"""
Pydantic schemas for Amazon PO PDF extraction and confirmation.
"""
from pydantic import BaseModel
from typing import Optional, List


class AmazonPOItemPreview(BaseModel):
    """Single line item from the Amazon PO items table."""
    model_config = {"protected_namespaces": ()}

    asin: Optional[str] = None
    external_id: Optional[str] = None
    model_number: Optional[str] = None
    hsn: Optional[str] = None
    title: Optional[str] = None
    cancellation_status: Optional[str] = None
    cancellation_date: Optional[str] = None
    window_type: Optional[str] = None
    expected_date: Optional[str] = None
    quantity_requested: Optional[int] = None
    accepted_quantity: Optional[int] = None
    quantity_received: Optional[int] = None
    quantity_outstanding: Optional[int] = None
    unit_cost: Optional[float] = None
    total_cost: Optional[float] = None


class AmazonPOHeaderPreview(BaseModel):
    """PO header for preview display."""
    po_number: Optional[str] = None
    po_status: Optional[str] = None
    vendor_code: Optional[str] = None
    ship_to_location_code: Optional[str] = None
    ship_to_city: Optional[str] = None
    ship_to_state: Optional[str] = None
    ordered_on_date: Optional[str] = None
    ship_window_start_date: Optional[str] = None
    ship_window_end_date: Optional[str] = None
    freight_terms: Optional[str] = None
    payment_method: Optional[str] = None
    payment_terms: Optional[str] = None
    purchasing_entity_name: Optional[str] = None
    # Summary — Submitted
    submitted_items: Optional[int] = None
    submitted_quantity: Optional[int] = None
    submitted_total_cost: Optional[float] = None
    # Summary — Accepted
    accepted_items: Optional[int] = None
    accepted_quantity: Optional[int] = None
    accepted_total_cost: Optional[float] = None
    # Summary — Cancelled
    cancelled_items: Optional[int] = None
    cancelled_quantity: Optional[int] = None
    cancelled_total_cost: Optional[float] = None
    # Summary — Received
    received_items: Optional[int] = None
    received_quantity: Optional[int] = None
    received_total_cost: Optional[float] = None


class AmazonPOExtractResponse(BaseModel):
    """Response from the PDF extract endpoint."""
    success: bool
    header: Optional[AmazonPOHeaderPreview] = None
    items: List[AmazonPOItemPreview] = []
    warnings: List[str] = []
    errors: List[str] = []
    page_count: int = 0
    item_count: int = 0


class AmazonPOConfirmRequest(BaseModel):
    """Request body for the confirm/save endpoint."""
    header: AmazonPOHeaderPreview
    items: List[AmazonPOItemPreview]
    status: Optional[str] = "Created"
