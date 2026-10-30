-- =====================================================================
-- TechGenia_Analytics - MySQL 8.0.16+ schema (23 tables)
--
-- Design notes
-- * Charset utf8mb4 with utf8mb4_general_ci: string comparison is
--   case-insensitive, which ASIN / SKU / item-code matching relies on.
-- * Guid columns are CHAR(36) holding the text form of the UUID.
-- * Users.Id defaults to UUID(); other columns are filled by the
--   application at insert time.
-- * Sales.NetRevenue is a STORED generated column.
-- * MySQL cannot put a WHERE clause on an index, so the unique rule
--   "one stock row per product, warehouse and date" is enforced with a
--   STORED generated column (AsgWarehouseKey = IFNULL(AsgWarehouseId, 0))
--   plus an ordinary UNIQUE KEY. Real warehouse ids start at 1, so 0
--   never collides. See Inventory and InventoryHistory.
-- * CHECK constraints are enforced from MySQL 8.0.16 onwards.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS TechGenia_Analytics
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE TechGenia_Analytics;

-- ---------------------------------------------------------------------
-- 1. TABLES  (foreign keys are added afterwards with ALTER TABLE, so
--    the creation order does not matter)
-- ---------------------------------------------------------------------

CREATE TABLE Inventory (
  Id                 INT AUTO_INCREMENT PRIMARY KEY,
  ProductId          INT NOT NULL,
  AsgWarehouseId     INT NULL,
  CurrentStock       INT NOT NULL,
  PackedQty          INT NOT NULL,
  UnpackedQty        INT NOT NULL,
  LastInventoryDate  DATE NULL,
  LastUpdated        DATETIME NULL,
  UpdatedBy          CHAR(36) NULL,
  InventoryDate      DATE NOT NULL,
  -- backs the unique key below (see design notes)
  AsgWarehouseKey    INT GENERATED ALWAYS AS (IFNULL(AsgWarehouseId, 0)) STORED,
  UNIQUE KEY UX_Inventory_Product_Warehouse_Date (ProductId, AsgWarehouseKey, InventoryDate)
);

CREATE TABLE Products (
  Id           INT AUTO_INCREMENT PRIMARY KEY,
  ProductName  VARCHAR(255) NOT NULL,
  AsgSku       VARCHAR(50) NOT NULL,
  AmazonId     VARCHAR(50) NULL,
  BlinkitId    VARCHAR(50) NULL,
  Gs1          VARCHAR(50) NULL,
  Category     VARCHAR(100) NULL,
  Brand        VARCHAR(100) NULL,
  UnitPrice    DECIMAL(10,2) NULL,
  IsActive     TINYINT(1) NULL DEFAULT 1,
  CreatedAt    DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt    DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  CreatedBy    CHAR(36) NULL,
  UnitWeight   VARCHAR(50) NULL,
  PackSize     INT NULL,
  UNIQUE KEY UQ_Products_AsgSku (AsgSku)
);

CREATE TABLE PurchaseOrders (
  Id                    INT AUTO_INCREMENT PRIMARY KEY,
  PoNumber              VARCHAR(50) NOT NULL,
  Channel               VARCHAR(50) NOT NULL,
  ProductId             INT NOT NULL,
  WarehouseId           INT NULL,
  Quantity              INT NOT NULL,
  ReceivedQuantity      INT NULL,
  UnitPrice             DECIMAL(10,2) NOT NULL,
  TotalAmount           DECIMAL(10,2) NOT NULL,
  OrderDate             DATE NOT NULL,
  ExpectedDeliveryDate  DATE NULL,
  ActualDeliveryDate    DATE NULL,
  HubCode               VARCHAR(100) NULL,
  City                  VARCHAR(100) NULL,
  Courier               VARCHAR(100) NULL,
  TrackingNumber        VARCHAR(100) NULL,
  Status                VARCHAR(50) NOT NULL,
  IsDelayed             TINYINT(1) NULL,
  Remarks               TEXT NULL,
  CreatedAt             DATETIME NULL,
  UpdatedAt             DATETIME NULL,
  CreatedBy             CHAR(36) NULL,
  UpdatedBy             CHAR(36) NULL
);

CREATE TABLE Alerts (
  Id          INT AUTO_INCREMENT PRIMARY KEY,
  ProductId   INT NOT NULL,
  Channel     VARCHAR(50) NULL,
  AlertType   VARCHAR(50) NOT NULL,
  Severity    VARCHAR(20) NOT NULL,
  Message     TEXT NOT NULL,
  IsResolved  TINYINT(1) NULL DEFAULT 0,
  ResolvedBy  CHAR(36) NULL,
  ResolvedAt  DATETIME NULL,
  Remarks     TEXT NULL,
  CreatedAt   DATETIME NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE AmazonInventory (
  Id                             INT AUTO_INCREMENT PRIMARY KEY,
  ReportDate                     DATE NOT NULL,
  ASIN                           VARCHAR(20) NOT NULL,
  ProductTitle                   VARCHAR(500) NULL,
  BrandCode                      VARCHAR(50) NULL,
  Brand                          VARCHAR(100) NULL,
  Category                       VARCHAR(200) NULL,
  Subcategory                    VARCHAR(200) NULL,
  ParentASIN                     VARCHAR(20) NULL,
  UPC                            VARCHAR(50) NULL,
  EAN                            VARCHAR(50) NULL,
  ISBN                           VARCHAR(50) NULL,
  ModelNumber                    VARCHAR(100) NULL,
  MSRP                           DECIMAL(15,2) NULL,
  Binding                        VARCHAR(100) NULL,
  Colour                         VARCHAR(100) NULL,
  ReleaseDate                    VARCHAR(50) NULL,
  ReplenishmentCode              VARCHAR(50) NULL,
  ManufacturerCode               VARCHAR(50) NULL,
  SourceableProductOOSPercent    DECIMAL(10,2) NULL,
  ProcurableProductOOSPercent    DECIMAL(10,2) NULL,
  VendorConfirmationPercent      DECIMAL(10,2) NULL,
  NetReceived                    DECIMAL(15,2) NULL,
  NetReceivedUnits               INT NULL,
  OpenPurchaseOrderQuantity      INT NULL,
  ReceiveFillPercent             DECIMAL(10,2) NULL,
  OverallVendorLeadTimeDays      INT NULL,
  UnfilledCustomerOrderedUnits   INT NULL,
  Aged90PlusDaysSellableInventory DECIMAL(15,2) NULL,
  Aged90PlusDaysSellableUnits    INT NULL,
  SellableOnHandInventory        DECIMAL(15,2) NULL,
  SellableOnHandUnits            INT NULL,
  UnsellableOnHandInventory      DECIMAL(15,2) NULL,
  UnsellableOnHandUnits          INT NULL,
  ConfirmedUnits                 INT NULL,
  NetOrderedGMS                  DECIMAL(15,2) NULL,
  NetShippedGMS                  DECIMAL(15,2) NULL,
  InTransitQuantity               INT NULL,
  SellableInTransitUnits          INT NULL,
  UnsellableInTransitUnits        INT NULL,
  CreatedAt                       DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  DistributorId                   INT NULL
);

CREATE TABLE AmazonPO (
  Id                     INT AUTO_INCREMENT PRIMARY KEY,
  PONumber               VARCHAR(30) NOT NULL,
  POStatus               VARCHAR(50) NULL,
  VendorCode             VARCHAR(50) NULL,
  ShipToLocationCode     VARCHAR(50) NULL,
  ShipToCity             VARCHAR(100) NULL,
  ShipToState            VARCHAR(100) NULL,
  OrderedOnDate          DATE NULL,
  ShipWindowStartDate    DATE NULL,
  ShipWindowEndDate      DATE NULL,
  FreightTerms           VARCHAR(50) NULL,
  PaymentMethod          VARCHAR(50) NULL,
  PaymentTerms           VARCHAR(100) NULL,
  PurchasingEntityName   VARCHAR(200) NULL,
  SubmittedItems         INT NULL,
  SubmittedQuantity      INT NULL,
  SubmittedTotalCost     DECIMAL(15,2) NULL,
  AcceptedItems          INT NULL,
  AcceptedQuantity       INT NULL,
  AcceptedTotalCost      DECIMAL(15,2) NULL,
  CancelledItems         INT NULL,
  CancelledQuantity      INT NULL,
  CancelledTotalCost     DECIMAL(15,2) NULL,
  ReceivedItems          INT NULL,
  ReceivedQuantity       INT NULL,
  ReceivedTotalCost      DECIMAL(15,2) NULL,
  CreatedAt              DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  DispatchDate           DATE NULL,
  Courier                VARCHAR(100) NULL,
  UNIQUE KEY UQ_AmazonPO_PONumber (PONumber)
);

CREATE TABLE AmazonPOItem (
  Id                   INT AUTO_INCREMENT PRIMARY KEY,
  POId                 INT NOT NULL,
  PONumber             VARCHAR(30) NOT NULL,
  ASIN                 VARCHAR(20) NOT NULL,
  ExternalId           VARCHAR(50) NULL,
  ModelNumber          VARCHAR(100) NULL,
  HSN                  VARCHAR(20) NULL,
  Title                VARCHAR(500) NULL,
  CancellationStatus   VARCHAR(50) NULL,
  CancellationDate     DATE NULL,
  WindowType           VARCHAR(50) NULL,
  ExpectedDate         DATE NULL,
  QuantityRequested    INT NULL,
  AcceptedQuantity     INT NULL,
  QuantityReceived     INT NULL,
  QuantityOutstanding  INT NULL,
  UnitCost             DECIMAL(15,2) NULL,
  TotalCost            DECIMAL(15,2) NULL,
  CreatedAt            DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  ProductId            INT NULL,
  ItemStatus           VARCHAR(50) NULL
);

CREATE TABLE AmazonSales (
  Id                          INT AUTO_INCREMENT PRIMARY KEY,
  ReportDate                  DATE NOT NULL,
  SourceFile                  VARCHAR(20) NOT NULL,
  ASIN                        VARCHAR(20) NOT NULL,
  SKU                         VARCHAR(100) NULL,
  Brand                       VARCHAR(100) NULL,
  ProductTitle                VARCHAR(500) NULL,
  BrandCode                   VARCHAR(50) NULL,
  Category                    VARCHAR(200) NULL,
  Subcategory                 VARCHAR(200) NULL,
  ParentASIN                  VARCHAR(20) NULL,
  UPC                         VARCHAR(50) NULL,
  EAN                         VARCHAR(50) NULL,
  ISBN                        VARCHAR(50) NULL,
  ManufacturerCode            VARCHAR(50) NULL,
  MSRP                        DECIMAL(15,2) NULL,
  Binding                     VARCHAR(100) NULL,
  Colour                      VARCHAR(100) NULL,
  ReleaseDate                 VARCHAR(50) NULL,
  ReplenishmentCode           VARCHAR(50) NULL,
  OrderedRevenue               DECIMAL(15,2) NULL,
  OrderedUnits                 INT NULL,
  ShippedRevenue                DECIMAL(15,2) NULL,
  ShippedCOGS                   DECIMAL(15,2) NULL,
  ShippedUnits                  INT NULL,
  CustomerReturns               INT NULL,
  UnfilledCustomerOrderedUnits  INT NULL,
  ConfirmedUnits                INT NULL,
  NetOrderedGMS                 DECIMAL(15,2) NULL,
  NetShippedGMS                 DECIMAL(15,2) NULL,
  NetPPMPercent                 DECIMAL(10,4) NULL,
  ASINConfirmationPercent       DECIMAL(10,4) NULL,
  ASP                           DECIMAL(15,2) NULL,
  GL                            VARCHAR(50) NULL,
  VM                            VARCHAR(50) NULL,
  VendorCode                    VARCHAR(50) NULL,
  SaleSpike_D1                  DECIMAL(15,4) NULL,
  Sellable                      INT NULL,
  OpenPO                        INT NULL,
  Appointment                   VARCHAR(200) NULL,
  DaysTillNextAppointment       INT NULL,
  DOC                           DECIMAL(10,2) NULL,
  OOSLastWeek                   DECIMAL(10,4) NULL,
  OOS4wWeek                     DECIMAL(10,4) NULL,
  DRR_D1                        DECIMAL(15,4) NULL,
  DRR_7Days                     DECIMAL(15,4) NULL,
  DRR_3Days                     DECIMAL(15,4) NULL,
  DRR_30Days                    DECIMAL(15,4) NULL,
  NetShippedGMS_D1               DECIMAL(15,2) NULL,
  DOH                            DECIMAL(10,2) NULL,
  CreatedAt                      DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY UQ_AmazonSales_DateASINSource (ReportDate, ASIN, SourceFile)
);

CREATE TABLE AsgWarehouses (
  Id             INT AUTO_INCREMENT PRIMARY KEY,
  WarehouseName  VARCHAR(100) NOT NULL,
  City           VARCHAR(100) NULL,
  State          VARCHAR(100) NULL,
  Active         TINYINT(1) NULL,
  CreatedAt      DATETIME NULL
);

CREATE TABLE AuditLogs (
  Id          INT AUTO_INCREMENT PRIMARY KEY,
  UserId      CHAR(36) NULL,
  Action      VARCHAR(255) NOT NULL,
  TableName   VARCHAR(100) NULL,
  RecordId    VARCHAR(50) NULL,
  OldValues   TEXT NULL,
  NewValues   TEXT NULL,
  IpAddress   VARCHAR(50) NULL,
  UserAgent   VARCHAR(500) NULL,
  CreatedAt   DATETIME NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE BlinkitInventory (
  Id                   INT AUTO_INCREMENT PRIMARY KEY,
  ReportDate           DATE NOT NULL,
  BackendFacilityName  VARCHAR(200) NULL,
  BackendFacilityId    INT NULL,
  ItemId               VARCHAR(50) NOT NULL,
  ItemName             VARCHAR(300) NULL,
  BackendInvQty        INT NULL,
  FrontendInvQty       INT NULL,
  CreatedAt            DATETIME NULL,
  DistributorId        INT NULL
);

CREATE TABLE BlinkitPO (
  Id                    INT AUTO_INCREMENT PRIMARY KEY,
  PONumber              VARCHAR(30) NOT NULL,
  PODate                DATE NULL,
  POReleaseDate         DATE NULL,
  POExpiryDate          DATE NULL,
  PaymentTerms          VARCHAR(50) NULL,
  FreightTerms          VARCHAR(50) NULL,
  ExpectedDeliveryDate  DATE NULL,
  VendorCode            VARCHAR(50) NULL,
  VendorName            VARCHAR(200) NULL,
  VendorGSTIN           VARCHAR(20) NULL,
  VendorPAN             VARCHAR(15) NULL,
  IssuerName            VARCHAR(200) NULL,
  IssuerGSTIN           VARCHAR(20) NULL,
  BillToName            VARCHAR(200) NULL,
  BillToAddress         VARCHAR(500) NULL,
  BillToGSTIN           VARCHAR(20) NULL,
  ShipToName            VARCHAR(200) NULL,
  ShipToAddress         VARCHAR(1000) NULL,
  ShipToGSTIN           VARCHAR(20) NULL,
  TotalTaxableAmount    DECIMAL(15,2) NULL,
  TotalTax              DECIMAL(15,2) NULL,
  DiscountTD            DECIMAL(15,2) NULL,
  DiscountCD            DECIMAL(15,2) NULL,
  DiscountSD            DECIMAL(15,2) NULL,
  GrandTotal            DECIMAL(15,2) NULL,
  Status                VARCHAR(50) NULL,
  CreatedAt             DATETIME NULL,
  DispatchDate          DATE NULL,
  Courier               VARCHAR(100) NULL,
  ShipToCity            VARCHAR(100) NULL,
  ShipToState           VARCHAR(100) NULL,
  UNIQUE KEY UQ_BlinkitPO_PONumber (PONumber)
);

CREATE TABLE BlinkitPOItem (
  Id             INT AUTO_INCREMENT PRIMARY KEY,
  POId           INT NOT NULL,
  PONumber       VARCHAR(30) NOT NULL,
  Sno            INT NULL,
  EagleCode      INT NULL,
  ItemCode       VARCHAR(100) NULL,
  ItemName       VARCHAR(300) NULL,
  MRP            DECIMAL(10,2) NULL,
  Size           VARCHAR(50) NULL,
  HSNCode        VARCHAR(20) NULL,
  QTY            DECIMAL(10,2) NULL,
  UOM            VARCHAR(10) NULL,
  UnitBaseCost   DECIMAL(10,2) NULL,
  Discount       DECIMAL(10,2) NULL,
  TaxableValue   DECIMAL(15,2) NULL,
  CGSTRate       DECIMAL(5,2) NULL,
  CGSTAmt        DECIMAL(15,2) NULL,
  SGSTRate       DECIMAL(5,2) NULL,
  SGSTAmt        DECIMAL(15,2) NULL,
  IGSTRate       DECIMAL(5,2) NULL,
  IGSTAmt        DECIMAL(15,2) NULL,
  TotalAmount    DECIMAL(15,2) NULL,
  CreatedAt      DATETIME NULL,
  ProductId      INT NULL,
  AcceptedQty    INT NULL,
  ItemStatus     VARCHAR(50) NULL,
  ReceivedQty    INT NULL
);

CREATE TABLE BlinkitSales (
  Id                INT AUTO_INCREMENT PRIMARY KEY,
  SaleDate          DATE NOT NULL,
  ItemId            INT NOT NULL,
  ItemName          VARCHAR(300) NULL,
  ManufacturerId    INT NULL,
  ManufacturerName  VARCHAR(200) NULL,
  CityId            INT NULL,
  CityName          VARCHAR(100) NULL,
  Category          VARCHAR(100) NULL,
  QtySold           DECIMAL(10,2) NULL,
  MRP               DECIMAL(15,2) NULL,
  CreatedAt         DATETIME NULL
);

CREATE TABLE DistributorFacilities (
  Id            INT AUTO_INCREMENT PRIMARY KEY,
  DistributorId INT NOT NULL,
  FacilityName  VARCHAR(200) NOT NULL,
  FacilityType  VARCHAR(20) NOT NULL,
  City          VARCHAR(100) NULL,
  State         VARCHAR(100) NULL,
  Active        TINYINT(1) NULL,
  CreatedAt     DATETIME NULL
);

CREATE TABLE Distributors (
  Id              INT AUTO_INCREMENT PRIMARY KEY,
  DistributorName VARCHAR(100) NOT NULL,
  Channel         VARCHAR(20) NOT NULL,
  ContactPerson   VARCHAR(100) NULL,
  Phone           VARCHAR(20) NULL,
  Email           VARCHAR(100) NULL,
  Active          TINYINT(1) NULL,
  CreatedAt       DATETIME NULL
);

CREATE TABLE DistributorStock (
  Id           INT AUTO_INCREMENT PRIMARY KEY,
  ReportDate   DATE NOT NULL,
  DistributorId INT NULL,
  ItemName     VARCHAR(300) NOT NULL,
  OpeningQty   INT NULL,
  ClosingQty   INT NULL,
  SaleQty      INT NULL,
  CreatedAt    DATETIME NULL,
  SKU          VARCHAR(100) NULL,
  DL_Qty       INT NULL,
  MH_Qty       INT NULL,
  KT_Qty       INT NULL,
  WB_Qty       INT NULL,
  HR_Qty       INT NULL
);

CREATE TABLE InventoryHistory (
  Id                 INT AUTO_INCREMENT PRIMARY KEY,
  ProductId          INT NOT NULL,
  AsgWarehouseId     INT NULL,
  InventoryDate      DATE NOT NULL,
  PackedQty          INT NOT NULL DEFAULT 0,
  UnpackedQty        INT NOT NULL DEFAULT 0,
  CurrentStock       INT NOT NULL DEFAULT 0,
  UploadedBy         CHAR(36) NULL,
  CreatedAt          DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  -- backs the unique key below (see design notes)
  AsgWarehouseKey    INT GENERATED ALWAYS AS (IFNULL(AsgWarehouseId, 0)) STORED,
  UNIQUE KEY UQ_InventoryHistory_Product_Warehouse_Date (ProductId, AsgWarehouseKey, InventoryDate)
);

CREATE TABLE Notifications (
  Id        INT AUTO_INCREMENT PRIMARY KEY,
  UserId    CHAR(36) NOT NULL,
  Title     VARCHAR(255) NOT NULL,
  Message   TEXT NOT NULL,
  Type      VARCHAR(50) NOT NULL,
  IsRead    TINYINT(1) NULL DEFAULT 0,
  CreatedAt DATETIME NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Roles (
  Id           INT AUTO_INCREMENT PRIMARY KEY,
  Name         VARCHAR(100) NOT NULL,
  Description  VARCHAR(500) NOT NULL,
  Permissions  TEXT NOT NULL,
  IsLocked     TINYINT(1) NULL,
  CreatedAt    DATETIME NULL,
  UpdatedAt    DATETIME NULL,
  UNIQUE KEY UQ_Roles_Name (Name)
);

CREATE TABLE Sales (
  Id             INT AUTO_INCREMENT PRIMARY KEY,
  OrderId        VARCHAR(100) NULL,
  Channel        VARCHAR(50) NOT NULL,
  ProductId      INT NOT NULL,
  WarehouseId    INT NULL,
  Quantity       INT NOT NULL,
  UnitPrice      DECIMAL(10,2) NOT NULL,
  TotalAmount    DECIMAL(10,2) NOT NULL,
  OrderDate      DATE NOT NULL,
  DeliveryDate   DATE NULL,
  CustomerCity   VARCHAR(100) NULL,
  CustomerState  VARCHAR(100) NULL,
  PaymentMode    VARCHAR(50) NULL,
  Status         VARCHAR(50) NOT NULL,
  Commission     DECIMAL(10,2) NULL,
  NetRevenue     DECIMAL(10,2) GENERATED ALWAYS AS (TotalAmount - IFNULL(Commission, 0)) STORED,
  CreatedAt      DATETIME NULL,
  UpdatedAt      DATETIME NULL
);

CREATE TABLE UploadLogs (
  Id           INT AUTO_INCREMENT PRIMARY KEY,
  UploadType   VARCHAR(50) NOT NULL,
  Channel      VARCHAR(20) NULL,
  FileName     VARCHAR(255) NOT NULL,
  FileSize     INT NULL,
  UploadDate   DATE NOT NULL,
  ProcessedAt  DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  Status       VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
  TotalRows    INT NULL DEFAULT 0,
  SuccessRows  INT NULL DEFAULT 0,
  ErrorRows    INT NULL DEFAULT 0,
  Errors       TEXT NULL,
  UploadedBy   CHAR(36) NOT NULL
);

CREATE TABLE Users (
  Id            CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  Name          VARCHAR(255) NOT NULL,
  Email         VARCHAR(255) NOT NULL,
  PasswordHash  VARCHAR(255) NOT NULL,
  Role          VARCHAR(50) NOT NULL,
  Avatar        VARCHAR(500) NULL,
  IsActive      TINYINT(1) NULL DEFAULT 1,
  CreatedAt     DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  LastLogin     DATETIME NULL,
  CreatedBy     CHAR(36) NULL,
  UpdatedAt     DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY UQ_Users_Email (Email)
);

CREATE TABLE Warehouses (
  Id             INT AUTO_INCREMENT PRIMARY KEY,
  WarehouseName  VARCHAR(255) NOT NULL,
  WarehouseCode  VARCHAR(50) NOT NULL,
  Channel        VARCHAR(50) NOT NULL,
  Location       VARCHAR(255) NULL,
  Address        VARCHAR(500) NULL,
  Pincode        VARCHAR(20) NULL,
  City           VARCHAR(100) NULL,
  State          VARCHAR(100) NULL,
  IsActive       TINYINT(1) NULL DEFAULT 1,
  CreatedAt      DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  Region         VARCHAR(50) NULL,
  FCType         VARCHAR(50) NULL,
  WarehouseType  VARCHAR(50) NULL,
  UpdatedAt      DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY UQ_Warehouses_WarehouseCode (WarehouseCode)
);

-- ---------------------------------------------------------------------
-- 2. INDEXES
-- ---------------------------------------------------------------------

CREATE INDEX IDX_Alerts_Active        ON Alerts (IsResolved, Severity);
CREATE INDEX IDX_Alerts_CreatedAt     ON Alerts (CreatedAt);
CREATE INDEX IDX_Alerts_IsResolved    ON Alerts (IsResolved);
CREATE INDEX IDX_Alerts_ProductId     ON Alerts (ProductId);
CREATE INDEX IDX_Alerts_Severity      ON Alerts (Severity);

CREATE INDEX IX_AmazonInventory_ASIN         ON AmazonInventory (ASIN);
CREATE INDEX IX_AmazonInventory_Brand        ON AmazonInventory (Brand);
CREATE INDEX IX_AmazonInventory_ModelNumber  ON AmazonInventory (ModelNumber);
CREATE INDEX IX_AmazonInventory_ReportDate   ON AmazonInventory (ReportDate);

CREATE INDEX IX_AmazonPO_OrderedOnDate ON AmazonPO (OrderedOnDate);
CREATE INDEX IX_AmazonPO_PONumber      ON AmazonPO (PONumber);
CREATE INDEX IX_AmazonPO_POStatus      ON AmazonPO (POStatus);

CREATE INDEX IX_AmazonPOItem_ASIN      ON AmazonPOItem (ASIN);
CREATE INDEX IX_AmazonPOItem_POId      ON AmazonPOItem (POId);
CREATE INDEX IX_AmazonPOItem_PONumber  ON AmazonPOItem (PONumber);
CREATE INDEX IX_AmazonPOItem_ProductId ON AmazonPOItem (ProductId);

CREATE INDEX IX_AmazonSales_ASIN       ON AmazonSales (ASIN);
CREATE INDEX IX_AmazonSales_ReportDate ON AmazonSales (ReportDate);
CREATE INDEX IX_AmazonSales_SKU        ON AmazonSales (SKU);
CREATE INDEX IX_AmazonSales_SourceFile ON AmazonSales (SourceFile);

CREATE INDEX IDX_AuditLogs_Action     ON AuditLogs (Action);
CREATE INDEX IDX_AuditLogs_CreatedAt  ON AuditLogs (CreatedAt);
CREATE INDEX IDX_AuditLogs_TableName  ON AuditLogs (TableName);
CREATE INDEX IDX_AuditLogs_UserId     ON AuditLogs (UserId);

CREATE INDEX IX_BlinkitPOItem_ProductId ON BlinkitPOItem (ProductId);

CREATE INDEX ix_Inventory_ProductId ON Inventory (ProductId);
CREATE INDEX IX_InventoryHistory_ProductDate ON InventoryHistory (ProductId, InventoryDate DESC);

CREATE INDEX IDX_Notifications_CreatedAt ON Notifications (CreatedAt);
CREATE INDEX IDX_Notifications_IsRead    ON Notifications (IsRead);
CREATE INDEX IDX_Notifications_UserId    ON Notifications (UserId);

CREATE INDEX IDX_Products_AmazonId    ON Products (AmazonId);
CREATE INDEX IDX_Products_AsgSku      ON Products (AsgSku);
CREATE INDEX IDX_Products_BlinkitId   ON Products (BlinkitId);
CREATE INDEX IDX_Products_Category    ON Products (Category);
CREATE INDEX IDX_Products_IsActive    ON Products (IsActive);
CREATE INDEX IDX_Products_ProductName ON Products (ProductName);

CREATE INDEX ix_PurchaseOrders_Channel   ON PurchaseOrders (Channel);
CREATE INDEX ix_PurchaseOrders_PoNumber  ON PurchaseOrders (PoNumber);
CREATE INDEX ix_PurchaseOrders_ProductId ON PurchaseOrders (ProductId);
CREATE INDEX ix_PurchaseOrders_Status    ON PurchaseOrders (Status);

CREATE INDEX ix_Roles_IsLocked ON Roles (IsLocked);

CREATE INDEX ix_Sales_Channel   ON Sales (Channel);
CREATE INDEX ix_Sales_OrderDate ON Sales (OrderDate);
CREATE INDEX ix_Sales_OrderId   ON Sales (OrderId);
CREATE INDEX ix_Sales_ProductId ON Sales (ProductId);
CREATE INDEX ix_Sales_Status    ON Sales (Status);

CREATE INDEX IDX_UploadLogs_Channel    ON UploadLogs (Channel);
CREATE INDEX IDX_UploadLogs_Status     ON UploadLogs (Status);
CREATE INDEX IDX_UploadLogs_UploadDate ON UploadLogs (UploadDate);
CREATE INDEX IDX_UploadLogs_UploadType ON UploadLogs (UploadType);

CREATE INDEX IDX_Users_Email    ON Users (Email);
CREATE INDEX IDX_Users_IsActive ON Users (IsActive);
CREATE INDEX IDX_Users_Role     ON Users (Role);

CREATE INDEX IDX_Warehouses_Channel  ON Warehouses (Channel);
CREATE INDEX IDX_Warehouses_IsActive ON Warehouses (IsActive);

-- ---------------------------------------------------------------------
-- 3. FOREIGN KEYS
-- ---------------------------------------------------------------------

ALTER TABLE Alerts               ADD CONSTRAINT FK_Alerts_Products              FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE AmazonInventory      ADD CONSTRAINT FK_AmazonInventory_Distributors FOREIGN KEY (DistributorId)  REFERENCES Distributors (Id);
ALTER TABLE AmazonPOItem         ADD CONSTRAINT FK_AmazonPOItem_AmazonPO        FOREIGN KEY (POId)           REFERENCES AmazonPO (Id) ON DELETE CASCADE;
ALTER TABLE AmazonPOItem         ADD CONSTRAINT FK_AmazonPOItem_Product         FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE AuditLogs            ADD CONSTRAINT FK_AuditLogs_Users              FOREIGN KEY (UserId)         REFERENCES Users (Id);
ALTER TABLE BlinkitInventory     ADD CONSTRAINT FK_BlinkitInventory_Distributors FOREIGN KEY (DistributorId) REFERENCES Distributors (Id);
ALTER TABLE BlinkitPOItem        ADD CONSTRAINT FK_BlinkitPOItem_BlinkitPO      FOREIGN KEY (POId)           REFERENCES BlinkitPO (Id) ON DELETE CASCADE;
ALTER TABLE BlinkitPOItem        ADD CONSTRAINT FK_BlinkitPOItem_Product        FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE DistributorFacilities ADD CONSTRAINT FK_DistributorFacilities_Distributors FOREIGN KEY (DistributorId) REFERENCES Distributors (Id);
ALTER TABLE DistributorStock     ADD CONSTRAINT FK_DistributorStock_Distributors FOREIGN KEY (DistributorId) REFERENCES Distributors (Id);
ALTER TABLE Inventory            ADD CONSTRAINT FK_Inventory_Products           FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE Inventory            ADD CONSTRAINT FK_Inventory_AsgWarehouse       FOREIGN KEY (AsgWarehouseId) REFERENCES AsgWarehouses (Id);
ALTER TABLE InventoryHistory     ADD CONSTRAINT FK_InventoryHistory_AsgWarehouse FOREIGN KEY (AsgWarehouseId) REFERENCES AsgWarehouses (Id);
ALTER TABLE InventoryHistory     ADD CONSTRAINT FK_InventoryHistory_Products    FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE InventoryHistory     ADD CONSTRAINT FK_InventoryHistory_Users       FOREIGN KEY (UploadedBy)     REFERENCES Users (Id);
ALTER TABLE Notifications        ADD CONSTRAINT FK_Notifications_Users          FOREIGN KEY (UserId)         REFERENCES Users (Id);
ALTER TABLE PurchaseOrders       ADD CONSTRAINT FK_PurchaseOrders_Products      FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE PurchaseOrders       ADD CONSTRAINT FK_PurchaseOrders_Warehouses    FOREIGN KEY (WarehouseId)    REFERENCES Warehouses (Id);
ALTER TABLE Sales                ADD CONSTRAINT FK_Sales_Products               FOREIGN KEY (ProductId)      REFERENCES Products (Id);
ALTER TABLE Sales                ADD CONSTRAINT FK_Sales_Warehouses             FOREIGN KEY (WarehouseId)    REFERENCES Warehouses (Id);
ALTER TABLE UploadLogs           ADD CONSTRAINT FK_UploadLogs_Users             FOREIGN KEY (UploadedBy)     REFERENCES Users (Id);

-- ---------------------------------------------------------------------
-- 4. CHECK CONSTRAINTS  (enforced from MySQL 8.0.16)
-- ---------------------------------------------------------------------

ALTER TABLE Alerts      ADD CONSTRAINT CHK_Alerts_Channel      CHECK (Channel = 'Blinkit' OR Channel = 'Amazon' OR Channel IS NULL);
ALTER TABLE Alerts      ADD CONSTRAINT CHK_Alerts_Severity     CHECK (Severity = 'Low' OR Severity = 'Medium' OR Severity = 'High');
ALTER TABLE Notifications ADD CONSTRAINT CHK_Notifications_Type CHECK (Type = 'success' OR Type = 'error' OR Type = 'warning' OR Type = 'info');
ALTER TABLE Products    ADD CONSTRAINT CHK_Products_UnitPrice  CHECK (UnitPrice IS NULL OR UnitPrice >= 0);
ALTER TABLE UploadLogs  ADD CONSTRAINT CHK_UploadLogs_Channel  CHECK (Channel IS NULL OR (Channel = 'Blinkit' OR Channel = 'Amazon'));
ALTER TABLE UploadLogs  ADD CONSTRAINT CHK_UploadLogs_Status   CHECK (Status = 'FAILED' OR Status = 'PARTIAL' OR Status = 'SUCCESS' OR Status = 'PROCESSING');
ALTER TABLE UploadLogs  ADD CONSTRAINT CHK_UploadLogs_Type     CHECK (UploadType = 'Stock' OR UploadType = 'Inventory' OR UploadType = 'DistributorStock' OR UploadType = 'BlinkitInventory' OR UploadType = 'BlinkitPO' OR UploadType = 'BlinkitSales' OR UploadType = 'AmazonInventory' OR UploadType = 'AmazonPO' OR UploadType = 'AmazonSales');
ALTER TABLE Users       ADD CONSTRAINT CHK_Users_Email         CHECK (Email LIKE '%_@_%.__%');
ALTER TABLE Users       ADD CONSTRAINT CHK_Users_Role          CHECK (Role = 'Blinkit Distributor' OR Role = 'Amazon Distributor' OR Role = 'Manager' OR Role = 'Admin');
ALTER TABLE Warehouses  ADD CONSTRAINT CHK_FCType              CHECK (FCType = 'Small' OR FCType = 'Large' OR FCType = 'Sortable' OR FCType = 'Standard' OR FCType IS NULL);
ALTER TABLE Warehouses  ADD CONSTRAINT CHK_Region              CHECK (Region = 'Central' OR Region = 'West' OR Region = 'East' OR Region = 'South' OR Region = 'North' OR Region IS NULL);
ALTER TABLE Warehouses  ADD CONSTRAINT CHK_WarehouseType       CHECK (WarehouseType = 'Backend' OR WarehouseType = 'Frontend' OR WarehouseType IS NULL);
