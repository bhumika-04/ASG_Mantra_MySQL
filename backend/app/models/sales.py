"""
Sales Model - SQLAlchemy ORM
GAP 1 SOLUTION: OrderId is NULLABLE (Amazon sales have no Order IDs - aggregated data)
GAP 2 SOLUTION: Customer fields NULLABLE (Blinkit only has customer data)
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, DECIMAL, Computed
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Sales(Base):
    __tablename__ = "Sales"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    # GAP 1: OrderId NULLABLE for Amazon (product-day aggregates without order IDs)
    OrderId = Column(String(100), nullable=True, index=True)
    Channel = Column(String(50), nullable=False, index=True)
    ProductId = Column(Integer, ForeignKey("Products.Id"), nullable=False, index=True)
    WarehouseId = Column(Integer, ForeignKey("Warehouses.Id"), nullable=True)
    Quantity = Column(Integer, nullable=False)
    UnitPrice = Column(DECIMAL(10, 2), nullable=False)
    TotalAmount = Column(DECIMAL(10, 2), nullable=False)
    OrderDate = Column(Date, nullable=False, index=True)
    DeliveryDate = Column(Date, nullable=True)
    # GAP 2: Customer data - Blinkit only (Amazon files don't have customer info)
    CustomerCity = Column(String(100), nullable=True)
    CustomerState = Column(String(100), nullable=True)
    PaymentMode = Column(String(50), nullable=True)  # Blinkit: COD/Online
    Status = Column(String(50), nullable=False, index=True)
    Commission = Column(DECIMAL(10, 2), nullable=True)
    NetRevenue = Column(DECIMAL(10, 2), Computed("TotalAmount - ISNULL(Commission, 0)"))
    CreatedAt = Column(DateTime, default=func.getdate())
    UpdatedAt = Column(DateTime, default=func.getdate(), onupdate=func.getdate())

    # Relationships
    product = relationship("Product", back_populates="sales")
    warehouse = relationship("Warehouse", back_populates="sales")

    def to_dict(self):
        return {
            "id": self.Id,
            "orderId": self.OrderId,  # May be None for Amazon
            "channel": self.Channel,
            "productId": self.ProductId,
            "warehouseId": self.WarehouseId,
            "quantity": self.Quantity,
            "unitPrice": float(self.UnitPrice),
            "totalAmount": float(self.TotalAmount),
            "orderDate": self.OrderDate.isoformat() if self.OrderDate else None,
            "deliveryDate": self.DeliveryDate.isoformat() if self.DeliveryDate else None,
            "customerCity": self.CustomerCity,
            "customerState": self.CustomerState,
            "paymentMode": self.PaymentMode,
            "status": self.Status,
            "commission": float(self.Commission) if self.Commission else None,
            "netRevenue": float(self.NetRevenue) if self.NetRevenue else None,
        }
