"""Purchase order request schemas."""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date
from enum import Enum


class POStatus(str, Enum):
    """PO Status enum"""

    CREATED = "Created"
    PACKED = "Packed"
    DISPATCHED = "Dispatched"
    IN_TRANSIT = "In Transit"
    DELIVERED = "Delivered"
    DELAYED = "Delayed"
    CANCELLED = "Cancelled"


class PurchaseOrderUpdate(BaseModel):
    """Update purchase order status request"""

    status: POStatus
    receivedQuantity: Optional[int] = Field(None, ge=0)
    actualDeliveryDate: Optional[date] = None
    trackingNumber: Optional[str] = Field(None, max_length=100)
    courier: Optional[str] = Field(None, max_length=100)
    remarks: Optional[str] = None
