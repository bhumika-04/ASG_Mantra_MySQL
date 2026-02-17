"""
EagleStock Model - SQLAlchemy ORM
Eagle Network = Blinkit Distributor
Workflow: ASG → Eagle (Distributor) → Blinkit

Eagle sends weekly stock report (Excel) every Monday.
This table records per-item stock levels at Eagle's warehouse.
"""
from sqlalchemy import Column, Integer, String, Date, DateTime
from sqlalchemy.sql import func
from ..database import Base


class EagleStockData(Base):
    __tablename__ = "EagleStock"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ReportDate = Column(Date, nullable=False)

    # Product
    ItemName = Column(String(300), nullable=False)

    # Stock movement for the week
    OpeningQty = Column(Integer, nullable=True)   # Stock at start of week
    ClosingQty = Column(Integer, nullable=True)    # Current stock at Eagle warehouse
    SaleQty = Column(Integer, nullable=True)       # Units dispatched to Blinkit this week

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "reportDate": self.ReportDate.isoformat() if self.ReportDate else None,
            "itemName": self.ItemName,
            "openingQty": self.OpeningQty,
            "closingQty": self.ClosingQty,
            "saleQty": self.SaleQty,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
