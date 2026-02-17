"""
DistributorStock Model - SQLAlchemy ORM
Replaces the Eagle-specific EagleStock table.

Both distributors send weekly stock reports:
  Eagle (Id=2) → Blinkit channel  — dispatched to Blinkit DCs
  RK    (Id=1) → Amazon channel   — dispatched to Amazon FCs

Table: DistributorStock
SQL (run once):
    CREATE TABLE DistributorStock (
        Id            INT IDENTITY(1,1) PRIMARY KEY,
        ReportDate    DATE NOT NULL,
        DistributorId INT NULL REFERENCES Distributors(Id),
        ItemName      NVARCHAR(300) NOT NULL,
        OpeningQty    INT NULL,
        ClosingQty    INT NULL,
        SaleQty       INT NULL,
        CreatedAt     DATETIME DEFAULT GETDATE()
    );
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class DistributorStockData(Base):
    __tablename__ = "DistributorStock"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ReportDate = Column(Date, nullable=False)
    DistributorId = Column(Integer, ForeignKey('Distributors.Id'), nullable=True)

    # Product
    ItemName = Column(String(300), nullable=False)

    # Weekly stock movement
    OpeningQty = Column(Integer, nullable=True)   # Stock at start of week
    ClosingQty = Column(Integer, nullable=True)    # Current stock at distributor warehouse
    SaleQty = Column(Integer, nullable=True)       # Units dispatched to platform this week

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "reportDate": self.ReportDate.isoformat() if self.ReportDate else None,
            "distributorId": self.DistributorId,
            "itemName": self.ItemName,
            "openingQty": self.OpeningQty,
            "closingQty": self.ClosingQty,
            "saleQty": self.SaleQty,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
