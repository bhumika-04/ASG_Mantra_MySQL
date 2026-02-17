"""
Inventory Pydantic Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime


class InventoryUpdate(BaseModel):
    """Update inventory request"""

    packedQty: Optional[int] = Field(None, ge=0)
    unpackedQty: Optional[int] = Field(None, ge=0)
    reorderLevel: Optional[int] = Field(None, ge=0)
    maxStockLevel: Optional[int] = Field(None, ge=0)


class InventoryResponse(BaseModel):
    """Inventory response"""

    id: int
    productId: int
    channel: str
    warehouseId: Optional[int] = None
    currentStock: int
    packedQty: int
    unpackedQty: int
    reorderLevel: Optional[int] = None
    maxStockLevel: Optional[int] = None
    lastInventoryDate: Optional[date] = None
    lastUpdated: Optional[datetime] = None

    # Include product details
    productName: Optional[str] = None
    asgSku: Optional[str] = None

    class Config:
        from_attributes = True
