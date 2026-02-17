"""
AmazonSales Model - SQLAlchemy ORM
Source: AmazonSales.csv (VendorCSV) + RK Excel (RKExcel) — merged table
Table managed via SQL script: database/update_amazon_sales.sql
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, DECIMAL
from sqlalchemy.sql import func
from ..database import Base


class AmazonSalesData(Base):
    __tablename__ = "AmazonSales"
    __table_args__ = {'extend_existing': True}

    Id = Column(Integer, primary_key=True, autoincrement=True)
    ReportDate = Column(Date, nullable=False)
    SourceFile = Column(String(20), nullable=False)  # 'VendorCSV' or 'RKExcel'

    # Product Identification (shared)
    ASIN = Column(String(20), nullable=False)
    SKU = Column(String(100), nullable=True)
    Brand = Column(String(100), nullable=True)

    # VendorCSV-only columns
    ProductTitle = Column(String(500), nullable=True)
    BrandCode = Column(String(50), nullable=True)
    Category = Column(String(200), nullable=True)
    Subcategory = Column(String(200), nullable=True)
    ParentASIN = Column(String(20), nullable=True)
    UPC = Column(String(50), nullable=True)
    EAN = Column(String(50), nullable=True)
    ISBN = Column(String(50), nullable=True)
    ManufacturerCode = Column(String(50), nullable=True)
    MSRP = Column(DECIMAL(15, 2), nullable=True)
    Binding = Column(String(100), nullable=True)
    Colour = Column(String(100), nullable=True)
    ReleaseDate = Column(String(50), nullable=True)
    ReplenishmentCode = Column(String(50), nullable=True)

    # Revenue & Sales (VendorCSV only)
    OrderedRevenue = Column(DECIMAL(15, 2), nullable=True)
    OrderedUnits = Column(Integer, nullable=True)
    ShippedRevenue = Column(DECIMAL(15, 2), nullable=True)
    ShippedCOGS = Column(DECIMAL(15, 2), nullable=True)
    ShippedUnits = Column(Integer, nullable=True)
    CustomerReturns = Column(Integer, nullable=True)
    UnfilledCustomerOrderedUnits = Column(Integer, nullable=True)
    ConfirmedUnits = Column(Integer, nullable=True)
    NetOrderedGMS = Column(DECIMAL(15, 2), nullable=True)
    NetShippedGMS = Column(DECIMAL(15, 2), nullable=True)
    NetPPMPercent = Column(DECIMAL(10, 4), nullable=True)
    ASINConfirmationPercent = Column(DECIMAL(10, 4), nullable=True)

    # RKExcel-only columns
    ASP = Column(DECIMAL(15, 2), nullable=True)
    GL = Column(String(50), nullable=True)
    VM = Column(String(50), nullable=True)
    VendorCode = Column(String(50), nullable=True)
    SaleSpike_D1 = Column(DECIMAL(15, 4), nullable=True)
    Sellable = Column(Integer, nullable=True)
    OpenPO = Column(Integer, nullable=True)
    Appointment = Column(String(200), nullable=True)
    DaysTillNextAppointment = Column(Integer, nullable=True)
    DOC = Column(DECIMAL(10, 2), nullable=True)
    OOSLastWeek = Column(DECIMAL(10, 4), nullable=True)
    OOS4wWeek = Column(DECIMAL(10, 4), nullable=True)

    # Shared / Computed DRR columns
    DRR_D1 = Column(DECIMAL(15, 4), nullable=True)
    DRR_7Days = Column(DECIMAL(15, 4), nullable=True)
    DRR_3Days = Column(DECIMAL(15, 4), nullable=True)
    DRR_30Days = Column(DECIMAL(15, 4), nullable=True)
    NetShippedGMS_D1 = Column(DECIMAL(15, 2), nullable=True)
    DOH = Column(DECIMAL(10, 2), nullable=True)

    # Metadata
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "reportDate": self.ReportDate.isoformat() if self.ReportDate else None,
            "sourceFile": self.SourceFile,
            "asin": self.ASIN,
            "sku": self.SKU,
            "brand": self.Brand,
            "productTitle": self.ProductTitle,
            "orderedRevenue": float(self.OrderedRevenue) if self.OrderedRevenue else None,
            "orderedUnits": self.OrderedUnits,
            "shippedRevenue": float(self.ShippedRevenue) if self.ShippedRevenue else None,
            "shippedCOGS": float(self.ShippedCOGS) if self.ShippedCOGS else None,
            "customerReturns": self.CustomerReturns,
            "drrD1": float(self.DRR_D1) if self.DRR_D1 else None,
            "drr7Days": float(self.DRR_7Days) if self.DRR_7Days else None,
            "drr30Days": float(self.DRR_30Days) if self.DRR_30Days else None,
            "sellable": self.Sellable,
            "doh": float(self.DOH) if self.DOH else None,
            "openPO": self.OpenPO,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
