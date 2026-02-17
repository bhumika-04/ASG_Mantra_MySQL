"""
BlinkitPOItem Model - SQLAlchemy ORM (PO Line Items)
Source: Eagle Network Supply PO PDFs
Table managed via SQL script: database/blinkit_tables.sql
FK to BlinkitPO with CASCADE delete
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, DECIMAL
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class BlinkitPOItemData(Base):
    __tablename__ = "BlinkitPOItem"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    POId = Column(Integer, ForeignKey("BlinkitPO.Id", ondelete="CASCADE"), nullable=False)
    PONumber = Column(String(30), nullable=False)

    # Line Item Details
    Sno = Column(Integer, nullable=True)
    EagleCode = Column(Integer, nullable=True)
    ItemCode = Column(String(100), nullable=True)
    ItemName = Column(String(300), nullable=True)
    MRP = Column(DECIMAL(10, 2), nullable=True)
    Size = Column(String(50), nullable=True)
    HSNCode = Column(String(20), nullable=True)
    QTY = Column(DECIMAL(10, 2), nullable=True)
    UOM = Column(String(10), nullable=True)
    UnitBaseCost = Column(DECIMAL(10, 2), nullable=True)
    Discount = Column(DECIMAL(10, 2), nullable=True)
    TaxableValue = Column(DECIMAL(15, 2), nullable=True)

    # Tax Breakdown
    CGSTRate = Column(DECIMAL(5, 2), nullable=True)
    CGSTAmt = Column(DECIMAL(15, 2), nullable=True)
    SGSTRate = Column(DECIMAL(5, 2), nullable=True)
    SGSTAmt = Column(DECIMAL(15, 2), nullable=True)
    IGSTRate = Column(DECIMAL(5, 2), nullable=True)
    IGSTAmt = Column(DECIMAL(15, 2), nullable=True)

    # Total
    TotalAmount = Column(DECIMAL(15, 2), nullable=True)

    # Product link (resolved from ItemCode/EagleCode at upload time)
    ProductId = Column(Integer, ForeignKey("Products.Id"), nullable=True, index=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    # Relationships
    po = relationship("BlinkitPOData", back_populates="items")
    product = relationship("Product")

    def to_dict(self):
        return {
            "id": self.Id,
            "poId": self.POId,
            "poNumber": self.PONumber,
            "productId": self.ProductId,
            "eagleCode": self.EagleCode,
            "itemCode": self.ItemCode,
            "itemName": self.ItemName,
            "mrp": float(self.MRP) if self.MRP else None,
            "hsnCode": self.HSNCode,
            "qty": float(self.QTY) if self.QTY else None,
            "unitBaseCost": float(self.UnitBaseCost) if self.UnitBaseCost else None,
            "totalAmount": float(self.TotalAmount) if self.TotalAmount else None,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
