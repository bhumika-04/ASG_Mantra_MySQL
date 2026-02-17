"""
Alert Pydantic Schemas
"""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class AlertResolve(BaseModel):
    """Resolve alert request"""
    remarks: Optional[str] = None


class AlertResponse(BaseModel):
    """Alert response"""
    id: int
    productId: int
    channel: Optional[str] = None
    alertType: str
    severity: str
    message: str
    isResolved: bool
    resolvedAt: Optional[datetime] = None
    remarks: Optional[str] = None
    createdAt: Optional[datetime] = None

    # Product details
    productName: Optional[str] = None
    asgSku: Optional[str] = None

    class Config:
        from_attributes = True
