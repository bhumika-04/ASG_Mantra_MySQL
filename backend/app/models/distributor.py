"""
Distributor Model - SQLAlchemy ORM
Master table for distributors: RK (Amazon) and Eagle (Blinkit)
Workflow: ASG → Distributor → Channel
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from ..database import Base


class Distributor(Base):
    __tablename__ = "Distributors"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    DistributorName = Column(String(100), nullable=False)        # RK, Eagle
    Channel = Column(String(20), nullable=False)                 # Amazon, Blinkit
    ContactPerson = Column(String(100), nullable=True)
    Phone = Column(String(20), nullable=True)
    Email = Column(String(100), nullable=True)
    Active = Column(Boolean, default=True)
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "distributorName": self.DistributorName,
            "channel": self.Channel,
            "contactPerson": self.ContactPerson,
            "phone": self.Phone,
            "email": self.Email,
            "active": self.Active,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
