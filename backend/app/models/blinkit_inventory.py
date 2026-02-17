"""
BlinkitInventory Model - SQLAlchemy ORM
Source: Blinkit_Inventory Report_DD.MM.YY.csv
Table managed via SQL script: database/blinkit_tables.sql
Per-facility rows (NOT aggregated — preserves warehouse-level detail)
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class BlinkitInventoryData(Base):
    __tablename__ = "BlinkitInventory"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ReportDate = Column(Date, nullable=False)
    DistributorId = Column(Integer, ForeignKey('Distributors.Id'), nullable=True)

    # Warehouse / Facility
    BackendFacilityName = Column(String(200), nullable=True)
    BackendFacilityId = Column(Integer, nullable=True)

    # Product
    ItemId = Column(String(50), nullable=False)
    ItemName = Column(String(300), nullable=True)

    # Stock Quantities
    BackendInvQty = Column(Integer, nullable=True)
    FrontendInvQty = Column(Integer, nullable=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "distributorId": self.DistributorId,
            "reportDate": self.ReportDate.isoformat() if self.ReportDate else None,
            "backendFacilityName": self.BackendFacilityName,
            "backendFacilityId": self.BackendFacilityId,
            "itemId": self.ItemId,
            "itemName": self.ItemName,
            "backendInvQty": self.BackendInvQty,
            "frontendInvQty": self.FrontendInvQty,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
