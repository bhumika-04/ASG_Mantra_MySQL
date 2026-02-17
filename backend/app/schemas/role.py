"""
Role Schemas - Pydantic models for request/response validation
"""
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class RoleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=500)
    permissions: List[str] = Field(..., min_items=1)


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    permissions: Optional[List[str]] = Field(None, min_items=1)


class RoleResponse(RoleBase):
    id: str
    is_locked: bool
    created_at: Optional[datetime]

    class Config:
        from_attributes = True
