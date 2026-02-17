"""
Amazon Data Router - Upload to dedicated Amazon tables
Writes to: AmazonSales, AmazonInventory, AmazonPO, AmazonPOItem
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, text
from datetime import datetime, date, timedelta
from typing import Optional
import pandas as pd
import io
import re
import logging

from app.database import get_db
from app.models.user import User
from app.models.amazon_sales import AmazonSalesData
from app.models.amazon_inventory import AmazonInventoryData
from app.models.amazon_po import AmazonPOData
from app.models.amazon_po_item import AmazonPOItemData
from app.models.product import Product
from app.models.inventory import Inventory
from app.utils.dependencies import get_current_user
from app.schemas.amazon_po import AmazonPOConfirmRequest
from app.routers.uploads import find_or_create_product, find_or_create_warehouse
from app.utils.audit import log_audit, log_upload


def _get_packing_alerts_amazon(db: Session, items: list) -> list:
    """Check packed qty in Inventory for each Amazon PO item.
    items: list of (asin, title, ordered_qty)
    Returns list of alert dicts for items where packed < ordered.
    """
    alerts = []
    for asin, title, ordered_qty in items:
        if not asin or not ordered_qty:
            continue
        product = db.query(Product).filter(Product.AmazonId == asin).first()
        packed_qty = 0
        if product:
            packed_qty = db.query(func.sum(Inventory.PackedQty)).filter(
                Inventory.ProductId == product.Id
            ).scalar() or 0
        gap = int(ordered_qty) - packed_qty
        if gap > 0:
            alerts.append({
                "asin": asin,
                "title": title or asin,
                "ordered_qty": int(ordered_qty),
                "packed_qty": packed_qty,
                "gap": gap,
            })
    return alerts

logger = logging.getLogger(__name__)
router = APIRouter()


# ---- Shared helpers (same as uploads.py) ----

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


def clean_percentage(val) -> float:
    """Clean percentage values — strip % sign."""
    if pd.isna(val) or str(val).strip() in ('', '-', 'nan', 'UNKNOWN'):
        return 0.0
    s = str(val).strip().replace('%', '')
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
        return float(str(val).replace(',', '').replace('₹', '').replace('$', '').replace('\u200e', ''))
    except (ValueError, TypeError):
        return None


def extract_date_from_metadata(contents: bytes, filename: str) -> tuple:
    """Extract report date from Vendor Central CSV metadata line 1.
    Format: ...Viewing Range=[DD/MM/YY - DD/MM/YY]...
    Amazon India exports use DD/MM/YY (e.g. 01/12/25 = 1 Dec 2025).
    Fallback: parse date from filename (Inventory_01.12.25-...).
    Returns (date, detected: bool) — detected=False means fallback to today.
    """
    try:
        if filename.endswith('.csv'):
            lines = contents.decode('utf-8', errors='ignore').split('\n')
            if lines:
                metadata = lines[0]
                match = re.search(r'Viewing Range=\[(\d{2}/\d{2}/\d{2})', metadata)
                if match:
                    # DD/MM/YY format (Amazon India)
                    return datetime.strptime(match.group(1), '%d/%m/%y').date(), True
    except Exception:
        pass

    # Fallback: extract from filename  e.g. Inventory_01.12.25-01.12.25.csv
    try:
        m = re.search(r'(\d{2})\.(\d{2})\.(\d{2})', filename)
        if m:
            return datetime.strptime(f"{m.group(1)}.{m.group(2)}.{m.group(3)}", '%d.%m.%y').date(), True
    except Exception:
        pass

    return date.today(), False


def detect_sales_format(columns: list) -> str:
    """Detect if the file is AmazonSales.csv (VendorCSV) or RK Excel (RKExcel)."""
    col_set = set(c.strip().lower() for c in columns)
    # VendorCSV has these unique columns
    if 'ordered revenue' in col_set or 'product title' in col_set or 'brand code' in col_set:
        return 'VendorCSV'
    # RKExcel has these unique columns
    if 'asp' in col_set or 'gl' in col_set or 'vm' in col_set or 'drr(d-1)' in col_set:
        return 'RKExcel'
    # Default
    return 'VendorCSV'


def _ensure_product_amazon(db: Session, asin: str, title: str, brand: str, category: str, seen: set, model_number: str = None) -> bool:
    """Auto-create a Product record for an unknown ASIN.
    Uses model_number (ASG SKU from CSV) if available, otherwise falls back to
    placeholder AsgSku = 'UNLINKED-AMZN-{asin}' so user can fill in the real SKU later.
    Returns True if a new product was created, False if it already existed.
    """
    if asin in seen:
        return False
    seen.add(asin)
    # Already linked by ASIN
    if db.query(Product).filter(Product.AmazonId == asin).first():
        logger.debug(f"[Product] ASIN {asin} already linked in Products — skipping auto-create")
        return False
    # Already linked by model number / AsgSku
    clean_model = (model_number or '').strip()
    if clean_model and clean_model.lower() != 'nan':
        if db.query(Product).filter(Product.AsgSku == clean_model).first():
            logger.debug(f"[Product] Model number {clean_model} already exists — skipping auto-create")
            return False
        sku = clean_model[:50]
    else:
        sku = f"UNLINKED-AMZN-{asin}"[:50]
        if db.query(Product).filter(Product.AsgSku == sku).first():
            logger.debug(f"[Product] Placeholder SKU {sku} already exists — skipping auto-create")
            return False
    logger.info(f"[Product] Auto-creating product: ASIN={asin}, SKU={sku}")
    db.add(Product(
        ProductName=(title or asin)[:255],
        AsgSku=sku,
        AmazonId=asin,
        Brand=brand[:100] if brand else None,
        Category=category[:100] if category else None,
    ))
    return True


# ============================================================
# PREVIEW 1: Amazon Sales — dry-run validation
# ============================================================
@router.post("/sales/preview")
async def preview_amazon_sales(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dry-run: parse Amazon Sales CSV/Excel and return new products that would be auto-created.
    Does NOT write to the database. Admin/Manager only.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    try:
        contents = await file.read()
        filename = file.filename or "unknown.csv"

        # Detect report date (so UI can warn if not found)
        detected_date, date_found = extract_date_from_metadata(contents, filename)

        # For Excel (RK format) parse normally; for CSV skip first metadata row
        if filename.endswith('.xlsx') or filename.endswith('.xls'):
            df = read_file(contents, filename)
        else:
            df = read_file(contents, filename, skiprows=1)

        # Detect format so preview maps correct columns
        fmt = detect_sales_format(df.columns.tolist())
        is_rk = (fmt == 'RKExcel')

        seen_asins: set = set()
        new_products = []
        preview_rows = []
        valid_rows = 0

        for idx, row in df.iterrows():
            asin = safe_str(row.get('ASIN'), 20)
            # RK Excel uses 'SKU' column; VendorCSV uses 'Model Number'
            if is_rk:
                model_number = safe_str(row.get('SKU'), 50)
            else:
                model_number = safe_str(row.get('Model Number') or row.get('ModelNumber'), 50)
            if not asin and not model_number:
                continue
            valid_rows += 1

            # Collect preview row data — map columns per format
            if is_rk:
                preview_rows.append({
                    'rowNumber': idx + 1,
                    'asin': asin or None,
                    'productTitle': safe_str(model_number, 255),  # use SKU as title proxy
                    'orderedUnits': safe_int(row.get('DRR(D-1)')),
                    'orderedRevenue': safe_float(row.get('Net Shipped GMS(D-1)')),
                    'shippedUnits': safe_int(row.get('Sellable')),
                    'shippedRevenue': None,
                })
            else:
                preview_rows.append({
                    'rowNumber': idx + 1,
                    'asin': asin or None,
                    'productTitle': safe_str(row.get('Product Title') or row.get('Title'), 255),
                    'orderedUnits': safe_int(row.get('Ordered Units')),
                    'orderedRevenue': safe_float(row.get('Ordered Revenue')),
                    'shippedUnits': safe_int(row.get('Shipped Units')),
                    'shippedRevenue': safe_float(row.get('Shipped Revenue')),
                })

            identifier = asin or model_number
            if identifier in seen_asins:
                continue
            seen_asins.add(identifier)
            exists = False
            if asin:
                exists = db.query(Product).filter(Product.AmazonId == asin).first() is not None
            if not exists and model_number:
                exists = db.query(Product).filter(Product.AsgSku == model_number).first() is not None
            if not exists:
                sku = model_number if (model_number and model_number.lower() != 'nan') else f"UNLINKED-AMZN-{asin}"
                placeholder = sku[:50]
                ph_exists = db.query(Product).filter(Product.AsgSku == placeholder).first() is not None
                if not ph_exists:
                    new_products.append({
                        'asin': asin or None,
                        'modelNumber': model_number or None,
                        'productTitle': safe_str(row.get('Product Title') or row.get('Title') or model_number, 255),
                        'placeholderSku': placeholder,
                    })

        # Check for duplicate data (same date already uploaded)
        duplicate_warning = None
        if date_found and detected_date:
            from sqlalchemy import func
            existing_count = db.query(func.count(AmazonSalesData.Id)).filter(
                AmazonSalesData.ReportDate == detected_date
            ).scalar()
            if existing_count > 0:
                duplicate_warning = f"Found {existing_count} existing sales records for {detected_date.strftime('%Y-%m-%d')}. This data may already be uploaded."

        return {
            'success': True,
            'validRows': valid_rows,
            'previewRows': preview_rows,
            'newProducts': new_products,
            'newFacilities': [],
            'detectedDate': detected_date.isoformat() if date_found else None,
            'duplicateDataWarning': duplicate_warning,
            'salesFormat': fmt,  # 'VendorCSV' or 'RKExcel'
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


# ============================================================
# ENDPOINT 1: Amazon Sales Upload (AmazonSales.csv or RK Excel)
# ============================================================
@router.post("/sales")
async def upload_amazon_sales(
    file: UploadFile = File(...),
    report_date_override: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload Amazon sales data — auto-detects VendorCSV vs RK Excel format."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    contents = await file.read()
    filename = file.filename or "unknown.csv"
    logger.info(f"[Upload] Amazon sales upload started: file={filename}, size={len(contents)} bytes, user={current_user.Email}")

    # Extract report date from metadata (CSV) or use today
    extracted_date, date_found = extract_date_from_metadata(contents, filename)
    logger.info(f"[Upload] Date extraction: detected={extracted_date}, found_in_file={date_found}, override={report_date_override}")

    # Allow caller to override the report date (e.g. when CSV has no metadata date)
    if report_date_override:
        try:
            report_date = datetime.strptime(report_date_override, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid report_date_override format. Use YYYY-MM-DD")
    else:
        report_date = extracted_date

    logger.info(f"[Upload] Using report_date={report_date}")

    # For RK Excel, handle multi-sheet
    if filename.endswith('.xlsx') or filename.endswith('.xls'):
        logger.info(f"[Upload] Detected Excel file — processing as RK Excel (multi-sheet)")
        return await _upload_rk_excel(contents, filename, db, user_id=current_user.Id)

    # For CSV — VendorCSV format
    df = read_file(contents, filename, skiprows=1)
    source_format = detect_sales_format(df.columns.tolist())
    logger.info(f"[Upload] CSV detected format={source_format}, total_rows={len(df)}, columns={df.columns.tolist()}")

    if source_format == 'VendorCSV':
        return _upload_vendor_csv(df, report_date, db, filename=filename, user_id=current_user.Id)
    else:
        return _upload_rk_excel_sheet(df, report_date, db)


def _upload_vendor_csv(df: pd.DataFrame, report_date: date, db: Session, filename: str = "unknown", user_id: int = None) -> dict:
    """Process AmazonSales.csv (Vendor Central format)."""
    rows_processed = 0
    rows_skipped = 0
    errors = []
    auto_created_products = 0
    seen_asins: set = set()

    logger.info(f"[VendorCSV] Starting processing: report_date={report_date}, total_df_rows={len(df)}")

    # AGGREGATION: Group duplicate ASINs and sum numeric columns
    # This prevents unique constraint violations when CSV contains multiple rows for same ASIN
    if 'ASIN' in df.columns and len(df) > 0:
        original_rows = len(df)

        # Define aggregation rules
        numeric_cols = ['Ordered Units', 'Ordered Revenue', 'Shipped Units', 'Shipped Revenue',
                       'Shipped COGS', 'Customer Returns', 'Unfilled Customer Ordered Units',
                       'Confirmed Units', 'Net Ordered GMS', 'Net Shipped GMS']

        agg_dict = {}
        for col in df.columns:
            if col == 'ASIN':
                continue  # This is the grouping key
            elif col in numeric_cols:
                agg_dict[col] = 'sum'  # Sum numeric values
            else:
                agg_dict[col] = 'first'  # Take first non-null value for metadata

        # Group by ASIN and aggregate
        df = df.groupby('ASIN', as_index=False).agg(agg_dict)

        aggregated_rows = len(df)
        if aggregated_rows < original_rows:
            logger.info(f"[VendorCSV] Aggregated {original_rows} rows → {aggregated_rows} unique ASINs (removed {original_rows - aggregated_rows} duplicates)")

    logger.info(f"[VendorCSV] Processing {len(df)} unique ASIN rows")

    for idx, row in df.iterrows():
        try:
            asin = safe_str(row.get('ASIN'), 20)
            if not asin:
                rows_skipped += 1
                logger.debug(f"[VendorCSV] Row {idx+2}: skipped — no ASIN")
                continue

            # Auto-create product if this ASIN is not in Products master
            if _ensure_product_amazon(
                db, asin,
                safe_str(row.get('Product Title'), 255),
                safe_str(row.get('Brand'), 100),
                safe_str(row.get('Category'), 100),
                seen_asins,
                model_number=safe_str(row.get('Model Number') or row.get('ModelNumber'), 50),
            ):
                auto_created_products += 1

            ordered_units = safe_int(row.get('Ordered Units'))

            # Check for duplicate
            existing = db.query(AmazonSalesData).filter(
                AmazonSalesData.ReportDate == report_date,
                AmazonSalesData.ASIN == asin,
                AmazonSalesData.SourceFile == 'VendorCSV'
            ).first()

            if existing:
                rows_skipped += 1
                logger.debug(f"[VendorCSV] Row {idx+2}: skipped — duplicate ASIN={asin} on {report_date}")
                continue

            record = AmazonSalesData(
                ReportDate=report_date,
                SourceFile='VendorCSV',
                ASIN=asin,
                SKU=safe_str(row.get('Model Number'), 100),
                Brand=safe_str(row.get('Brand'), 100),
                ProductTitle=safe_str(row.get('Product Title'), 500),
                BrandCode=safe_str(row.get('Brand Code'), 50),
                Category=safe_str(row.get('Category'), 200),
                Subcategory=safe_str(row.get('Subcategory'), 200),
                ParentASIN=safe_str(row.get('Parent ASIN'), 20),
                UPC=safe_str(row.get('UPC'), 50),
                EAN=safe_str(row.get('EAN'), 50),
                ISBN=safe_str(row.get('ISBN'), 50),
                ManufacturerCode=safe_str(row.get('Manufacturer Code'), 50),
                MSRP=clean_numeric(row.get('MSRP')) or None,
                Binding=safe_str(row.get('Binding'), 100),
                Colour=safe_str(row.get('Colour'), 100),
                ReleaseDate=safe_str(row.get('Release Date'), 50),
                ReplenishmentCode=safe_str(row.get('Replenishment Code'), 50),
                # Revenue & Sales
                OrderedRevenue=clean_numeric(row.get('Ordered Revenue')) or None,
                OrderedUnits=ordered_units,
                ShippedRevenue=clean_numeric(row.get('Shipped Revenue')) or None,
                ShippedCOGS=clean_numeric(row.get('Shipped COGS')) or None,
                ShippedUnits=safe_int(row.get('Shipped Units')),
                CustomerReturns=safe_int(row.get('Customer Returns')),
                UnfilledCustomerOrderedUnits=safe_int(row.get('Unfilled Customer Ordered Units')),
                ConfirmedUnits=safe_int(row.get('Confirmed Units')),
                NetOrderedGMS=clean_numeric(row.get('Net Ordered GMS')) or None,
                NetShippedGMS=clean_numeric(row.get('Net Shipped GMS')) or None,
                NetPPMPercent=clean_percentage(row.get('Net PPM %')) or None,
                ASINConfirmationPercent=clean_percentage(row.get('ASIN Confirmation %')) or None,
                # Computed DRR from OrderedUnits
                DRR_D1=float(ordered_units) if ordered_units else None,
                DRR_7Days=float(ordered_units * 7) if ordered_units else None,
                DRR_30Days=float(ordered_units * 30) if ordered_units else None,
                # Net Shipped GMS also goes to the shared column
                NetShippedGMS_D1=clean_numeric(row.get('Net Shipped GMS')) or None,
            )
            db.add(record)
            rows_processed += 1
            logger.debug(f"[VendorCSV] Row {idx+2}: queued ASIN={asin}, units={ordered_units}")

        except Exception as e:
            rows_skipped += 1
            logger.error(f"[VendorCSV] Row {idx+2}: ERROR — {type(e).__name__}: {e}")
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    logger.info(f"[VendorCSV] Pre-commit summary: rows_processed={rows_processed}, rows_skipped={rows_skipped}, auto_products={auto_created_products}, errors={len(errors)}")

    try:
        log_upload(db, "AmazonSales", "Amazon", filename, 0, user_id,
                   total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
        log_audit(db, user_id, "UPLOAD", "AmazonSales", None,
                  new_values={"type": "VendorCSV", "file": filename, "rows": rows_processed})
        db.commit()
        logger.info(f"[VendorCSV] db.commit() SUCCESS — {rows_processed} rows saved to AmazonSales")
    except Exception as commit_err:
        db.rollback()
        logger.error(f"[VendorCSV] db.commit() FAILED — {type(commit_err).__name__}: {commit_err}")
        raise HTTPException(status_code=500, detail=f"Database commit failed: {commit_err}")

    msg = f"Amazon VendorCSV sales uploaded: {rows_processed} rows processed, {rows_skipped} skipped"
    if auto_created_products:
        msg += f", {auto_created_products} new products auto-created (needs ASG SKU mapping)"
    return {
        "success": True,
        "message": msg,
        "data": {
            "source_format": "VendorCSV (AmazonSales.csv)",
            "report_date": report_date.isoformat(),
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "auto_created_products": auto_created_products,
            "errors": errors
        }
    }


async def _upload_rk_excel(contents: bytes, filename: str, db: Session, user_id: int = None) -> dict:
    """Process RK Inventory & Sale Report Excel (multi-sheet, each sheet = 1 date)."""
    xl = pd.ExcelFile(io.BytesIO(contents))
    total_processed = 0
    total_skipped = 0
    total_auto_created = 0
    sheets_processed = 0
    errors = []

    logger.info(f"[RKExcel] Starting: filename={filename}, sheets={xl.sheet_names}")

    for sheet_name in xl.sheet_names:
        try:
            # Parse sheet date from name (format: DD.MM.YY)
            report_date = _parse_sheet_date(sheet_name)
            if not report_date:
                logger.warning(f"[RKExcel] Sheet '{sheet_name}': skipped — cannot parse date from sheet name")
                continue

            df = xl.parse(sheet_name)
            if df.empty:
                logger.warning(f"[RKExcel] Sheet '{sheet_name}': skipped — empty sheet")
                continue

            logger.info(f"[RKExcel] Sheet '{sheet_name}': report_date={report_date}, rows={len(df)}")
            result = _upload_rk_excel_sheet(df, report_date, db)
            total_processed += result.get('rows_processed', 0)
            total_skipped += result.get('rows_skipped', 0)
            total_auto_created += result.get('auto_created_products', 0)
            sheets_processed += 1
            logger.info(f"[RKExcel] Sheet '{sheet_name}': processed={result.get('rows_processed',0)}, skipped={result.get('rows_skipped',0)}")

        except Exception as e:
            logger.error(f"[RKExcel] Sheet '{sheet_name}': ERROR — {type(e).__name__}: {e}")
            if len(errors) < 10:
                errors.append(f"Sheet '{sheet_name}': {str(e)}")

    logger.info(f"[RKExcel] Pre-commit: sheets={sheets_processed}, total_processed={total_processed}, total_skipped={total_skipped}")

    try:
        log_upload(db, "AmazonSales", "Amazon", filename, 0, user_id,
                   total_rows=total_processed + total_skipped, success_rows=total_processed, error_rows=total_skipped, status="Success")
        log_audit(db, user_id, "UPLOAD", "AmazonSales", None,
                  new_values={"type": "RKExcel", "file": filename, "rows": total_processed, "sheets": sheets_processed})
        db.commit()
        logger.info(f"[RKExcel] db.commit() SUCCESS — {total_processed} rows saved to AmazonSales")
    except Exception as commit_err:
        db.rollback()
        logger.error(f"[RKExcel] db.commit() FAILED — {type(commit_err).__name__}: {commit_err}")
        raise HTTPException(status_code=500, detail=f"Database commit failed: {commit_err}")

    msg = f"RK Excel uploaded: {sheets_processed} sheets, {total_processed} rows processed"
    if total_auto_created:
        msg += f", {total_auto_created} new products auto-created (needs ASG SKU mapping)"
    return {
        "success": True,
        "message": msg,
        "data": {
            "source_format": "RKExcel (RK Inventory & Sale Report)",
            "sheets_processed": sheets_processed,
            "rows_processed": total_processed,
            "rows_skipped": total_skipped,
            "auto_created_products": total_auto_created,
            "errors": errors
        }
    }


def _parse_sheet_date(sheet_name: str) -> date:
    """Parse sheet name like '28.11.25' to date 2025-11-28."""
    try:
        return datetime.strptime(sheet_name.strip(), '%d.%m.%y').date()
    except ValueError:
        return None


def _upload_rk_excel_sheet(df: pd.DataFrame, report_date: date, db: Session) -> dict:
    """Process a single RK Excel sheet (or CSV detected as RKExcel format)."""
    rows_processed = 0
    rows_skipped = 0
    auto_created_products = 0
    seen_asins: set = set()
    logger.info(f"[RKSheet] Processing sheet: report_date={report_date}, rows={len(df)}")

    # AGGREGATION: Group duplicate ASINs before processing
    # This prevents unique constraint violations on (ReportDate, ASIN, SourceFile)
    if len(df) > 0:
        original_rows = len(df)
        # First normalize column names to detect ASIN column
        asin_col = None
        for c in df.columns:
            if str(c).strip().lower() == 'asin':
                asin_col = c
                break

        if asin_col and asin_col in df.columns:
            # Define numeric columns that should be summed
            numeric_patterns = ['drr', 'sellable', 'doh', 'open po', 'openpo', 'asp',
                               'net shipped', 'sale spike', 'doc', 'oos']

            agg_dict = {}
            for col in df.columns:
                if col == asin_col:
                    continue  # Grouping key
                col_lower = str(col).lower()
                # Check if column should be summed (numeric) or take first value (metadata)
                is_numeric = any(pattern in col_lower for pattern in numeric_patterns)
                agg_dict[col] = 'sum' if is_numeric else 'first'

            # Group by ASIN and aggregate
            df = df.groupby(asin_col, as_index=False).agg(agg_dict)

            aggregated_rows = len(df)
            if aggregated_rows < original_rows:
                logger.info(f"[RKSheet] Aggregated {original_rows} rows → {aggregated_rows} unique ASINs (removed {original_rows - aggregated_rows} duplicates)")

    logger.info(f"[RKSheet] Processing {len(df)} unique ASIN rows")

    # Normalize column names
    col_map = {}
    for c in df.columns:
        cl = str(c).strip().lower()
        if cl == 'asin':
            col_map['asin'] = c
        elif cl in ('sku', 'sku '):
            col_map['sku'] = c
        elif cl == 'brand':
            col_map['brand'] = c
        elif cl == 'asp':
            col_map['asp'] = c
        elif cl == 'gl':
            col_map['gl'] = c
        elif cl == 'vm':
            col_map['vm'] = c
        elif cl in ('vendor code', 'vendorcode'):
            col_map['vendor_code'] = c
        elif 'drr' in cl and 'd-1' in cl:
            col_map['drr_d1'] = c
        elif '7' in cl and 'drr' in cl:
            col_map['drr_7'] = c
        elif '3' in cl and 'drr' in cl:
            col_map['drr_3'] = c
        elif '30' in cl and 'drr' in cl:
            col_map['drr_30'] = c
        elif 'net shipped' in cl:
            col_map['net_shipped'] = c
        elif 'sale spike' in cl:
            col_map['sale_spike'] = c
        elif cl == 'sellable':
            col_map['sellable'] = c
        elif cl == 'doh':
            col_map['doh'] = c
        elif cl in ('open po', 'openpo'):
            col_map['open_po'] = c
        elif cl == 'appointment':
            col_map['appointment'] = c
        elif 'days till' in cl:
            col_map['days_till'] = c
        elif cl in ('doc_', 'doc'):
            col_map['doc'] = c
        elif 'oos last' in cl:
            col_map['oos_last'] = c
        elif 'oos 4w' in cl:
            col_map['oos_4w'] = c

    for idx, row in df.iterrows():
        try:
            asin = safe_str(row.get(col_map.get('asin', 'ASIN')), 20)
            if not asin:
                rows_skipped += 1
                continue

            # Auto-create product if this ASIN is not in Products master
            # RK Excel uses 'sku' col_map key (not 'model_number')
            if _ensure_product_amazon(
                db, asin, None,
                safe_str(row.get(col_map.get('brand', 'Brand')), 100),
                None, seen_asins,
                model_number=safe_str(row.get(col_map.get('sku', 'SKU')), 50),
            ):
                auto_created_products += 1

            # Check for duplicate
            existing = db.query(AmazonSalesData).filter(
                AmazonSalesData.ReportDate == report_date,
                AmazonSalesData.ASIN == asin,
                AmazonSalesData.SourceFile == 'RKExcel'
            ).first()

            if existing:
                rows_skipped += 1
                continue

            record = AmazonSalesData(
                ReportDate=report_date,
                SourceFile='RKExcel',
                ASIN=asin,
                SKU=safe_str(row.get(col_map.get('sku', 'SKU')), 100),
                Brand=safe_str(row.get(col_map.get('brand', 'Brand')), 100),
                ASP=clean_numeric(row.get(col_map.get('asp', 'ASP'))) or None,
                GL=safe_str(row.get(col_map.get('gl', 'GL')), 50),
                VM=safe_str(row.get(col_map.get('vm', 'VM')), 50),
                VendorCode=safe_str(row.get(col_map.get('vendor_code', 'Vendor Code')), 50),
                DRR_D1=clean_numeric(row.get(col_map.get('drr_d1', 'DRR(D-1)'))) or None,
                DRR_7Days=clean_numeric(row.get(col_map.get('drr_7', '7 days DRR'))) or None,
                DRR_3Days=clean_numeric(row.get(col_map.get('drr_3', '3 days DRR'))) or None,
                DRR_30Days=clean_numeric(row.get(col_map.get('drr_30', '30 days DRR'))) or None,
                NetShippedGMS_D1=clean_numeric(row.get(col_map.get('net_shipped', 'Net Shipped GMS(D-1)'))) or None,
                SaleSpike_D1=clean_numeric(row.get(col_map.get('sale_spike', 'Sale spike(D-1)'))) or None,
                Sellable=safe_int(row.get(col_map.get('sellable', 'Sellable'))),
                DOH=clean_numeric(row.get(col_map.get('doh', 'DOH'))) or None,
                OpenPO=safe_int(row.get(col_map.get('open_po', 'open PO'))),
                Appointment=safe_str(row.get(col_map.get('appointment', 'Appointment')), 200),
                DaysTillNextAppointment=safe_int(row.get(col_map.get('days_till', 'Days till next appointment'))),
                DOC=clean_numeric(row.get(col_map.get('doc', 'DOC_'))) or None,
                OOSLastWeek=clean_numeric(row.get(col_map.get('oos_last', 'OOS last week'))) or None,
                OOS4wWeek=clean_numeric(row.get(col_map.get('oos_4w', 'OOS 4w week'))) or None,
            )
            db.add(record)
            rows_processed += 1

        except Exception as e:
            rows_skipped += 1
            logger.error(f"[RKSheet] Row {idx+2}: ERROR — {type(e).__name__}: {e}")

    logger.info(f"[RKSheet] Done: rows_processed={rows_processed}, rows_skipped={rows_skipped}, auto_products={auto_created_products}")
    return {"rows_processed": rows_processed, "rows_skipped": rows_skipped, "auto_created_products": auto_created_products}


# ============================================================
# PREVIEW 2: Amazon Inventory — dry-run validation
# ============================================================
@router.post("/inventory/preview")
async def preview_amazon_inventory(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dry-run: parse Amazon Inventory CSV and return new products that would be auto-created.
    Does NOT write to the database. Admin/Manager only.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    try:
        contents = await file.read()
        filename = file.filename or "unknown.csv"

        # Detect report date (so UI can warn if not found)
        detected_date, date_found = extract_date_from_metadata(contents, filename)

        df = read_file(contents, filename, skiprows=1)

        seen_asins: set = set()
        new_products = []
        preview_rows = []
        valid_rows = 0

        for idx, row in df.iterrows():
            asin = safe_str(row.get('ASIN'), 20)
            if not asin:
                continue
            valid_rows += 1

            # Collect preview row data (handle multiple column name variations)
            # Helper: get first non-None value from column name variations
            def get_first_value(*col_names):
                for col in col_names:
                    val = row.get(col)
                    if val is not None and not pd.isna(val):
                        return val
                return None

            preview_rows.append({
                'rowNumber': idx + 1,
                'asin': asin or None,
                'productTitle': safe_str(row.get('Product Title'), 255),
                'sellableQuantity': safe_int(get_first_value(
                    'Sellable On Hand Units',
                    'Sellable On-Hand Units',
                    'Sellable'
                )),
                'unfulfilledQuantity': safe_int(get_first_value(
                    'Unsellable On-Hand Units',
                    'Unsellable On Hand Units',
                    'Unfulfillable'
                )),
                'reservedQuantity': safe_int(get_first_value(
                    'Sellable In Transit Units',
                    'Reserved FC Transfers',
                    'Reserved'
                )),
            })

            if asin in seen_asins:
                continue
            seen_asins.add(asin)
            exists = db.query(Product).filter(Product.AmazonId == asin).first() is not None
            if not exists:
                model_number = safe_str(row.get('Model Number') or row.get('ModelNumber'), 50)
                if model_number:
                    exists = db.query(Product).filter(Product.AsgSku == model_number).first() is not None
            if not exists:
                placeholder = f"UNLINKED-AMZN-{asin}"[:50]
                ph_exists = db.query(Product).filter(Product.AsgSku == placeholder).first() is not None
                if not ph_exists:
                    new_products.append({
                        'asin': asin,
                        'modelNumber': safe_str(row.get('Model Number') or row.get('ModelNumber'), 50) or None,
                        'productTitle': safe_str(row.get('Product Title'), 255),
                        'placeholderSku': placeholder,
                    })

        # Check for duplicate data (same date already uploaded)
        duplicate_warning = None
        if date_found and detected_date:
            from sqlalchemy import func
            existing_count = db.query(func.count(AmazonInventoryData.Id)).filter(
                AmazonInventoryData.ReportDate == detected_date
            ).scalar()
            if existing_count > 0:
                duplicate_warning = f"Found {existing_count} existing inventory records for {detected_date.strftime('%Y-%m-%d')}. This data may already be uploaded."

        return {
            'success': True,
            'validRows': valid_rows,
            'previewRows': preview_rows,
            'newProducts': new_products,
            'newFacilities': [],
            'detectedDate': detected_date.isoformat() if date_found else None,
            'duplicateDataWarning': duplicate_warning,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


# ============================================================
# ENDPOINT 2: Amazon Inventory Upload (Vendor Central CSV)
# ============================================================
@router.post("/inventory")
async def upload_amazon_inventory(
    file: UploadFile = File(...),
    report_date_override: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload Amazon Vendor Central inventory CSV to AmazonInventory table."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    contents = await file.read()
    filename = file.filename or "unknown.csv"

    extracted_date, _ = extract_date_from_metadata(contents, filename)

    # Allow caller to override the report date (e.g. when CSV has no metadata date)
    if report_date_override:
        try:
            report_date = datetime.strptime(report_date_override, '%Y-%m-%d').date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid report_date_override format. Use YYYY-MM-DD")
    else:
        report_date = extracted_date

    df = read_file(contents, filename, skiprows=1)

    rows_processed = 0
    rows_skipped = 0
    errors = []
    auto_created_products = 0
    seen_asins: set = set()

    for idx, row in df.iterrows():
        try:
            asin = safe_str(row.get('ASIN'), 20)
            if not asin:
                rows_skipped += 1
                continue

            # Auto-create product if this ASIN is not in Products master
            if _ensure_product_amazon(
                db, asin,
                safe_str(row.get('Product Title'), 255),
                safe_str(row.get('Brand'), 100),
                safe_str(row.get('Category'), 100),
                seen_asins,
                model_number=safe_str(row.get('Model Number') or row.get('ModelNumber'), 50),
            ):
                auto_created_products += 1

            # Check for duplicate
            existing = db.query(AmazonInventoryData).filter(
                AmazonInventoryData.ReportDate == report_date,
                AmazonInventoryData.ASIN == asin
            ).first()

            if existing:
                rows_skipped += 1
                continue

            record = AmazonInventoryData(
                ReportDate=report_date,
                ASIN=asin,
                ProductTitle=safe_str(row.get('Product Title'), 500),
                BrandCode=safe_str(row.get('Brand Code'), 50),
                Brand=safe_str(row.get('Brand'), 100),
                Category=safe_str(row.get('Category'), 200),
                Subcategory=safe_str(row.get('Subcategory'), 200),
                ParentASIN=safe_str(row.get('Parent ASIN'), 20),
                UPC=safe_str(row.get('UPC'), 50),
                EAN=safe_str(row.get('EAN'), 50),
                ISBN=safe_str(row.get('ISBN'), 50),
                ModelNumber=safe_str(row.get('Model Number'), 100),
                MSRP=clean_numeric(row.get('MSRP')) or None,
                Binding=safe_str(row.get('Binding'), 100),
                Colour=safe_str(row.get('Colour'), 100),
                ReleaseDate=safe_str(row.get('Release Date'), 50),
                ReplenishmentCode=safe_str(row.get('Replenishment Code'), 50),
                ManufacturerCode=safe_str(row.get('Manufacturer Code'), 50),
                SourceableProductOOSPercent=clean_percentage(row.get('Sourceable Product OOS %')) or None,
                ProcurableProductOOSPercent=clean_percentage(row.get('Procurable Product OOS %')) or None,
                VendorConfirmationPercent=clean_percentage(row.get('Vendor Confirmation %')) or None,
                NetReceived=clean_numeric(row.get('Net Received')) or None,
                NetReceivedUnits=safe_int(row.get('Net Received Units')),
                OpenPurchaseOrderQuantity=safe_int(row.get('Open Purchase Order Quantity')),
                ReceiveFillPercent=clean_percentage(row.get('Receive Fill %')) or None,
                OverallVendorLeadTimeDays=safe_int(row.get('Overall Vendor Lead Time (days)')),
                UnfilledCustomerOrderedUnits=safe_int(row.get('Unfilled Customer Ordered Units')),
                Aged90PlusDaysSellableInventory=clean_numeric(row.get('Aged 90+ Days Sellable Inventory')) or None,
                Aged90PlusDaysSellableUnits=safe_int(row.get('Aged 90+ Days Sellable Units')),
                SellableOnHandInventory=clean_numeric(row.get('Sellable On-Hand Inventory')) or None,
                SellableOnHandUnits=safe_int(row.get('Sellable On Hand Units')),
                UnsellableOnHandInventory=clean_numeric(row.get('Unsellable On-Hand Inventory')) or None,
                UnsellableOnHandUnits=safe_int(row.get('Unsellable On-Hand Units')),
                ConfirmedUnits=safe_int(row.get('Confirmed Units')),
                NetOrderedGMS=clean_numeric(row.get('Net Ordered GMS')) or None,
                NetShippedGMS=clean_numeric(row.get('Net Shipped GMS')) or None,
                InTransitQuantity=safe_int(row.get('In Transit Quantity')),
                SellableInTransitUnits=safe_int(row.get('Sellable In Transit Units')),
                UnsellableInTransitUnits=safe_int(row.get('Unsellable In Transit Units')),
            )
            db.add(record)
            rows_processed += 1

        except Exception as e:
            rows_skipped += 1
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    log_upload(db, "AmazonInventory", "Amazon", file.filename, len(contents), current_user.Id,
               total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "AmazonInventory", None,
              new_values={"type": "AmazonInventory", "file": file.filename, "rows": rows_processed})
    db.commit()
    msg = f"Amazon inventory uploaded: {rows_processed} rows processed, {rows_skipped} skipped"
    if auto_created_products:
        msg += f", {auto_created_products} new products auto-created (needs ASG SKU mapping)"
    return {
        "success": True,
        "message": msg,
        "data": {
            "report_date": report_date.isoformat(),
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "auto_created_products": auto_created_products,
            "errors": errors
        }
    }


# ============================================================
# PREVIEW 3: Amazon PO — dry-run validation (CSV/Excel)
# ============================================================
@router.post("/purchase-orders/preview")
async def preview_amazon_po(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Dry-run: parse Amazon PO CSV/Excel and return new products + ship-to info.
    Amazon FCs (ShipToLocationCode) are informational only — they are NOT created in our DB.
    Does NOT write to the database. Admin/Manager only.
    """
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    try:
        contents = await file.read()
        filename = file.filename or "unknown.csv"
        df = read_file(contents, filename)

        seen_asins: set = set()
        seen_po_numbers: set = set()
        new_products = []
        po_summary = []
        po_items = []
        valid_rows = 0

        for _, row in df.iterrows():
            po_number = safe_str(row.get('PONumber') or row.get('PO Number'), 30)
            asin = safe_str(row.get('ASIN'), 20)
            if not po_number or not asin:
                continue
            valid_rows += 1

            # Summarise unique POs
            if po_number not in seen_po_numbers:
                seen_po_numbers.add(po_number)
                po_summary.append({
                    'poNumber': po_number,
                    'shipToLocationCode': safe_str(row.get('ShipToLocationCode'), 50),
                    'shipToCity': safe_str(row.get('ShipToCity'), 100),
                    'shipToState': safe_str(row.get('ShipToState'), 100),
                    'status': safe_str(row.get('Status'), 50),
                    'orderedOnDate': safe_str(row.get('OrderedOnDate') or row.get('OrderDate'), 20),
                    'paymentTerms': safe_str(row.get('PaymentTerms'), 100),
                })

            # Full line-item detail for the preview table
            po_items.append({
                'poNumber': po_number,
                'asin': asin,
                'externalId': safe_str(row.get('ExternalId') or row.get('External Id'), 50),
                'modelNumber': safe_str(row.get('ModelNumber') or row.get('Model Number'), 50),
                'hsn': safe_str(row.get('HSN'), 20),
                'title': safe_str(row.get('Title') or row.get('Product Name'), 255),
                'status': safe_str(row.get('Status'), 50),
                'cancellationStatus': safe_str(row.get('CancellationStatus'), 50),
                'windowType': safe_str(row.get('WindowType') or row.get('Window Type'), 50),
                'expectedDate': safe_str(row.get('ExpectedDate') or row.get('ExpectedDeliveryDate'), 20),
                'quantityRequested': safe_int(row.get('QuantityRequested') or row.get('Quantity Requested')),
                'acceptedQuantity': safe_int(row.get('AcceptedQuantity') or row.get('Accepted quantity')),
                'quantityReceived': safe_int(row.get('QuantityReceived') or row.get('Quantity received')),
                'quantityOutstanding': safe_int(row.get('QuantityOutstanding') or row.get('Quantity Outstanding')),
                'unitCost': clean_numeric(row.get('UnitCost') or row.get('Unit Cost')) or None,
                'totalCost': clean_numeric(row.get('TotalCost') or row.get('Total cost')) or None,
            })

            # Check product mapping
            if asin not in seen_asins:
                seen_asins.add(asin)
                exists = db.query(Product).filter(Product.AmazonId == asin).first() is not None
                if not exists:
                    model_number = safe_str(row.get('ModelNumber') or row.get('Model Number'), 50)
                    if model_number:
                        exists = db.query(Product).filter(Product.AsgSku == model_number).first() is not None
                if not exists:
                    placeholder = f"UNLINKED-AMZN-{asin}"[:50]
                    ph_exists = db.query(Product).filter(Product.AsgSku == placeholder).first() is not None
                    if not ph_exists:
                        new_products.append({
                            'asin': asin,
                            'modelNumber': safe_str(row.get('ModelNumber') or row.get('Model Number'), 50) or None,
                            'productTitle': safe_str(row.get('Title'), 255),
                            'placeholderSku': placeholder,
                        })

        return {
            'success': True,
            'validRows': valid_rows,
            'newProducts': new_products,
            'newFacilities': [],
            'poSummary': po_summary,
            'poItems': po_items,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


# ============================================================
# ENDPOINT 3: Amazon PO Upload (from PO PDFs → CSV/Excel)
# ============================================================
@router.post("/purchase-orders")
async def upload_amazon_po(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload Amazon PO data (manually created from PO PDFs) to AmazonPO + AmazonPOItem tables."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    contents = await file.read()
    filename = file.filename or "unknown.csv"
    df = read_file(contents, filename)

    rows_processed = 0
    rows_skipped = 0
    po_created = 0
    errors = []
    packing_items = []  # (asin, title, qty_requested) for packing check
    products_created = []
    warehouses_created = []

    for idx, row in df.iterrows():
        try:
            po_number = safe_str(row.get('PONumber') or row.get('PO Number'), 30)
            asin = safe_str(row.get('ASIN'), 20)
            if not po_number or not asin:
                rows_skipped += 1
                continue

            # Find or create PO header
            po = db.query(AmazonPOData).filter(AmazonPOData.PONumber == po_number).first()
            if not po:
                ship_to_code = safe_str(row.get('ShipToLocationCode'), 50)
                ship_to_city = safe_str(row.get('ShipToCity'), 100)
                ship_to_state = safe_str(row.get('ShipToState'), 100)

                po = AmazonPOData(
                    PONumber=po_number,
                    POStatus=safe_str(row.get('Status') or row.get('POStatus'), 50),
                    VendorCode=safe_str(row.get('VendorCode') or row.get('Vendor'), 50),
                    ShipToLocationCode=ship_to_code,
                    ShipToCity=ship_to_city,
                    ShipToState=ship_to_state,
                    OrderedOnDate=_parse_date(row.get('OrderedOnDate') or row.get('OrderDate')),
                    PaymentTerms=safe_str(row.get('PaymentTerms'), 100),
                    PurchasingEntityName=safe_str(row.get('PurchasingEntityName'), 200),
                )
                db.add(po)
                db.flush()
                po_created += 1

                # Auto-create warehouse from ShipTo data
                wh_name = ship_to_code or ship_to_city
                if wh_name:
                    wh_id, wh_created = find_or_create_warehouse(
                        db, wh_name, channel="Amazon",
                        city=ship_to_city, state=ship_to_state,
                    )
                    if wh_created:
                        warehouses_created.append({"name": wh_name, "code": wh_name.upper().replace(' ', '-')[:50]})

            # Auto-create product from ASIN if not found
            model_number = safe_str(row.get('ModelNumber') or row.get('Model Number'), 100)
            title = safe_str(row.get('Title') or row.get('Product Name'), 500)
            existing_product = db.query(Product).filter(Product.AmazonId == asin).first()
            if not existing_product and model_number:
                existing_product = db.query(Product).filter(Product.AsgSku == model_number).first()

            product = find_or_create_product(
                db, asin=asin, model_number=model_number, product_title=title,
            )
            if not existing_product and product:
                products_created.append({"name": title or asin, "sku": product.AsgSku, "amazon_id": asin})

            # Create line item
            item = AmazonPOItemData(
                POId=po.Id,
                PONumber=po_number,
                ASIN=asin,
                ProductId=product.Id if product else None,
                ExternalId=safe_str(row.get('ExternalId') or row.get('External Id'), 50),
                ModelNumber=model_number,
                HSN=safe_str(row.get('HSN'), 20),
                Title=title,
                CancellationStatus=safe_str(row.get('CancellationStatus'), 50),
                CancellationDate=_parse_date(row.get('CancellationDate')),
                WindowType=safe_str(row.get('WindowType') or row.get('Window Type'), 50),
                ExpectedDate=_parse_date(row.get('ExpectedDate') or row.get('Expected date')),
                QuantityRequested=safe_int(row.get('QuantityRequested') or row.get('Quantity Requested')),
                AcceptedQuantity=safe_int(row.get('AcceptedQuantity') or row.get('Accepted quantity')),
                QuantityReceived=safe_int(row.get('QuantityReceived') or row.get('Quantity received')),
                QuantityOutstanding=safe_int(row.get('QuantityOutstanding') or row.get('Quantity Outstanding')),
                UnitCost=clean_numeric(row.get('UnitCost') or row.get('Unit Cost')) or None,
                TotalCost=clean_numeric(row.get('TotalCost') or row.get('Total cost')) or None,
            )
            db.add(item)
            rows_processed += 1

            # Collect for packing check
            qty = safe_int(row.get('QuantityRequested') or row.get('Quantity Requested'))
            if asin and qty:
                packing_items.append((asin, title, qty))

        except Exception as e:
            db.rollback()
            rows_skipped += 1
            if len(errors) < 10:
                errors.append(f"Row {idx + 2}: {str(e)}")

    log_upload(db, "AmazonPO", "Amazon", file.filename, len(contents), current_user.Id,
               total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "AmazonPO", None,
              new_values={"type": "AmazonPO", "file": file.filename, "rows": rows_processed, "pos": po_created})
    db.commit()
    packing_alerts = _get_packing_alerts_amazon(db, packing_items)
    return {
        "success": True,
        "message": f"Amazon PO uploaded: {po_created} POs, {rows_processed} line items",
        "data": {
            "po_created": po_created,
            "rows_processed": rows_processed,
            "rows_skipped": rows_skipped,
            "total_rows": len(df),
            "errors": errors,
            "packing_alerts": packing_alerts,
            "products_created": products_created,
            "warehouses_created": warehouses_created,
        }
    }


# ============================================================
# ENDPOINT 7: Amazon Sales Analytics (from AmazonSales table)
# ============================================================
@router.get("/analytics")
async def get_amazon_sales_analytics(
    days: int = Query(1825, ge=1, le=1825, description="Number of days to look back"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get analytics from the AmazonSales table (VendorCSV + RKExcel data).

    VendorCSV rows: OrderedUnits and OrderedRevenue populated.
    RKExcel rows:   OrderedUnits is NULL; DRR_D1 (daily run rate) is a separate metric.
    Only VendorCSV OrderedUnits are used for 'total units' — DRR is not ordered units.
    """
    end_dt = date.today()
    start_dt = end_dt - timedelta(days=days)
    start_dt_s = start_dt.isoformat()  # e.g. '2021-02-10'

    try:
        # Use raw T-SQL for all queries to guarantee MSSQL/pyodbc compatibility.
        # Only VendorCSV rows have OrderedUnits; RKExcel rows store DRR_D1 (daily run rate).
        # DRR is NOT ordered units, so we use ISNULL(OrderedUnits, 0) throughout.

        # ----- Total rows all-time (diagnostic: confirms table has data) -----
        total_records_all_time = int(
            db.execute(text("SELECT COUNT(*) FROM AmazonSales")).scalar() or 0
        )

        # ----- Summary stats -----
        summary_row = db.execute(text("""
            SELECT
                COUNT(*)                                        AS total_records,
                COUNT(DISTINCT CASE WHEN SourceFile = 'VendorCSV' AND OrderedUnits > 0 THEN ASIN END) AS active_products,
                SUM(ISNULL(OrderedUnits, 0))                    AS total_units,
                SUM(OrderedRevenue)                             AS total_revenue,
                MAX(ReportDate)                                 AS max_date
            FROM AmazonSales
            WHERE ReportDate >= :start_dt
        """), {"start_dt": start_dt_s}).fetchone()

        total_records_in_range = int(summary_row[0] or 0)
        active_products        = int(summary_row[1] or 0)
        total_units            = int(summary_row[2] or 0)
        total_revenue          = float(summary_row[3] or 0)
        max_date               = summary_row[4]  # Python date/datetime or None

        avg_units_per_product = round(total_units / active_products, 1) if active_products > 0 else 0

        # ----- Monthly growth -----
        monthly_growth = 0.0
        if max_date:
            max_date_d     = max_date.date() if hasattr(max_date, 'date') else max_date
            current_start  = max_date_d - timedelta(days=30)
            prev_start     = max_date_d - timedelta(days=60)

            growth_rows = db.execute(text("""
                SELECT
                    SUM(CASE WHEN ReportDate > :current_start AND ReportDate <= :max_date
                             THEN ISNULL(OrderedUnits, 0) END) AS current_units,
                    SUM(CASE WHEN ReportDate > :prev_start    AND ReportDate <= :current_start
                             THEN ISNULL(OrderedUnits, 0) END) AS prev_units
                FROM AmazonSales
                WHERE ReportDate > :prev_start AND ReportDate <= :max_date
            """), {
                "current_start": current_start.isoformat(),
                "max_date":      max_date_d.isoformat(),
                "prev_start":    prev_start.isoformat(),
            }).fetchone()

            current_u = float(growth_rows[0] or 0)
            prev_u    = float(growth_rows[1] or 0)
            if prev_u > 0:
                monthly_growth = round(((current_u - prev_u) / prev_u) * 100, 1)

        # ----- Top 10 products -----
        top_rows = db.execute(text("""
            SELECT TOP 10
                ASIN,
                MAX(ProductTitle)                               AS product_title,
                MAX(SKU)                                        AS sku,
                SUM(ISNULL(OrderedUnits, 0))                    AS total_units,
                SUM(OrderedRevenue)                             AS total_revenue
            FROM AmazonSales
            WHERE ReportDate >= :start_dt AND SourceFile = 'VendorCSV'
            GROUP BY ASIN
            ORDER BY SUM(ISNULL(OrderedUnits, 0)) DESC
        """), {"start_dt": start_dt_s}).fetchall()

        top_products = [
            {
                "asin":          row[0],
                "product_title": row[1] or row[2] or row[0],
                "total_units":   int(row[3] or 0),
                "total_revenue": float(row[4] or 0),
            }
            for row in top_rows
        ]

        # ----- Daily / Monthly trend -----
        # First try daily grouping; if only 1 distinct date exists fall back to monthly
        daily_rows = db.execute(text("""
            SELECT
                ReportDate,
                SUM(ISNULL(OrderedUnits, 0))          AS total_units,
                SUM(OrderedRevenue)                   AS total_revenue
            FROM AmazonSales
            WHERE ReportDate >= :start_dt AND SourceFile = 'VendorCSV'
            GROUP BY ReportDate
            ORDER BY ReportDate
        """), {"start_dt": start_dt_s}).fetchall()

        if len(daily_rows) > 1:
            daily_trend = [
                {
                    "date":          row[0].isoformat() if row[0] else None,
                    "total_units":   int(row[1] or 0),
                    "total_revenue": float(row[2] or 0),
                }
                for row in daily_rows
            ]
        else:
            # Fall back to monthly grouping so area chart renders with multiple points
            monthly_rows = db.execute(text("""
                SELECT
                    CONVERT(varchar(7), ReportDate, 120) AS month,
                    SUM(ISNULL(OrderedUnits, 0))          AS total_units,
                    SUM(OrderedRevenue)                   AS total_revenue
                FROM AmazonSales
                WHERE ReportDate IS NOT NULL AND SourceFile = 'VendorCSV'
                GROUP BY CONVERT(varchar(7), ReportDate, 120)
                ORDER BY CONVERT(varchar(7), ReportDate, 120)
            """)).fetchall()
            daily_trend = [
                {
                    "date":          row[0],
                    "total_units":   int(row[1] or 0),
                    "total_revenue": float(row[2] or 0),
                }
                for row in monthly_rows
            ]

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Amazon analytics query failed: {exc}"
        )

    return {
        "summary": {
            "total_units":              total_units,
            "total_revenue":            total_revenue,
            "active_products":          active_products,
            "avg_units_per_product":    avg_units_per_product,
            "monthly_growth":           monthly_growth,
            "total_records_in_range":   total_records_in_range,
            "total_records_all_time":   total_records_all_time,
            "date_range": {
                "start": start_dt.isoformat(),
                "end":   end_dt.isoformat(),
                "days":  days,
            }
        },
        "top_products": top_products,
        "daily_trend":  daily_trend,
    }


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
    return None


# ============================================================
# ENDPOINT 4: Amazon PO Status Update (manual)
# ============================================================
VALID_AMAZON_PO_STATUSES = [
    "Created", "Confirmed", "In Transit", "Partially Received",
    "Received", "Closed", "Cancelled"
]


@router.patch("/purchase-orders/{po_id}/status")
async def update_amazon_po_status(
    po_id: int,
    status: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Manually update Amazon PO status (e.g. Created → In Transit → Received)."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    if status not in VALID_AMAZON_PO_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_AMAZON_PO_STATUSES)}"
        )

    po = db.query(AmazonPOData).filter(AmazonPOData.Id == po_id).first()
    if not po:
        raise HTTPException(status_code=404, detail=f"Amazon PO with id {po_id} not found")

    old_status = po.POStatus
    po.POStatus = status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "AmazonPO", str(po.Id),
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
# ENDPOINT 5: Amazon PO PDF Extract (preview — no DB write)
# ============================================================
@router.post("/purchase-orders/extract-pdf")
async def extract_amazon_po_pdf(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Extract PO data from an Amazon Vendor Central PO PDF for preview."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    filename = file.filename or "unknown"
    if not filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF (.pdf)")

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    from app.services.amazon_pdf_parser import extract_amazon_po_from_pdf
    result = extract_amazon_po_from_pdf(contents)

    return result.to_dict()


# ============================================================
# ENDPOINT 6: Amazon PO PDF Confirm (save to DB)
# ============================================================
@router.post("/purchase-orders/confirm-pdf")
async def confirm_amazon_po_pdf(
    body: AmazonPOConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save verified Amazon PO data (from PDF extraction) to the database."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    header = body.header
    items = body.items

    if not header.po_number:
        raise HTTPException(status_code=400, detail="PO Number is required")

    # Check for duplicate PO
    existing = db.query(AmazonPOData).filter(AmazonPOData.PONumber == header.po_number).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"PO {header.po_number} already exists in the database (ID: {existing.Id})"
        )

    products_created = []
    warehouses_created = []

    # Create PO header
    po = AmazonPOData(
        PONumber=header.po_number,
        POStatus=safe_str(header.po_status or body.status, 50),
        VendorCode=safe_str(header.vendor_code, 50),
        ShipToLocationCode=safe_str(header.ship_to_location_code, 50),
        ShipToCity=safe_str(header.ship_to_city, 100),
        ShipToState=safe_str(header.ship_to_state, 100),
        OrderedOnDate=_parse_date(header.ordered_on_date),
        ShipWindowStartDate=_parse_date(header.ship_window_start_date),
        ShipWindowEndDate=_parse_date(header.ship_window_end_date),
        FreightTerms=safe_str(header.freight_terms, 50),
        PaymentMethod=safe_str(header.payment_method, 50),
        PaymentTerms=safe_str(header.payment_terms, 100),
        PurchasingEntityName=safe_str(header.purchasing_entity_name, 200),
        # Summary - Submitted
        SubmittedItems=header.submitted_items,
        SubmittedQuantity=header.submitted_quantity,
        SubmittedTotalCost=header.submitted_total_cost,
        # Summary - Accepted
        AcceptedItems=header.accepted_items,
        AcceptedQuantity=header.accepted_quantity,
        AcceptedTotalCost=header.accepted_total_cost,
        # Summary - Cancelled
        CancelledItems=header.cancelled_items,
        CancelledQuantity=header.cancelled_quantity,
        CancelledTotalCost=header.cancelled_total_cost,
        # Summary - Received
        ReceivedItems=header.received_items,
        ReceivedQuantity=header.received_quantity,
        ReceivedTotalCost=header.received_total_cost,
    )
    db.add(po)
    db.flush()

    # Auto-create warehouse from ShipTo data
    ship_to_code = safe_str(header.ship_to_location_code, 50)
    ship_to_city = safe_str(header.ship_to_city, 100)
    ship_to_state = safe_str(header.ship_to_state, 100)
    wh_name = ship_to_code or ship_to_city
    if wh_name:
        wh_id, wh_created = find_or_create_warehouse(
            db, name=wh_name, channel="Amazon", city=ship_to_city, state=ship_to_state
        )
        if wh_created:
            warehouses_created.append({"name": wh_name, "code": wh_name.upper().replace(' ', '-')[:50]})

    # Create line items
    items_created = 0
    for item in items:
        po_item = AmazonPOItemData(
            POId=po.Id,
            PONumber=header.po_number,
            ASIN=safe_str(item.asin, 20) or '',
            ExternalId=safe_str(item.external_id, 50),
            ModelNumber=safe_str(item.model_number, 100),
            HSN=safe_str(item.hsn, 20),
            Title=safe_str(item.title, 500),
            CancellationStatus=safe_str(item.cancellation_status, 50),
            CancellationDate=_parse_date(item.cancellation_date),
            WindowType=safe_str(item.window_type, 50),
            ExpectedDate=_parse_date(item.expected_date),
            QuantityRequested=item.quantity_requested,
            AcceptedQuantity=item.accepted_quantity,
            QuantityReceived=item.quantity_received,
            QuantityOutstanding=item.quantity_outstanding,
            UnitCost=item.unit_cost,
            TotalCost=item.total_cost,
        )
        db.add(po_item)
        items_created += 1

        # Auto-create product if missing
        asin = safe_str(item.asin, 20)
        model_number = safe_str(item.model_number, 100)
        title = safe_str(item.title, 500)
        if asin or model_number:
            from app.models.product import Product
            existing_product = db.query(Product).filter(
                (Product.AmazonId == asin) | (Product.AsgSku == model_number)
            ).first()
            if not existing_product:
                find_or_create_product(db, asin=asin, model_number=model_number, product_title=title)
                products_created.append({"name": title or asin, "sku": model_number, "asin": asin})

    log_upload(db, "AmazonPO", "Amazon", f"PDF-{header.po_number}", 0, current_user.Id,
               total_rows=len(items), success_rows=items_created, error_rows=0, status="Success")
    log_audit(db, current_user.Id, "UPLOAD", "AmazonPO", str(po.Id),
              new_values={"type": "AmazonPO_PDF", "po_number": header.po_number, "items": items_created})
    db.commit()

    # Check packing gaps for all PO items
    amazon_items = [
        (safe_str(i.asin, 20), safe_str(i.title, 500), i.quantity_requested)
        for i in items if i.asin and i.quantity_requested
    ]
    packing_alerts = _get_packing_alerts_amazon(db, amazon_items)

    return {
        "success": True,
        "message": f"Amazon PO {header.po_number} saved with {items_created} line items",
        "data": {
            "po_id": po.Id,
            "po_number": header.po_number,
            "items_created": items_created,
            "packing_alerts": packing_alerts,
            "products_created": products_created,
            "warehouses_created": warehouses_created,
        }
    }
