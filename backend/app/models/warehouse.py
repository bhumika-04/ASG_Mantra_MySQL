"""
Warehouse Model - SQLAlchemy ORM
Represents Amazon FC locations (Channel=Amazon) and Blinkit warehouses (Channel=Blinkit).
Linked to RK or Eagle distributors.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Warehouse(Base):
    __tablename__ = "Warehouses"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    Channel = Column(String(50), nullable=False, index=True)       # Amazon / Blinkit
    WarehouseName = Column(String(255), nullable=False)
    WarehouseCode = Column(String(50), unique=True, nullable=False, index=True)
    Location = Column(String(255), nullable=True)
    City = Column(String(100), nullable=True)
    State = Column(String(100), nullable=True)
    Region = Column(String(50), nullable=True)                     # North, South, East, West, Central

    # Amazon specific
    FCType = Column(String(50), nullable=True)                     # Standard, Sortable, Large, Small

    # Blinkit specific
    WarehouseType = Column(String(50), nullable=True)              # Frontend, Backend

    IsActive = Column(Boolean, default=True, index=True)
    CreatedAt = Column(DateTime, default=func.getdate())
    UpdatedAt = Column(DateTime, default=func.getdate(), onupdate=func.getdate())

    # Relationships
    sales = relationship("Sales", back_populates="warehouse")
    purchase_orders = relationship("PurchaseOrder", back_populates="warehouse")

    def to_dict(self):
        return {
            "id": self.Id,
            "channel": self.Channel,
            "warehouseName": self.WarehouseName,
            "warehouseCode": self.WarehouseCode,
            "location": self.Location,
            "city": self.City,
            "state": self.State,
            "region": self.Region,
            "fcType": self.FCType,
            "warehouseType": self.WarehouseType,
            "isActive": self.IsActive,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
