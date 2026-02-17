"""
Sales Pydantic Schemas
"""
from pydantic import BaseModel
from typing import Optional
from datetime import date
from decimal import Decimal


class SalesResponse(BaseModel):
    """Sales response"""

    id: int
    orderId: str
    channel: str
    productId: int
    quantity: int
    unitPrice: float
    totalAmount: float
    orderDate: date
    deliveryDate: Optional[date] = None
    customerCity: Optional[str] = None
    customerState: Optional[str] = None
    paymentMethod: Optional[str] = None
    status: str
    commission: Optional[float] = None
    netRevenue: Optional[float] = None

    # Include product details
    productName: Optional[str] = None
    asgSku: Optional[str] = None

    class Config:
        from_attributes = True
