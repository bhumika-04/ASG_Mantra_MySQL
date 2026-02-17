"""
DistributorFacility Model - SQLAlchemy ORM
Eagle Network facilities (Backend & Frontend)
Only Blinkit distributor (Eagle) has facilities.
Amazon distributor (RK) has no tracked facilities.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class DistributorFacility(Base):
    __tablename__ = "DistributorFacilities"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    DistributorId = Column(Integer, ForeignKey("Distributors.Id"), nullable=False)
    FacilityName = Column(String(200), nullable=False)
    FacilityType = Column(String(20), nullable=False)   # Backend / Frontend
    City = Column(String(100), nullable=True)
    State = Column(String(100), nullable=True)
    Active = Column(Boolean, default=True)
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "distributorId": self.DistributorId,
            "facilityName": self.FacilityName,
            "facilityType": self.FacilityType,
            "city": self.City,
            "state": self.State,
            "active": self.Active,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
