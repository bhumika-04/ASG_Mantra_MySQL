"""
Purchase Order Model - SQLAlchemy ORM
Aligned with schema-updated.sql
"""
from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey, DECIMAL
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class PurchaseOrder(Base):
    __tablename__ = "PurchaseOrders"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    PoNumber = Column(String(50), nullable=False, index=True)
    Channel = Column(String(50), nullable=False, index=True)
    ProductId = Column(Integer, ForeignKey("Products.Id"), nullable=False, index=True)
    WarehouseId = Column(Integer, ForeignKey("Warehouses.Id"), nullable=True)

    # Quantities
    Quantity = Column(Integer, nullable=False)
    ReceivedQuantity = Column(Integer, default=0)

    # Pricing
    UnitPrice = Column(DECIMAL(10, 2), nullable=False)
    TotalAmount = Column(DECIMAL(10, 2), nullable=False)

    # Dates
    OrderDate = Column(Date, nullable=False)
    ExpectedDeliveryDate = Column(Date, nullable=True)
    ActualDeliveryDate = Column(Date, nullable=True)

    # Location & Shipping (from actual PO files)
    HubCode = Column(String(100), nullable=True)  # FC/Hub from PO
    City = Column(String(100), nullable=True)  # Delivery city
    Courier = Column(String(100), nullable=True)  # Courier name
    TrackingNumber = Column(String(100), nullable=True)  # Future use

    # GAP 5: Manual status management
    Status = Column(String(50), nullable=False, default='Created', index=True)
    IsDelayed = Column(Boolean, default=False)  # Used by VW_DashboardInventoryStats & VW_PlatformComparison
    Remarks = Column(String, nullable=True)

    CreatedAt = Column(DateTime, default=func.getdate())
    UpdatedAt = Column(DateTime, default=func.getdate(), onupdate=func.getdate())
    CreatedBy = Column(UNIQUEIDENTIFIER, nullable=True)
    UpdatedBy = Column(UNIQUEIDENTIFIER, nullable=True)

    # Relationships
    product = relationship("Product", back_populates="purchase_orders")
    warehouse = relationship("Warehouse", back_populates="purchase_orders")

    def to_dict(self):
        return {
            "id": self.Id,
            "poNumber": self.PoNumber,
            "channel": self.Channel,
            "productId": self.ProductId,
            "warehouseId": self.WarehouseId,
            "quantity": self.Quantity,
            "receivedQuantity": self.ReceivedQuantity,
            "unitPrice": float(self.UnitPrice) if self.UnitPrice else None,
            "totalAmount": float(self.TotalAmount) if self.TotalAmount else None,
            "orderDate": self.OrderDate.isoformat() if self.OrderDate else None,
            "expectedDeliveryDate": self.ExpectedDeliveryDate.isoformat() if self.ExpectedDeliveryDate else None,
            "actualDeliveryDate": self.ActualDeliveryDate.isoformat() if self.ActualDeliveryDate else None,
            "hubCode": self.HubCode,
            "city": self.City,
            "courier": self.Courier,
            "trackingNumber": self.TrackingNumber,
            "status": self.Status,
            "isDelayed": self.IsDelayed,
            "remarks": self.Remarks,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
            "updatedAt": self.UpdatedAt.isoformat() if self.UpdatedAt else None,
        }
