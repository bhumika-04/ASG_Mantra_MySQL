"""
Pydantic schemas for Blinkit PO PDF extraction and confirmation.
"""
from pydantic import BaseModel
from typing import Optional, List


class POItemPreview(BaseModel):
    """Single line item for preview display."""
    sno: Optional[int] = None
    eagle_code: Optional[int] = None
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    mrp: Optional[float] = None
    size: Optional[str] = None
    hsn_code: Optional[str] = None
    qty: Optional[float] = None
    uom: Optional[str] = None
    unit_base_cost: Optional[float] = None
    discount: Optional[float] = None
    taxable_value: Optional[float] = None
    cgst_rate: Optional[float] = None
    cgst_amt: Optional[float] = None
    sgst_rate: Optional[float] = None
    sgst_amt: Optional[float] = None
    igst_rate: Optional[float] = None
    igst_amt: Optional[float] = None
    total_amount: Optional[float] = None


class POHeaderPreview(BaseModel):
    """PO header for preview display."""
    po_number: Optional[str] = None
    po_date: Optional[str] = None
    po_release_date: Optional[str] = None
    po_expiry_date: Optional[str] = None
    payment_terms: Optional[str] = None
    freight_terms: Optional[str] = None
    expected_delivery_date: Optional[str] = None
    vendor_code: Optional[str] = None
    vendor_name: Optional[str] = None
    vendor_gstin: Optional[str] = None
    vendor_pan: Optional[str] = None
    issuer_name: Optional[str] = None
    issuer_gstin: Optional[str] = None
    bill_to_name: Optional[str] = None
    bill_to_address: Optional[str] = None
    bill_to_gstin: Optional[str] = None
    ship_to_name: Optional[str] = None
    ship_to_address: Optional[str] = None
    ship_to_gstin: Optional[str] = None
    total_taxable_amount: Optional[float] = None
    total_tax: Optional[float] = None
    discount_td: Optional[float] = None
    discount_cd: Optional[float] = None
    discount_sd: Optional[float] = None
    grand_total: Optional[float] = None


class POExtractResponse(BaseModel):
    """Response from the PDF extract endpoint."""
    success: bool
    header: Optional[POHeaderPreview] = None
    items: List[POItemPreview] = []
    warnings: List[str] = []
    errors: List[str] = []
    page_count: int = 0
    item_count: int = 0


class POConfirmRequest(BaseModel):
    """Request body for the confirm/save endpoint."""
    header: POHeaderPreview
    items: List[POItemPreview]
    status: Optional[str] = "Created"
