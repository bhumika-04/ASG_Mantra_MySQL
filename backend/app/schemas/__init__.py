"""
Pydantic Schemas for Request/Response Validation
"""
from .user import UserCreate, UserUpdate, UserResponse, UserLogin, Token
from .product import ProductCreate, ProductUpdate, ProductResponse
from .inventory import InventoryUpdate, InventoryResponse
from .purchase_order import PurchaseOrderCreate, PurchaseOrderUpdate, PurchaseOrderResponse
from .sales import SalesResponse
from .common import PaginatedResponse, MessageResponse

__all__ = [
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserLogin",
    "Token",
    "ProductCreate",
    "ProductUpdate",
    "ProductResponse",
    "InventoryUpdate",
    "InventoryResponse",
    "PurchaseOrderCreate",
    "PurchaseOrderUpdate",
    "PurchaseOrderResponse",
    "SalesResponse",
    "PaginatedResponse",
    "MessageResponse",
]
