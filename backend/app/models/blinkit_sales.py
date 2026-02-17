"""
BlinkitSales Model - SQLAlchemy ORM
Source: Blinkit daily CSV (sales_DD.MM.YY-DD.MM.YY.csv)
Table managed via SQL script: database/blinkit_tables.sql
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, DECIMAL
from sqlalchemy.sql import func
from ..database import Base


class BlinkitSalesData(Base):
    __tablename__ = "BlinkitSales"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    SaleDate = Column(Date, nullable=False)

    # Product & Manufacturer
    ItemId = Column(Integer, nullable=False)
    ItemName = Column(String(300), nullable=True)
    ManufacturerId = Column(Integer, nullable=True)
    ManufacturerName = Column(String(200), nullable=True)

    # Location
    CityId = Column(Integer, nullable=True)
    CityName = Column(String(100), nullable=True)

    # Sales Data
    Category = Column(String(100), nullable=True)
    QtySold = Column(DECIMAL(10, 2), nullable=True)
    MRP = Column(DECIMAL(15, 2), nullable=True)  # Total revenue (qty x unit_price)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "saleDate": self.SaleDate.isoformat() if self.SaleDate else None,
            "itemId": self.ItemId,
            "itemName": self.ItemName,
            "manufacturerName": self.ManufacturerName,
            "cityName": self.CityName,
            "category": self.Category,
            "qtySold": float(self.QtySold) if self.QtySold else None,
            "mrp": float(self.MRP) if self.MRP else None,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
