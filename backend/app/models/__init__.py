"""
SQLAlchemy Models for TechGenia Analytics
"""
from .user import User
from .product import Product
from .inventory import Inventory
from .purchase_order import PurchaseOrder
from .sales import Sales
from .warehouse import Warehouse
from .alert import LowStockAlert
from .notification import Notification
from .audit_log import AuditLog
from .upload_log import UploadLog

# Dedicated Amazon tables
from .amazon_inventory import AmazonInventoryData
from .amazon_sales import AmazonSalesData
from .amazon_po import AmazonPOData
from .amazon_po_item import AmazonPOItemData

# Dedicated Blinkit tables
from .blinkit_sales import BlinkitSalesData
from .blinkit_po import BlinkitPOData
from .blinkit_po_item import BlinkitPOItemData
from .blinkit_inventory import BlinkitInventoryData

# Distributor & Warehouse master tables
from .distributor import Distributor
from .distributor_facility import DistributorFacility
from .distributor_stock import DistributorStockData
from .asg_warehouse import AsgWarehouse

__all__ = [
    "User",
    "Product",
    "Inventory",
    "PurchaseOrder",
    "Sales",
    "Warehouse",
    "LowStockAlert",
    "Notification",
    "AuditLog",
    "UploadLog",
    # Dedicated tables
    "AmazonInventoryData",
    "AmazonSalesData",
    "AmazonPOData",
    "AmazonPOItemData",
    "BlinkitSalesData",
    "BlinkitPOData",
    "BlinkitPOItemData",
    "BlinkitInventoryData",
    # Distributor & Warehouse
    "Distributor",
    "DistributorFacility",
    "DistributorStockData",
    "AsgWarehouse",
]
