"""
Users Router - User Management
Handles user CRUD operations (Admin only)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate, UserResponse
from app.utils.security import hash_password
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def get_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all users
    Admin only
    """
    # Check permissions
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can view all users")

    users = db.query(User).filter(User.IsActive == True).all()

    return [
        {
            "id": str(user.Id),
            "name": user.Name,
            "email": user.Email,
            "role": user.Role,
            "is_active": user.IsActive,
            "created_at": user.CreatedAt.isoformat() if user.CreatedAt else None,
        }
        for user in users
    ]


@router.get("/{user_id}")
async def get_user_by_id(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get a single user by ID
    Admin only
    """
    # Check permissions
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can view user details")

    user = db.query(User).filter(User.Id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": str(user.Id),
        "name": user.Name,
        "email": user.Email,
        "role": user.Role,
        "is_active": user.IsActive,
        "created_at": user.CreatedAt.isoformat() if user.CreatedAt else None,
    }


@router.post("", include_in_schema=False)
@router.post("/")
async def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new user
    Admin only
    """
    # Check permissions
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can create users")

    # Check if email already exists
    existing = db.query(User).filter(User.Email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    # Hash password
    hashed_password = hash_password(user_data.password)

    # Create new user
    new_user = User(
        Name=user_data.name,
        Email=user_data.email,
        PasswordHash=hashed_password,
        Role=user_data.role,
        IsActive=True,
        CreatedAt=datetime.utcnow(),
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        return {
            "success": True,
            "message": "User created successfully",
            "data": {
                "id": str(new_user.Id),
                "name": new_user.Name,
                "email": new_user.Email,
                "role": new_user.Role,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create user: {str(e)}")


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    user_data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update a user
    Admin only
    """
    # Check permissions
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can update users")

    user = db.query(User).filter(User.Id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update fields if provided
    if user_data.name is not None:
        user.Name = user_data.name

    if user_data.email is not None:
        # Check if new email conflicts with another user
        existing = db.query(User).filter(
            User.Email == user_data.email,
            User.Id != user_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Another user with this email already exists")
        user.Email = user_data.email

    if user_data.password is not None:
        user.PasswordHash = hash_password(user_data.password)

    if user_data.role is not None:
        user.Role = user_data.role

    if user_data.isActive is not None:
        user.IsActive = user_data.isActive

    try:
        db.commit()
        db.refresh(user)

        return {
            "success": True,
            "message": "User updated successfully",
            "data": {
                "id": str(user.Id),
                "name": user.Name,
                "email": user.Email,
                "role": user.Role,
                "is_active": user.IsActive,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a user (soft delete by setting IsActive = False)
    Admin only
    """
    # Check permissions
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can delete users")

    # Prevent self-deletion
    if str(current_user.Id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(User).filter(User.Id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Soft delete by setting IsActive to False
    user.IsActive = False

    try:
        db.commit()
        return {
            "success": True,
            "message": "User deactivated successfully"
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
