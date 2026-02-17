"""
Alert Model - SQLAlchemy ORM
Matches SQL table [dbo].[Alerts] in Script.sql
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class LowStockAlert(Base):
    __tablename__ = "Alerts"
    __table_args__ = {'implicit_returning': False}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ProductId = Column(Integer, ForeignKey("Products.Id"), nullable=False, index=True)
    Channel = Column(String(50), nullable=True)
    AlertType = Column(String(50), nullable=False, default="Low Stock")
    Severity = Column(String(20), nullable=False, index=True)
    Message = Column(String, nullable=False, default="")
    IsResolved = Column(Boolean, default=False, index=True)
    ResolvedBy = Column(UNIQUEIDENTIFIER, nullable=True)
    ResolvedAt = Column(DateTime, nullable=True)
    Remarks = Column(String, nullable=True)
    CreatedAt = Column(DateTime, default=func.getdate())

    # Relationships
    product = relationship("Product")

    def to_dict(self):
        return {
            "id": self.Id,
            "productId": self.ProductId,
            "channel": self.Channel,
            "alertType": self.AlertType,
            "severity": self.Severity,
            "message": self.Message,
            "isResolved": self.IsResolved,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
            "resolvedAt": self.ResolvedAt.isoformat() if self.ResolvedAt else None,
            "remarks": self.Remarks,
        }
