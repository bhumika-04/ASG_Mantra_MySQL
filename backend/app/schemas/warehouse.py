"""
Warehouse Pydantic Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class WarehouseChannel(str, Enum):
    """Warehouse Channel enum"""
    AMAZON = "Amazon"
    BLINKIT = "Blinkit"


class BlinkitWarehouseType(str, Enum):
    """Blinkit Warehouse Type enum"""
    FRONTEND = "Frontend"
    BACKEND = "Backend"


class AmazonFCType(str, Enum):
    """Amazon FC Type enum"""
    STANDARD = "Standard"
    SORTABLE = "Sortable"
    LARGE = "Large"
    SMALL = "Small"


class Region(str, Enum):
    """Region enum"""
    NORTH = "North"
    SOUTH = "South"
    EAST = "East"
    WEST = "West"
    CENTRAL = "Central"


class WarehouseCreate(BaseModel):
    """Create warehouse request"""
    warehouseCode: str = Field(..., min_length=1, max_length=50)
    warehouseName: str = Field(..., min_length=1, max_length=255)
    channel: WarehouseChannel
    location: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: str = Field(..., max_length=100)
    region: Optional[Region] = None

    # Amazon specific
    fcType: Optional[AmazonFCType] = None

    # Blinkit specific
    warehouseType: Optional[BlinkitWarehouseType] = None

    # Optional fields
    address: Optional[str] = Field(None, max_length=500)
    pincode: Optional[str] = Field(None, max_length=20)
    contactPerson: Optional[str] = Field(None, max_length=255)
    contactPhone: Optional[str] = Field(None, max_length=20)
    contactEmail: Optional[str] = Field(None, max_length=255)
    capacity: Optional[int] = None
    isActive: bool = True


class WarehouseUpdate(BaseModel):
    """Update warehouse request"""
    warehouseName: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=100)
    state: Optional[str] = Field(None, max_length=100)
    region: Optional[Region] = None
    fcType: Optional[AmazonFCType] = None
    warehouseType: Optional[BlinkitWarehouseType] = None
    address: Optional[str] = Field(None, max_length=500)
    pincode: Optional[str] = Field(None, max_length=20)
    contactPerson: Optional[str] = Field(None, max_length=255)
    contactPhone: Optional[str] = Field(None, max_length=20)
    contactEmail: Optional[str] = Field(None, max_length=255)
    capacity: Optional[int] = None
    isActive: Optional[bool] = None


class WarehouseResponse(BaseModel):
    """Warehouse response"""
    id: int
    warehouseCode: str
    warehouseName: str
    channel: str
    location: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    region: Optional[str] = None
    fcType: Optional[str] = None
    warehouseType: Optional[str] = None
    address: Optional[str] = None
    pincode: Optional[str] = None
    contactPerson: Optional[str] = None
    contactPhone: Optional[str] = None
    contactEmail: Optional[str] = None
    capacity: Optional[int] = None
    isActive: bool
    createdAt: Optional[datetime] = None

    class Config:
        from_attributes = True
