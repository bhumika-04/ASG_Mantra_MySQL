"""
Purchase Order Pydantic Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime
from enum import Enum


class POChannel(str, Enum):
    """PO Channel enum"""

    AMAZON = "Amazon"
    BLINKIT = "Blinkit"


class POStatus(str, Enum):
    """PO Status enum"""

    CREATED = "Created"
    PACKED = "Packed"
    DISPATCHED = "Dispatched"
    IN_TRANSIT = "In Transit"
    DELIVERED = "Delivered"
    DELAYED = "Delayed"
    CANCELLED = "Cancelled"


class PurchaseOrderCreate(BaseModel):
    """Create purchase order request"""

    poNumber: str = Field(..., min_length=1, max_length=50)
    channel: POChannel
    productId: int
    quantity: int = Field(..., gt=0)
    unitPrice: float = Field(..., gt=0)
    orderDate: Optional[date] = None
    expectedDeliveryDate: Optional[date] = None
    warehouseId: Optional[int] = None
    hub: Optional[str] = Field(None, max_length=100)
    courier: Optional[str] = Field(None, max_length=100)
    trackingNumber: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None


class PurchaseOrderUpdate(BaseModel):
    """Update purchase order status request"""

    status: POStatus
    receivedQuantity: Optional[int] = Field(None, ge=0)
    actualDeliveryDate: Optional[date] = None
    trackingNumber: Optional[str] = Field(None, max_length=100)
    courier: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None


class PurchaseOrderResponse(BaseModel):
    """Purchase order response"""

    id: int
    poNumber: str
    channel: str
    productId: int
    warehouseId: Optional[int] = None
    quantity: int
    receivedQuantity: Optional[int] = None
    unitPrice: Optional[float] = None
    totalAmount: Optional[float] = None
    orderDate: Optional[date] = None
    expectedDeliveryDate: Optional[date] = None
    actualDeliveryDate: Optional[date] = None
    hubCode: Optional[str] = None
    city: Optional[str] = None
    courier: Optional[str] = None
    trackingNumber: Optional[str] = None
    status: str
    isDelayed: Optional[bool] = None
    remarks: Optional[str] = None
    createdAt: Optional[datetime] = None

    # Include product details
    productName: Optional[str] = None
    asgSku: Optional[str] = None

    class Config:
        from_attributes = True
