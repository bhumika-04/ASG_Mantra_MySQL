"""
Inventory Model - SQLAlchemy ORM
ASG internal warehouse stock (Packed/Unpacked quantities).
Platform-specific inventory lives in AmazonInventory / BlinkitInventory tables.
"""
from sqlalchemy import Column, Integer, DateTime, Date, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class Inventory(Base):
    __tablename__ = "Inventory"
    __table_args__ = (
        UniqueConstraint('ProductId', 'AsgWarehouseId', 'InventoryDate', name='UX_Inventory_Product_Warehouse_Date'),
        {'implicit_returning': False},  # MSSQL: avoid OUTPUT clause conflict with triggers
    )

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ProductId = Column(Integer, ForeignKey("Products.Id"), nullable=False, index=True)
    AsgWarehouseId = Column(Integer, ForeignKey("AsgWarehouses.Id"), nullable=True)

    # Inventory levels
    CurrentStock = Column(Integer, nullable=False, default=0)  # Total = Packed + Unpacked
    PackedQty = Column(Integer, nullable=False, default=0)     # Ready-to-ship inventory
    UnpackedQty = Column(Integer, nullable=False, default=0)   # Raw/unpackaged inventory

    # Date-wise snapshot
    InventoryDate = Column(Date, nullable=False, default=func.getdate())  # One row per product/warehouse/date

    # Tracking
    LastInventoryDate = Column(Date, nullable=True)  # Date of last inventory upload
    LastUpdated = Column(DateTime, default=func.getdate(), onupdate=func.getdate())
    UpdatedBy = Column(UNIQUEIDENTIFIER, nullable=True)

    # Relationships
    product = relationship("Product", back_populates="inventory")
    asg_warehouse = relationship("AsgWarehouse", back_populates="inventory")

    def to_dict(self):
        return {
            "id": self.Id,
            "productId": self.ProductId,
            "asgWarehouseId": self.AsgWarehouseId,
            "currentStock": self.CurrentStock,
            "packedQty": self.PackedQty,
            "unpackedQty": self.UnpackedQty,
            "inventoryDate": self.InventoryDate.isoformat() if self.InventoryDate else None,
            "lastInventoryDate": self.LastInventoryDate.isoformat() if self.LastInventoryDate else None,
            "lastUpdated": self.LastUpdated.isoformat() if self.LastUpdated else None,
        }

    @property
    def is_out_of_stock(self):
        """Check if inventory is zero"""
        return self.CurrentStock == 0
