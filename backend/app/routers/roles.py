"""
Roles Router - Role Management
Handles role CRUD operations
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import json

from app.database import get_db
from app.models.user import User
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate, RoleResponse
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("", response_model=List[RoleResponse], include_in_schema=False)
@router.get("/", response_model=List[RoleResponse])
async def get_all_roles(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all roles
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can view roles")

    roles = db.query(Role).all()
    return [role.to_dict() for role in roles]


@router.get("/{role_id}", response_model=RoleResponse)
async def get_role_by_id(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get a single role by ID
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can view roles")

    role = db.query(Role).filter(Role.Id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    return role.to_dict()


@router.post("", response_model=RoleResponse, include_in_schema=False)
@router.post("/", response_model=RoleResponse)
async def create_role(
    role_data: RoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new role
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can create roles")

    # Check if role name already exists
    existing_role = db.query(Role).filter(Role.Name == role_data.name).first()
    if existing_role:
        raise HTTPException(status_code=400, detail="Role name already exists")

    # Create new role
    new_role = Role(
        Name=role_data.name,
        Description=role_data.description,
        Permissions=json.dumps(role_data.permissions),
        IsLocked=False,
    )

    try:
        db.add(new_role)
        db.commit()
        db.refresh(new_role)
        return new_role.to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create role: {str(e)}")


@router.put("/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: int,
    role_data: RoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update an existing role
    Admin only - Cannot update locked roles
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can update roles")

    role = db.query(Role).filter(Role.Id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    # Prevent editing locked/system roles
    if role.IsLocked or role.Name.lower() == "admin":
        raise HTTPException(status_code=403, detail="Cannot edit system roles")

    # Update fields if provided
    if role_data.name is not None:
        # Check if new name conflicts with existing role
        existing = db.query(Role).filter(Role.Name == role_data.name, Role.Id != role_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Role name already exists")
        role.Name = role_data.name

    if role_data.description is not None:
        role.Description = role_data.description

    if role_data.permissions is not None:
        role.Permissions = json.dumps(role_data.permissions)

    try:
        db.commit()
        db.refresh(role)
        return role.to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update role: {str(e)}")


@router.delete("/{role_id}")
async def delete_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a role
    Admin only - Cannot delete locked roles or Admin role
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can delete roles")

    role = db.query(Role).filter(Role.Id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    # Prevent deleting locked/system roles
    if role.IsLocked or role.Name.lower() == "admin":
        raise HTTPException(status_code=403, detail="Cannot delete system roles")

    # Check if any users have this role
    users_with_role = db.query(User).filter(User.Role == role.Name).count()
    if users_with_role > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete role. {users_with_role} user(s) are assigned this role"
        )

    try:
        db.delete(role)
        db.commit()
        return {"success": True, "message": f"Role '{role.Name}' deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete role: {str(e)}")
