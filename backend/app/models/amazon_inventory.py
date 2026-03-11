"""
AmazonInventory Model - SQLAlchemy ORM
Source: Vendor Central CSV (38 data columns)
Table managed via SQL script: database/amazon_tables.sql
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, DECIMAL, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class AmazonInventoryData(Base):
    __tablename__ = "AmazonInventory"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ReportDate = Column(Date, nullable=False)


    # Product Identification
    ASIN = Column(String(20), nullable=False)
    ProductTitle = Column(String(500), nullable=True)
    BrandCode = Column(String(50), nullable=True)
    Brand = Column(String(100), nullable=True)
    Category = Column(String(200), nullable=True)
    Subcategory = Column(String(200), nullable=True)
    ParentASIN = Column(String(20), nullable=True)
    UPC = Column(String(50), nullable=True)
    EAN = Column(String(50), nullable=True)
    ISBN = Column(String(50), nullable=True)
    ModelNumber = Column(String(100), nullable=True)
    MSRP = Column(DECIMAL(15, 2), nullable=True)
    Binding = Column(String(100), nullable=True)
    Colour = Column(String(100), nullable=True)
    ReleaseDate = Column(String(50), nullable=True)
    ReplenishmentCode = Column(String(50), nullable=True)
    ManufacturerCode = Column(String(50), nullable=True)

    # OOS & Fill Metrics
    SourceableProductOOSPercent = Column(DECIMAL(10, 2), nullable=True)
    ProcurableProductOOSPercent = Column(DECIMAL(10, 2), nullable=True)
    VendorConfirmationPercent = Column(DECIMAL(10, 2), nullable=True)

    # Received
    NetReceived = Column(DECIMAL(15, 2), nullable=True)
    NetReceivedUnits = Column(Integer, nullable=True)
    OpenPurchaseOrderQuantity = Column(Integer, nullable=True)
    ReceiveFillPercent = Column(DECIMAL(10, 2), nullable=True)
    OverallVendorLeadTimeDays = Column(Integer, nullable=True)
    UnfilledCustomerOrderedUnits = Column(Integer, nullable=True)

    # Aged Inventory
    Aged90PlusDaysSellableInventory = Column(DECIMAL(15, 2), nullable=True)
    Aged90PlusDaysSellableUnits = Column(Integer, nullable=True)

    # On-Hand Inventory
    SellableOnHandInventory = Column(DECIMAL(15, 2), nullable=True)
    SellableOnHandUnits = Column(Integer, nullable=True)
    UnsellableOnHandInventory = Column(DECIMAL(15, 2), nullable=True)
    UnsellableOnHandUnits = Column(Integer, nullable=True)

    # Orders & Shipments
    ConfirmedUnits = Column(Integer, nullable=True)
    NetOrderedGMS = Column(DECIMAL(15, 2), nullable=True)
    NetShippedGMS = Column(DECIMAL(15, 2), nullable=True)

    # In Transit
    InTransitQuantity = Column(Integer, nullable=True)
    SellableInTransitUnits = Column(Integer, nullable=True)
    UnsellableInTransitUnits = Column(Integer, nullable=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "reportDate": self.ReportDate.isoformat() if self.ReportDate else None,
            "asin": self.ASIN,
            "productTitle": self.ProductTitle,
            "brand": self.Brand,
            "modelNumber": self.ModelNumber,
            "sellableOnHandUnits": self.SellableOnHandUnits,
            "unsellableOnHandUnits": self.UnsellableOnHandUnits,
            "openPurchaseOrderQuantity": self.OpenPurchaseOrderQuantity,
            "netShippedGMS": float(self.NetShippedGMS) if self.NetShippedGMS else None,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
