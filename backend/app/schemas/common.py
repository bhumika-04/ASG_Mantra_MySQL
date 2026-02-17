"""
Common Pydantic Schemas
"""
from pydantic import BaseModel
from typing import Generic, TypeVar, List, Optional

T = TypeVar("T")


class MessageResponse(BaseModel):
    """Standard message response"""

    message: str
    status: str = "success"


class PaginatedResponse(BaseModel, Generic[T]):
    """Paginated response wrapper"""

    items: List[T]
    total: int
    page: int
    page_size: int
    total_pages: int


class ErrorResponse(BaseModel):
    """Error response"""

    detail: str
    status: str = "error"
