"""
Authentication Router - Login, Logout, Token Management
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..models.user import User
from ..models.role import Role
from ..schemas.user import UserLogin, Token, UserResponse
from ..utils.security import verify_password
from ..utils.auth import create_access_token, get_current_user

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(user_credentials: UserLogin, db: Session = Depends(get_db)):
    """
    User login endpoint

    - Validates email and password
    - Returns JWT access token
    - Updates last login timestamp
    """
    # Find user by email
    user = db.query(User).filter(User.Email == user_credentials.email).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Verify password
    password_match = verify_password(user_credentials.password, user.PasswordHash)

    if not password_match:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # Check if user is active
    if not user.IsActive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    # Update last login
    user.LastLogin = datetime.utcnow()
    db.commit()

    # Get user's role permissions from database
    permissions = []
    role = db.query(Role).filter(Role.Name == user.Role).first()
    if role:
        import json
        permissions = json.loads(role.Permissions) if role.Permissions else []

    # Create access token
    access_token = create_access_token(
        data={
            "user_id": str(user.Id),
            "email": user.Email,
            "role": user.Role,
        }
    )

    # Return token and user info with permissions
    return Token(
        access_token=access_token,
        user=UserResponse(
            id=str(user.Id),
            name=user.Name,
            email=user.Email,
            role=user.Role,
            avatar=user.Avatar,
            isActive=user.IsActive,
            createdAt=user.CreatedAt,
            lastLogin=user.LastLogin,
            permissions=permissions,
        ),
    )


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """
    User logout endpoint

    - Invalidates token (client-side)
    - In production, add token to blacklist
    """
    return {"message": "Successfully logged out", "status": "success"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Get current authenticated user information with permissions
    """
    # Get user's role permissions from database
    permissions = []
    role = db.query(Role).filter(Role.Name == current_user.Role).first()
    if role:
        import json
        permissions = json.loads(role.Permissions) if role.Permissions else []

    return UserResponse(
        id=str(current_user.Id),
        name=current_user.Name,
        email=current_user.Email,
        role=current_user.Role,
        avatar=current_user.Avatar,
        isActive=current_user.IsActive,
        createdAt=current_user.CreatedAt,
        lastLogin=current_user.LastLogin,
        permissions=permissions,
    )
