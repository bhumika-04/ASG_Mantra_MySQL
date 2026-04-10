"""
Purchase Orders Router - PO Management
Handles purchase order lifecycle, creation, and tracking
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import Optional
from datetime import datetime, date
import re

from app.database import get_db
from app.models.user import User
from app.models.purchase_order import PurchaseOrder
from app.models.product import Product
from app.models.inventory import Inventory
from app.models.amazon_po import AmazonPOData
from app.models.amazon_po_item import AmazonPOItemData
from app.models.blinkit_po import BlinkitPOData
from app.models.blinkit_po_item import BlinkitPOItemData
from app.schemas.purchase_order import PurchaseOrderCreate, PurchaseOrderUpdate
from app.schemas.common import PaginatedResponse
from app.utils.dependencies import get_current_user
from app.utils.audit import log_audit, notify

router = APIRouter()

# --- City/State helpers for Blinkit PO responses ---

_GSTIN_STATE = {
    '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
    '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
    '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
    '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '27': 'Maharashtra', '29': 'Karnataka', '32': 'Kerala',
    '33': 'Tamil Nadu', '36': 'Telangana',
}

_INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Lakshadweep',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
    'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim',
    'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
    'West Bengal',
]

_CITY_KEYWORDS = [
    'Mumbai', 'Delhi', 'Bangalore', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata',
    'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Surat', 'Kanpur', 'Nagpur', 'Indore',
    'Thane', 'Bhopal', 'Visakhapatnam', 'Patna', 'Vadodara', 'Ghaziabad', 'Ludhiana',
    'Agra', 'Nashik', 'Faridabad', 'Meerut', 'Rajkot', 'Varanasi', 'Srinagar',
    'Aurangabad', 'Dhanbad', 'Amritsar', 'Allahabad', 'Ranchi', 'Howrah', 'Jabalpur',
    'Gurgaon', 'Gurugram', 'Noida', 'Chandigarh', 'Coimbatore', 'Kochi', 'Mysuru',
]


def _blk_city_state(address: Optional[str], ship_to_name: Optional[str], gstin: Optional[str]):
    """Derive city and state for a Blinkit PO row.
    Priority: (1) parse full address, (2) GSTIN prefix for state, (3) keyword scan of name/address.
    """
    city = None
    state = None

    # 1. Parse structured address (City, State - PINCODE)
    if address:
        clean = re.sub(r'[-\s]*\d{6}\s*$', '', address.strip()).strip(' ,')
        parts = [p.strip() for p in clean.split(',') if p.strip()]
        for i in range(len(parts) - 1, -1, -1):
            for s in _INDIAN_STATES:
                if s.lower() in parts[i].lower():
                    state = s
                    if i > 0:
                        city = parts[i - 1].strip()
                    break
            if state:
                break

    # 2. GSTIN prefix → state (most reliable for state when address is missing/ambiguous)
    if not state and gstin and len(gstin) >= 2:
        state = _GSTIN_STATE.get(gstin[:2].zfill(2))

    # 3. Keyword scan across address + ship_to_name for city and state
    combined = ' '.join(filter(None, [address, ship_to_name]))
    if combined:
        if not city:
            for kw in _CITY_KEYWORDS:
                if kw.lower() in combined.lower():
                    city = kw
                    break
        if not state:
            for s in _INDIAN_STATES:
                if s.lower() in combined.lower():
                    state = s
                    break

    return city, state


@router.get("/amazon/overview")
async def get_amazon_po_overview(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """One row per PO number with aggregated item count and qty — for the overview table."""
    query = db.query(
        AmazonPOData.Id.label('po_id'),
        AmazonPOData.PONumber.label('po_number'),
        AmazonPOData.OrderedOnDate.label('order_date'),
        AmazonPOData.POStatus.label('status'),
        AmazonPOData.ShipToCity.label('ship_to_city'),
        AmazonPOData.ShipToState.label('ship_to_state'),
        AmazonPOData.ShipToLocationCode.label('ship_to_location_code'),
        func.count(AmazonPOItemData.Id).label('item_count'),
        func.sum(AmazonPOItemData.QuantityRequested).label('total_qty'),
        func.min(AmazonPOItemData.ExpectedDate).label('expected_delivery_date'),
    ).join(AmazonPOItemData, AmazonPOItemData.POId == AmazonPOData.Id)

    if search:
        query = query.filter(AmazonPOData.PONumber.ilike(f"%{search}%"))
    if status:
        query = query.filter(AmazonPOData.POStatus == status)
    if start_date:
        try:
            query = query.filter(AmazonPOData.OrderedOnDate >= datetime.strptime(start_date, "%Y-%m-%d").date())
        except ValueError:
            pass
    if end_date:
        try:
            query = query.filter(AmazonPOData.OrderedOnDate <= datetime.strptime(end_date, "%Y-%m-%d").date())
        except ValueError:
            pass

    query = query.group_by(
        AmazonPOData.Id, AmazonPOData.PONumber, AmazonPOData.OrderedOnDate,
        AmazonPOData.POStatus, AmazonPOData.ShipToCity, AmazonPOData.ShipToState,
        AmazonPOData.ShipToLocationCode,
    )

    total = query.count()
    offset = (page - 1) * page_size
    rows = query.order_by(AmazonPOData.OrderedOnDate.desc()).offset(offset).limit(page_size).all()

    items = []
    for r in rows:
        location_parts = [r.ship_to_location_code, r.ship_to_city, r.ship_to_state]
        location = ', '.join(p for p in location_parts if p) or '—'
        items.append({
            "po_id": r.po_id,
            "po_number": r.po_number,
            "order_date": r.order_date.isoformat() if r.order_date else None,
            "expected_delivery_date": r.expected_delivery_date.isoformat() if r.expected_delivery_date else None,
            "status": r.status or 'Created',
            "ship_to_city": r.ship_to_city,
            "ship_to_state": r.ship_to_state,
            "ship_to_location_code": r.ship_to_location_code,
            "location": location,
            "item_count": int(r.item_count or 0),
            "total_qty": int(r.total_qty or 0),
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size}


@router.get("/amazon/stats")
async def get_amazon_po_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return per-status counts and totals for Amazon POs (unfiltered, for KPI cards)."""
    rows = db.query(AmazonPOData.POStatus, func.count(AmazonPOData.Id)).group_by(AmazonPOData.POStatus).all()
    status_counts = {(r[0] or 'Created'): r[1] for r in rows}
    total_units = db.query(func.sum(AmazonPOItemData.QuantityRequested)).scalar() or 0
    return {
        "status_counts": status_counts,
        "total_pos": sum(status_counts.values()),
        "total_units": int(total_units),
    }


@router.get("/amazon", response_model=PaginatedResponse)
async def get_amazon_purchase_orders(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get Amazon purchase orders from AmazonPO + AmazonPOItem tables."""
    query = db.query(AmazonPOItemData).join(AmazonPOData, AmazonPOItemData.POId == AmazonPOData.Id)

    if search:
        query = query.filter(
            AmazonPOItemData.PONumber.ilike(f"%{search}%") |
            AmazonPOItemData.Title.ilike(f"%{search}%") |
            AmazonPOItemData.ASIN.ilike(f"%{search}%") |
            AmazonPOItemData.ModelNumber.ilike(f"%{search}%")
        )

    if status:
        query = query.filter(AmazonPOData.POStatus == status)

    if start_date:
        try:
            query = query.filter(AmazonPOData.OrderedOnDate >= datetime.strptime(start_date, "%Y-%m-%d").date())
        except ValueError:
            pass
    if end_date:
        try:
            query = query.filter(AmazonPOData.OrderedOnDate <= datetime.strptime(end_date, "%Y-%m-%d").date())
        except ValueError:
            pass

    total = query.count()
    offset = (page - 1) * page_size
    po_items = query.order_by(desc(AmazonPOData.OrderedOnDate)).offset(offset).limit(page_size).all()

    # Batch load products by ASIN (eliminates N+1)
    asins = list({item.ASIN for item in po_items if item.ASIN})
    products_by_asin: dict = {}
    if asins:
        prods = db.query(Product).filter(Product.AmazonId.in_(asins)).all()
        products_by_asin = {p.AmazonId: p for p in prods}

    # Batch load packed qty sums per product (latest inventory date only)
    product_ids = [p.Id for p in products_by_asin.values()]
    packed_by_product: dict = {}
    if product_ids:
        latest_inv_date = db.query(func.max(Inventory.InventoryDate)).scalar()
        inv_q = db.query(Inventory.ProductId, func.sum(Inventory.PackedQty)).filter(
            Inventory.ProductId.in_(product_ids)
        )
        if latest_inv_date:
            inv_q = inv_q.filter(Inventory.InventoryDate == latest_inv_date)
        packed_by_product = {row[0]: int(row[1] or 0) for row in inv_q.group_by(Inventory.ProductId).all()}

    today = date.today()
    items = []
    for item in po_items:
        po = item.po
        product = products_by_asin.get(item.ASIN)
        product_id = product.Id if product else None
        asg_sku = product.AsgSku if product else None
        product_name = (product.ProductName if product else None) or item.Title or item.ModelNumber or item.ASIN or ''
        packed_qty = packed_by_product.get(product_id, 0) if product_id else 0

        qty_requested = item.QuantityRequested or 0
        gap = max(0, qty_requested - packed_qty)

        expected_date = item.ExpectedDate.isoformat() if item.ExpectedDate else None

        po_header_status = (po.POStatus if po else None) or 'Created'
        item_status = item.ItemStatus or po_header_status
        is_delayed = bool(
            item.ExpectedDate
            and item.ExpectedDate < today
            and po_header_status not in ('Received', 'Delivered', 'Cancelled', 'Closed')
        )

        items.append({
            "id": item.Id,
            "po_id": item.POId,
            "po_number": item.PONumber,
            "product_id": product_id,
            "product_name": product_name,
            "asg_sku": asg_sku,
            "amazon_id": item.ASIN,
            "order_date": po.OrderedOnDate.isoformat() if po and po.OrderedOnDate else None,
            "expected_delivery_date": expected_date,
            "quantity": qty_requested,
            "accepted_quantity": item.AcceptedQuantity,
            "received_quantity": item.QuantityReceived or 0,
            "packed_qty": packed_qty,
            "gap": gap,
            "unit_price": float(item.UnitCost) if item.UnitCost else 0.0,
            "total_amount": float(item.TotalCost) if item.TotalCost else 0.0,
            "status": item_status,
            "po_status": po_header_status,
            "is_delayed": is_delayed,
            "ship_to_city": po.ShipToCity if po else None,
            "ship_to_state": po.ShipToState if po else None,
            "ship_to_location_code": po.ShipToLocationCode if po else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/blinkit/overview")
async def get_blinkit_po_overview(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """One row per PO number with aggregated item count and qty — for the overview table."""
    query = db.query(
        BlinkitPOData.Id.label('po_id'),
        BlinkitPOData.PONumber.label('po_number'),
        BlinkitPOData.PODate.label('order_date'),
        BlinkitPOData.Status.label('status'),
        BlinkitPOData.ShipToName.label('ship_to_name'),
        BlinkitPOData.ShipToAddress.label('ship_to_address'),
        BlinkitPOData.ShipToGSTIN.label('ship_to_gstin'),
        BlinkitPOData.ExpectedDeliveryDate.label('expected_delivery_date'),
        func.count(BlinkitPOItemData.Id).label('item_count'),
        func.sum(BlinkitPOItemData.QTY).label('total_qty'),
    ).join(BlinkitPOItemData, BlinkitPOItemData.POId == BlinkitPOData.Id)

    if search:
        query = query.filter(BlinkitPOData.PONumber.ilike(f"%{search}%"))
    if status:
        query = query.filter(BlinkitPOData.Status == status)
    if start_date:
        try:
            query = query.filter(BlinkitPOData.PODate >= datetime.strptime(start_date, "%Y-%m-%d").date())
        except ValueError:
            pass
    if end_date:
        try:
            query = query.filter(BlinkitPOData.PODate <= datetime.strptime(end_date, "%Y-%m-%d").date())
        except ValueError:
            pass

    query = query.group_by(
        BlinkitPOData.Id, BlinkitPOData.PONumber, BlinkitPOData.PODate,
        BlinkitPOData.Status, BlinkitPOData.ShipToName, BlinkitPOData.ShipToAddress,
        BlinkitPOData.ShipToGSTIN, BlinkitPOData.ExpectedDeliveryDate,
    )

    total = query.count()
    offset = (page - 1) * page_size
    rows = query.order_by(BlinkitPOData.PODate.desc()).offset(offset).limit(page_size).all()

    items = []
    for r in rows:
        city, state = _blk_city_state(r.ship_to_address, r.ship_to_name, r.ship_to_gstin)
        items.append({
            "po_id": r.po_id,
            "po_number": r.po_number,
            "order_date": r.order_date.isoformat() if r.order_date else None,
            "expected_delivery_date": r.expected_delivery_date.isoformat() if r.expected_delivery_date else None,
            "status": r.status or 'Created',
            "ship_to_name": r.ship_to_name,
            "ship_to_city": city,
            "ship_to_state": state,
            "item_count": int(r.item_count or 0),
            "total_qty": int(r.total_qty or 0),
        })

    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size}


@router.get("/blinkit/stats")
async def get_blinkit_po_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return per-status counts and totals for Blinkit POs (unfiltered, for KPI cards)."""
    rows = db.query(BlinkitPOData.Status, func.count(BlinkitPOData.Id)).group_by(BlinkitPOData.Status).all()
    status_counts = {(r[0] or 'Created'): r[1] for r in rows}
    total_units = db.query(func.sum(BlinkitPOItemData.QTY)).scalar() or 0
    return {
        "status_counts": status_counts,
        "total_pos": sum(status_counts.values()),
        "total_units": int(total_units),
    }


@router.get("/blinkit", response_model=PaginatedResponse)
async def get_blinkit_purchase_orders(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get Blinkit purchase orders from BlinkitPO + BlinkitPOItem tables."""
    query = db.query(BlinkitPOItemData).join(BlinkitPOData, BlinkitPOItemData.POId == BlinkitPOData.Id)

    if search:
        query = query.filter(
            BlinkitPOItemData.PONumber.ilike(f"%{search}%") |
            BlinkitPOItemData.ItemName.ilike(f"%{search}%") |
            BlinkitPOItemData.ItemCode.ilike(f"%{search}%")
        )

    if status:
        query = query.filter(BlinkitPOData.Status == status)

    if start_date:
        try:
            query = query.filter(BlinkitPOData.PODate >= datetime.strptime(start_date, "%Y-%m-%d").date())
        except ValueError:
            pass
    if end_date:
        try:
            query = query.filter(BlinkitPOData.PODate <= datetime.strptime(end_date, "%Y-%m-%d").date())
        except ValueError:
            pass

    total = query.count()
    offset = (page - 1) * page_size
    po_items = query.order_by(desc(BlinkitPOData.PODate)).offset(offset).limit(page_size).all()

    # Batch load products — priority: EagleCode→BlinkitId, ItemCode→BlinkitId, ItemCode→AsgSku
    eagle_codes = list({str(item.EagleCode) for item in po_items if item.EagleCode})
    item_codes = list({item.ItemCode for item in po_items if item.ItemCode})
    all_blinkit_ids = list(set(eagle_codes + item_codes))

    products_by_blinkit_id: dict = {}
    if all_blinkit_ids:
        prods = db.query(Product).filter(Product.BlinkitId.in_(all_blinkit_ids)).all()
        products_by_blinkit_id = {p.BlinkitId: p for p in prods}

    products_by_asg_sku: dict = {}
    unmatched_item_codes = [c for c in item_codes if c not in products_by_blinkit_id]
    if unmatched_item_codes:
        prods = db.query(Product).filter(Product.AsgSku.in_(unmatched_item_codes)).all()
        products_by_asg_sku = {p.AsgSku: p for p in prods}

    # Batch load packed qty sums per product (latest inventory date only)
    all_product_ids = list({p.Id for p in list(products_by_blinkit_id.values()) + list(products_by_asg_sku.values())})
    packed_by_product: dict = {}
    if all_product_ids:
        latest_inv_date = db.query(func.max(Inventory.InventoryDate)).scalar()
        inv_q = db.query(Inventory.ProductId, func.sum(Inventory.PackedQty)).filter(
            Inventory.ProductId.in_(all_product_ids)
        )
        if latest_inv_date:
            inv_q = inv_q.filter(Inventory.InventoryDate == latest_inv_date)
        packed_by_product = {row[0]: int(row[1] or 0) for row in inv_q.group_by(Inventory.ProductId).all()}

    today = date.today()
    items = []
    for item in po_items:
        po = item.po
        # Resolve product using priority order
        product = None
        if item.EagleCode:
            product = products_by_blinkit_id.get(str(item.EagleCode))
        if not product and item.ItemCode:
            product = products_by_blinkit_id.get(item.ItemCode)
        if not product and item.ItemCode:
            product = products_by_asg_sku.get(item.ItemCode)

        product_id = product.Id if product else None
        asg_sku = product.AsgSku if product else None
        product_name = (product.ProductName if product else None) or item.ItemName or item.ItemCode or ''
        blinkit_id = item.ItemCode or (str(item.EagleCode) if item.EagleCode else None)
        packed_qty = packed_by_product.get(product_id, 0) if product_id else 0

        qty = int(item.QTY) if item.QTY else 0
        gap = max(0, qty - packed_qty)

        po_header_status = (po.Status if po else None) or 'Created'
        item_status = item.ItemStatus or po_header_status
        is_delayed = bool(
            po and po.ExpectedDeliveryDate
            and po.ExpectedDeliveryDate < today
            and po_header_status not in ('Received', 'Delivered', 'Cancelled', 'Closed')
        )

        ship_to_name = po.ShipToName if po else None
        ship_to_address = po.ShipToAddress if po else None
        ship_to_gstin = po.ShipToGSTIN if po else None
        city, state = _blk_city_state(ship_to_address, ship_to_name, ship_to_gstin)

        items.append({
            "id": item.Id,
            "po_id": item.POId,
            "po_number": item.PONumber,
            "product_id": product_id,
            "product_name": product_name,
            "asg_sku": asg_sku,
            "blinkit_id": blinkit_id,
            "order_date": po.PODate.isoformat() if po and po.PODate else None,
            "expected_delivery_date": po.ExpectedDeliveryDate.isoformat() if po and po.ExpectedDeliveryDate else None,
            "quantity": qty,
            "accepted_qty": item.AcceptedQty,
            "received_quantity": 0,
            "packed_qty": packed_qty,
            "gap": gap,
            "unit_price": float(item.UnitBaseCost) if item.UnitBaseCost else 0.0,
            "total_amount": float(item.TotalAmount) if item.TotalAmount else 0.0,
            "status": item_status,
            "po_status": po_header_status,
            "is_delayed": is_delayed,
            "ship_to_name": ship_to_name,
            "ship_to_address": ship_to_address,
            "ship_to_gstin": ship_to_gstin,
            "ship_to_city": city,
            "ship_to_state": state,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("", response_model=PaginatedResponse, include_in_schema=False)
@router.get("/", response_model=PaginatedResponse)
async def get_all_purchase_orders(
    search: Optional[str] = Query(None, description="Search by PO number or product name"),
    channel: Optional[str] = Query(None, description="Filter by channel (Amazon/Blinkit)"),
    status: Optional[str] = Query(None, description="Filter by status"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all purchase orders combining Amazon and Blinkit new PO tables.
    """
    today = date.today()
    combined = []

    # Parse date filters
    start = None
    end = None
    if start_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")
    if end_date:
        try:
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")

    # Query Amazon POs
    if not channel or channel.lower() == "amazon":
        aq = db.query(AmazonPOItemData).join(AmazonPOData, AmazonPOItemData.POId == AmazonPOData.Id)
        if search:
            aq = aq.filter(
                AmazonPOItemData.PONumber.ilike(f"%{search}%") |
                AmazonPOItemData.Title.ilike(f"%{search}%") |
                AmazonPOItemData.ASIN.ilike(f"%{search}%")
            )
        if status:
            aq = aq.filter(AmazonPOData.POStatus == status)
        if start:
            aq = aq.filter(AmazonPOData.OrderedOnDate >= start)
        if end:
            aq = aq.filter(AmazonPOData.OrderedOnDate <= end)

        for item in aq.all():
            po = item.po
            po_status = (po.POStatus if po else None) or 'Created'
            is_delayed = bool(
                item.ExpectedDate and item.ExpectedDate < today
                and po_status not in ('Received', 'Delivered', 'Cancelled', 'Closed')
            )
            hub = None
            if po:
                hub = po.ShipToCity or po.ShipToLocationCode or None
            tat = None
            if item.ExpectedDate and po and po.OrderedOnDate:
                tat = (item.ExpectedDate - po.OrderedOnDate).days
            combined.append({
                "id": item.Id,
                "po_number": item.PONumber,
                "product_id": None,
                "product_name": item.Title or item.ASIN or '',
                "asg_sku": None,
                "channel": "Amazon",
                "order_date": po.OrderedOnDate.isoformat() if po and po.OrderedOnDate else None,
                "expected_delivery_date": item.ExpectedDate.isoformat() if item.ExpectedDate else None,
                "quantity": item.QuantityRequested or 0,
                "unit_price": float(item.UnitCost) if item.UnitCost else 0.0,
                "total_amount": float(item.TotalCost) if item.TotalCost else 0.0,
                "status": po_status,
                "is_delayed": is_delayed,
                "warehouse_id": None,
                "hub": hub,
                "tat": tat,
            })

    # Query Blinkit POs
    if not channel or channel.lower() == "blinkit":
        bq = db.query(BlinkitPOItemData).join(BlinkitPOData, BlinkitPOItemData.POId == BlinkitPOData.Id)
        if search:
            bq = bq.filter(
                BlinkitPOItemData.PONumber.ilike(f"%{search}%") |
                BlinkitPOItemData.ItemName.ilike(f"%{search}%") |
                BlinkitPOItemData.ItemCode.ilike(f"%{search}%")
            )
        if status:
            bq = bq.filter(BlinkitPOData.Status == status)
        if start:
            bq = bq.filter(BlinkitPOData.PODate >= start)
        if end:
            bq = bq.filter(BlinkitPOData.PODate <= end)

        for item in bq.all():
            po = item.po
            po_status = (po.Status if po else None) or 'Created'
            is_delayed = bool(
                po and po.ExpectedDeliveryDate and po.ExpectedDeliveryDate < today
                and po_status not in ('Received', 'Delivered', 'Cancelled', 'Closed')
            )
            hub = (po.ShipToName if po else None) or None
            tat = None
            if po and po.ExpectedDeliveryDate and po.PODate:
                tat = (po.ExpectedDeliveryDate - po.PODate).days
            combined.append({
                "id": item.Id,
                "po_number": item.PONumber,
                "product_id": None,
                "product_name": item.ItemName or item.ItemCode or '',
                "asg_sku": None,
                "channel": "Blinkit",
                "order_date": po.PODate.isoformat() if po and po.PODate else None,
                "expected_delivery_date": po.ExpectedDeliveryDate.isoformat() if po and po.ExpectedDeliveryDate else None,
                "quantity": int(item.QTY) if item.QTY else 0,
                "unit_price": float(item.UnitBaseCost) if item.UnitBaseCost else 0.0,
                "total_amount": float(item.TotalAmount) if item.TotalAmount else 0.0,
                "status": po_status,
                "is_delayed": is_delayed,
                "warehouse_id": None,
                "hub": hub,
                "tat": tat,
            })

    # Sort by order_date descending and paginate in Python
    combined.sort(key=lambda x: x.get("order_date") or "0000-01-01", reverse=True)

    total = len(combined)
    offset = (page - 1) * page_size
    items = combined[offset:offset + page_size]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/{po_id}")
async def get_purchase_order_by_id(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get a single purchase order by ID with full details
    """
    po = db.query(PurchaseOrder).filter(PurchaseOrder.Id == po_id).first()

    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    product = po.product
    warehouse = po.warehouse if po.warehouse else None

    return {
        "id": po.Id,
        "po_number": po.PoNumber,
        "product_id": po.ProductId,
        "product_name": product.ProductName,
        "asg_sku": product.AsgSku,
        "amazon_id": product.AmazonId,
        "blinkit_id": product.BlinkitId,
        "category": product.Category,
        "brand": product.Brand,
        "channel": po.Channel,
        "order_date": po.OrderDate.isoformat() if po.OrderDate else None,
        "expected_delivery_date": po.ExpectedDeliveryDate.isoformat() if po.ExpectedDeliveryDate else None,
        "actual_delivery_date": po.ActualDeliveryDate.isoformat() if po.ActualDeliveryDate else None,
        "quantity": po.Quantity,
        "received_quantity": po.ReceivedQuantity,
        "unit_price": float(po.UnitPrice),
        "total_amount": float(po.TotalAmount),
        "status": po.Status,
        "is_delayed": po.IsDelayed,
        "warehouse_id": po.WarehouseId,
        "warehouse_name": warehouse.WarehouseName if warehouse else None,
        "remarks": po.Remarks,
    }


@router.post("/")
async def create_purchase_order(
    po_data: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new purchase order
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Verify product exists
    product = db.query(Product).filter(Product.Id == po_data.productId).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Calculate total amount
    total_amount = po_data.quantity * po_data.unitPrice

    # Create PO
    new_po = PurchaseOrder(
        PoNumber=po_data.poNumber,
        ProductId=po_data.productId,
        Channel=po_data.channel,
        OrderDate=po_data.orderDate or datetime.utcnow(),
        ExpectedDeliveryDate=po_data.expectedDeliveryDate,
        Quantity=po_data.quantity,
        ReceivedQuantity=0,
        UnitPrice=po_data.unitPrice,
        TotalAmount=total_amount,
        Status="Created",
        WarehouseId=po_data.warehouseId,
        Remarks=po_data.remarks,
    )

    try:
        db.add(new_po)
        db.commit()
        db.refresh(new_po)

        return {
            "success": True,
            "message": "Purchase order created successfully",
            "data": {
                "id": new_po.Id,
                "po_number": new_po.PoNumber,
                "product_name": product.ProductName,
                "quantity": new_po.Quantity,
                "total_amount": float(new_po.TotalAmount),
                "status": new_po.Status,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create purchase order: {str(e)}")


@router.put("/{po_id}/status")
async def update_purchase_order_status(
    po_id: int,
    status_data: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update purchase order status
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(PurchaseOrder).filter(PurchaseOrder.Id == po_id).first()

    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    # Capture old status for audit
    old_status = po.Status

    # Update status
    po.Status = status_data.status

    # On Delivered: record received quantity and actual delivery date
    if status_data.status == "Delivered":
        if status_data.receivedQuantity is not None:
            po.ReceivedQuantity = status_data.receivedQuantity
        else:
            po.ReceivedQuantity = po.Quantity  # Default to full quantity

        po.ActualDeliveryDate = status_data.actualDeliveryDate or datetime.utcnow().date()

    # Update tracking number if provided
    if status_data.trackingNumber is not None:
        po.TrackingNumber = status_data.trackingNumber

    # Update courier if provided
    if status_data.courier is not None:
        po.Courier = status_data.courier

    # Update remarks if provided
    if status_data.remarks is not None:
        po.Remarks = status_data.remarks

    log_audit(db, current_user.Id, "STATUS_CHANGE", "PurchaseOrders", str(po.Id),
              old_values={"status": old_status},
              new_values={"status": status_data.status})
    notify(db, current_user.Id, "PO Status Updated",
           f"PO {po.PoNumber}: {old_status} → {status_data.status}", "po_status")

    try:
        db.commit()
        db.refresh(po)

        return {
            "success": True,
            "message": f"Purchase order status updated to {status_data.status}",
            "data": {
                "id": po.Id,
                "po_number": po.PoNumber,
                "status": po.Status,
                "received_quantity": po.ReceivedQuantity,
                "actual_delivery_date": po.ActualDeliveryDate.isoformat() if po.ActualDeliveryDate else None,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update purchase order: {str(e)}")


@router.put("/amazon-item/{item_id}/status")
async def update_amazon_po_status(
    item_id: int,
    status_data: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update per-item status for an Amazon PO line (ItemStatus, not the PO header)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    old_status = item.ItemStatus
    item.ItemStatus = status_data.status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "AmazonPOItem", str(item.Id),
              old_values={"itemStatus": old_status},
              new_values={"itemStatus": status_data.status})
    try:
        db.commit()
        return {"success": True, "message": f"Amazon PO item {item.Id} status updated to {status_data.status}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/blinkit-item/{item_id}/status")
async def update_blinkit_po_status(
    item_id: int,
    status_data: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update per-item status for a Blinkit PO line (ItemStatus, not the PO header)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    item = db.query(BlinkitPOItemData).filter(BlinkitPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blinkit PO item not found")

    old_status = item.ItemStatus
    item.ItemStatus = status_data.status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "BlinkitPOItem", str(item.Id),
              old_values={"itemStatus": old_status},
              new_values={"itemStatus": status_data.status})
    try:
        db.commit()
        return {"success": True, "message": f"Blinkit PO item {item.Id} status updated to {status_data.status}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/amazon-po/{po_id}/po-status")
async def update_amazon_po_header_status(
    po_id: int,
    status_data: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update AmazonPO header status (used by overview/lifecycle pages)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(AmazonPOData).filter(AmazonPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Amazon PO not found")

    old_status = po.POStatus
    po.POStatus = status_data.status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "AmazonPO", str(po.Id),
              old_values={"poStatus": old_status},
              new_values={"poStatus": status_data.status})
    notify(db, current_user.Id, "Amazon PO Status Updated",
           f"PO {po.PONumber}: {old_status} → {status_data.status}", "po_status")
    try:
        db.commit()
        return {"success": True, "message": f"Amazon PO {po.PONumber} status updated to {status_data.status}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/blinkit-po/{po_id}/po-status")
async def update_blinkit_po_header_status(
    po_id: int,
    status_data: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update BlinkitPO header status (used by overview/lifecycle pages)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    old_status = po.Status
    po.Status = status_data.status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "BlinkitPO", str(po.Id),
              old_values={"status": old_status},
              new_values={"status": status_data.status})
    notify(db, current_user.Id, "Blinkit PO Status Updated",
           f"PO {po.PONumber}: {old_status} → {status_data.status}", "po_status")
    try:
        db.commit()
        return {"success": True, "message": f"Blinkit PO {po.PONumber} status updated to {status_data.status}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


def _deduct_inventory_for_product(db: Session, product_id: int, deduct_qty: int) -> dict:
    """Deduct deduct_qty from PackedQty (then CurrentStock) for a product across all inventory rows.
    Returns info about how much was deducted and any shortfall."""
    from sqlalchemy import func as sqlfunc
    latest_date = db.query(func.max(Inventory.InventoryDate)).scalar()
    inv_q = db.query(Inventory).filter(
        Inventory.ProductId == product_id,
        Inventory.PackedQty > 0
    )
    if latest_date:
        inv_q = inv_q.filter(Inventory.InventoryDate == latest_date)
    inv_rows = inv_q.order_by(Inventory.InventoryDate.desc()).all()

    total_packed = sum(i.PackedQty for i in inv_rows)
    remaining = deduct_qty

    for inv in inv_rows:
        if remaining <= 0:
            break
        deduct = min(inv.PackedQty, remaining)
        inv.PackedQty -= deduct
        inv.CurrentStock = max(0, inv.CurrentStock - deduct)
        remaining -= deduct

    return {
        "deducted": deduct_qty - remaining,
        "shortfall": max(0, remaining),
        "was_packed": total_packed,
    }


@router.put("/amazon-item/{item_id}/accepted-qty")
async def update_amazon_item_accepted_qty(
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set AcceptedQuantity on an Amazon PO line item and deduct from packed inventory."""
    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    accepted_qty = body.get("accepted_qty")
    if accepted_qty is None:
        raise HTTPException(status_code=422, detail="accepted_qty is required")

    old_val = item.AcceptedQuantity or 0
    new_val = int(accepted_qty)
    item.AcceptedQuantity = new_val

    # Deduct the DIFFERENCE from packed inventory
    deduct_qty = new_val - old_val
    inventory_result = {}
    if deduct_qty > 0:
        # Resolve product: from ProductId link or by ASIN lookup
        product_id = item.ProductId
        if not product_id:
            product = db.query(Product).filter(Product.AmazonId == item.ASIN).first()
            if product:
                product_id = product.Id
        if product_id:
            inventory_result = _deduct_inventory_for_product(db, product_id, deduct_qty)

    log_audit(db, current_user.Id, "UPDATE", "AmazonPOItem", str(item_id),
              old_values={"acceptedQuantity": old_val},
              new_values={"acceptedQuantity": new_val, "inventoryDeducted": inventory_result.get("deducted", 0)})
    try:
        db.commit()
        return {
            "success": True,
            "accepted_quantity": item.AcceptedQuantity,
            "inventory_deducted": inventory_result.get("deducted", 0),
            "inventory_shortfall": inventory_result.get("shortfall", 0),
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/amazon-item/{item_id}/received-qty")
async def update_amazon_item_received_qty(
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set QuantityReceived on an Amazon PO line item."""
    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    received_qty = body.get("received_qty")
    if received_qty is None:
        raise HTTPException(status_code=422, detail="received_qty is required")

    old_val = item.QuantityReceived or 0
    new_val = int(received_qty)
    item.QuantityReceived = new_val

    log_audit(db, current_user.Id, "UPDATE", "AmazonPOItem", str(item_id),
              old_values={"quantityReceived": old_val},
              new_values={"quantityReceived": new_val})
    try:
        db.commit()
        return {"success": True, "received_quantity": item.QuantityReceived}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/blinkit-item/{item_id}/accepted-qty")
async def update_blinkit_item_accepted_qty(
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set AcceptedQty on a Blinkit PO line item and deduct from packed inventory."""
    item = db.query(BlinkitPOItemData).filter(BlinkitPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blinkit PO item not found")

    accepted_qty = body.get("accepted_qty")
    if accepted_qty is None:
        raise HTTPException(status_code=422, detail="accepted_qty is required")

    old_val = item.AcceptedQty or 0
    new_val = int(accepted_qty)
    item.AcceptedQty = new_val

    # Deduct the DIFFERENCE from packed inventory
    deduct_qty = new_val - old_val
    inventory_result = {}
    if deduct_qty > 0:
        product_id = item.ProductId
        if not product_id:
            # Lookup by EagleCode → BlinkitId, then ItemCode → BlinkitId, then ItemCode → AsgSku
            if item.EagleCode:
                p = db.query(Product).filter(Product.BlinkitId == str(item.EagleCode)).first()
                if p:
                    product_id = p.Id
            if not product_id and item.ItemCode:
                p = db.query(Product).filter(Product.BlinkitId == item.ItemCode).first()
                if p:
                    product_id = p.Id
            if not product_id and item.ItemCode:
                p = db.query(Product).filter(Product.AsgSku == item.ItemCode).first()
                if p:
                    product_id = p.Id
        if product_id:
            inventory_result = _deduct_inventory_for_product(db, product_id, deduct_qty)

    log_audit(db, current_user.Id, "UPDATE", "BlinkitPOItem", str(item_id),
              old_values={"acceptedQty": old_val},
              new_values={"acceptedQty": new_val, "inventoryDeducted": inventory_result.get("deducted", 0)})
    try:
        db.commit()
        return {
            "success": True,
            "accepted_qty": item.AcceptedQty,
            "inventory_deducted": inventory_result.get("deducted", 0),
            "inventory_shortfall": inventory_result.get("shortfall", 0),
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
