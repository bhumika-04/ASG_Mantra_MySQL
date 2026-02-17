"""
Product Model - SQLAlchemy ORM
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, DECIMAL
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Product(Base):
    __tablename__ = "Products"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ProductName = Column(String(255), nullable=False, index=True)
    AsgSku = Column(String(50), unique=True, nullable=False, index=True)
    AmazonId = Column(String(50), nullable=True, index=True)
    BlinkitId = Column(String(50), nullable=True, index=True)
    Gs1 = Column(String(50), nullable=True)
    Category = Column(String(100), nullable=True, index=True)
    Brand = Column(String(100), nullable=True)
    UnitPrice = Column(DECIMAL(10, 2), nullable=True)
    UnitWeight = Column(String(50), nullable=True)  # e.g., "1KG", "15ML", "500G"
    PackSize = Column(Integer, nullable=True)  # Number of units per pack
    IsActive = Column(Boolean, default=True, index=True)
    CreatedAt = Column(DateTime, default=func.getdate())
    UpdatedAt = Column(DateTime, default=func.getdate(), onupdate=func.getdate())
    CreatedBy = Column(UNIQUEIDENTIFIER, nullable=True)

    # Relationships
    inventory = relationship("Inventory", back_populates="product")  # Multiple records (one per channel)
    sales = relationship("Sales", back_populates="product")
    purchase_orders = relationship("PurchaseOrder", back_populates="product")

    def to_dict(self):
        return {
            "id": self.Id,
            "productName": self.ProductName,
            "asgSku": self.AsgSku,
            "amazonId": self.AmazonId,
            "blinkitId": self.BlinkitId,
            "gs1": self.Gs1,
            "category": self.Category,
            "brand": self.Brand,
            "unitPrice": float(self.UnitPrice) if self.UnitPrice else None,
            "unitWeight": self.UnitWeight,
            "packSize": self.PackSize,
            "isActive": self.IsActive,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
