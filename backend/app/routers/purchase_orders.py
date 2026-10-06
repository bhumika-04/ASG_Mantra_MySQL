"""
Purchase Orders Router - PO Management
Handles purchase order lifecycle, creation, and tracking
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc, func, literal, text
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
from app.utils.timeutil import now_ist, today_ist
import time as _time

router = APIRouter()

_TERMINAL_STATUSES = {'Delivered', 'Received', 'Cancelled', 'Closed', 'Expired'}
_PENDING_STATUSES  = {'Created', 'Packed', 'Dispatched', 'In Transit', 'Delayed'}
_EXPIRY_DAYS = 15  # PO is auto-shown as Expired when expiry date is this many days past
# Statuses that block auto-expiry: terminal ones plus in-progress shipped statuses —
# a dispatched/in-transit PO is actively being fulfilled and should not flip to Expired
# just because the ship-window end date passed.
_NO_EXPIRY_OVERRIDE = _TERMINAL_STATUSES | {'Dispatched', 'In Transit'}

# Header statuses that take precedence over the max item status when deriving a PO's
# effective status. Defined once because the overview, item-grid and stats queries each
# carried their own copy and drifted: the item grid omitted Dispatched/In Transit, so
# the same status filter returned different POs depending on which view you were in.
# 'Expired' is included because it is a real stored header status, not only a computed
# one — an explicitly expired PO must not be overridden by a stale item status.
_HEADER_WINS = ('Delivered', 'Received', 'Cancelled', 'Closed', 'Dispatched', 'In Transit', 'Expired')
_HEADER_WINS_SQL = "'" + "','".join(_HEADER_WINS) + "'"
_NO_EXPIRY_SQL = "'" + "','".join(sorted(_NO_EXPIRY_OVERRIDE)) + "'"


def _po_status_expr(status_col: str, item_expr: str) -> str:
    """Effective PO status in SQL: an authoritative header status wins, otherwise fall
    back to the item status. Shared by the overview, item-grid and stats queries."""
    return (f"CASE WHEN {status_col} IN ({_HEADER_WINS_SQL}) THEN {status_col} "
            f"ELSE COALESCE({item_expr}, {status_col}, 'Created') END")


def _po_expired_sql(status_col: str, item_expr: str, expiry_col: str) -> str:
    """Predicate matching Expired POs. Expired arises two ways and both must match:
    stored explicitly on the header, or derived because the expiry date passed while
    the PO was still open. The filter previously tested only the derived case, so it
    returned 13 of 236 expired Amazon POs and 0 of 264 for Blinkit."""
    return (f"({status_col} = 'Expired' OR ("
            f"{_po_status_expr(status_col, item_expr)} NOT IN ({_NO_EXPIRY_SQL}) "
            f"AND {expiry_col} IS NOT NULL "
            f"AND DATEDIFF(NOW(), {expiry_col}) >= {_EXPIRY_DAYS}))")


def _po_status_filter(status: str, status_col: str, item_expr: str, expiry_col: str):
    """Bound predicate for a status filter, mirroring the stats CTE exactly.

    Every non-Expired status must also exclude POs the expiry override reclassifies as
    Expired, otherwise a PO counted as Expired by the KPI still shows up under its
    stored status in the grid (13 Amazon POs sat in both 'Created' and 'Expired').

    The status value is bound as a parameter, never interpolated. It arrives straight
    from a query string, so embedding it in the SQL text made every PO listing endpoint
    injectable: ?status=' OR '1'='1 returned all rows regardless of status.
    """
    expired = _po_expired_sql(status_col, item_expr, expiry_col)
    if status == 'Expired':
        return text(expired)
    return text(
        f"({_po_status_expr(status_col, item_expr)} = :po_status AND NOT {expired})"
    ).bindparams(po_status=status)

def _eff_status(base: Optional[str], expiry_date=None) -> str:
    """Compute display status: applies auto-expiry on top of the stored/derived status."""
    s = base or 'Created'
    if s not in _NO_EXPIRY_OVERRIDE and expiry_date:
        # Normalize datetime.datetime → datetime.date (DB drivers can return either for DATE columns)
        exp = expiry_date.date() if hasattr(expiry_date, 'date') else expiry_date
        if (today_ist() - exp).days >= _EXPIRY_DAYS:
            return 'Expired'
    return s

# Cache latest inventory date for 5 minutes — avoids one DB round-trip per PO page load
_inv_date_cache: dict = {"value": None, "ts": 0.0}

# Short-lived cache for stats endpoints — 15s TTL so KPIs feel instant on navigation
# while still reflecting status changes within a few seconds.
_stats_cache: dict = {}  # key → {"data": ..., "ts": float}
_STATS_TTL = 15.0

def _stats_get(key: str):
    entry = _stats_cache.get(key)
    if entry and _time.monotonic() - entry["ts"] < _STATS_TTL:
        return entry["data"]
    return None

def _stats_set(key: str, data: dict):
    _stats_cache[key] = {"data": data, "ts": _time.monotonic()}

def _stats_invalidate():
    """Call after any mutation that changes PO status so next read is always fresh."""
    _stats_cache.clear()


# A PO that has been delivered cannot be moved back to a stage before delivery.
_DELIVERED_STATUSES = {'Delivered', 'Received'}
_PRE_DELIVERY_STATUSES = {'Created', 'Packed', 'Dispatched', 'In Transit', 'Delayed'}


def _check_status_move(old_status, new_status) -> None:
    """Refuse Delivered/Received -> Created/Packed/Dispatched/In Transit/Delayed (HTTP 422)."""
    old = getattr(old_status, 'value', old_status)
    new = getattr(new_status, 'value', new_status)
    if old in _DELIVERED_STATUSES and new in _PRE_DELIVERY_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"A {old} PO cannot go back to '{new}'.",
        )


def _check_expected_not_before_order(expected, order_date, what: str = "Expected date") -> None:
    """Refuse an expected date earlier than the order date (HTTP 422)."""
    if expected and order_date and expected < order_date:
        raise HTTPException(
            status_code=422,
            detail=f"{what} ({expected.isoformat()}) cannot be before the order date ({order_date.isoformat()}).",
        )


def _require_po_editor(current_user: User):
    """Quantity edits cascade into inventory deductions — restrict to Admin/Manager,
    matching the guard already applied to the PO status endpoints."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _validate_qty(value, ordered_qty, field: str) -> int:
    """Coerce a submitted quantity and bounds-check it against the line's ordered qty.

    Without the upper bound an oversized value (e.g. 99999 on a 10-unit line) would
    drive an equivalently oversized inventory deduction.
    """
    try:
        qty = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a whole number")
    if qty < 0:
        raise HTTPException(status_code=422, detail=f"{field} cannot be negative")
    if ordered_qty is not None and qty > int(ordered_qty):
        raise HTTPException(
            status_code=422,
            detail=f"{field} ({qty}) cannot exceed the ordered quantity ({int(ordered_qty)})",
        )
    return qty

def _get_latest_inv_date(db):
    now = _time.monotonic()
    if _inv_date_cache["value"] is not None and now - _inv_date_cache["ts"] < 300:
        return _inv_date_cache["value"]
    val = db.query(func.max(Inventory.InventoryDate)).scalar()
    _inv_date_cache["value"] = val
    _inv_date_cache["ts"] = now
    return val

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
    # Logistics & warehouse hub cities common in Blinkit/Eagle POs
    'Bhiwandi', 'Kundli', 'Sonipat', 'Manesar', 'Bilaspur', 'Palghar', 'Vasai',
    'Navi Mumbai', 'Khopoli', 'Panvel', 'Bhosari', 'Whitefield', 'Bommasandra',
    'Tumkur', 'Hosur', 'Sriperumbudur', 'Oragadam', 'Rai', 'Bawal', 'Haridwar',
    'Roorkee', 'Rudrapur', 'Pantnagar', 'Kashipur', 'Baddi', 'Parwanoo',
    'Khurja', 'Hapur', 'Pilkhuwa', 'Greater Noida', 'Bahadurgarh',
]

# Hub city → state for Eagle Network warehouses whose addresses omit the state name
_HUB_CITY_STATE = {
    'kundli': 'Haryana', 'sonipat': 'Haryana', 'manesar': 'Haryana',
    'bahadurgarh': 'Haryana', 'rai': 'Haryana', 'bawal': 'Haryana',
    'bhiwandi': 'Maharashtra', 'palghar': 'Maharashtra', 'vasai': 'Maharashtra',
    'panvel': 'Maharashtra', 'khopoli': 'Maharashtra', 'navi mumbai': 'Maharashtra',
    'bhosari': 'Maharashtra', 'pune': 'Maharashtra', 'nagpur': 'Maharashtra',
    'bommasandra': 'Karnataka', 'whitefield': 'Karnataka', 'hosur': 'Karnataka',
    'tumkur': 'Karnataka', 'oragadam': 'Tamil Nadu', 'sriperumbudur': 'Tamil Nadu',
    'haridwar': 'Uttarakhand', 'roorkee': 'Uttarakhand', 'rudrapur': 'Uttarakhand',
    'pantnagar': 'Uttarakhand', 'kashipur': 'Uttarakhand',
}

# Eagle Network PO number prefix → state (most reliable fallback)
_EAGLE_PREFIX_STATE = {
    'EH': 'Haryana', 'EK': 'Karnataka', 'ED': 'Delhi',
    'EM': 'Maharashtra', 'EW': 'West Bengal', 'EP': 'Punjab',
    'EU': 'Uttar Pradesh', 'ER': 'Rajasthan', 'ET': 'Tamil Nadu',
}


def _blk_city_state(address: Optional[str], ship_to_name: Optional[str], gstin: Optional[str], po_number: Optional[str] = None):
    """Derive city and state for a Blinkit PO row.
    Priority: (1) parse normalised address parts, (2) GSTIN prefix,
              (3) keyword scan, (4) hub city → state lookup,
              (5) Eagle PO number prefix.
    Handles multi-line addresses (newlines → commas) and trailing
    "PIN India" / "PIN\nIndia" patterns common in Blinkit PDFs.
    """
    city = None
    state = None

    # 1. Parse structured address
    if address:
        # Normalise newlines/tabs to commas so multi-line PDF addresses
        # are treated the same as comma-separated ones
        norm = re.sub(r'[\r\n\t]+', ', ', address.strip())
        # Strip trailing country name variants (India, INDIA, etc.)
        norm = re.sub(r'[,\s]*\bIndia\b[,.\s]*$', '', norm, flags=re.IGNORECASE).strip(' ,')
        # Strip trailing 6-digit PIN (now that "India" is gone)
        norm = re.sub(r'[-\s]*\d{6}\s*$', '', norm).strip(' ,')

        parts = [p.strip() for p in norm.split(',') if p.strip()]

        # Scan backward for a state name embedded in any part
        for i in range(len(parts) - 1, -1, -1):
            for s in _INDIAN_STATES:
                if s.lower() in parts[i].lower():
                    state = s
                    # City may be in the same segment (e.g. "Gurgaon Haryana")
                    # or in the immediately preceding segment
                    for kw in _CITY_KEYWORDS:
                        if kw.lower() in parts[i].lower():
                            city = kw
                            break
                    if not city and i > 0:
                        city = parts[i - 1].strip()
                    break
            if state:
                break

        # After stripping PIN+India the last part often IS the city
        # (e.g. "... BUILDING E/8, Thane" → last part "Thane")
        if not city and parts:
            for kw in _CITY_KEYWORDS:
                if kw.lower() in parts[-1].lower():
                    city = kw
                    break

        # Scan remaining parts from end toward start for hub city keywords
        # (handles "VILLAGE-TALUKA BHIWANDI ..., Thane" where Bhiwandi is mid-address)
        if not city and len(parts) >= 2:
            for p in reversed(parts):
                for kw in _CITY_KEYWORDS:
                    if kw.lower() in p.lower():
                        city = kw
                        break
                if city:
                    break

    # 2. GSTIN prefix → state
    if not state and gstin and len(gstin) >= 2:
        state = _GSTIN_STATE.get(gstin[:2].zfill(2))

    # 3. Keyword scan across full address + ship_to_name
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

    # 4. Hub city → state (warehouse addresses that omit the state name)
    if not state and city:
        state = _HUB_CITY_STATE.get(city.lower())
    if not state and combined:
        for hub, hub_state in _HUB_CITY_STATE.items():
            if hub in combined.lower():
                if not city:
                    city = hub.title()
                state = hub_state
                break

    # 5. Eagle PO number prefix → state (most reliable final fallback)
    if not state and po_number and len(po_number) >= 2:
        prefix = po_number[:2].upper()
        state = _EAGLE_PREFIX_STATE.get(prefix)

    return city, state


@router.get("/amazon/overview")
async def get_amazon_po_overview(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """One row per PO number with aggregated item count and qty — for the overview table."""
    query = db.query(
        AmazonPOData.Id.label('po_id'),
        AmazonPOData.PONumber.label('po_number'),
        AmazonPOData.OrderedOnDate.label('order_date'),
        AmazonPOData.POStatus.label('po_header_status'),
        func.max(AmazonPOItemData.ItemStatus).label('max_item_status'),
        AmazonPOData.ShipToCity.label('ship_to_city'),
        AmazonPOData.ShipToState.label('ship_to_state'),
        AmazonPOData.ShipToLocationCode.label('ship_to_location_code'),
        func.count(AmazonPOItemData.Id).label('item_count'),
        func.sum(AmazonPOItemData.QuantityRequested).label('total_qty'),
        func.min(AmazonPOItemData.ExpectedDate).label('expected_delivery_date'),
        func.min(AmazonPOItemData.CancellationDate).label('po_cancellation_date'),
        AmazonPOData.ShipWindowEndDate.label('ship_window_end_date'),
        AmazonPOData.DispatchDate.label('dispatch_date'),
        AmazonPOData.Courier.label('courier'),
    ).join(AmazonPOItemData, AmazonPOItemData.POId == AmazonPOData.Id)

    if search:
        query = query.filter(AmazonPOData.PONumber.ilike(f"%{search}%"))
    if status:
        query = query.having(_po_status_filter(
            status, "AmazonPO.POStatus", "MAX(AmazonPOItem.ItemStatus)", "AmazonPO.ShipWindowEndDate"
        ))
    # Skip date filter when searching by PO number — the PO may predate the active range
    if not search:
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
        AmazonPOData.ShipToLocationCode, AmazonPOData.ShipWindowEndDate,
        AmazonPOData.DispatchDate, AmazonPOData.Courier,
    )


    # Single pass: subquery + COUNT(*) OVER() avoids a second GROUP BY round-trip
    offset = (page - 1) * page_size
    subq = query.subquery()
    rows_with_count = (
        db.query(subq,
                 func.count().over().label('_total'),
                 func.sum(subq.c.total_qty).over().label('_total_units'))
        .order_by(subq.c.order_date.desc())
        .offset(offset).limit(page_size).all()
    )
    # Window aggregates ride along on returned rows only — paging past the end returns
    # none, so fall back to explicit aggregates rather than reporting 0.
    if rows_with_count:
        total = rows_with_count[0]._total
        total_units = int(rows_with_count[0]._total_units or 0)
    else:
        total = db.query(func.count()).select_from(subq).scalar() or 0
        total_units = int(db.query(func.coalesce(func.sum(subq.c.total_qty), 0)).select_from(subq).scalar() or 0)

    items = []
    for r in rows_with_count:
        location_parts = [r.ship_to_location_code, r.ship_to_city, r.ship_to_state]
        location = ', '.join(p for p in location_parts if p) or '—'
        # ShipWindowEndDate = last day Amazon expects shipment — treat as PO expiry for Amazon
        eff_status = _eff_status(r.po_header_status or r.max_item_status, r.ship_window_end_date)
        items.append({
            "po_id": r.po_id,
            "po_number": r.po_number,
            "order_date": r.order_date.isoformat() if r.order_date else None,
            "expected_delivery_date": r.expected_delivery_date.isoformat() if r.expected_delivery_date else None,
            "po_cancellation_date": r.po_cancellation_date.isoformat() if r.po_cancellation_date else None,
            "ship_window_end_date": r.ship_window_end_date.isoformat() if r.ship_window_end_date else None,
            "dispatch_date": r.dispatch_date.isoformat() if r.dispatch_date else None,
            "courier": r.courier,
            "status": eff_status,
            "po_status": r.po_header_status,
            "ship_to_city": r.ship_to_city,
            "ship_to_state": r.ship_to_state,
            "ship_to_location_code": r.ship_to_location_code,
            "location": location,
            "item_count": int(r.item_count or 0),
            "total_qty": int(r.total_qty or 0),
        })

    return {"items": items, "total": total, "total_units": total_units,
            "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size}


@router.get("/amazon/stats")
async def get_amazon_po_stats(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return per-status PO counts and totals for Amazon POs (optionally date-filtered).
    Counts at PO level by POStatus so metrics match the overview grid and update when status changes.
    """
    where_clauses = []
    params: dict = {}
    if start_date:
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
            where_clauses.append("OrderedOnDate >= :start_date")
            params["start_date"] = start_date
        except ValueError:
            pass
    if end_date:
        try:
            datetime.strptime(end_date, "%Y-%m-%d")
            where_clauses.append("OrderedOnDate <= :end_date")
            params["end_date"] = end_date
        except ValueError:
            pass
    amz_where_sql = ("WHERE p." + " AND p.".join(where_clauses)) if where_clauses else ""
    cache_key = f"amz_stats:{start_date}:{end_date}"
    cached = _stats_get(cache_key)
    if cached:
        return cached
    # Single query: status counts + total units via CTE to avoid two round-trips
    rows = db.execute(text(f"""
        WITH base AS (
            SELECT
                CASE
                    WHEN CASE WHEN p.POStatus IN ({_HEADER_WINS_SQL}) THEN p.POStatus ELSE COALESCE(agg.max_status, p.POStatus, 'Created') END
                         NOT IN ({_HEADER_WINS_SQL},'Expired','Dispatched','In Transit')
                     AND p.ShipWindowEndDate IS NOT NULL
                     AND DATEDIFF(NOW(), p.ShipWindowEndDate) >= {_EXPIRY_DAYS}
                    THEN 'Expired'
                    ELSE CASE WHEN p.POStatus IN ({_HEADER_WINS_SQL}) THEN p.POStatus ELSE COALESCE(agg.max_status, p.POStatus, 'Created') END
                END AS eff_status,
                COALESCE(units.total_qty, 0) AS total_qty
            FROM AmazonPO p
            LEFT JOIN (
                SELECT POId, MAX(ItemStatus) AS max_status
                FROM AmazonPOItem GROUP BY POId
            ) agg ON agg.POId = p.Id
            LEFT JOIN (
                SELECT POId, SUM(QuantityRequested) AS total_qty
                FROM AmazonPOItem GROUP BY POId
            ) units ON units.POId = p.Id
            {amz_where_sql}
        )
        SELECT eff_status, COUNT(*) AS cnt, SUM(total_qty) AS total_qty
        FROM base
        GROUP BY eff_status
    """), params).fetchall()
    status_counts = {r[0]: r[1] for r in rows}
    total_units = int(sum(r[2] or 0 for r in rows))
    result = {
        "status_counts": status_counts,
        "total_pos": sum(status_counts.values()),
        "total_units": total_units,
    }
    _stats_set(cache_key, result)
    return result


@router.get("/carriers")
async def get_carriers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return distinct carrier names used across Amazon and Blinkit POs."""
    amz = {r[0] for r in db.query(AmazonPOData.Courier)
           .filter(AmazonPOData.Courier.isnot(None), AmazonPOData.Courier != '').distinct().all()}
    blk = {r[0] for r in db.query(BlinkitPOData.Courier)
           .filter(BlinkitPOData.Courier.isnot(None), BlinkitPOData.Courier != '').distinct().all()}
    return {"carriers": sorted(amz | blk)}


@router.get("/amazon/states")
async def get_amazon_po_states(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return all distinct non-null ShipToState values from Amazon POs."""
    rows = (
        db.query(AmazonPOData.ShipToState)
        .filter(AmazonPOData.ShipToState.isnot(None), AmazonPOData.ShipToState != '')
        .distinct()
        .order_by(AmazonPOData.ShipToState)
        .all()
    )
    return {"states": [r[0] for r in rows]}


# No response_model: this returns total_units/total_pos on top of the standard
# pagination fields, and PaginatedResponse would silently strip them.
@router.get("/amazon")
async def get_amazon_purchase_orders(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
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
        query = query.filter(_po_status_filter(
            status, "AmazonPO.POStatus", "AmazonPOItem.ItemStatus", "AmazonPO.ShipWindowEndDate"
        ))

    if state:
        query = query.filter(AmazonPOData.ShipToState == state)

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

    # One round-trip: window function returns total alongside each row
    offset = (page - 1) * page_size
    rows_with_count = (
        query.add_columns(func.count().over().label('_total'))
        .order_by(desc(AmazonPOData.OrderedOnDate))
        .offset(offset).limit(page_size).all()
    )
    # COUNT(*) OVER() rides along on returned rows only — paging past the end returns
    # none, so fall back to an explicit count rather than reporting a total of 0.
    total = rows_with_count[0]._total if rows_with_count else query.count()

    # Units and distinct POs under the same filters, so the KPI card cannot pair a
    # filtered count with an unfiltered unit figure. Kept as a separate aggregate
    # because MySQL (like MSSQL before it) has no COUNT(DISTINCT x) OVER() — verified directly against the live database, not assumed.
    agg = query.with_entities(
        func.coalesce(func.sum(AmazonPOItemData.QuantityRequested), 0),
        func.count(func.distinct(AmazonPOItemData.PONumber)),
    ).one()
    total_units, total_pos = int(agg[0] or 0), int(agg[1] or 0)
    po_items = [r[0] for r in rows_with_count]

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
        latest_inv_date = _get_latest_inv_date(db)
        inv_q = db.query(Inventory.ProductId, func.sum(Inventory.PackedQty)).filter(
            Inventory.ProductId.in_(product_ids)
        )
        if latest_inv_date:
            inv_q = inv_q.filter(Inventory.InventoryDate == latest_inv_date)
        packed_by_product = {row[0]: int(row[1] or 0) for row in inv_q.group_by(Inventory.ProductId).all()}

    today = today_ist()
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
        # Terminal PO-header status (Delivered, Cancelled, etc.) overrides item-level status,
        # matching the overview page which prioritises the PO header.
        effective_base = po_header_status if po_header_status in _TERMINAL_STATUSES else (item.ItemStatus or po_header_status)
        item_status = _eff_status(effective_base, po.ShipWindowEndDate if po else None)
        is_delayed = bool(
            item.ExpectedDate
            and item.ExpectedDate < today
            and item_status not in _TERMINAL_STATUSES
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
            "po_cancellation_date": item.CancellationDate.isoformat() if item.CancellationDate else None,
            "ship_window_end_date": po.ShipWindowEndDate.isoformat() if po and po.ShipWindowEndDate else None,
            "dispatch_date": po.DispatchDate.isoformat() if po and po.DispatchDate else None,
            "courier": po.Courier if po else None,
            "quantity": qty_requested,
            "accepted_quantity": item.AcceptedQuantity,
            "received_quantity": item.QuantityReceived or 0,
            "packed_qty": packed_qty,
            "gap": gap,
            "unit_price": float(item.UnitCost) if item.UnitCost else 0.0,
            "total_amount": float(item.TotalCost) if item.TotalCost else (
                round(float(item.UnitCost) * qty_requested, 2) if item.UnitCost and qty_requested else 0.0
            ),
            "status": item_status,
            "po_status": po_header_status,
            "is_delayed": is_delayed,
            "ship_to_city": po.ShipToCity if po else None,
            "ship_to_state": po.ShipToState if po else None,
            "ship_to_location_code": po.ShipToLocationCode if po else None,
        })

    # total_units and total_pos carry the same filters as total, including status, so
    # the KPI card cannot pair a filtered count with an unfiltered unit figure.
    return {
        "items": items,
        "total": total,
        "total_units": total_units,
        "total_pos": total_pos,
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
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """One row per PO number with aggregated item count and qty — for the overview table."""
    query = db.query(
        BlinkitPOData.Id.label('po_id'),
        BlinkitPOData.PONumber.label('po_number'),
        BlinkitPOData.PODate.label('order_date'),
        BlinkitPOData.Status.label('po_header_status'),
        func.max(BlinkitPOItemData.ItemStatus).label('max_item_status'),
        BlinkitPOData.ShipToName.label('ship_to_name'),
        BlinkitPOData.ShipToAddress.label('ship_to_address'),
        BlinkitPOData.ShipToGSTIN.label('ship_to_gstin'),
        BlinkitPOData.ShipToCity.label('ship_to_city'),
        BlinkitPOData.ShipToState.label('ship_to_state'),
        BlinkitPOData.ExpectedDeliveryDate.label('expected_delivery_date'),
        BlinkitPOData.POExpiryDate.label('po_expiry_date'),
        BlinkitPOData.DispatchDate.label('dispatch_date'),
        BlinkitPOData.Courier.label('courier'),
        func.count(BlinkitPOItemData.Id).label('item_count'),
        func.sum(BlinkitPOItemData.QTY).label('total_qty'),
    ).join(BlinkitPOItemData, BlinkitPOItemData.POId == BlinkitPOData.Id)

    if search:
        query = query.filter(BlinkitPOData.PONumber.ilike(f"%{search}%"))
    if status:
        query = query.having(_po_status_filter(
            status, "BlinkitPO.Status", "MAX(BlinkitPOItem.ItemStatus)", "BlinkitPO.POExpiryDate"
        ))
    # Skip date filter when searching by PO number — the PO may predate the active range
    if not search:
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
        BlinkitPOData.ShipToGSTIN, BlinkitPOData.ShipToCity, BlinkitPOData.ShipToState,
        BlinkitPOData.ExpectedDeliveryDate,
        BlinkitPOData.POExpiryDate, BlinkitPOData.DispatchDate, BlinkitPOData.Courier,
    )

    # Single pass: subquery + COUNT(*) OVER() avoids a second GROUP BY round-trip
    offset = (page - 1) * page_size
    subq = query.subquery()
    rows_with_count = (
        db.query(subq,
                 func.count().over().label('_total'),
                 func.sum(subq.c.total_qty).over().label('_total_units'))
        .order_by(subq.c.order_date.desc())
        .offset(offset).limit(page_size).all()
    )
    # Window aggregates ride along on returned rows only — paging past the end returns
    # none, so fall back to explicit aggregates rather than reporting 0.
    if rows_with_count:
        total = rows_with_count[0]._total
        total_units = int(rows_with_count[0]._total_units or 0)
    else:
        total = db.query(func.count()).select_from(subq).scalar() or 0
        total_units = int(db.query(func.coalesce(func.sum(subq.c.total_qty), 0)).select_from(subq).scalar() or 0)

    items = []
    for r in rows_with_count:
        city = r.ship_to_city or None
        state = r.ship_to_state or None
        if not city or not state:
            _city, _state = _blk_city_state(r.ship_to_address, r.ship_to_name, r.ship_to_gstin, r.po_number)
            city = city or _city
            state = state or _state
        eff_status = _eff_status(
            r.po_header_status or r.max_item_status,
            r.po_expiry_date,
        )
        items.append({
            "po_id": r.po_id,
            "po_number": r.po_number,
            "order_date": r.order_date.isoformat() if r.order_date else None,
            "expected_delivery_date": r.expected_delivery_date.isoformat() if r.expected_delivery_date else None,
            "po_expiry_date": r.po_expiry_date.isoformat() if r.po_expiry_date else None,
            "dispatch_date": r.dispatch_date.isoformat() if r.dispatch_date else None,
            "courier": r.courier,
            "status": eff_status,
            "po_status": r.po_header_status,
            "ship_to_name": r.ship_to_name,
            "ship_to_city": city,
            "ship_to_state": state,
            "item_count": int(r.item_count or 0),
            "total_qty": int(r.total_qty or 0),
        })

    return {"items": items, "total": total, "total_units": total_units,
            "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size}


@router.get("/lifecycle/overview")
async def get_lifecycle_overview(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None, description="all | amazon | blinkit"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Combined Amazon + Blinkit PO overview with true server-side pagination.

    Paginating the two channel endpoints in lockstep produced uneven page sizes and a
    `total` that collapsed to 0 once one channel ran out of rows. This UNIONs both
    channels first, then paginates the merged set, so every page holds exactly
    `page_size` rows and `total` is stable across pages.
    """
    ch = (channel or 'all').lower()
    show_amz = ch in ('all', 'amazon')
    show_blk = ch in ('all', 'blinkit')
    if not show_amz and not show_blk:
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}

    params: dict = {}
    amz_where, blk_where = [], []

    if search:
        amz_where.append("p.PONumber LIKE :search")
        blk_where.append("p.PONumber LIKE :search")
        params["search"] = f"%{search}%"
    else:
        # Date filter is skipped while searching — a PO may predate the active range
        if start_date:
            try:
                datetime.strptime(start_date, "%Y-%m-%d")
                amz_where.append("p.OrderedOnDate >= :start_date")
                blk_where.append("p.PODate >= :start_date")
                params["start_date"] = start_date
            except ValueError:
                pass
        if end_date:
            try:
                datetime.strptime(end_date, "%Y-%m-%d")
                amz_where.append("p.OrderedOnDate <= :end_date")
                blk_where.append("p.PODate <= :end_date")
                params["end_date"] = end_date
            except ValueError:
                pass

    amz_where_sql = ("WHERE " + " AND ".join(amz_where)) if amz_where else ""
    blk_where_sql = ("WHERE " + " AND ".join(blk_where)) if blk_where else ""

    # Mirrors the stats CTE: header status wins for shipped/terminal states, else max item status
    def _base_expr(status_col: str, item_alias: str = "i") -> str:
        return (f"CASE WHEN p.{status_col} IN ({_HEADER_WINS_SQL}) "
                f"THEN p.{status_col} ELSE COALESCE(MAX({item_alias}.ItemStatus), p.{status_col}, 'Created') END")

    amz_sel = f"""
        SELECT
            p.Id AS po_id, p.PONumber AS po_number, 'Amazon' AS channel,
            p.OrderedOnDate AS order_date,
            {_base_expr('POStatus')} AS base_status,
            p.POStatus AS po_status,
            p.ShipWindowEndDate AS expiry_date,
            MIN(i.ExpectedDate) AS expected_delivery_date,
            p.DispatchDate AS dispatch_date, p.Courier AS courier,
            p.ShipToCity AS ship_to_city, p.ShipToState AS ship_to_state,
            p.ShipToLocationCode AS ship_to_location_code,
            CAST(NULL AS CHAR(500)) COLLATE utf8mb4_general_ci AS ship_to_address,
            CAST(NULL AS CHAR(200)) COLLATE utf8mb4_general_ci AS ship_to_name,
            CAST(NULL AS CHAR(50)) COLLATE utf8mb4_general_ci  AS ship_to_gstin,
            COUNT(i.Id) AS item_count,
            COALESCE(SUM(i.QuantityRequested), 0) AS total_qty
        FROM AmazonPO p
        LEFT JOIN AmazonPOItem i ON i.POId = p.Id
        {amz_where_sql}
        GROUP BY p.Id, p.PONumber, p.OrderedOnDate, p.POStatus, p.ShipWindowEndDate,
                 p.DispatchDate, p.Courier, p.ShipToCity, p.ShipToState, p.ShipToLocationCode
    """

    blk_sel = f"""
        SELECT
            p.Id AS po_id, p.PONumber AS po_number, 'Blinkit' AS channel,
            p.PODate AS order_date,
            {_base_expr('Status')} AS base_status,
            p.Status AS po_status,
            p.POExpiryDate AS expiry_date,
            p.ExpectedDeliveryDate AS expected_delivery_date,
            p.DispatchDate AS dispatch_date, p.Courier AS courier,
            p.ShipToCity AS ship_to_city, p.ShipToState AS ship_to_state,
            CAST(NULL AS CHAR(100)) COLLATE utf8mb4_general_ci AS ship_to_location_code,
            CAST(p.ShipToAddress AS CHAR(500)) COLLATE utf8mb4_general_ci AS ship_to_address,
            CAST(p.ShipToName AS CHAR(200)) COLLATE utf8mb4_general_ci AS ship_to_name,
            CAST(p.ShipToGSTIN AS CHAR(50)) COLLATE utf8mb4_general_ci AS ship_to_gstin,
            COUNT(i.Id) AS item_count,
            COALESCE(SUM(i.QTY), 0) AS total_qty
        FROM BlinkitPO p
        LEFT JOIN BlinkitPOItem i ON i.POId = p.Id
        {blk_where_sql}
        GROUP BY p.Id, p.PONumber, p.PODate, p.Status, p.POExpiryDate, p.ExpectedDeliveryDate,
                 p.DispatchDate, p.Courier, p.ShipToCity, p.ShipToState,
                 CAST(p.ShipToAddress AS CHAR(500)) COLLATE utf8mb4_general_ci, CAST(p.ShipToName AS CHAR(200)) COLLATE utf8mb4_general_ci,
                 CAST(p.ShipToGSTIN AS CHAR(50)) COLLATE utf8mb4_general_ci
    """

    parts = ([amz_sel] if show_amz else []) + ([blk_sel] if show_blk else [])
    union_sql = "\n        UNION ALL\n".join(parts)

    _ov = "','".join(sorted(_NO_EXPIRY_OVERRIDE))
    status_filter = ""
    if status and status != 'all':
        status_filter = "WHERE eff_status = :status"
        params["status"] = status

    params["offset"] = (page - 1) * page_size
    params["limit"] = page_size

    rows = db.execute(text(f"""
        WITH combined AS (
            {union_sql}
        ),
        scored AS (
            SELECT *,
                CASE
                    WHEN base_status NOT IN ('{_ov}')
                     AND expiry_date IS NOT NULL
                     AND DATEDIFF(NOW(), expiry_date) >= {_EXPIRY_DAYS}
                    THEN 'Expired' ELSE base_status
                END AS eff_status
            FROM combined
        )
        SELECT *, COUNT(*) OVER() AS _total, SUM(total_qty) OVER() AS _total_units
        FROM scored
        {status_filter}
        ORDER BY order_date DESC, po_number DESC
        LIMIT :limit OFFSET :offset
    """), params).fetchall()

    # Window aggregates only ride along on returned rows. Paging past the end yields no
    # rows and therefore no totals — re-derive them so they never collapse to 0.
    if rows:
        total = rows[0]._total
        total_units = int(rows[0]._total_units or 0)
    else:
        total = db.execute(text(f"""
            WITH combined AS (
                {union_sql}
            ),
            scored AS (
                SELECT *,
                    CASE
                        WHEN base_status NOT IN ('{_ov}')
                         AND expiry_date IS NOT NULL
                         AND DATEDIFF(NOW(), expiry_date) >= {_EXPIRY_DAYS}
                        THEN 'Expired' ELSE base_status
                    END AS eff_status
                FROM combined
            )
            SELECT COUNT(*) AS c, COALESCE(SUM(total_qty), 0) AS u FROM scored {status_filter}
        """), {k: v for k, v in params.items() if k not in ('offset', 'limit')}).fetchone()
        total, total_units = (total[0] or 0, int(total[1] or 0)) if total else (0, 0)

    items = []
    for r in rows:
        city, state = r.ship_to_city or None, r.ship_to_state or None
        if r.channel == 'Blinkit' and (not city or not state):
            _c, _s = _blk_city_state(r.ship_to_address, r.ship_to_name, r.ship_to_gstin, r.po_number)
            city, state = city or _c, state or _s
        tat = (r.dispatch_date - r.order_date).days if (r.dispatch_date and r.order_date) else None
        items.append({
            "po_id": r.po_id,
            "po_number": r.po_number,
            "channel": r.channel,
            "order_date": r.order_date.isoformat() if r.order_date else None,
            "expected_delivery_date": r.expected_delivery_date.isoformat() if r.expected_delivery_date else None,
            "expiry_date": r.expiry_date.isoformat() if r.expiry_date else None,
            "dispatch_date": r.dispatch_date.isoformat() if r.dispatch_date else None,
            "courier": r.courier,
            "status": r.eff_status,
            "po_status": r.po_status,
            "ship_to_city": city,
            "ship_to_state": state,
            "ship_to_location_code": r.ship_to_location_code,
            "tat": tat,
            "item_count": int(r.item_count or 0),
            "total_qty": int(r.total_qty or 0),
        })

    # total_units is scoped by the same filters as total, including status. The stats
    # endpoints are date-filtered only, so pairing their unit figure with this count
    # described two different populations: filtering to Expired showed 4 POs alongside
    # the unfiltered 33,012 units.
    return {"items": items, "total": total, "total_units": total_units,
            "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size}


@router.get("/blinkit/stats")
async def get_blinkit_po_stats(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Return per-status PO counts and totals for Blinkit POs (optionally date-filtered).
    Counts at PO level by Status so metrics match the overview grid and update when status changes.
    """
    blk_where = []
    blk_params: dict = {}
    if start_date:
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
            blk_where.append("PODate >= :start_date")
            blk_params["start_date"] = start_date
        except ValueError:
            pass
    if end_date:
        try:
            datetime.strptime(end_date, "%Y-%m-%d")
            blk_where.append("PODate <= :end_date")
            blk_params["end_date"] = end_date
        except ValueError:
            pass
    blk_where_sql = ("WHERE p." + " AND p.".join(blk_where)) if blk_where else ""
    cache_key = f"blk_stats:{start_date}:{end_date}"
    cached = _stats_get(cache_key)
    if cached:
        return cached
    # Single query: status counts + total units via CTE to avoid two round-trips
    rows = db.execute(text(f"""
        WITH base AS (
            SELECT
                CASE
                    WHEN CASE WHEN p.Status IN ({_HEADER_WINS_SQL}) THEN p.Status ELSE COALESCE(agg.max_status, p.Status, 'Created') END
                         NOT IN ({_HEADER_WINS_SQL},'Expired','Dispatched','In Transit')
                     AND p.POExpiryDate IS NOT NULL
                     AND DATEDIFF(NOW(), p.POExpiryDate) >= {_EXPIRY_DAYS}
                    THEN 'Expired'
                    ELSE CASE WHEN p.Status IN ({_HEADER_WINS_SQL}) THEN p.Status ELSE COALESCE(agg.max_status, p.Status, 'Created') END
                END AS eff_status,
                COALESCE(units.total_qty, 0) AS total_qty
            FROM BlinkitPO p
            LEFT JOIN (
                SELECT POId, MAX(ItemStatus) AS max_status
                FROM BlinkitPOItem GROUP BY POId
            ) agg ON agg.POId = p.Id
            LEFT JOIN (
                SELECT POId, SUM(QTY) AS total_qty
                FROM BlinkitPOItem GROUP BY POId
            ) units ON units.POId = p.Id
            {blk_where_sql}
        )
        SELECT eff_status, COUNT(*) AS cnt, SUM(total_qty) AS total_qty
        FROM base
        GROUP BY eff_status
    """), blk_params).fetchall()
    status_counts = {r[0]: r[1] for r in rows}
    total_units = int(sum(r[2] or 0 for r in rows))
    result = {
        "status_counts": status_counts,
        "total_pos": sum(status_counts.values()),
        "total_units": total_units,
    }
    _stats_set(cache_key, result)
    return result


# No response_model: this returns total_units/total_pos on top of the standard
# pagination fields, and PaginatedResponse would silently strip them.
@router.get("/blinkit")
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
        query = query.filter(_po_status_filter(
            status, "BlinkitPO.Status", "BlinkitPOItem.ItemStatus", "BlinkitPO.POExpiryDate"
        ))

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

    # One round-trip: window function returns total alongside each row
    offset = (page - 1) * page_size
    rows_with_count = (
        query.add_columns(func.count().over().label('_total'))
        .order_by(desc(BlinkitPOData.PODate))
        .offset(offset).limit(page_size).all()
    )
    # COUNT(*) OVER() rides along on returned rows only — paging past the end returns
    # none, so fall back to an explicit count rather than reporting a total of 0.
    total = rows_with_count[0]._total if rows_with_count else query.count()

    # Units and distinct POs under the same filters, so the KPI card cannot pair a
    # filtered count with an unfiltered unit figure. Kept as a separate aggregate
    # because MySQL (like MSSQL before it) has no COUNT(DISTINCT x) OVER() — verified directly against the live database, not assumed.
    agg = query.with_entities(
        func.coalesce(func.sum(BlinkitPOItemData.QTY), 0),
        func.count(func.distinct(BlinkitPOItemData.PONumber)),
    ).one()
    total_units, total_pos = int(agg[0] or 0), int(agg[1] or 0)
    po_items = [r[0] for r in rows_with_count]

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
        latest_inv_date = _get_latest_inv_date(db)
        inv_q = db.query(Inventory.ProductId, func.sum(Inventory.PackedQty)).filter(
            Inventory.ProductId.in_(all_product_ids)
        )
        if latest_inv_date:
            inv_q = inv_q.filter(Inventory.InventoryDate == latest_inv_date)
        packed_by_product = {row[0]: int(row[1] or 0) for row in inv_q.group_by(Inventory.ProductId).all()}

    today = today_ist()
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
        # Terminal PO-header status (Delivered, Cancelled, etc.) overrides item-level status,
        # matching the overview page which prioritises the PO header.
        effective_base = po_header_status if po_header_status in _TERMINAL_STATUSES else (item.ItemStatus or po_header_status)
        item_status = _eff_status(effective_base, po.POExpiryDate if po else None)
        is_delayed = bool(
            po and po.ExpectedDeliveryDate
            and po.ExpectedDeliveryDate < today
            and item_status not in _TERMINAL_STATUSES
        )

        ship_to_name = po.ShipToName if po else None
        ship_to_address = po.ShipToAddress if po else None
        ship_to_gstin = po.ShipToGSTIN if po else None
        po_num = item.PONumber if item.PONumber else (po.PONumber if po else None)
        city = (po.ShipToCity if po else None) or None
        state = (po.ShipToState if po else None) or None
        if not city or not state:
            _city, _state = _blk_city_state(ship_to_address, ship_to_name, ship_to_gstin, po_num)
            city = city or _city
            state = state or _state

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
            "po_expiry_date": po.POExpiryDate.isoformat() if po and po.POExpiryDate else None,
            "dispatch_date": po.DispatchDate.isoformat() if po and po.DispatchDate else None,
            "courier": po.Courier if po else None,
            "quantity": qty,
            "accepted_qty": item.AcceptedQty,
            "received_quantity": item.ReceivedQty if item.ReceivedQty is not None else 0,
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

    # total_units and total_pos carry the same filters as total, including status, so
    # the KPI card cannot pair a filtered count with an unfiltered unit figure.
    return {
        "items": items,
        "total": total,
        "total_units": total_units,
        "total_pos": total_pos,
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
    today = today_ist()
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
            aq = aq.filter(_po_status_filter(
                status, "AmazonPO.POStatus", "AmazonPOItem.ItemStatus", "AmazonPO.ShipWindowEndDate"
            ))
        if start:
            aq = aq.filter(AmazonPOData.OrderedOnDate >= start)
        if end:
            aq = aq.filter(AmazonPOData.OrderedOnDate <= end)

        for item in aq.all():
            po = item.po
            po_status = _eff_status(item.ItemStatus or (po.POStatus if po else None), po.ShipWindowEndDate if po else None)
            is_delayed = bool(
                item.ExpectedDate and item.ExpectedDate < today
                and po_status not in _TERMINAL_STATUSES
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
            bq = bq.filter(_po_status_filter(
                status, "BlinkitPO.Status", "BlinkitPOItem.ItemStatus", "BlinkitPO.POExpiryDate"
            ))
        if start:
            bq = bq.filter(BlinkitPOData.PODate >= start)
        if end:
            bq = bq.filter(BlinkitPOData.PODate <= end)

        for item in bq.all():
            po = item.po
            po_status = _eff_status(item.ItemStatus or (po.Status if po else None), po.POExpiryDate if po else None)
            is_delayed = bool(
                po and po.ExpectedDeliveryDate and po.ExpectedDeliveryDate < today
                and po_status not in _TERMINAL_STATUSES
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
        OrderDate=po_data.orderDate or today_ist(),
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
    _check_status_move(old_status, status_data.status)

    # Update status
    po.Status = status_data.status

    # On Delivered: record received quantity and actual delivery date
    if status_data.status == "Delivered":
        if status_data.receivedQuantity is not None:
            po.ReceivedQuantity = status_data.receivedQuantity
        else:
            po.ReceivedQuantity = po.Quantity  # Default to full quantity

        po.ActualDeliveryDate = status_data.actualDeliveryDate or today_ist()

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
    _check_status_move(old_status, status_data.status)
    item.ItemStatus = status_data.status

    # Auto-fill received/accepted qty when item marked Delivered/Received (only if not already recorded)
    if status_data.status in ('Delivered', 'Received'):
        if item.QuantityReceived is None:
            item.QuantityReceived = item.QuantityRequested or 0
        if item.AcceptedQuantity is None:
            item.AcceptedQuantity = item.QuantityRequested or 0
    elif status_data.status == 'Cancelled':
        # Preserve existing partial-receipt data; only zero if nothing was recorded yet
        if item.QuantityReceived is None:
            item.QuantityReceived = 0
        if item.AcceptedQuantity is None:
            item.AcceptedQuantity = 0

    # Cascade to PO header only when ALL items (including unset ones) are terminal
    po = db.query(AmazonPOData).filter(AmazonPOData.Id == item.POId).first()
    if po:
        all_statuses = [i.ItemStatus for i in po.items]
        if all_statuses and all(s in _TERMINAL_STATUSES for s in all_statuses):
            sibling_statuses = set(all_statuses)
            # Precedence: any fulfilment wins, then a uniform Cancelled, then any
            # remaining Closed/Cancelled mix closes the PO out. Without the third
            # branch an all-Closed PO left the header stale.
            if sibling_statuses & {'Received', 'Delivered'}:
                po.POStatus = 'Delivered'
            elif sibling_statuses == {'Cancelled'}:
                po.POStatus = 'Cancelled'
            elif sibling_statuses <= {'Closed', 'Cancelled'}:
                po.POStatus = 'Closed'

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
    _check_status_move(old_status, status_data.status)
    item.ItemStatus = status_data.status

    # Auto-fill received/accepted qty when item marked Delivered/Received (only if not already recorded)
    if status_data.status in ('Delivered', 'Received'):
        if item.ReceivedQty is None:
            item.ReceivedQty = int(item.QTY or 0)
        if item.AcceptedQty is None:
            item.AcceptedQty = int(item.QTY or 0)
    elif status_data.status == 'Cancelled':
        # Preserve existing partial-receipt data; only zero if nothing was recorded yet
        if item.ReceivedQty is None:
            item.ReceivedQty = 0
        if item.AcceptedQty is None:
            item.AcceptedQty = 0

    # Cascade to PO header only when ALL items (including unset ones) are terminal
    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == item.POId).first()
    if po:
        all_statuses = [i.ItemStatus for i in po.items]
        if all_statuses and all(s in _TERMINAL_STATUSES for s in all_statuses):
            sibling_statuses = set(all_statuses)
            # Precedence: any fulfilment wins, then a uniform Cancelled, then any
            # remaining Closed/Cancelled mix closes the PO out. Without the third
            # branch an all-Closed PO left the header stale.
            if sibling_statuses & {'Received', 'Delivered'}:
                po.Status = 'Delivered'
            elif sibling_statuses == {'Cancelled'}:
                po.Status = 'Cancelled'
            elif sibling_statuses <= {'Closed', 'Cancelled'}:
                po.Status = 'Closed'

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
    _check_status_move(old_status, status_data.status)
    po.POStatus = status_data.status

    # Auto-manage item quantities based on new PO status.
    if status_data.status in ('Delivered', 'Received'):
        for item in po.items:
            if item.QuantityReceived is None:
                item.QuantityReceived = item.QuantityRequested or 0
            if item.AcceptedQuantity is None:
                item.AcceptedQuantity = item.QuantityRequested or 0
    elif status_data.status == 'Cancelled':
        for item in po.items:
            if item.QuantityReceived is None:
                item.QuantityReceived = 0
            if item.AcceptedQuantity is None:
                item.AcceptedQuantity = 0

    log_audit(db, current_user.Id, "STATUS_CHANGE", "AmazonPO", str(po.Id),
              old_values={"poStatus": old_status},
              new_values={"poStatus": status_data.status})
    notify(db, current_user.Id, "Amazon PO Status Updated",
           f"PO {po.PONumber}: {old_status} → {status_data.status}", "po_status")
    try:
        db.commit()
        _stats_invalidate()
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
    _check_status_move(old_status, status_data.status)
    po.Status = status_data.status

    # Auto-manage item quantities based on new PO status.
    if status_data.status in ('Delivered', 'Received'):
        for item in po.items:
            if item.ReceivedQty is None:
                item.ReceivedQty = int(item.QTY or 0)
            if item.AcceptedQty is None:
                item.AcceptedQty = int(item.QTY or 0)
    elif status_data.status == 'Cancelled':
        for item in po.items:
            if item.ReceivedQty is None:
                item.ReceivedQty = 0
            if item.AcceptedQty is None:
                item.AcceptedQty = 0

    log_audit(db, current_user.Id, "STATUS_CHANGE", "BlinkitPO", str(po.Id),
              old_values={"status": old_status},
              new_values={"status": status_data.status})
    notify(db, current_user.Id, "Blinkit PO Status Updated",
           f"PO {po.PONumber}: {old_status} → {status_data.status}", "po_status")
    try:
        db.commit()
        _stats_invalidate()
        return {"success": True, "message": f"Blinkit PO {po.PONumber} status updated to {status_data.status}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/blinkit-po/{po_id}/update-header")
async def update_blinkit_po_header(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update address/GSTIN header fields of an existing Blinkit PO (e.g. after re-extracting PDF)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    updatable = {
        'bill_to_name':    'BillToName',
        'bill_to_address': 'BillToAddress',
        'bill_to_gstin':   'BillToGSTIN',
        'ship_to_name':    'ShipToName',
        'ship_to_address': 'ShipToAddress',
        'ship_to_gstin':   'ShipToGSTIN',
        'vendor_name':     'VendorName',
        'vendor_gstin':    'VendorGSTIN',
        'vendor_pan':      'VendorPAN',
        'issuer_name':     'IssuerName',
        'issuer_gstin':    'IssuerGSTIN',
        'payment_terms':   'PaymentTerms',
        'freight_terms':   'FreightTerms',
        'grand_total':     'GrandTotal',
        'total_taxable_amount': 'TotalTaxableAmount',
        'total_tax':       'TotalTax',
    }

    old_vals = {}
    new_vals = {}
    for key, col in updatable.items():
        if key in payload and payload[key] is not None:
            old_val = getattr(po, col)
            new_val = payload[key]
            if str(old_val or '') != str(new_val or ''):
                old_vals[key] = old_val
                new_vals[key] = new_val
                setattr(po, col, new_val)

    if not new_vals:
        return {"success": True, "message": "No changes to apply"}

    log_audit(db, current_user.Id, "UPDATE", "BlinkitPO", str(po.Id),
              old_values=old_vals, new_values=new_vals)
    try:
        db.commit()
        return {"success": True, "message": f"PO {po.PONumber} header updated successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


def _adjust_inventory_for_product(db: Session, product_id: int, delta_qty: int) -> dict:
    """Apply a stock movement against a product's most recent inventory snapshot.

    delta_qty > 0 deducts (an accepted quantity went up); delta_qty < 0 restores (an
    accepted quantity was corrected downward). Restoring mirrors deducting so a
    correction cannot leak stock — previously only the deduct direction was handled,
    so lowering an accepted qty from 100 to 10 kept all 100 units deducted. The restore
    is in turn capped at what was really deducted, so it cannot create stock either.

    The snapshot date is resolved per product. A global MAX(InventoryDate) silently
    matches nothing for any product missing from the latest upload, so the adjustment
    became a no-op that still reported success.
    """
    latest_date = db.query(func.max(Inventory.InventoryDate)).filter(
        Inventory.ProductId == product_id
    ).scalar()
    if latest_date is None:
        return {"deducted": 0, "shortfall": max(0, delta_qty), "was_packed": 0}

    # No PackedQty > 0 filter: on the restore path the rows drained to zero are
    # precisely the ones the stock has to go back into.
    inv_rows = db.query(Inventory).filter(
        Inventory.ProductId == product_id,
        Inventory.InventoryDate == latest_date,
    ).order_by(Inventory.Id).all()
    if not inv_rows:
        return {"deducted": 0, "shortfall": max(0, delta_qty), "was_packed": 0}

    total_packed = sum(i.PackedQty or 0 for i in inv_rows)

    if delta_qty < 0:
        # Restore only what was actually taken from this snapshot. A deduction is
        # capped by the packed stock available (a 504-unit accept against 152 packed
        # deducts 152), so putting back the full amount on a correction manufactured
        # the difference as phantom stock. InventoryHistory keeps the quantity as
        # uploaded and is never touched by deductions, so (uploaded - current packed)
        # is exactly what has been deducted so far and is the most that can go back.
        remaining = -delta_qty
        restored = 0
        for inv in inv_rows:
            if remaining <= 0:
                break
            baseline = db.execute(text(
                "SELECT PackedQty FROM InventoryHistory "
                "WHERE ProductId = :pid AND InventoryDate = :d "
                "AND COALESCE(AsgWarehouseId, 0) = :wid"
            ), {"pid": product_id, "d": latest_date, "wid": inv.AsgWarehouseId or 0}).scalar()
            # No history row (e.g. snapshot predates InventoryHistory): nothing to
            # cap against, keep the previous behaviour.
            room = remaining if baseline is None else max(0, int(baseline) - (inv.PackedQty or 0))
            put_back = min(room, remaining)
            if put_back > 0:
                inv.PackedQty = (inv.PackedQty or 0) + put_back
                inv.CurrentStock = (inv.CurrentStock or 0) + put_back
                restored += put_back
                remaining -= put_back
        # "deducted" is negative for a restore; "shortfall" carries the part that
        # could not be returned because it was never deducted in the first place.
        return {"deducted": -restored, "shortfall": remaining, "was_packed": total_packed}

    remaining = delta_qty
    for inv in inv_rows:
        if remaining <= 0:
            break
        available = inv.PackedQty or 0
        if available <= 0:
            continue
        deduct = min(available, remaining)
        inv.PackedQty = available - deduct
        inv.CurrentStock = max(0, (inv.CurrentStock or 0) - deduct)
        remaining -= deduct

    return {
        "deducted": delta_qty - remaining,
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
    _require_po_editor(current_user)

    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    accepted_qty = body.get("accepted_qty")
    if accepted_qty is None:
        raise HTTPException(status_code=422, detail="accepted_qty is required")

    old_val = item.AcceptedQuantity or 0
    new_val = _validate_qty(accepted_qty, item.QuantityRequested, "accepted_qty")
    item.AcceptedQuantity = new_val

    # Apply the DIFFERENCE to packed inventory — negative deltas restore stock
    delta_qty = new_val - old_val
    inventory_result = {}
    if delta_qty != 0:
        # Resolve product: from ProductId link or by ASIN lookup.
        # Guard the ASIN lookup — some products carry AmazonId = '' and an empty
        # lookup value would match one of them arbitrarily.
        product_id = item.ProductId
        if not product_id and (item.ASIN or '').strip():
            product = db.query(Product).filter(Product.AmazonId == item.ASIN).first()
            if product:
                product_id = product.Id
        if product_id:
            inventory_result = _adjust_inventory_for_product(db, product_id, delta_qty)

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
    _require_po_editor(current_user)

    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    received_qty = body.get("received_qty")
    if received_qty is None:
        raise HTTPException(status_code=422, detail="received_qty is required")

    old_val = item.QuantityReceived or 0
    new_val = _validate_qty(received_qty, item.QuantityRequested, "received_qty")
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
    _require_po_editor(current_user)

    item = db.query(BlinkitPOItemData).filter(BlinkitPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blinkit PO item not found")

    accepted_qty = body.get("accepted_qty")
    if accepted_qty is None:
        raise HTTPException(status_code=422, detail="accepted_qty is required")

    old_val = item.AcceptedQty or 0
    new_val = _validate_qty(accepted_qty, item.QTY, "accepted_qty")
    item.AcceptedQty = new_val

    # Apply the DIFFERENCE to packed inventory — negative deltas restore stock
    delta_qty = new_val - old_val
    inventory_result = {}
    if delta_qty != 0:
        product_id = item.ProductId
        if not product_id:
            # Lookup by EagleCode → BlinkitId, then ItemCode → BlinkitId, then ItemCode → AsgSku.
            # Each lookup value is checked for emptiness first — some products carry
            # BlinkitId = '' and an empty lookup would match one of them arbitrarily.
            item_code = (item.ItemCode or '').strip()
            if item.EagleCode and str(item.EagleCode).strip():
                p = db.query(Product).filter(Product.BlinkitId == str(item.EagleCode)).first()
                if p:
                    product_id = p.Id
            if not product_id and item_code:
                p = db.query(Product).filter(Product.BlinkitId == item_code).first()
                if p:
                    product_id = p.Id
            if not product_id and item_code:
                p = db.query(Product).filter(Product.AsgSku == item_code).first()
                if p:
                    product_id = p.Id
        if product_id:
            inventory_result = _adjust_inventory_for_product(db, product_id, delta_qty)

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


@router.put("/blinkit-item/{item_id}/received-qty")
async def update_blinkit_item_received_qty(
    item_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set ReceivedQty on a Blinkit PO line item."""
    _require_po_editor(current_user)

    item = db.query(BlinkitPOItemData).filter(BlinkitPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blinkit PO item not found")

    received_qty = body.get("received_qty")
    if received_qty is None:
        raise HTTPException(status_code=422, detail="received_qty is required")

    old_val = item.ReceivedQty or 0
    new_val = _validate_qty(received_qty, item.QTY, "received_qty")
    item.ReceivedQty = new_val
    log_audit(db, current_user.Id, "UPDATE", "BlinkitPOItem", str(item_id),
              old_values={"receivedQty": old_val},
              new_values={"receivedQty": new_val})
    try:
        db.commit()
        return {"success": True, "received_qty": item.ReceivedQty}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/amazon-po/{po_id}/courier")
async def update_amazon_po_courier(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the courier on an Amazon PO header."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(AmazonPOData).filter(AmazonPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Amazon PO not found")

    old_val = po.Courier
    po.Courier = payload.get("courier") or None
    log_audit(db, current_user.Id, "UPDATE", "AmazonPO", str(po.Id),
              old_values={"courier": old_val},
              new_values={"courier": po.Courier})
    try:
        db.commit()
        return {"success": True, "courier": po.Courier}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/blinkit-po/{po_id}/courier")
async def update_blinkit_po_courier(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the courier on a Blinkit PO header."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    old_val = po.Courier
    po.Courier = payload.get("courier") or None
    log_audit(db, current_user.Id, "UPDATE", "BlinkitPO", str(po.Id),
              old_values={"courier": old_val},
              new_values={"courier": po.Courier})
    try:
        db.commit()
        return {"success": True, "courier": po.Courier}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/amazon-po/{po_id}/dispatch-date")
async def update_amazon_po_dispatch_date(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the dispatch date on an Amazon PO header."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(AmazonPOData).filter(AmazonPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Amazon PO not found")

    raw = payload.get("dispatch_date")
    old_val = po.DispatchDate.isoformat() if po.DispatchDate else None
    if raw:
        try:
            po.DispatchDate = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="dispatch_date must be YYYY-MM-DD")
    else:
        po.DispatchDate = None

    new_val = po.DispatchDate.isoformat() if po.DispatchDate else None
    log_audit(db, current_user.Id, "UPDATE", "AmazonPO", str(po.Id),
              old_values={"dispatchDate": old_val},
              new_values={"dispatchDate": new_val})
    try:
        db.commit()
        return {"success": True, "dispatch_date": new_val}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/blinkit-po/{po_id}/dispatch-date")
async def update_blinkit_po_dispatch_date(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the dispatch date on a Blinkit PO header."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    raw = payload.get("dispatch_date")
    old_val = po.DispatchDate.isoformat() if po.DispatchDate else None
    if raw:
        try:
            po.DispatchDate = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="dispatch_date must be YYYY-MM-DD")
    else:
        po.DispatchDate = None

    new_val = po.DispatchDate.isoformat() if po.DispatchDate else None
    log_audit(db, current_user.Id, "UPDATE", "BlinkitPO", str(po.Id),
              old_values={"dispatchDate": old_val},
              new_values={"dispatchDate": new_val})
    try:
        db.commit()
        return {"success": True, "dispatch_date": new_val}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/amazon-item/{item_id}/expected-date")
async def update_amazon_item_expected_date(
    item_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the expected delivery date on an Amazon PO item."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    raw = payload.get("expected_date")
    old_val = item.ExpectedDate.isoformat() if item.ExpectedDate else None
    if raw:
        try:
            new_expected = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="expected_date must be YYYY-MM-DD")
        parent_po = db.query(AmazonPOData).filter(AmazonPOData.Id == item.POId).first()
        _check_expected_not_before_order(new_expected, parent_po.OrderedOnDate if parent_po else None)
        item.ExpectedDate = new_expected
    else:
        item.ExpectedDate = None

    new_val = item.ExpectedDate.isoformat() if item.ExpectedDate else None
    log_audit(db, current_user.Id, "UPDATE", "AmazonPOItem", str(item.Id),
              old_values={"expectedDate": old_val},
              new_values={"expectedDate": new_val})
    try:
        db.commit()
        return {"success": True, "expected_date": new_val}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/blinkit-po/{po_id}/expected-delivery-date")
async def update_blinkit_po_expected_delivery_date(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the expected delivery date on a Blinkit PO header."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    raw = payload.get("expected_delivery_date")
    old_val = po.ExpectedDeliveryDate.isoformat() if po.ExpectedDeliveryDate else None
    if raw:
        try:
            new_expected = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="expected_delivery_date must be YYYY-MM-DD")
        _check_expected_not_before_order(new_expected, po.PODate, "Expected delivery date")
        po.ExpectedDeliveryDate = new_expected
    else:
        po.ExpectedDeliveryDate = None

    new_val = po.ExpectedDeliveryDate.isoformat() if po.ExpectedDeliveryDate else None
    log_audit(db, current_user.Id, "UPDATE", "BlinkitPO", str(po.Id),
              old_values={"expectedDeliveryDate": old_val},
              new_values={"expectedDeliveryDate": new_val})
    try:
        db.commit()
        return {"success": True, "expected_delivery_date": new_val}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/blinkit-po/{po_id}/expiry-date")
async def update_blinkit_po_expiry_date(
    po_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set or clear the PO expiry date on a Blinkit PO header."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    raw = payload.get("expiry_date")
    old_val = po.POExpiryDate.isoformat() if po.POExpiryDate else None
    if raw:
        try:
            po.POExpiryDate = datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="expiry_date must be YYYY-MM-DD")
    else:
        po.POExpiryDate = None

    new_val = po.POExpiryDate.isoformat() if po.POExpiryDate else None
    log_audit(db, current_user.Id, "UPDATE", "BlinkitPO", str(po.Id),
              old_values={"poExpiryDate": old_val},
              new_values={"poExpiryDate": new_val})
    try:
        db.commit()
        return {"success": True, "expiry_date": new_val}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
