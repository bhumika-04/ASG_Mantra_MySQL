"""
BlinkitPO Model - SQLAlchemy ORM (PO Header)
Source: Eagle Network Supply PO PDFs
Table managed via SQL script: database/blinkit_tables.sql
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, DECIMAL
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class BlinkitPOData(Base):
    __tablename__ = "BlinkitPO"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)

    # PO Header
    PONumber = Column(String(30), nullable=False, unique=True)
    PODate = Column(Date, nullable=True)
    POReleaseDate = Column(Date, nullable=True)
    POExpiryDate = Column(Date, nullable=True)
    PaymentTerms = Column(String(50), nullable=True)
    FreightTerms = Column(String(50), nullable=True)
    ExpectedDeliveryDate = Column(Date, nullable=True)

    # Vendor Info
    VendorCode = Column(String(50), nullable=True)
    VendorName = Column(String(200), nullable=True)
    VendorGSTIN = Column(String(20), nullable=True)
    VendorPAN = Column(String(15), nullable=True)

    # Issuer
    IssuerName = Column(String(200), nullable=True)
    IssuerGSTIN = Column(String(20), nullable=True)

    # Bill To
    BillToName = Column(String(200), nullable=True)
    BillToAddress = Column(String(500), nullable=True)
    BillToGSTIN = Column(String(20), nullable=True)

    # Ship To
    ShipToName = Column(String(200), nullable=True)
    ShipToAddress = Column(String(500), nullable=True)
    ShipToGSTIN = Column(String(20), nullable=True)

    # Totals
    TotalTaxableAmount = Column(DECIMAL(15, 2), nullable=True)
    TotalTax = Column(DECIMAL(15, 2), nullable=True)
    DiscountTD = Column(DECIMAL(15, 2), nullable=True)
    DiscountCD = Column(DECIMAL(15, 2), nullable=True)
    DiscountSD = Column(DECIMAL(15, 2), nullable=True)
    GrandTotal = Column(DECIMAL(15, 2), nullable=True)

    # Status (manual entry)
    Status = Column(String(50), nullable=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    # Relationships
    items = relationship("BlinkitPOItemData", back_populates="po", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.Id,
            "poNumber": self.PONumber,
            "poDate": self.PODate.isoformat() if self.PODate else None,
            "poExpiryDate": self.POExpiryDate.isoformat() if self.POExpiryDate else None,
            "vendorName": self.VendorName,
            "shipToName": self.ShipToName,
            "shipToAddress": self.ShipToAddress,
            "shipToGstin": self.ShipToGSTIN,
            "grandTotal": float(self.GrandTotal) if self.GrandTotal else None,
            "status": self.Status,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
