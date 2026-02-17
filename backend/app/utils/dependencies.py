"""
FastAPI Dependencies - Authorization and permissions
"""
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models.user import User
from ..models.role import Role
from .auth import get_current_user
import json


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """
    Get current active user (must be active)

    Args:
        current_user: Current authenticated user

    Returns:
        User object if active

    Raises:
        HTTPException: If user is not active
    """
    if not current_user.IsActive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return current_user


def check_permission(allowed_roles: list[str]):
    """
    Check if user has required role

    Args:
        allowed_roles: List of allowed role names

    Returns:
        Dependency function that checks user role

    Raises:
        HTTPException: If user doesn't have required role
    """

    def permission_checker(current_user: User = Depends(get_current_active_user)):
        if current_user.Role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not enough permissions. Required roles: {', '.join(allowed_roles)}",
            )
        return current_user

    return permission_checker


# Pre-defined permission checkers (role names must match DB values exactly)
admin_only = check_permission(["Admin"])
admin_or_manager = check_permission(["Admin", "Manager"])
amazon_access = check_permission(["Admin", "Manager", "Amazon Distributor"])
blinkit_access = check_permission(["Admin", "Manager", "Blinkit Distributor"])


def require_permissions(required_permissions: list[str]):
    """
    Check if user has required permissions from their role

    Args:
        required_permissions: List of required permission IDs

    Returns:
        Dependency function that checks user permissions from database

    Raises:
        HTTPException: If user doesn't have required permissions
    """

    def permission_checker(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db)
    ):
        # Get user's role permissions from database
        role = db.query(Role).filter(Role.Name == current_user.Role).first()

        if not role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User role not found",
            )

        # Parse permissions from JSON
        user_permissions = json.loads(role.Permissions) if role.Permissions else []

        # Check if user has all required permissions
        missing_permissions = [p for p in required_permissions if p not in user_permissions]

        if missing_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(missing_permissions)}",
            )

        return current_user

    return permission_checker


def get_user_permissions(current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)) -> list[str]:
    """
    Get current user's permissions from their role

    Args:
        current_user: Current authenticated user
        db: Database session

    Returns:
        List of permission IDs the user has
    """
    role = db.query(Role).filter(Role.Name == current_user.Role).first()

    if not role:
        return []

    return json.loads(role.Permissions) if role.Permissions else []
