"""
Blinkit Data Router - Upload to dedicated Blinkit tables
Writes to: BlinkitSales, BlinkitInventory, BlinkitPO, BlinkitPOItem
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func as sqlfunc, text, or_
from datetime import datetime, date, timedelta
from typing import Optional
import pandas as pd
import io
import re

from app.database import get_db
from app.models.user import User
from app.models.blinkit_sales import BlinkitSalesData
from app.models.blinkit_inventory import BlinkitInventoryData
from app.models.blinkit_po import BlinkitPOData
from app.models.blinkit_po_item import BlinkitPOItemData
from app.models.distributor_stock import DistributorStockData
from app.models.product import Product
from app.models.distributor_facility import DistributorFacility
from app.models.distributor import Distributor
from app.models.inventory import Inventory
from app.utils.dependencies import get_current_user
from app.schemas.blinkit_po import POConfirmRequest
from app.routers.uploads import find_or_create_product, find_or_create_warehouse
from app.utils.audit import log_audit, log_upload
from app.services.eagle_pdf_parser import extract_po_from_pdf


def _get_packing_alerts_blinkit(db: Session, items: list) -> list:
    """Check packed qty in Inventory for each Blinkit PO item.
    items: list of (item_code, item_name, ordered_qty)
    Returns list of alert dicts for items where packed < ordered.
    """
    alerts = []
    for item_code, item_name, ordered_qty in items:
        if not item_code or not ordered_qty:
            continue
        product = db.query(Product).filter(Product.AsgSku == item_code).first()
        packed_qty = 0
        if product:
            packed_qty = db.query(sqlfunc.sum(Inventory.PackedQty)).filter(
                Inventory.ProductId == product.Id
            ).scalar() or 0
        gap = int(ordered_qty) - packed_qty
        if gap > 0:
            alerts.append({
                "item_code": item_code,
                "item_name": item_name or item_code,
                "ordered_qty": int(ordered_qty),
                "packed_qty": packed_qty,
                "gap": gap,
            })
    return alerts


def _deduct_from_packed_inventory_blinkit(db: Session, items: list) -> list:
    """Deduct ordered qty from PackedQty in Inventory for each Blinkit PO item.
    items: list of (item_code, item_name, ordered_qty)
    Lookup by AsgSku first, then BlinkitId.
    Returns list of shortfall warnings where packed_qty < ordered_qty.
    """
    warnings = []
    for item_code, item_name, ordered_qty in items:
        if not item_code or not ordered_qty:
            continue
        product = db.query(Product).filter(Product.AsgSku == item_code).first()
        if not product:
            product = db.query(Product).filter(Product.BlinkitId == item_code).first()
        if not product:
            continue

        inv_rows = db.query(Inventory).filter(
            Inventory.ProductId == product.Id,
            Inventory.PackedQty > 0
        ).order_by(Inventory.InventoryDate.desc()).all()

        total_packed = sum(i.PackedQty for i in inv_rows)
        qty_to_deduct = int(ordered_qty)
        remaining = qty_to_deduct

        for inv in inv_rows:
            if remaining <= 0:
                break
            deduct = min(inv.PackedQty, remaining)
            inv.PackedQty -= deduct
            inv.CurrentStock = max(0, inv.CurrentStock - deduct)
            remaining -= deduct

        if remaining > 0 or total_packed == 0:
            warnings.append({
                "item_code": item_code,
                "item_name": item_name or item_code,
                "ordered_qty": qty_to_deduct,
                "packed_qty": total_packed,
                "shortfall": max(remaining, qty_to_deduct - total_packed),
            })
    return warnings

router = APIRouter()


# ============================================================
# QUERY: Blinkit Inventory (per-facility view)
# ============================================================
@router.get("/inventory")
async def get_blinkit_inventory(
    search: Optional[str] = Query(None),
    facility: Optional[str] = Query(None),
    report_date: Optional[str] = Query(None, description="Filter by report date (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get Blinkit inventory data with per-facility detail."""
    query = db.query(BlinkitInventoryData)

    if report_date:
        try:
            rd = datetime.strptime(report_date, "%Y-%m-%d").date()
            query = query.filter(BlinkitInventoryData.ReportDate == rd)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        latest = db.query(sqlfunc.max(BlinkitInventoryData.ReportDate)).scalar()
        if latest:
            query = query.filter(BlinkitInventoryData.ReportDate == latest)

    if search:
        query = query.filter(BlinkitInventoryData.ItemName.ilike(f"%{search}%"))

    if facility:
        query = query.filter(BlinkitInventoryData.BackendFacilityName.ilike(f"%{facility}%"))

    total = query.count()

    # Aggregate stats from the full filtered dataset (not just current page)
    stats_row = query.with_entities(
        sqlfunc.sum(BlinkitInventoryData.BackendInvQty).label('total_backend'),
        sqlfunc.sum(BlinkitInventoryData.FrontendInvQty).label('total_frontend'),
        sqlfunc.count(sqlfunc.distinct(BlinkitInventoryData.BackendFacilityName)).label('unique_facilities'),
    ).one()

    offset = (page - 1) * page_size
    items = query.order_by(
        BlinkitInventoryData.ItemName,
        BlinkitInventoryData.BackendFacilityName
    ).offset(offset).limit(page_size).all()

    facilities_list = db.query(BlinkitInventoryData.BackendFacilityName).distinct().all()
    dates_list = db.query(BlinkitInventoryData.ReportDate).distinct().order_by(
        desc(BlinkitInventoryData.ReportDate)
    ).limit(20).all()

    total_backend = int(stats_row.total_backend or 0)
    total_frontend = int(stats_row.total_frontend or 0)

    return {
        "items": [item.to_dict() for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "stats": {
            "totalBackendQty": total_backend,
            "totalFrontendQty": total_frontend,
            "totalQty": total_backend + total_frontend,
            "uniqueFacilities": int(stats_row.unique_facilities or 0),
        },
        "filters": {
            "facilities": [f[0] for f in facilities_list if f[0]],
            "report_dates": [d[0].isoformat() for d in dates_list if d[0]],
        }
    }


# ---- Shared helpers ----

def clean_numeric(val) -> float:
    """Clean currency symbols, commas, LRM chars from numeric values."""
    if pd.isna(val) or str(val).strip() in ('', '-', 'nan', 'UNKNOWN'):
        return 0.0
    s = str(val)
    s = re.sub(r'[\u200e₹$€,\s]', '', s)
    s = re.sub(r'[^\d.\-]', '', s)
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def read_file(contents: bytes, filename: str, skiprows: int = 0) -> pd.DataFrame:
    """Parse uploaded file as DataFrame."""
    if filename.endswith('.xlsx') or filename.endswith('.xls'):
        return pd.read_excel(io.BytesIO(contents), skiprows=skiprows)
    elif filename.endswith('.csv'):
        try:
            return pd.read_csv(io.BytesIO(contents), skiprows=skiprows, encoding='utf-8')
        except UnicodeDecodeError:
            return pd.read_csv(io.BytesIO(contents), skiprows=skiprows, encoding='latin-1')
    else:
        raise HTTPException(status_code=400, detail="File must be Excel (.xlsx, .xls) or CSV (.csv)")


def safe_str(val, max_len=None):
    """Safely convert value to string, return None for NaN/empty."""
    if pd.isna(val) or str(val).strip() in ('', 'nan', 'UNKNOWN'):
        return None
    s = str(val).strip()
    # Strip ALL non-printable/non-ASCII chars (BOM, NBSP, zero-width, etc.)
    # MSSQL VARCHAR columns store these as '?'
    s = re.sub(r'[^\x20-\x7E]', '', s).strip()
    if not s or s in ('', 'nan', 'UNKNOWN'):
        return None
    if max_len:
        s = s[:max_len]
    return s


def safe_int(val):
    """Safely convert to int, return None for NaN."""
    if pd.isna(val) or str(val).strip() in ('', '-', 'nan', 'UNKNOWN'):
        return None
    try:
        return int(float(str(val).replace(',', '').replace('₹', '').replace('\u200e', '')))
    except (ValueError, TypeError):
        return None


def safe_float(val):
    """Safely convert to float, return None for NaN."""
    if pd.isna(val) or str(val).strip() in ('', '-', 'nan', 'UNKNOWN'):
        return None
    try:
        return float(str(val).replace(',', '').replace('₹', '').replace('\u200e', ''))
    except (ValueError, TypeError):
        return None


def _parse_date(val) -> date:
    """Parse various date formats, return None on failure."""
    if pd.isna(val) or str(val).strip() in ('', 'nan'):
        return None
    s = str(val).strip()
    for fmt in ('%m/%d/%Y', '%m/%d/%y', '%d/%m/%Y', '%d/%m/%y',
                '%Y-%m-%d', '%d-%m-%Y', '%d.%m.%Y', '%d.%m.%y'):
        try:
            return datetime.strptime(s.split(' ')[0], fmt).date()
        except ValueError:
            continue
    # Try pandas as fallback
    try:
        return pd.to_datetime(s).date()
    except Exception:
        return None


def _ensure_product_blinkit(db: Session, item_id: int, item_name: str, category: str, seen: set) -> bool:
    """Auto-create a Product record for an unknown Blinkit item_id.
    First tries to match by BlinkitId, then by normalized product name.
    Only creates a new UNLINKED-BLNK placeholder if no match is found at all.
    Returns True if a new product was created, False if it already existed or was linked.
    """
    key = str(item_id)
    if key in seen:
        return False
    seen.add(key)

    # Already linked by BlinkitId
    if db.query(Product).filter(Product.BlinkitId == key).first():
        return False

    # Placeholder already exists
    placeholder = f"UNLINKED-BLNK-{item_id}"[:50]
    if db.query(Product).filter(Product.AsgSku == placeholder).first():
        return False

    # Blinkit names differ significantly from ASG names (e.g. "Nilgiri Eucalyptus" vs "Eucalyptus"),
    # so name matching is skipped — admin manually links via Product Master UI.
    db.add(Product(
        ProductName=(item_name or str(item_id))[:255],
        AsgSku=placeholder,
        BlinkitId=key,
        Category=category[:100] if category else None,
    ))
    return True


def _ensure_distributor_facility(db: Session, facility_name: str, seen: set) -> bool:
    """Auto-create a DistributorFacility for Eagle Network from Blinkit PO ShipToName.
    Returns True if a new facility was created, False if it already existed.
    """
    key = (facility_name or '').strip().lower()
    if not key or key in seen:
        return False
    seen.add(key)

    exists = db.query(DistributorFacility).filter(
        DistributorFacility.FacilityName == facility_name
    ).first()
    if exists:
        return False

    db.add(DistributorFacility(
        DistributorId=2,  # Eagle Network
        FacilityName=facility_name,
        FacilityType="Backend",
        Active=True,
    ))
    return True


def _ensure_blinkit_facility(db: Session, facility_id: int, facility_name: str, seen: set) -> bool:
    """Auto-create a Warehouse record (Channel=Blinkit) for a new Blinkit backend facility.
    Blinkit FE/BE warehouses come from Sales/Inventory uploads → stored in Warehouses table.
    DistributorFacility (Eagle Network's own warehouses) is populated from PO uploads, not here.
    Returns True if a new warehouse was created, False if it already existed.
    """
    key = str(facility_id) if facility_id else (facility_name or '').lower()
    if key in seen:
        return False
    seen.add(key)

    name = facility_name or f"Facility-{facility_id}"

    # Extract city from facility name (e.g. "Delhi BF 1" → "Delhi")
    city = None
    if name:
        import re
        city_match = re.match(r'^(\w+(?:\s\w+)?)\s+BF', name, re.IGNORECASE)
        if city_match:
            city = city_match.group(1).strip().title()

    # Only write to Warehouses table (Channel=Blinkit, WarehouseType=Backend)
    find_or_create_warehouse(db, name, channel="Blinkit", city=city, warehouse_type="Backend")

    return True


# ============================================================
# PREVIEW 1: Blinkit Sales — dry-run validation
# ============================================================
@router.post("/sales/preview")
async def preview_blinkit_sales(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dry-run: parse Blinkit Sales CSV and return new products that would be auto-created.
    Does NOT write to the database. Admin/Manager only.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    try:
        contents = await file.read()
        filename = file.filename or "unknown.csv"
        df = read_file(contents, filename)

        # Detect date from filename (sales_DD.MM.YY-DD.MM.YY.csv)
        import re
        date_found = False
        detected_date = None
        date_match = re.search(r'sales[_-](\d{2})\.(\d{2})\.(\d{2})', filename.lower())
        if date_match:
            dd, mm, yy = date_match.groups()
            year = 2000 + int(yy)
            detected_date = date(year, int(mm), int(dd))
            date_found = True

        col_map = {}
        for col in df.columns:
            cl = str(col).strip().lower().replace(' ', '_')
            if cl in ('item_id', 'itemid'):
                col_map[col] = 'item_id'
            elif cl in ('item_name', 'itemname'):
                col_map[col] = 'item_name'
            elif cl in ('manufacturer_name', 'manufacturername'):
                col_map[col] = 'manufacturer_name'
            elif cl in ('city_name', 'cityname', 'city'):
                col_map[col] = 'city_name'
            elif cl == 'category':
                col_map[col] = 'category'
            elif cl in ('qty_sold', 'qtysold'):
                col_map[col] = 'qty_sold'
            elif cl == 'mrp':
                col_map[col] = 'mrp'
        df = df.rename(columns=col_map)

        seen_ids: set = set()
        new_products = []
        valid_rows = 0
        preview_rows = []

        for idx, row in df.iterrows():
            item_id = safe_int(row.get('item_id'))
            if not item_id:
                continue
            valid_rows += 1

            # Collect preview rows (first 10)
            if len(preview_rows) < 10:
                preview_rows.append({
                    'rowNumber': idx + 1,
                    'itemId': item_id,
                    'itemName': safe_str(row.get('item_name'), 255),
                    'manufacturerName': safe_str(row.get('manufacturer_name'), 200),
                    'cityName': safe_str(row.get('city_name'), 100),
                    'category': safe_str(row.get('category'), 100),
                    'qtySold': safe_float(row.get('qty_sold')),
                    'mrp': safe_float(row.get('mrp')),
                })

            key = str(item_id)
            if key in seen_ids:
                continue
            seen_ids.add(key)
            exists = db.query(Product).filter(Product.BlinkitId == key).first()
            placeholder = f"UNLINKED-BLNK-{item_id}"[:50]
            placeholder_exists = db.query(Product).filter(Product.AsgSku == placeholder).first()
            if not exists and not placeholder_exists:
                new_products.append({
                    'itemId': item_id,
                    'itemName': safe_str(row.get('item_name'), 255),
                    'placeholderSku': placeholder,
                })

        # Duplicate detection
        duplicate_warning = None
        if date_found and detected_date:
            from sqlalchemy import func
            from ..models.blinkit_sales import BlinkitSalesData
            existing_count = db.query(func.count(BlinkitSalesData.Id)).filter(
                BlinkitSalesData.SaleDate == detected_date
            ).scalar()
            if existing_count > 0:
                duplicate_warning = f"Found {existing_count} existing sales records for {detected_date.strftime('%Y-%m-%d')}. This data may already be uploaded."

        return {
            'success': True,
            'uploadType': 'blinkit/sales',
            'validRows': valid_rows,
            'newProducts': new_products,
            'newFacilities': [],
            'detectedDate': detected_date.isoformat() if detected_date else None,
            'previewRows': preview_rows,
            'duplicateDataWarning': duplicate_warning,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


# ============================================================
# ENDPOINT 1: Blinkit Sales Upload (daily CSV)
# ============================================================
@router.post("/sales")
async def upload_blinkit_sales(
    file: UploadFile = File(...),
    report_date_override: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload Blinkit daily sales CSV to BlinkitSales table.
    Expected columns: item_id, item_name, manufacturer_id, manufacturer_name,
    city_id, city_name, category, date, qty_sold, mrp
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    contents = await file.read()
    filename = file.filename or "unknown.csv"
    df = read_file(contents, filename)

    # Parse override date if provided
    override_date = None
    if report_date_override:
        try:
            override_date = datetime.strptime(report_date_override, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid report_date_override format. Use YYYY-MM-DD")

    # Normalize column names
    col_map = {}
    for col in df.columns:
        cl = str(col).strip().lower().replace(' ', '_')
        if cl in ('item_id', 'itemid'):
            col_map[col] = 'item_id'
        elif cl in ('item_name', 'itemname'):
            col_map[col] = 'item_name'
        elif cl in ('manufacturer_id', 'manufacturerid'):
            col_map[col] = 'manufacturer_id'
        elif cl in ('manufacturer_name', 'manufacturername'):
            col_map[col] = 'manufacturer_name'
        elif cl in ('city_id', 'cityid'):
            col_map[col] = 'city_id'
        elif cl in ('city_name', 'cityname', 'city'):
            col_map[col] = 'city_name'
        elif cl == 'category':
            col_map[col] = 'category'
        elif cl == 'date':
            col_map[col] = 'date'
        elif cl in ('qty_sold', 'qtysold', 'quantity'):
            col_map[col] = 'qty_sold'
        elif cl == 'mrp':
            col_map[col] = 'mrp'
    df = df.rename(columns=col_map)

    rows_processed = 0
    rows_skipped = 0
    errors = []
    auto_created_products = 0
    seen_item_ids: set = set()

    for idx, row in df.iterrows():
        try:
            item_id = safe_int(row.get('item_id'))
            if not item_id:
                rows_skipped += 1
                continue

            # Auto-create product if this Blinkit item_id is not in Products master
            if _ensure_product_blinkit(
                db, item_id,
                safe_str(row.get('item_name'), 255),
                safe_str(row.get('category'), 100),
                seen_item_ids
            ):
                auto_created_products += 1

            # Use override date if provided, otherwise parse from CSV
            if override_date:
                sale_date = override_date
            else:
                try:
                    sale_date = pd.to_datetime(row.get('date', datetime.utcnow())).date()
                except Exception:
                    sale_date = datetime.utcnow().date()

            city_id = safe_int(row.get('city_id'))

            # Check for duplicate (SaleDate + ItemId + CityId)
            existing = db.query(BlinkitSalesData).filter(
                BlinkitSalesData.SaleDate == sale_date,
                BlinkitSalesData.ItemId == item_id,
                BlinkitSalesData.CityId == city_id
            ).first()

            if existing:
                rows_skipped += 1
                continue

            record = BlinkitSalesData(
                SaleDate=sale_date,
                ItemId=item_id,
                ItemName=safe_str(row.get('item_name'), 300),
                ManufacturerId=safe_int(row.get('manufacturer_id')),
                ManufacturerName=safe_str(row.get('manufacturer_name'), 200),
                CityId=city_id,
                CityName=safe_str(row.get('city_name'), 100),
                Category=safe_str(row.get('category'), 100),
                QtySold=clean_numeric(row.get('qty_sold', 0)) or None,
                MRP=clean_numeric(row.get('mrp', 0)) or None,
            )
            db.add(record)
            rows_processed += 1

        except Exception as e:
            rows_skipped += 1
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    log_upload(db, "BlinkitSales", "Blinkit", file.filename, len(contents), current_user.Id,
               total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "BlinkitSales", None,
              new_values={"type": "BlinkitSales", "file": file.filename, "rows": rows_processed})
    db.commit()
    msg = f"Blinkit sales uploaded: {rows_processed} rows processed, {rows_skipped} skipped"
    if auto_created_products:
        msg += f", {auto_created_products} new products auto-created (needs ASG SKU mapping)"
    return {
        "success": True,
        "message": msg,
        "data": {
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "total_rows": len(df),
            "auto_created_products": auto_created_products,
            "errors": errors
        }
    }


# ============================================================
# PREVIEW 2: Blinkit Inventory — dry-run validation
# ============================================================
@router.post("/inventory/preview")
async def preview_blinkit_inventory(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dry-run: parse Blinkit Inventory CSV and return new products + new facilities that would
    be auto-created. Does NOT write to the database. Admin/Manager only.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    try:
        contents = await file.read()
        filename = file.filename or "unknown.csv"
        df = read_file(contents, filename)

        # Detect date from filename or created_at column
        import re
        from datetime import datetime
        date_found = False
        detected_date = None

        # Try to detect from filename first
        date_match = re.search(r'(\d{4}[-_]\d{2}[-_]\d{2})', filename)
        if date_match:
            try:
                detected_date = datetime.strptime(date_match.group(1).replace('_', '-'), '%Y-%m-%d').date()
                date_found = True
            except:
                pass

        # If not in filename, try created_at column
        if not date_found and 'created_at' in df.columns:
            first_date = df['created_at'].iloc[0] if len(df) > 0 else None
            if first_date and not pd.isna(first_date):
                try:
                    if isinstance(first_date, str):
                        detected_date = datetime.strptime(first_date.split()[0], '%Y-%m-%d').date()
                    else:
                        detected_date = first_date.date() if hasattr(first_date, 'date') else first_date
                    date_found = True
                except:
                    pass

        col_map = {}
        for col in df.columns:
            cl = str(col).strip().lower().replace(' ', '_')
            if cl in ('item_id', 'itemid'):
                col_map[col] = 'item_id'
            elif cl in ('item_name', 'itemname'):
                col_map[col] = 'item_name'
            elif cl in ('backend_inv_qty', 'backendinvqty', 'backend_qty'):
                col_map[col] = 'backend_inv_qty'
            elif cl in ('frontend_inv_qty', 'frontendinvqty', 'frontend_qty'):
                col_map[col] = 'frontend_inv_qty'
            elif cl in ('backend_facility_name', 'facility_name'):
                col_map[col] = 'facility_name'
            elif cl in ('backend_facility_id', 'facility_id'):
                col_map[col] = 'facility_id'
        df = df.rename(columns=col_map)

        seen_item_ids: set = set()
        seen_facility_keys: set = set()
        new_products = []
        new_facilities = []
        valid_rows = 0
        preview_rows = []

        for idx, row in df.iterrows():
            item_id = safe_int(row.get('item_id'))
            if not item_id:
                continue
            valid_rows += 1

            # Collect preview rows (first 10)
            if len(preview_rows) < 10:
                preview_rows.append({
                    'rowNumber': idx + 1,
                    'itemId': item_id,
                    'itemName': safe_str(row.get('item_name'), 255),
                    'facilityName': safe_str(row.get('facility_name'), 200),
                    'backendQty': safe_int(row.get('backend_inv_qty')),
                    'frontendQty': safe_int(row.get('frontend_inv_qty')),
                })

            # Check product
            key = str(item_id)
            if key not in seen_item_ids:
                seen_item_ids.add(key)
                exists = db.query(Product).filter(Product.BlinkitId == key).first()
                placeholder = f"UNLINKED-BLNK-{item_id}"[:50]
                ph_exists = db.query(Product).filter(Product.AsgSku == placeholder).first()
                if not exists and not ph_exists:
                    new_products.append({
                        'itemId': item_id,
                        'itemName': safe_str(row.get('item_name'), 255),
                        'placeholderSku': placeholder,
                    })

            # Check facility
            facility_id = safe_int(row.get('facility_id'))
            facility_name = safe_str(row.get('facility_name'), 200)
            if facility_id or facility_name:
                fkey = str(facility_id) if facility_id else (facility_name or '').lower()
                if fkey not in seen_facility_keys:
                    seen_facility_keys.add(fkey)
                    exists = False
                    if facility_name:
                        exists = db.query(DistributorFacility).filter(
                            DistributorFacility.FacilityName == facility_name
                        ).first() is not None
                    if not exists:
                        new_facilities.append({
                            'facilityId': facility_id,
                            'facilityName': facility_name or f"Facility-{facility_id}",
                        })

        # Duplicate detection
        duplicate_warning = None
        if date_found and detected_date:
            from sqlalchemy import func
            from ..models.blinkit_inventory import BlinkitInventoryData
            existing_count = db.query(func.count(BlinkitInventoryData.Id)).filter(
                BlinkitInventoryData.ReportDate == detected_date
            ).scalar()
            if existing_count > 0:
                duplicate_warning = f"Found {existing_count} existing inventory records for {detected_date.strftime('%Y-%m-%d')}. This data may already be uploaded."

        return {
            'success': True,
            'uploadType': 'blinkit/inventory',
            'validRows': valid_rows,
            'newProducts': new_products,
            'newFacilities': new_facilities,
            'detectedDate': detected_date.isoformat() if detected_date else None,
            'previewRows': preview_rows,
            'duplicateDataWarning': duplicate_warning,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


# ============================================================
# ENDPOINT 2: Blinkit Inventory Upload (per-facility CSV)
# ============================================================
@router.post("/inventory")
async def upload_blinkit_inventory(
    file: UploadFile = File(...),
    report_date_override: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload Blinkit Inventory Report CSV to BlinkitInventory table.
    Preserves per-facility rows (NOT aggregated).
    Expected columns: created_at, backend_facility_name, backend_facility_id,
    item_id, item_name, backend_inv_qty, frontend_inv_qty
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    contents = await file.read()
    filename = file.filename or "unknown.csv"
    df = read_file(contents, filename)

    # Normalize column names
    col_map = {}
    for col in df.columns:
        cl = str(col).strip().lower().replace(' ', '_')
        if cl in ('item_id', 'itemid'):
            col_map[col] = 'item_id'
        elif cl in ('item_name', 'itemname'):
            col_map[col] = 'item_name'
        elif cl in ('backend_inv_qty', 'backendinvqty', 'backend_qty'):
            col_map[col] = 'backend_inv_qty'
        elif cl in ('frontend_inv_qty', 'frontendinvqty', 'frontend_qty'):
            col_map[col] = 'frontend_inv_qty'
        elif cl in ('backend_facility_name', 'facility_name'):
            col_map[col] = 'facility_name'
        elif cl in ('backend_facility_id', 'facility_id'):
            col_map[col] = 'facility_id'
        elif cl in ('created_at', 'createdat', 'report_date', 'date'):
            col_map[col] = 'report_date'
    df = df.rename(columns=col_map)

    # Use override date if provided, otherwise extract from CSV
    if report_date_override:
        try:
            report_date = datetime.strptime(report_date_override, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid report_date_override format. Use YYYY-MM-DD")
    else:
        report_date = _extract_blinkit_inventory_date(df, filename)

    # Look up Blinkit distributor once for all rows
    blinkit_distributor = db.query(Distributor).filter(
        Distributor.Channel == 'Blinkit',
        Distributor.Active == True
    ).first()
    blinkit_distributor_id = blinkit_distributor.Id if blinkit_distributor else None

    rows_processed = 0
    rows_skipped = 0
    errors = []
    auto_created_products = 0
    auto_created_facilities = 0
    seen_item_ids: set = set()
    seen_facility_ids: set = set()

    for idx, row in df.iterrows():
        try:
            item_id = safe_int(row.get('item_id'))
            if not item_id:
                rows_skipped += 1
                continue

            facility_id = safe_int(row.get('facility_id'))
            facility_name = safe_str(row.get('facility_name'), 200)

            # Auto-create product if this Blinkit item_id is not in Products master
            if _ensure_product_blinkit(
                db, item_id,
                safe_str(row.get('item_name'), 255),
                None, seen_item_ids
            ):
                auto_created_products += 1

            # Auto-create facility if this backend_facility is not in DistributorFacilities
            if facility_id or facility_name:
                if _ensure_blinkit_facility(db, facility_id, facility_name, seen_facility_ids):
                    auto_created_facilities += 1

            # Check for duplicate (ReportDate + ItemId + BackendFacilityId)
            existing = db.query(BlinkitInventoryData).filter(
                BlinkitInventoryData.ReportDate == report_date,
                BlinkitInventoryData.ItemId == item_id,
                BlinkitInventoryData.BackendFacilityId == facility_id
            ).first()

            if existing:
                rows_skipped += 1
                continue

            record = BlinkitInventoryData(
                ReportDate=report_date,
                DistributorId=blinkit_distributor_id,
                BackendFacilityName=safe_str(row.get('facility_name'), 200),
                BackendFacilityId=facility_id,
                ItemId=item_id,
                ItemName=safe_str(row.get('item_name'), 300),
                BackendInvQty=safe_int(row.get('backend_inv_qty')),
                FrontendInvQty=safe_int(row.get('frontend_inv_qty')),
            )
            db.add(record)
            rows_processed += 1

        except Exception as e:
            rows_skipped += 1
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    log_upload(db, "BlinkitInventory", "Blinkit", file.filename, len(contents), current_user.Id,
               total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "BlinkitInventory", None,
              new_values={"type": "BlinkitInventory", "file": file.filename, "rows": rows_processed})
    db.commit()
    msg = f"Blinkit inventory uploaded: {rows_processed} rows processed, {rows_skipped} skipped"
    extras = []
    if auto_created_products:
        extras.append(f"{auto_created_products} new products auto-created (needs ASG SKU mapping)")
    if auto_created_facilities:
        extras.append(f"{auto_created_facilities} new facilities auto-created")
    if extras:
        msg += ", " + ", ".join(extras)
    return {
        "success": True,
        "message": msg,
        "data": {
            "report_date": report_date.isoformat(),
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "total_rows": len(df),
            "auto_created_products": auto_created_products,
            "auto_created_facilities": auto_created_facilities,
            "errors": errors
        }
    }


def _extract_blinkit_inventory_date(df: pd.DataFrame, filename: str) -> date:
    """Extract report date from Blinkit inventory CSV.
    Tries: created_at column first, then filename pattern (DD.MM.YY), fallback to today.
    """
    # Try from created_at/report_date column
    if 'report_date' in df.columns and not df['report_date'].isna().all():
        try:
            return pd.to_datetime(df['report_date'].iloc[0]).date()
        except Exception:
            pass

    # Try from filename: Blinkit_Inventory Report_DD.MM.YY.csv
    match = re.search(r'(\d{2})\.(\d{2})\.(\d{2})', filename)
    if match:
        try:
            return datetime.strptime(f"{match.group(1)}.{match.group(2)}.{match.group(3)}", '%d.%m.%y').date()
        except ValueError:
            pass

    return date.today()


# ============================================================
# PREVIEW 3: Blinkit PO — dry-run validation (CSV/Excel)
# ============================================================
@router.post("/purchase-orders/preview")
async def preview_blinkit_po(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dry-run: parse Blinkit PO CSV/Excel and return new facilities (ShipToName not in
    DistributorFacilities) that would be auto-created on confirm.
    Does NOT write to the database. Admin/Manager only.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    try:
        contents = await file.read()
        filename = file.filename or "unknown.csv"
        df = read_file(contents, filename)

        seen_po_numbers: set = set()
        seen_facility_names: set = set()
        new_facilities = []
        po_summary = []
        po_items = []
        valid_rows = 0

        for _, row in df.iterrows():
            po_number = safe_str(row.get('PONumber') or row.get('PO Number') or row.get('po_number'), 30)
            if not po_number:
                continue
            valid_rows += 1

            ship_to_name = safe_str(row.get('ShipToName') or row.get('Ship To Name') or row.get('ship_to_name'), 200)

            # Summarise unique POs
            if po_number not in seen_po_numbers:
                seen_po_numbers.add(po_number)
                po_summary.append({
                    'poNumber': po_number,
                    'shipToName': ship_to_name,
                    'status': safe_str(row.get('Status'), 50),
                    'expectedDelivery': safe_str(row.get('ExpectedDeliveryDate') or row.get('Expected Delivery Date'), 20),
                    'poDate': safe_str(row.get('PODate') or row.get('PO Date'), 20),
                    'paymentTerms': safe_str(row.get('PaymentTerms') or row.get('Payment Terms'), 50),
                })

            # Collect all line items
            po_items.append({
                'poNumber': po_number,
                'sno': safe_int(row.get('Sno') or row.get('S.No') or row.get('SNo')),
                'eagleCode': safe_int(row.get('EagleCode') or row.get('Eagle Code')),
                'itemCode': safe_str(row.get('ItemCode') or row.get('Item Code'), 100),
                'itemName': safe_str(row.get('ItemName') or row.get('Item Name'), 300),
                'mrp': clean_numeric(row.get('MRP')) or None,
                'size': safe_str(row.get('Size'), 50),
                'hsnCode': safe_str(row.get('HSNCode') or row.get('HSN Code') or row.get('HSN'), 20),
                'qty': clean_numeric(row.get('QTY') or row.get('Qty') or row.get('Quantity')) or None,
                'uom': safe_str(row.get('UOM'), 10),
                'unitBaseCost': clean_numeric(row.get('UnitBaseCost') or row.get('Unit Base Cost')) or None,
                'discount': clean_numeric(row.get('Discount')) or None,
                'taxableValue': clean_numeric(row.get('TaxableValue') or row.get('Taxable Value')) or None,
                'cgstRate': clean_numeric(row.get('CGSTRate') or row.get('CGST Rate') or row.get('CGST %')) or None,
                'cgstAmt': clean_numeric(row.get('CGSTAmt') or row.get('CGST Amt') or row.get('CGST Amount')) or None,
                'sgstRate': clean_numeric(row.get('SGSTRate') or row.get('SGST Rate') or row.get('SGST %')) or None,
                'sgstAmt': clean_numeric(row.get('SGSTAmt') or row.get('SGST Amt') or row.get('SGST Amount')) or None,
                'igstRate': clean_numeric(row.get('IGSTRate') or row.get('IGST Rate') or row.get('IGST %')) or None,
                'igstAmt': clean_numeric(row.get('IGSTAmt') or row.get('IGST Amt') or row.get('IGST Amount')) or None,
                'totalAmount': clean_numeric(row.get('TotalAmount') or row.get('Total Amount') or row.get('Total')) or None,
            })

            # Check if ShipToName is a known facility
            if ship_to_name and ship_to_name not in seen_facility_names:
                seen_facility_names.add(ship_to_name)
                exists = db.query(DistributorFacility).filter(
                    DistributorFacility.FacilityName == ship_to_name
                ).first()
                if not exists:
                    new_facilities.append({
                        'facilityId': None,
                        'facilityName': ship_to_name,
                    })

        # Check for duplicate PO numbers already in the database
        duplicate_pos = []
        for po in po_summary:
            existing = db.query(BlinkitPOData).filter(BlinkitPOData.PONumber == po['poNumber']).first()
            if existing:
                duplicate_pos.append({
                    'poNumber': po['poNumber'],
                    'uploadedOn': existing.CreatedAt.strftime('%d %b %Y') if existing.CreatedAt else 'unknown date',
                })

        return {
            'success': True,
            'validRows': valid_rows,
            'newProducts': [],
            'newFacilities': new_facilities,
            'poSummary': po_summary,
            'poItems': po_items,
            'duplicatePos': duplicate_pos,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


# ============================================================
# ENDPOINT 3: Blinkit PO Upload (from Eagle Network PDFs → CSV)
# ============================================================
@router.post("/purchase-orders")
async def upload_blinkit_po(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload Blinkit PO data (from Eagle Network PO PDFs) to BlinkitPO + BlinkitPOItem tables.
    Expects a CSV/Excel with PO header fields + line item fields per row.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    contents = await file.read()
    filename = file.filename or "unknown.csv"
    df = read_file(contents, filename)

    rows_processed = 0
    rows_skipped = 0
    po_created = 0
    errors = []
    packing_items = []  # (item_code, item_name, ordered_qty) for packing check
    products_created = []
    warehouses_created = []
    seen_facility_names: set = set()

    for idx, row in df.iterrows():
        try:
            po_number = safe_str(row.get('PONumber') or row.get('PO Number') or row.get('po_number'), 30)
            if not po_number:
                rows_skipped += 1
                continue

            # Find or create PO header
            po = db.query(BlinkitPOData).filter(BlinkitPOData.PONumber == po_number).first()
            if not po:
                ship_to_name = safe_str(row.get('ShipToName') or row.get('Ship To Name'), 200)
                ship_to_address = safe_str(row.get('ShipToAddress') or row.get('Ship To Address'), 500)

                po = BlinkitPOData(
                    PONumber=po_number,
                    PODate=_parse_date(row.get('PODate') or row.get('PO Date')),
                    POReleaseDate=_parse_date(row.get('POReleaseDate') or row.get('PO Release Date')),
                    POExpiryDate=_parse_date(row.get('POExpiryDate') or row.get('PO Expiry Date')),
                    PaymentTerms=safe_str(row.get('PaymentTerms') or row.get('Payment Terms'), 50),
                    FreightTerms=safe_str(row.get('FreightTerms') or row.get('Freight Terms'), 50),
                    ExpectedDeliveryDate=_parse_date(row.get('ExpectedDeliveryDate') or row.get('Expected Delivery Date')),
                    VendorCode=safe_str(row.get('VendorCode') or row.get('Vendor Code'), 50),
                    VendorName=safe_str(row.get('VendorName') or row.get('Vendor Name'), 200),
                    VendorGSTIN=safe_str(row.get('VendorGSTIN') or row.get('Vendor GSTIN'), 20),
                    VendorPAN=safe_str(row.get('VendorPAN') or row.get('Vendor PAN'), 15),
                    IssuerName=safe_str(row.get('IssuerName') or row.get('Issuer Name'), 200),
                    IssuerGSTIN=safe_str(row.get('IssuerGSTIN') or row.get('Issuer GSTIN'), 20),
                    BillToName=safe_str(row.get('BillToName') or row.get('Bill To Name'), 200),
                    BillToAddress=safe_str(row.get('BillToAddress') or row.get('Bill To Address'), 500),
                    BillToGSTIN=safe_str(row.get('BillToGSTIN') or row.get('Bill To GSTIN'), 20),
                    ShipToName=ship_to_name,
                    ShipToAddress=ship_to_address,
                    ShipToGSTIN=safe_str(row.get('ShipToGSTIN') or row.get('Ship To GSTIN'), 20),
                    TotalTaxableAmount=clean_numeric(row.get('TotalTaxableAmount') or row.get('Total Taxable Amount')) or None,
                    TotalTax=clean_numeric(row.get('TotalTax') or row.get('Total Tax')) or None,
                    DiscountTD=clean_numeric(row.get('DiscountTD') or row.get('Discount TD')) or None,
                    DiscountCD=clean_numeric(row.get('DiscountCD') or row.get('Discount CD')) or None,
                    DiscountSD=clean_numeric(row.get('DiscountSD') or row.get('Discount SD')) or None,
                    GrandTotal=clean_numeric(row.get('GrandTotal') or row.get('Grand Total')) or None,
                    Status='Created',
                )
                db.add(po)
                db.flush()
                po_created += 1

                # Auto-create DistributorFacility from ShipToName (Eagle Network receiving point)
                if ship_to_name:
                    _ensure_distributor_facility(db, ship_to_name, seen_facility_names)

            # Auto-create product from item data if not found
            item_code = safe_str(row.get('ItemCode') or row.get('Item Code'), 100)
            eagle_code = safe_int(row.get('EagleCode') or row.get('Eagle Code'))
            item_name = safe_str(row.get('ItemName') or row.get('Item Name'), 300)
            blinkit_id = str(eagle_code) if eagle_code else item_code
            product = None  # resolved below if blinkit_id found

            if blinkit_id:
                # Check if product exists before calling find_or_create
                existing_product = None
                if eagle_code:
                    existing_product = db.query(Product).filter(Product.BlinkitId == str(eagle_code)).first()
                if not existing_product and item_code:
                    existing_product = db.query(Product).filter(Product.BlinkitId == item_code).first()
                if not existing_product and item_code:
                    existing_product = db.query(Product).filter(Product.AsgSku == item_code).first()

                product = find_or_create_product(
                    db,
                    model_number=item_code,
                    product_title=item_name,
                    blinkit_id=blinkit_id,
                )
                if not existing_product and product:
                    products_created.append({"name": item_name or item_code, "sku": product.AsgSku, "blinkit_id": blinkit_id})

            # Create line item
            item = BlinkitPOItemData(
                POId=po.Id,
                PONumber=po_number,
                ProductId=product.Id if product else None,
                Sno=safe_int(row.get('Sno') or row.get('S.No') or row.get('SNo')),
                EagleCode=safe_int(row.get('EagleCode') or row.get('Eagle Code')),
                ItemCode=safe_str(row.get('ItemCode') or row.get('Item Code'), 100),
                ItemName=safe_str(row.get('ItemName') or row.get('Item Name'), 300),
                MRP=clean_numeric(row.get('MRP')) or None,
                Size=safe_str(row.get('Size'), 50),
                HSNCode=safe_str(row.get('HSNCode') or row.get('HSN Code') or row.get('HSN'), 20),
                QTY=clean_numeric(row.get('QTY') or row.get('Qty') or row.get('Quantity')) or None,
                UOM=safe_str(row.get('UOM'), 10),
                UnitBaseCost=clean_numeric(row.get('UnitBaseCost') or row.get('Unit Base Cost')) or None,
                Discount=clean_numeric(row.get('Discount')) or None,
                TaxableValue=clean_numeric(row.get('TaxableValue') or row.get('Taxable Value')) or None,
                CGSTRate=clean_numeric(row.get('CGSTRate') or row.get('CGST Rate') or row.get('CGST %')) or None,
                CGSTAmt=clean_numeric(row.get('CGSTAmt') or row.get('CGST Amt') or row.get('CGST Amount')) or None,
                SGSTRate=clean_numeric(row.get('SGSTRate') or row.get('SGST Rate') or row.get('SGST %')) or None,
                SGSTAmt=clean_numeric(row.get('SGSTAmt') or row.get('SGST Amt') or row.get('SGST Amount')) or None,
                IGSTRate=clean_numeric(row.get('IGSTRate') or row.get('IGST Rate') or row.get('IGST %')) or None,
                IGSTAmt=clean_numeric(row.get('IGSTAmt') or row.get('IGST Amt') or row.get('IGST Amount')) or None,
                TotalAmount=clean_numeric(row.get('TotalAmount') or row.get('Total Amount') or row.get('Total')) or None,
            )
            db.add(item)
            rows_processed += 1
            # Collect item info for packing check
            _ic = safe_str(row.get('ItemCode') or row.get('Item Code'), 100)
            _iq = clean_numeric(row.get('QTY') or row.get('Qty') or row.get('qty'))
            _in = safe_str(row.get('ItemName') or row.get('Item Name'), 300)
            if _ic and _iq:
                packing_items.append((_ic, _in, _iq))

        except Exception as e:
            rows_skipped += 1
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    log_upload(db, "BlinkitPO", "Blinkit", file.filename, len(contents), current_user.Id,
               total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "BlinkitPO", None,
              new_values={"type": "BlinkitPO", "file": file.filename, "rows": rows_processed, "pos": po_created})
    db.commit()
    # Notify about low/insufficient packed inventory (no auto-deduction — manual via AcceptedQty)
    packing_alerts = _get_packing_alerts_blinkit(db, packing_items)
    return {
        "success": True,
        "message": f"Blinkit PO uploaded: {po_created} POs, {rows_processed} line items",
        "data": {
            "po_created": po_created,
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "errors": errors,
            "packing_alerts": packing_alerts,
            "products_created": products_created,
            "warehouses_created": warehouses_created,
        }
    }


# ============================================================
# ENDPOINT 4: Blinkit PO Status Update (manual)
# ============================================================
VALID_BLINKIT_PO_STATUSES = [
    "Created", "Packed", "Dispatched", "In Transit", "Partially Delivered",
    "Delivered", "Closed", "Cancelled"
]


@router.patch("/purchase-orders/{po_id}/status")
async def update_blinkit_po_status(
    po_id: int,
    status: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Manually update Blinkit PO status (e.g. Created → Dispatched → In Transit → Delivered)."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    if status not in VALID_BLINKIT_PO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_BLINKIT_PO_STATUSES)}"
        )

    po = db.query(BlinkitPOData).filter(BlinkitPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail=f"Blinkit PO with id {po_id} not found")

    old_status = po.Status
    po.Status = status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "BlinkitPO", str(po.Id),
              old_values={"status": old_status},
              new_values={"status": status})
    db.commit()

    return {
        "success": True,
        "message": f"PO {po.PONumber} status updated: {old_status} → {status}",
        "data": {
            "po_id": po.Id,
            "po_number": po.PONumber,
            "old_status": old_status,
            "new_status": status
        }
    }


# ============================================================
# ENDPOINT 5: Extract PO from Eagle Network PDF (Preview)
# ============================================================
@router.post("/purchase-orders/extract-pdf")
async def extract_blinkit_po_pdf(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Extract PO data from Eagle Network PDF for preview.
    Returns structured JSON without saving to database.
    Step 1 of the Extract -> Verify -> Save workflow.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    filename = file.filename or "unknown"
    if not filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF (.pdf)")

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    result = extract_po_from_pdf(contents)

    if not result.success:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to parse PDF: {'; '.join(result.errors)}"
        )

    data = result.to_dict()

    # Check if this PO already exists in the database
    po_number = (data.get('header') or {}).get('po_number', '').strip()
    if po_number:
        existing = db.query(BlinkitPOData).filter(BlinkitPOData.PONumber == po_number).first()
        if existing:
            uploaded_on = existing.CreatedAt.strftime('%d %b %Y') if existing.CreatedAt else 'unknown date'
            data['duplicate_warning'] = f"PO {po_number} already exists in the database (uploaded {uploaded_on}). Saving again will be blocked."

    return data


# ============================================================
# ENDPOINT 6: Confirm & Save extracted PO data
# ============================================================
@router.post("/purchase-orders/confirm-pdf")
async def confirm_blinkit_po_pdf(
    payload: POConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save previously extracted PO data to the database.
    Step 2 of the Extract -> Verify -> Save workflow.
    Receives the JSON payload from the preview step (possibly user-reviewed).
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    header = payload.header
    items = payload.items

    if not header.po_number or not header.po_number.strip():
        raise HTTPException(status_code=400, detail="PO Number is required")

    # Check for duplicate PO
    existing = db.query(BlinkitPOData).filter(
        BlinkitPOData.PONumber == header.po_number.strip()
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"PO {header.po_number} already exists (ID: {existing.Id})"
        )

    try:
        products_created = []
        warehouses_created = []

        po = BlinkitPOData(
            PONumber=header.po_number.strip(),
            PODate=_parse_date(header.po_date) if header.po_date else None,
            POReleaseDate=_parse_date(header.po_release_date) if header.po_release_date else None,
            POExpiryDate=_parse_date(header.po_expiry_date) if header.po_expiry_date else None,
            PaymentTerms=safe_str(header.payment_terms, 50),
            FreightTerms=safe_str(header.freight_terms, 50),
            ExpectedDeliveryDate=_parse_date(header.expected_delivery_date) if header.expected_delivery_date else None,
            VendorCode=safe_str(header.vendor_code, 50),
            VendorName=safe_str(header.vendor_name, 200),
            VendorGSTIN=safe_str(header.vendor_gstin, 20),
            VendorPAN=safe_str(header.vendor_pan, 15),
            IssuerName=safe_str(header.issuer_name, 200),
            IssuerGSTIN=safe_str(header.issuer_gstin, 20),
            BillToName=safe_str(header.bill_to_name, 200),
            BillToAddress=safe_str(header.bill_to_address, 500),
            BillToGSTIN=safe_str(header.bill_to_gstin, 20),
            ShipToName=safe_str(header.ship_to_name, 200),
            ShipToAddress=safe_str(header.ship_to_address, 500),
            ShipToGSTIN=safe_str(header.ship_to_gstin, 20),
            TotalTaxableAmount=header.total_taxable_amount,
            TotalTax=header.total_tax,
            DiscountTD=header.discount_td,
            DiscountCD=header.discount_cd,
            DiscountSD=header.discount_sd,
            GrandTotal=header.grand_total,
            Status=payload.status or "Created",
        )
        db.add(po)
        db.flush()

        # Auto-create DistributorFacility from ShipToName (Eagle Network receiving point)
        ship_to_name = safe_str(header.ship_to_name, 200)
        if ship_to_name:
            _ensure_distributor_facility(db, ship_to_name, set())

        items_created = 0
        for item_data in items:
            # Resolve product first so we can store ProductId on the item
            item_code = safe_str(item_data.item_code, 100)
            eagle_code = item_data.eagle_code
            item_name = safe_str(item_data.item_name, 300)
            blinkit_id = str(eagle_code) if eagle_code else (item_code or None)
            product = None
            if item_code or eagle_code:
                from app.models.product import Product
                from sqlalchemy import or_ as _or
                filters = []
                if blinkit_id:
                    filters.append(Product.BlinkitId == blinkit_id)
                if item_code:
                    filters.append(Product.AsgSku == item_code)
                existing_product = db.query(Product).filter(_or(*filters)).first() if filters else None
                if existing_product:
                    product = existing_product
                else:
                    product = find_or_create_product(db, model_number=item_code, product_title=item_name, blinkit_id=blinkit_id)
                    if product:
                        products_created.append({"name": item_name or item_code, "sku": item_code, "blinkit_id": blinkit_id})

            item = BlinkitPOItemData(
                POId=po.Id,
                PONumber=header.po_number.strip(),
                ProductId=product.Id if product else None,
                Sno=item_data.sno,
                EagleCode=eagle_code,
                ItemCode=item_code,
                ItemName=item_name,
                MRP=item_data.mrp,
                Size=safe_str(item_data.size, 50),
                HSNCode=safe_str(item_data.hsn_code, 20),
                QTY=item_data.qty,
                UOM=safe_str(item_data.uom, 10),
                UnitBaseCost=item_data.unit_base_cost,
                Discount=item_data.discount,
                TaxableValue=item_data.taxable_value,
                CGSTRate=item_data.cgst_rate,
                CGSTAmt=item_data.cgst_amt,
                SGSTRate=item_data.sgst_rate,
                SGSTAmt=item_data.sgst_amt,
                IGSTRate=item_data.igst_rate,
                IGSTAmt=item_data.igst_amt,
                TotalAmount=item_data.total_amount,
            )
            db.add(item)
            items_created += 1

        log_upload(db, "BlinkitPO", "Blinkit", f"PDF-{header.po_number}", 0, current_user.Id,
                   total_rows=len(items), success_rows=items_created, error_rows=0, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "BlinkitPO", str(po.Id),
                  new_values={"type": "BlinkitPO_PDF", "po_number": header.po_number, "items": items_created})
        db.commit()

        # Check packing gaps and deduct from inventory
        pdf_items = [
            (safe_str(i.item_code, 100), safe_str(i.item_name, 300), i.qty)
            for i in items if i.item_code and i.qty
        ]
        # Notify about low/insufficient packed inventory (no auto-deduction — manual via AcceptedQty)
        packing_alerts = _get_packing_alerts_blinkit(db, pdf_items)

        return {
            "success": True,
            "message": f"PO {header.po_number} saved: 1 PO header, {items_created} line items",
            "data": {
                "po_id": po.Id,
                "po_number": header.po_number,
                "po_created": 1,
                "items_created": items_created,
                "packing_alerts": packing_alerts,
                "products_created": products_created,
                "warehouses_created": warehouses_created,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save PO: {str(e)}")


# ============================================================
# ENDPOINT 7: Blinkit Sales Analytics (from BlinkitSales table)
# ============================================================
@router.get("/analytics")
async def get_blinkit_sales_analytics(
    days: int = Query(1825, ge=1, le=1825, description="Number of days to look back"),
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD (overrides days)"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD (default: today)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get analytics from the BlinkitSales table (daily CSV uploads)."""
    end_dt = date.fromisoformat(end_date) if end_date else date.today()
    start_dt = date.fromisoformat(start_date) if start_date else (end_dt - timedelta(days=days))
    start_dt_s = start_dt.isoformat()
    end_dt_s = end_dt.isoformat()

    try:
        # ----- Total rows all-time (diagnostic: confirms table has data) -----
        total_records_all_time = int(
            db.execute(text("SELECT COUNT(*) FROM BlinkitSales")).scalar() or 0
        )

        # ----- Summary stats -----
        summary_row = db.execute(text("""
            SELECT
                COUNT(*)                AS total_records,
                COUNT(DISTINCT ItemId)  AS active_items,
                SUM(QtySold)            AS total_qty,
                SUM(MRP)                AS total_revenue,
                MAX(SaleDate)           AS max_date
            FROM BlinkitSales
            WHERE SaleDate >= :start_dt AND SaleDate <= :end_dt
        """), {"start_dt": start_dt_s, "end_dt": end_dt_s}).fetchone()

        total_records_in_range = int(summary_row[0] or 0)
        active_items           = int(summary_row[1] or 0)
        total_qty              = float(summary_row[2] or 0)
        total_revenue          = float(summary_row[3] or 0)
        max_date               = summary_row[4]  # Python date/datetime or None

        # ----- Monthly growth -----
        monthly_growth = 0.0
        if max_date:
            max_date_d    = max_date.date() if hasattr(max_date, 'date') else max_date
            current_start = max_date_d - timedelta(days=30)
            prev_start    = max_date_d - timedelta(days=60)

            growth_row = db.execute(text("""
                SELECT
                    SUM(CASE WHEN SaleDate > :current_start AND SaleDate <= :max_date
                             THEN QtySold END) AS current_qty,
                    SUM(CASE WHEN SaleDate > :prev_start    AND SaleDate <= :current_start
                             THEN QtySold END) AS prev_qty
                FROM BlinkitSales
                WHERE SaleDate > :prev_start AND SaleDate <= :max_date
            """), {
                "current_start": current_start.isoformat(),
                "max_date":      max_date_d.isoformat(),
                "prev_start":    prev_start.isoformat(),
            }).fetchone()

            current_q = float(growth_row[0] or 0)
            prev_q    = float(growth_row[1] or 0)
            if prev_q > 0:
                monthly_growth = round(((current_q - prev_q) / prev_q) * 100, 1)

        # ----- All products -----
        top_rows = db.execute(text("""
            SELECT
                ItemId,
                MAX(ItemName)   AS item_name,
                SUM(QtySold)    AS total_qty,
                SUM(MRP)        AS total_revenue
            FROM BlinkitSales
            WHERE SaleDate >= :start_dt AND SaleDate <= :end_dt
            GROUP BY ItemId
            ORDER BY SUM(QtySold) DESC
        """), {"start_dt": start_dt_s, "end_dt": end_dt_s}).fetchall()

        top_products = [
            {
                "item_id":       int(row[0] or 0),
                "item_name":     row[1] or str(row[0]),
                "total_qty":     float(row[2] or 0),
                "total_revenue": float(row[3] or 0),
            }
            for row in top_rows
        ]

        # ----- Daily / Monthly trend -----
        # First try daily grouping; if only 1 distinct date fall back to monthly
        daily_rows = db.execute(text("""
            SELECT
                SaleDate,
                SUM(QtySold)    AS total_qty,
                SUM(MRP)        AS total_revenue
            FROM BlinkitSales
            WHERE SaleDate >= :start_dt AND SaleDate <= :end_dt
            GROUP BY SaleDate
            ORDER BY SaleDate
        """), {"start_dt": start_dt_s, "end_dt": end_dt_s}).fetchall()

        if len(daily_rows) > 1:
            daily_trend = [
                {
                    "date":          row[0].isoformat() if row[0] else None,
                    "total_qty":     float(row[1] or 0),
                    "total_revenue": float(row[2] or 0),
                }
                for row in daily_rows
            ]
        else:
            monthly_rows = db.execute(text("""
                SELECT
                    CONVERT(varchar(7), SaleDate, 120) AS month,
                    SUM(QtySold)    AS total_qty,
                    SUM(MRP)        AS total_revenue
                FROM BlinkitSales
                WHERE SaleDate IS NOT NULL
                GROUP BY CONVERT(varchar(7), SaleDate, 120)
                ORDER BY CONVERT(varchar(7), SaleDate, 120)
            """)).fetchall()
            daily_trend = [
                {
                    "date":          row[0],
                    "total_qty":     float(row[1] or 0),
                    "total_revenue": float(row[2] or 0),
                }
                for row in monthly_rows
            ]

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Blinkit analytics query failed: {exc}"
        )

    return {
        "summary": {
            "total_qty":              total_qty,
            "total_revenue":          total_revenue,
            "active_items":           active_items,
            "monthly_growth":         monthly_growth,
            "total_records_in_range": total_records_in_range,
            "total_records_all_time": total_records_all_time,
            "date_range": {
                "start": start_dt.isoformat(),
                "end":   end_dt.isoformat(),
                "days":  days,
            }
        },
        "top_products": top_products,
        "daily_trend":  daily_trend,
    }


# ============================================================
# ENDPOINT 7b: Blinkit Sales — All Products (paginated)
# ============================================================
@router.get("/products")
async def list_blinkit_sales_products(
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all products from BlinkitSales aggregated by ItemId, with pagination and search."""
    try:
        search_clause = ""
        params: dict = {"offset": (page - 1) * page_size, "page_size": page_size}
        if search:
            search_clause = "AND (ItemName LIKE :search OR CAST(ItemId AS NVARCHAR) LIKE :search)"
            params["search"] = f"%{search}%"

        count_sql = f"""
            SELECT COUNT(DISTINCT ItemId)
            FROM BlinkitSales
            WHERE ItemId IS NOT NULL {search_clause}
        """
        total = int(db.execute(text(count_sql), params).scalar() or 0)

        rows = db.execute(text(f"""
            SELECT
                ItemId,
                MAX(ItemName)    AS item_name,
                SUM(QtySold)     AS total_qty,
                SUM(MRP)         AS total_revenue,
                MIN(SaleDate)    AS first_sale,
                MAX(SaleDate)    AS last_sale
            FROM BlinkitSales
            WHERE ItemId IS NOT NULL {search_clause}
            GROUP BY ItemId
            ORDER BY SUM(QtySold) DESC
            OFFSET :offset ROWS FETCH NEXT :page_size ROWS ONLY
        """), params).fetchall()

        items = [
            {
                "itemId":       str(row[0]) if row[0] is not None else "",
                "itemName":     row[1] or str(row[0]) or "Unknown",
                "totalQty":     float(row[2] or 0),
                "totalRevenue": float(row[3] or 0),
                "firstSale":    row[4].isoformat() if row[4] else None,
                "lastSale":     row[5].isoformat() if row[5] else None,
            }
            for row in rows
        ]

        total_pages = max(1, (total + page_size - 1) // page_size)
        return {"items": items, "total": total, "page": page, "page_size": page_size, "total_pages": total_pages}

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Blinkit products query failed: {exc}")


# ============================================================
# ENDPOINT 8: Distributor Stock — Query
# ============================================================
@router.get("/distributor-stock")
async def get_distributor_stock(
    search: Optional[str] = Query(None),
    distributor_id: Optional[int] = Query(None, description="Filter by distributor (1=RK, 2=Eagle)"),
    report_date: Optional[str] = Query(None, description="Filter by exact report date (YYYY-MM-DD)"),
    date_from: Optional[str] = Query(None, description="Filter from date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter to date (YYYY-MM-DD)"),
    region: Optional[str] = Query(None, description="Filter by region: dl, mh, kt, wb"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get distributor stock data with optional search, distributor, and date filter."""
    query = db.query(DistributorStockData)

    if distributor_id:
        query = query.filter(DistributorStockData.DistributorId == distributor_id)

    if report_date:
        try:
            rd = datetime.strptime(report_date, "%Y-%m-%d").date()
            query = query.filter(DistributorStockData.ReportDate == rd)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if date_from:
        try:
            df = datetime.strptime(date_from, "%Y-%m-%d").date()
            query = query.filter(DistributorStockData.ReportDate >= df)
        except ValueError:
            pass

    if date_to:
        try:
            dt = datetime.strptime(date_to, "%Y-%m-%d").date()
            query = query.filter(DistributorStockData.ReportDate <= dt)
        except ValueError:
            pass

    if search:
        query = query.filter(or_(
            DistributorStockData.ItemName.ilike(f"%{search}%"),
            DistributorStockData.SKU.ilike(f"%{search}%"),
        ))

    region_map = {
        'dl': DistributorStockData.DL_Qty,
        'mh': DistributorStockData.MH_Qty,
        'kt': DistributorStockData.KT_Qty,
        'wb': DistributorStockData.WB_Qty,
    }
    if region and region in region_map:
        query = query.filter(region_map[region] > 0)

    total = query.count()

    stats_row = query.with_entities(
        sqlfunc.sum(DistributorStockData.ClosingQty).label('total_closing'),
        sqlfunc.sum(DistributorStockData.DL_Qty).label('total_dl'),
        sqlfunc.sum(DistributorStockData.MH_Qty).label('total_mh'),
        sqlfunc.sum(DistributorStockData.KT_Qty).label('total_kt'),
        sqlfunc.sum(DistributorStockData.WB_Qty).label('total_wb'),
        sqlfunc.count(sqlfunc.distinct(DistributorStockData.ItemName)).label('total_skus'),
    ).one()

    offset = (page - 1) * page_size
    items = query.order_by(DistributorStockData.ItemName).offset(offset).limit(page_size).all()

    dates_list = db.query(DistributorStockData.ReportDate).distinct().order_by(
        desc(DistributorStockData.ReportDate)
    ).limit(20).all()

    return {
        "items": [item.to_dict() for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "stats": {
            "totalClosingQty": int(stats_row.total_closing or 0),
            "totalDlQty": int(stats_row.total_dl or 0),
            "totalMhQty": int(stats_row.total_mh or 0),
            "totalKtQty": int(stats_row.total_kt or 0),
            "totalWbQty": int(stats_row.total_wb or 0),
            "totalSkus": int(stats_row.total_skus or 0),
        },
        "filters": {
            "report_dates": [d[0].isoformat() for d in dates_list if d[0]],
        }
    }


# ============================================================
# ENDPOINT 8a: Distributor Stock — Preview (parse without saving)
# ============================================================
@router.post("/distributor-stock/preview")
async def preview_distributor_stock(
    file: UploadFile = File(...),
    distributor_id: Optional[int] = Query(None),
    channel: Optional[str] = Query(None),
    report_date: Optional[str] = Query(None, description="Override report date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Parse distributor stock file and return preview rows without saving."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    # Resolve distributor
    if channel:
        dist = db.query(Distributor).filter(Distributor.Channel == channel, Distributor.Active == True).first()
        if not dist:
            raise HTTPException(status_code=404, detail=f"No active distributor found for channel '{channel}'")
        distributor_id = dist.Id
    elif distributor_id is None:
        raise HTTPException(status_code=400, detail="Provide either distributor_id or channel query param")

    contents = await file.read()
    filename = file.filename or "unknown.xlsx"
    df = read_file(contents, filename)

    # Same column mapping as upload
    col_map = {}
    assigned_targets: dict[str, str] = {}
    for col in df.columns:
        cl = str(col).strip().lower().replace(' ', '_').replace('-', '_')
        target = None
        if cl in ('report_date', 'reportdate', 'date', 'week_date', 'week', 'report_week'):
            target = 'report_date'
        elif cl in ('item_name', 'itemname', 'product_name', 'product', 'item',
                    'name', 'description', 'product_description', 'sku_name', 'item_description'):
            target = 'item_name'
        elif cl in ('closing_qty', 'closingqty', 'closing', 'close_qty', 'closing_stock',
                    'cl_stock', 'close_stock', 'closing_quantity',
                    'total_stock', 'total_qty', 'total_quantity', 'stock', 'current_stock'):
            target = 'closing_qty'
        elif cl in ('sku', 'sku_code', 'asg_sku', 'product_sku', 'item_sku', 'model_number', 'model_no'):
            target = 'sku'
        elif cl == 'dl':
            target = 'dl_qty'
        elif cl == 'mh':
            target = 'mh_qty'
        elif cl in ('kt', 'kar', 'ka'):
            target = 'kt_qty'
        elif cl == 'wb':
            target = 'wb_qty'
        if target:
            if target in assigned_targets:
                del col_map[assigned_targets[target]]
            col_map[col] = target
            assigned_targets[target] = col
    df = df.rename(columns=col_map)

    # Override date if provided
    override_date = None
    if report_date:
        try:
            from datetime import datetime as dt_obj
            override_date = dt_obj.strptime(report_date, '%Y-%m-%d').date()
        except Exception:
            pass

    rows = []
    detected_date = None
    for idx, row in df.iterrows():
        item_name = safe_str(row.get('item_name'), 300)
        if not item_name:
            continue
        rd = override_date or _parse_date(row.get('report_date')) or date.today()
        if detected_date is None:
            detected_date = rd.isoformat()
        rows.append({
            "itemName": item_name,
            "sku": safe_str(row.get('sku'), 100),
            "closingQty": safe_int(row.get('closing_qty')),
            "dlQty": safe_int(row.get('dl_qty')),
            "mhQty": safe_int(row.get('mh_qty')),
            "ktQty": safe_int(row.get('kt_qty')),
            "wbQty": safe_int(row.get('wb_qty')),
            "reportDate": rd.isoformat(),
        })

    # Duplicate check: does data already exist for this distributor + detected date?
    duplicate_warning = None
    if detected_date and distributor_id:
        existing_count = db.query(DistributorStockData).filter(
            DistributorStockData.DistributorId == distributor_id,
            DistributorStockData.ReportDate == detected_date,
        ).count()
        if existing_count > 0:
            duplicate_warning = f"Data for {detected_date} already exists ({existing_count} records). Uploading will overwrite existing records for this date."

    return {
        "rows": rows,
        "detectedDate": detected_date,
        "totalRows": len(rows),
        "duplicateWarning": duplicate_warning,
    }


# ============================================================
# ENDPOINT 8: Distributor Stock — Upload (weekly Excel)
# ============================================================
@router.post("/distributor-stock")
async def upload_distributor_stock(
    file: UploadFile = File(...),
    distributor_id: Optional[int] = Query(None, description="Distributor ID"),
    channel: Optional[str] = Query(None, description="Channel name: Amazon or Blinkit (looked up dynamically)"),
    report_date: Optional[str] = Query(None, description="Override report date for all rows (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload weekly distributor stock report (Excel/CSV).
    Pass either distributor_id OR channel (Amazon/Blinkit) — channel does dynamic lookup.
    Expected columns: report_date, item_name, opening_qty, closing_qty, sale_qty
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    # Resolve distributor_id dynamically if channel is given
    if channel:
        dist = db.query(Distributor).filter(
            Distributor.Channel == channel,
            Distributor.Active == True
        ).first()
        if not dist:
            raise HTTPException(status_code=404, detail=f"No active distributor found for channel '{channel}'")
        distributor_id = dist.Id
    elif distributor_id is None:
        raise HTTPException(status_code=400, detail="Provide either distributor_id or channel query param")
    else:
        # Validate the provided distributor_id actually exists
        dist = db.query(Distributor).filter(Distributor.Id == distributor_id).first()
        if not dist:
            raise HTTPException(status_code=404, detail=f"Distributor with id {distributor_id} not found")

    contents = await file.read()
    filename = file.filename or "unknown.xlsx"
    df = read_file(contents, filename)

    # Normalize column names — build col_map, then deduplicate by keeping last assignment
    # so that a more specific column (e.g. ITEM) wins over a generic one (e.g. SKU)
    col_map = {}
    assigned_targets: dict[str, str] = {}  # target → last source col that maps to it
    for col in df.columns:
        cl = str(col).strip().lower().replace(' ', '_').replace('-', '_')
        target = None
        if cl in ('report_date', 'reportdate', 'date', 'week_date', 'week', 'report_week'):
            target = 'report_date'
        elif cl in ('item_name', 'itemname', 'product_name', 'product', 'item',
                    'name', 'description', 'product_description', 'sku_name', 'item_description'):
            target = 'item_name'
        elif cl in ('opening_qty', 'openingqty', 'opening', 'open_qty', 'opening_stock',
                    'op_stock', 'open_stock', 'opening_quantity'):
            target = 'opening_qty'
        elif cl in ('closing_qty', 'closingqty', 'closing', 'close_qty', 'closing_stock',
                    'cl_stock', 'close_stock', 'closing_quantity',
                    'total_stock', 'total_qty', 'total_quantity', 'stock', 'current_stock'):
            target = 'closing_qty'
        elif cl in ('sale_qty', 'saleqty', 'sales_qty', 'sold_qty', 'dispatched_qty', 'dispatch',
                    'dispatched', 'dispatch_qty', 'dispatched_quantity', 'sale', 'sales',
                    'blinkit_dispatch', 'blinkit_sale', 'sold'):
            target = 'sale_qty'
        elif cl in ('sku', 'sku_code', 'asg_sku', 'product_sku', 'item_sku', 'model_number', 'model_no'):
            target = 'sku'
        elif cl == 'dl':
            target = 'dl_qty'
        elif cl == 'mh':
            target = 'mh_qty'
        elif cl in ('kt', 'kar', 'ka'):
            target = 'kt_qty'
        elif cl == 'wb':
            target = 'wb_qty'
        if target:
            # If a previous column already mapped to this target, drop its mapping first
            if target in assigned_targets:
                del col_map[assigned_targets[target]]
            col_map[col] = target
            assigned_targets[target] = col
    df = df.rename(columns=col_map)

    # Parse optional date override from query param
    override_date = None
    if report_date:
        try:
            from datetime import datetime as dt_obj
            override_date = dt_obj.strptime(report_date, '%Y-%m-%d').date()
        except Exception:
            pass

    rows_processed = 0
    rows_skipped = 0
    errors = []

    for idx, row in df.iterrows():
        try:
            item_name = safe_str(row.get('item_name'), 300)
            if not item_name:
                rows_skipped += 1
                continue

            row_date = override_date or _parse_date(row.get('report_date')) or date.today()

            sku = safe_str(row.get('sku'), 100)
            opening_qty = safe_int(row.get('opening_qty'))
            closing_qty = safe_int(row.get('closing_qty'))
            sale_qty = safe_int(row.get('sale_qty'))
            dl_qty = safe_int(row.get('dl_qty'))
            mh_qty = safe_int(row.get('mh_qty'))
            kt_qty = safe_int(row.get('kt_qty'))
            wb_qty = safe_int(row.get('wb_qty'))

            # Upsert: update quantities if row already exists (DistributorId + ReportDate + ItemName)
            existing = db.query(DistributorStockData).filter(
                DistributorStockData.DistributorId == distributor_id,
                DistributorStockData.ReportDate == row_date,
                DistributorStockData.ItemName == item_name
            ).first()
            if existing:
                existing.SKU = sku
                existing.OpeningQty = opening_qty
                existing.ClosingQty = closing_qty
                existing.SaleQty = sale_qty
                existing.DL_Qty = dl_qty
                existing.MH_Qty = mh_qty
                existing.KT_Qty = kt_qty
                existing.WB_Qty = wb_qty
            else:
                record = DistributorStockData(
                    ReportDate=row_date,
                    DistributorId=distributor_id,
                    ItemName=item_name,
                    SKU=sku,
                    OpeningQty=opening_qty,
                    ClosingQty=closing_qty,
                    SaleQty=sale_qty,
                    DL_Qty=dl_qty,
                    MH_Qty=mh_qty,
                    KT_Qty=kt_qty,
                    WB_Qty=wb_qty,
                )
                db.add(record)
            rows_processed += 1

        except Exception as e:
            rows_skipped += 1
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    log_upload(db, "DistributorStock", "Blinkit", file.filename, len(contents), current_user.Id,
               total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "DistributorStock", None,
              new_values={"type": "DistributorStock", "file": file.filename, "rows": rows_processed})
    db.commit()
    return {
        "success": True,
        "message": f"Distributor stock uploaded: {rows_processed} rows processed, {rows_skipped} skipped",
        "data": {
            "distributor_id": distributor_id,
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "total_rows": len(df),
            "errors": errors
        }
    }
