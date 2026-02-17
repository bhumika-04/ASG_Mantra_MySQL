"""
User Pydantic Schemas
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


class UserRole(str, Enum):
    """User roles enum"""

    ADMIN = "Admin"
    MANAGER = "Manager"
    AMAZON_DISTRIBUTOR = "Amazon Distributor"
    BLINKIT_DISTRIBUTOR = "Blinkit Distributor"


class UserLogin(BaseModel):
    """User login request"""

    email: EmailStr
    password: str = Field(..., min_length=6)


class UserCreate(BaseModel):
    """Create user request"""

    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=6)
    role: UserRole
    avatar: Optional[str] = None


class UserUpdate(BaseModel):
    """Update user request"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=6)
    role: Optional[UserRole] = None
    avatar: Optional[str] = None
    isActive: Optional[bool] = None


class UserResponse(BaseModel):
    """User response"""

    id: str
    name: str
    email: str
    role: str
    avatar: Optional[str] = None
    isActive: bool
    createdAt: Optional[datetime] = None
    lastLogin: Optional[datetime] = None
    permissions: List[str] = []

    class Config:
        from_attributes = True


class Token(BaseModel):
    """JWT token response"""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenData(BaseModel):
    """Token payload data"""

    user_id: str
    email: str
    role: str
