"""
Product Pydantic Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal


class ProductCreate(BaseModel):
    """Create product request"""

    productName: str = Field(..., min_length=1, max_length=255)
    asgSku: str = Field(..., min_length=1, max_length=50)
    amazonId: Optional[str] = Field(None, max_length=50)
    blinkitId: Optional[str] = Field(None, max_length=50)
    gs1: Optional[str] = Field(None, max_length=50)
    category: Optional[str] = Field(None, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    unitPrice: Optional[Decimal] = Field(None, ge=0)
    unitWeight: Optional[str] = Field(None, max_length=50)
    packSize: Optional[int] = Field(None, ge=1)


class ProductUpdate(BaseModel):
    """Update product request"""

    productName: Optional[str] = Field(None, min_length=1, max_length=255)
    amazonId: Optional[str] = Field(None, max_length=50)
    blinkitId: Optional[str] = Field(None, max_length=50)
    category: Optional[str] = Field(None, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    unitPrice: Optional[Decimal] = Field(None, ge=0)
    isActive: Optional[bool] = None


class ProductResponse(BaseModel):
    """Product response"""

    id: int
    productName: str
    asgSku: str
    amazonId: Optional[str] = None
    blinkitId: Optional[str] = None
    gs1: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    unitPrice: Optional[float] = None
    unitWeight: Optional[str] = None
    packSize: Optional[int] = None
    isActive: bool

    class Config:
        from_attributes = True
