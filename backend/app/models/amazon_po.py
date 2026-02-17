"""
AmazonPO Model - SQLAlchemy ORM (PO Header)
Source: PO PDFs (extracted data)
Table managed via SQL script: database/amazon_tables.sql
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, DECIMAL
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class AmazonPOData(Base):
    __tablename__ = "AmazonPO"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)

    # PO Header
    PONumber = Column(String(30), nullable=False, unique=True)
    POStatus = Column(String(50), nullable=True)
    VendorCode = Column(String(50), nullable=True)
    ShipToLocationCode = Column(String(50), nullable=True)
    ShipToCity = Column(String(100), nullable=True)
    ShipToState = Column(String(100), nullable=True)
    OrderedOnDate = Column(Date, nullable=True)
    ShipWindowStartDate = Column(Date, nullable=True)
    ShipWindowEndDate = Column(Date, nullable=True)
    FreightTerms = Column(String(50), nullable=True)
    PaymentMethod = Column(String(50), nullable=True)
    PaymentTerms = Column(String(100), nullable=True)
    PurchasingEntityName = Column(String(200), nullable=True)

    # Summary - Submitted
    SubmittedItems = Column(Integer, nullable=True)
    SubmittedQuantity = Column(Integer, nullable=True)
    SubmittedTotalCost = Column(DECIMAL(15, 2), nullable=True)

    # Summary - Accepted
    AcceptedItems = Column(Integer, nullable=True)
    AcceptedQuantity = Column(Integer, nullable=True)
    AcceptedTotalCost = Column(DECIMAL(15, 2), nullable=True)

    # Summary - Cancelled
    CancelledItems = Column(Integer, nullable=True)
    CancelledQuantity = Column(Integer, nullable=True)
    CancelledTotalCost = Column(DECIMAL(15, 2), nullable=True)

    # Summary - Received
    ReceivedItems = Column(Integer, nullable=True)
    ReceivedQuantity = Column(Integer, nullable=True)
    ReceivedTotalCost = Column(DECIMAL(15, 2), nullable=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    # Relationships
    items = relationship("AmazonPOItemData", back_populates="po", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.Id,
            "poNumber": self.PONumber,
            "poStatus": self.POStatus,
            "vendorCode": self.VendorCode,
            "shipToCity": self.ShipToCity,
            "shipToState": self.ShipToState,
            "orderedOnDate": self.OrderedOnDate.isoformat() if self.OrderedOnDate else None,
            "submittedQuantity": self.SubmittedQuantity,
            "submittedTotalCost": float(self.SubmittedTotalCost) if self.SubmittedTotalCost else None,
            "acceptedQuantity": self.AcceptedQuantity,
            "receivedQuantity": self.ReceivedQuantity,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
