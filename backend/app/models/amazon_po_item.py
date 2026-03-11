"""
AmazonPOItem Model - SQLAlchemy ORM (PO Line Items)
Source: PO PDFs (extracted data)
Table managed via SQL script: database/amazon_tables.sql
FK to AmazonPO with CASCADE delete
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey, DECIMAL
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class AmazonPOItemData(Base):
    __tablename__ = "AmazonPOItem"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    POId = Column(Integer, ForeignKey("AmazonPO.Id", ondelete="CASCADE"), nullable=False)
    PONumber = Column(String(30), nullable=False)

    # Product Identification
    ASIN = Column(String(20), nullable=False)
    ExternalId = Column(String(50), nullable=True)
    ModelNumber = Column(String(100), nullable=True)
    HSN = Column(String(20), nullable=True)
    Title = Column(String(500), nullable=True)

    # Cancellation
    CancellationStatus = Column(String(50), nullable=True)
    CancellationDate = Column(Date, nullable=True)

    # Delivery
    WindowType = Column(String(50), nullable=True)
    ExpectedDate = Column(Date, nullable=True)

    # Quantities
    QuantityRequested = Column(Integer, nullable=True)
    AcceptedQuantity = Column(Integer, nullable=True)
    QuantityReceived = Column(Integer, nullable=True)
    QuantityOutstanding = Column(Integer, nullable=True)

    # Cost
    UnitCost = Column(DECIMAL(15, 2), nullable=True)
    TotalCost = Column(DECIMAL(15, 2), nullable=True)

    # Per-item status (independent of PO header — allows different status per line)
    ItemStatus = Column(String(50), nullable=True)

    # Product link (resolved from ASIN at upload time)
    ProductId = Column(Integer, ForeignKey("Products.Id"), nullable=True, index=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    # Relationships
    po = relationship("AmazonPOData", back_populates="items")
    product = relationship("Product")

    def to_dict(self):
        return {
            "id": self.Id,
            "poId": self.POId,
            "poNumber": self.PONumber,
            "asin": self.ASIN,
            "productId": self.ProductId,
            "modelNumber": self.ModelNumber,
            "title": self.Title,
            "quantityRequested": self.QuantityRequested,
            "acceptedQuantity": self.AcceptedQuantity,
            "quantityReceived": self.QuantityReceived,
            "unitCost": float(self.UnitCost) if self.UnitCost else None,
            "totalCost": float(self.TotalCost) if self.TotalCost else None,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
