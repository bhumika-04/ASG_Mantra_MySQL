"""
AsgWarehouse Model - SQLAlchemy ORM
ASG Mantra's own internal warehouses.
Stock here is in packed/unpacked state before dispatch to distributors (RK/Eagle).
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class AsgWarehouse(Base):
    __tablename__ = "AsgWarehouses"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    WarehouseName = Column(String(100), nullable=False)   # e.g. "ASG Warehouse 1"
    City = Column(String(100), nullable=True)
    State = Column(String(100), nullable=True)
    Active = Column(Boolean, default=True)
    CreatedAt = Column(DateTime, default=func.getdate())

    # Relationships
    inventory = relationship("Inventory", back_populates="asg_warehouse")

    def to_dict(self):
        return {
            "id": self.Id,
            "warehouseName": self.WarehouseName,
            "city": self.City,
            "state": self.State,
            "active": self.Active,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
