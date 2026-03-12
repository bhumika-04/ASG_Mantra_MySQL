"""
Uploads Router - File Upload Processing
Handles ASG inventory uploads (Packed/Unpacked quantities).
Amazon and Blinkit data uploads are handled by amazon_data.py and blinkit_data.py.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from datetime import datetime
import pandas as pd
import io
import re

from app.database import get_db
from app.models.user import User
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.warehouse import Warehouse
from app.models.asg_warehouse import AsgWarehouse
from app.utils.dependencies import get_current_user
from app.utils.audit import log_audit, log_upload, notify

router = APIRouter()


def _normalize(val: str) -> str:
    """Normalize a string for fuzzy matching.
    - Strips whitespace, non-breaking spaces, tabs
    - Lowercases
    - Replaces hyphens/underscores/dots with spaces
    - Removes brackets, quotes, special chars
    - Normalizes '&' to 'and'
    - Collapses multiple spaces
    E.g. 'ASG-Mantra_Epsom.Salt (500g)' → 'asg mantra epsom salt 500g'
    """
    if not val:
        return ''
    s = str(val).strip().lower()
    s = s.replace('\u00a0', ' ').replace('\t', ' ')  # non-breaking space, tabs
    s = re.sub(r'[-_./\\]+', ' ', s)       # replace separators with space
    s = re.sub(r'[()[\]{}\'"]+', '', s)     # remove brackets and quotes
    s = re.sub(r'\s*&\s*', ' and ', s)      # '&' → 'and'
    s = re.sub(r'\s+', ' ', s).strip()      # collapse multiple spaces
    return s


def clean_numeric(val) -> float:
    """Clean currency symbols (₹, $), commas, LRM chars and whitespace from numeric values."""
    if pd.isna(val) or str(val).strip() in ('', '-', 'nan'):
        return 0.0
    s = str(val)
    # Remove LRM (Left-to-Right Mark), currency symbols, commas, whitespace
    s = re.sub(r'[\u200e₹â¹$,\s]', '', s)
    # Remove any remaining non-numeric chars except . and -
    s = re.sub(r'[^\d.\-]', '', s)
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def read_file(contents: bytes, filename: str, skiprows: int = 0) -> pd.DataFrame:
    """Parse uploaded file as DataFrame. Handles CSV/Excel with optional row skip."""
    if filename.endswith('.xlsx') or filename.endswith('.xls'):
        return pd.read_excel(io.BytesIO(contents), skiprows=skiprows)
    elif filename.endswith('.csv'):
        try:
            return pd.read_csv(io.BytesIO(contents), skiprows=skiprows, encoding='utf-8')
        except UnicodeDecodeError:
            return pd.read_csv(io.BytesIO(contents), skiprows=skiprows, encoding='latin-1')
    else:
        raise HTTPException(status_code=400, detail="File must be Excel (.xlsx, .xls) or CSV (.csv)")


def find_or_create_product(db, asin: str = None, model_number: str = None,
                           product_title: str = None, brand: str = None,
                           blinkit_id: str = None) -> Product:
    """Find product by ASIN/Model Number/BlinkitId/Name (normalized). Auto-creates if not found."""
    product = None
    # Try ASIN (exact — ASINs are standardized codes)
    if asin and asin != 'nan':
        product = db.query(Product).filter(Product.AmazonId == asin).first()
    # Try Model Number / AsgSku (case-insensitive)
    if not product and model_number and model_number != 'nan':
        product = db.query(Product).filter(
            func.lower(Product.AsgSku) == model_number.strip().lower()
        ).first()
    # Try BlinkitId (exact — numeric codes)
    if not product and blinkit_id and blinkit_id != 'nan':
        product = db.query(Product).filter(Product.BlinkitId == blinkit_id).first()
    # Fallback: normalized product name match
    if not product and product_title and product_title != 'nan':
        norm_title = _normalize(product_title)
        if norm_title:
            all_products = db.query(Product).all()
            for p in all_products:
                if _normalize(p.ProductName) == norm_title:
                    product = p
                    break

    def _is_placeholder_name(name):
        if not name:
            return True
        if re.match(r'^B0[A-Z0-9]{6,}$', name.strip()):
            return True
        if name.startswith('Product '):
            return True
        return False

    def _is_placeholder_sku(sku):
        if not sku:
            return True
        return sku.startswith('UNLINKED-AMZN-') or sku.startswith('AMZ-') or sku.startswith('BLK-')

    if not product:
        # Auto-create
        sku = model_number if (model_number and model_number != 'nan') else (
            f"BLK-{blinkit_id}" if (blinkit_id and blinkit_id != 'nan') else f"AMZ-{asin}"
        )
        name = product_title if (product_title and product_title != 'nan') else f"Product {sku}"
        product = Product(
            ProductName=name[:255],
            AsgSku=sku[:50],
            AmazonId=asin[:50] if (asin and asin != 'nan') else None,
            BlinkitId=blinkit_id[:50] if (blinkit_id and blinkit_id != 'nan') else None,
            Brand=brand[:100] if (brand and brand != 'nan') else None,
            IsActive=True,
        )
        db.add(product)
        db.flush()
    else:
        # Update missing or placeholder fields with better data when available
        if asin and asin != 'nan' and not product.AmazonId:
            # Clear AmazonId from any placeholder that had it to avoid duplicates
            db.query(Product).filter(
                Product.AmazonId == asin, Product.Id != product.Id
            ).update({"AmazonId": None}, synchronize_session=False)
            product.AmazonId = asin[:50]
        if blinkit_id and blinkit_id != 'nan' and not product.BlinkitId:
            # Clear BlinkitId from any placeholder that had it to avoid duplicates
            db.query(Product).filter(
                Product.BlinkitId == blinkit_id, Product.Id != product.Id
            ).update({"BlinkitId": None}, synchronize_session=False)
            product.BlinkitId = blinkit_id[:50]
        if brand and brand != 'nan' and not product.Brand:
            product.Brand = brand[:100]
        # Update ProductName if current name is a placeholder/ASIN and we have a real title
        if product_title and product_title != 'nan' and _is_placeholder_name(product.ProductName):
            product.ProductName = product_title[:255]
        # Update AsgSku if current SKU is a placeholder and we have a real model number
        if model_number and model_number != 'nan' and _is_placeholder_sku(product.AsgSku):
            product.AsgSku = model_number[:50]

    return product


def find_warehouse(db, warehouse_identifier: str) -> int | None:
    """
    Find warehouse by ID, Code, or Name (normalized).
    Returns warehouse ID if found, None otherwise.
    """
    if not warehouse_identifier or warehouse_identifier == 'nan':
        return None

    identifier = str(warehouse_identifier).strip()

    # Try as warehouse ID (if numeric)
    if identifier.isdigit():
        warehouse = db.query(Warehouse).filter(Warehouse.Id == int(identifier)).first()
        if warehouse:
            return warehouse.Id

    # Try as warehouse code (case-insensitive)
    warehouse = db.query(Warehouse).filter(
        func.lower(Warehouse.WarehouseCode) == identifier.lower()
    ).first()
    if warehouse:
        return warehouse.Id

    # Try as warehouse name (case-insensitive exact)
    warehouse = db.query(Warehouse).filter(
        func.lower(Warehouse.WarehouseName) == identifier.lower()
    ).first()
    if warehouse:
        return warehouse.Id

    # Normalized match (handles dashes, underscores, extra spaces)
    norm_input = _normalize(identifier)
    if norm_input:
        all_warehouses = db.query(Warehouse).all()
        for wh in all_warehouses:
            if _normalize(wh.WarehouseName) == norm_input or _normalize(wh.WarehouseCode) == norm_input:
                return wh.Id

    return None


def find_or_create_warehouse(db, name: str, channel: str,
                              city: str = None, state: str = None,
                              warehouse_type: str = None) -> tuple:
    """Find warehouse by name or code (normalized). Auto-creates if not found.
    Returns (warehouse_id, was_created)."""
    if not name or str(name).strip() in ('', 'nan', '-'):
        return None, False

    name = str(name).strip()

    # Try existing find (includes normalized matching)
    wh_id = find_warehouse(db, name)
    if wh_id:
        return wh_id, False

    # Auto-create with code derived from name
    code = name.upper().replace(' ', '-')[:50]

    warehouse = Warehouse(
        Channel=channel,
        WarehouseName=name[:255],
        WarehouseCode=code,
        City=city[:100] if city else None,
        State=state[:100] if state else None,
        WarehouseType=warehouse_type,
        IsActive=True,
    )
    db.add(warehouse)
    db.flush()
    return warehouse.Id, True


def find_or_create_asg_warehouse(db, name: str, city: str = None, state: str = None) -> tuple:
    """Find ASG internal warehouse by name (normalized). Auto-creates if not found.
    Returns (asg_warehouse_id, was_created)."""
    if not name or str(name).strip() in ('', 'nan', '-'):
        return None, False

    name = str(name).strip()

    # Try case-insensitive match
    wh = db.query(AsgWarehouse).filter(
        func.lower(AsgWarehouse.WarehouseName) == name.lower()
    ).first()
    if wh:
        return wh.Id, False

    # Normalized match (handles dashes, underscores, extra spaces)
    norm_input = _normalize(name)
    if norm_input:
        all_wh = db.query(AsgWarehouse).all()
        for w in all_wh:
            if _normalize(w.WarehouseName) == norm_input:
                return w.Id, False

    # Derive city from name if not provided (e.g. "Delhi Warehouse" -> "Delhi")
    if not city and 'warehouse' in name.lower():
        city = name.lower().replace('warehouse', '').strip().title()

    wh = AsgWarehouse(
        WarehouseName=name[:100],
        City=city[:100] if city else None,
        State=state[:100] if state else None,
        Active=True,
    )
    db.add(wh)
    db.flush()
    return wh.Id, True

@router.post("/inventory/preview")
async def preview_inventory_data(
    file: UploadFile = File(...),
    inventory_date: Optional[str] = Query(None, description="Inventory date YYYY-MM-DD (defaults to today)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Preview ASG inventory CSV/Excel before uploading.
    Validates product SKUs and warehouse names without writing to the database.
    Returns per-row status so user can review before confirming the upload.
    Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        contents = await file.read()

        if file.filename.endswith('.xlsx') or file.filename.endswith('.xls'):
            df = pd.read_excel(io.BytesIO(contents))
        elif file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="File must be Excel (.xlsx, .xls) or CSV (.csv)")

        # Normalize column names (same logic as upload endpoint)
        column_mapping = {}
        for col in df.columns:
            col_lower = col.lower().replace(' ', '').replace('_', '')
            if 'asg' in col_lower and 'sku' in col_lower:
                column_mapping[col] = 'asg_sku'
            elif col_lower in ['sku', 'skuid', 'productsku']:
                column_mapping[col] = 'asg_sku'
            elif 'packed' in col_lower and 'unpacked' not in col_lower:
                column_mapping[col] = 'packed_qty'
            elif 'unpacked' in col_lower:
                column_mapping[col] = 'unpacked_qty'
            elif col_lower in ['warehouse', 'warehouseid', 'location']:
                column_mapping[col] = 'warehouse'
            elif col_lower == 'channel':
                column_mapping[col] = 'channel'
        df = df.rename(columns=column_mapping)

        if 'asg_sku' not in df.columns:
            raise HTTPException(
                status_code=400,
                detail="Missing required column: ASG SKU ID. Please ensure your file has a column for SKU identifiers."
            )

        # Resolve inventory date (same logic as upload endpoint)
        if inventory_date:
            try:
                today = datetime.strptime(inventory_date, '%Y-%m-%d').date()
            except ValueError:
                today = datetime.utcnow().date()
        else:
            today = datetime.utcnow().date()

        rows = []
        valid_count = 0
        sku_not_found_count = 0

        for idx, row in df.iterrows():
            asg_sku = str(row.get('asg_sku', '')).strip()
            if not asg_sku or asg_sku == 'nan':
                continue  # skip blank rows silently

            packed_qty = int(row.get('packed_qty', 0) or 0)
            unpacked_qty = int(row.get('unpacked_qty', 0) or 0)

            warehouse_val = str(row.get('warehouse', '') or '').strip()
            if warehouse_val == 'nan':
                warehouse_val = ''

            channel_val = str(row.get('channel', '') or '').strip()
            if channel_val == 'nan':
                channel_val = ''

            # Check product exists
            product = db.query(Product).filter(Product.AsgSku == asg_sku).first()

            # Check warehouse if specified (look in both AsgWarehouses and Warehouses)
            warehouse_display = warehouse_val or None
            warehouse_status = 'found'  # found, new, none
            if warehouse_val:
                # Check AsgWarehouses first
                asg_wh = db.query(AsgWarehouse).filter(
                    (AsgWarehouse.WarehouseName == warehouse_val) |
                    (AsgWarehouse.WarehouseName.ilike(warehouse_val))
                ).first()
                if asg_wh:
                    warehouse_display = asg_wh.WarehouseName
                    warehouse_status = 'found'
                else:
                    wid = find_warehouse(db, warehouse_val)
                    if wid:
                        wh = db.query(Warehouse).filter(Warehouse.Id == wid).first()
                        warehouse_display = wh.WarehouseName if wh else warehouse_val
                        warehouse_status = 'found'
                    else:
                        warehouse_status = 'new'

            # Fetch inventory quantities for this product on the SPECIFIC upload date
            # (shows what will be overwritten if re-uploading same date,
            #  or None if this is a new date entry)
            current_packed = None
            current_unpacked = None
            if product:
                cur_row = db.execute(text(
                    "SELECT PackedQty, UnpackedQty FROM Inventory "
                    "WHERE ProductId = :pid AND InventoryDate = :inv_date "
                    "ORDER BY LastUpdated DESC OFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY"
                ), {"pid": product.Id, "inv_date": today}).fetchone()
                if cur_row:
                    current_packed = int(cur_row[0] or 0)
                    current_unpacked = int(cur_row[1] or 0)

            if not product:
                status = 'sku_not_found'
                reason = f"SKU '{asg_sku}' not found in product master — row will be skipped"
                sku_not_found_count += 1
            else:
                status = 'valid'
                reason = (
                    f"Warehouse '{warehouse_val}' will be auto-created"
                    if warehouse_val and warehouse_status == 'new' else None
                )
                valid_count += 1

            rows.append({
                'rowNumber': idx + 2,
                'status': status,
                'reason': reason,
                'asgSku': asg_sku,
                'productName': product.ProductName if product else None,
                'packedQty': packed_qty,
                'unpackedQty': unpacked_qty,
                'currentPackedQty': current_packed,
                'currentUnpackedQty': current_unpacked,
                'warehouse': warehouse_display,
                'warehouseFound': warehouse_status != 'new',
                'channel': channel_val or 'Both',
            })

        return {
            'success': True,
            'totalRows': len(rows),
            'valid': valid_count,
            'skuNotFound': sku_not_found_count,
            'rows': rows,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")


@router.post("/inventory")
async def upload_inventory_data(
    file: UploadFile = File(...),
    inventory_date: Optional[str] = Query(None, description="Inventory date YYYY-MM-DD (defaults to today)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload ASG inventory data with Packed/Unpacked quantities from Excel/CSV file.
    This is the ONLY source for Packed/Unpacked data - platform files do NOT contain this.

    Expected columns:
    - Product Name (optional)
    - ASG SKU ID (required) - maps to Product.AsgSku
    - Packed Qty (required)
    - Unpacked Qty (required)
    - Warehouse (optional)
    - Channel (optional, defaults to updating both Amazon and Blinkit)

    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        contents = await file.read()

        if file.filename.endswith('.xlsx') or file.filename.endswith('.xls'):
            df = pd.read_excel(io.BytesIO(contents))
        elif file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="File must be Excel (.xlsx, .xls) or CSV (.csv)")

        # Normalize column names (handle variations)
        column_mapping = {}
        for col in df.columns:
            col_lower = col.lower().replace(' ', '').replace('_', '')
            if 'asg' in col_lower and 'sku' in col_lower:
                column_mapping[col] = 'asg_sku'
            elif col_lower in ['sku', 'skuid', 'productsku']:
                column_mapping[col] = 'asg_sku'
            elif 'packed' in col_lower and 'unpacked' not in col_lower:
                column_mapping[col] = 'packed_qty'
            elif 'unpacked' in col_lower:
                column_mapping[col] = 'unpacked_qty'
            elif col_lower in ['warehouse', 'warehouseid', 'location']:
                column_mapping[col] = 'warehouse'
            elif col_lower == 'channel':
                column_mapping[col] = 'channel'

        df = df.rename(columns=column_mapping)

        # Validate required columns
        if 'asg_sku' not in df.columns:
            raise HTTPException(
                status_code=400,
                detail="Missing required column: ASG SKU ID. Please ensure your file has a column for SKU identifiers."
            )

        rows_processed = 0
        rows_skipped = 0
        rows_updated = 0
        errors = []
        # Use provided inventory_date or fall back to today
        if inventory_date:
            try:
                today = datetime.strptime(inventory_date, '%Y-%m-%d').date()
            except ValueError:
                today = datetime.utcnow().date()
        else:
            today = datetime.utcnow().date()
        asg_warehouses_created = []

        for idx, row in df.iterrows():
            try:
                asg_sku = str(row.get('asg_sku', '')).strip()
                if not asg_sku or asg_sku == 'nan':
                    rows_skipped += 1
                    continue

                # Find product by ASG SKU
                product = db.query(Product).filter(
                    Product.AsgSku == asg_sku
                ).first()

                if not product:
                    errors.append(f"Row {idx + 2}: Product with SKU '{asg_sku}' not found")
                    rows_skipped += 1
                    continue

                # Parse quantities
                packed_qty = int(row.get('packed_qty', 0) or 0)
                unpacked_qty = int(row.get('unpacked_qty', 0) or 0)
                current_stock = packed_qty + unpacked_qty

                # Find or auto-create ASG warehouse if specified
                asg_wh_id = None
                warehouse_value = row.get('warehouse', None)
                if warehouse_value and str(warehouse_value).strip() and str(warehouse_value).lower() != 'nan':
                    wh_name = str(warehouse_value).strip()
                    asg_wh_id, asg_wh_created = find_or_create_asg_warehouse(db, wh_name)
                    if asg_wh_created:
                        asg_warehouses_created.append({"name": wh_name, "id": asg_wh_id})

                # Inventory = date-wise snapshots (one row per product+warehouse+date).
                # Same date → OVERWRITE that row.
                # Different/past date → INSERT a new row (history preserved).
                if asg_wh_id is not None:
                    existing = db.execute(text(
                        "SELECT Id, PackedQty, UnpackedQty FROM Inventory "
                        "WHERE ProductId = :pid AND AsgWarehouseId = :wid AND InventoryDate = :today"
                    ), {"pid": product.Id, "wid": asg_wh_id, "today": today}).fetchone()
                else:
                    existing = db.execute(text(
                        "SELECT Id, PackedQty, UnpackedQty FROM Inventory "
                        "WHERE ProductId = :pid AND AsgWarehouseId IS NULL AND InventoryDate = :today"
                    ), {"pid": product.Id, "today": today}).fetchone()

                if existing:
                    prev_packed = int(existing[1] or 0)
                    prev_unpacked = int(existing[2] or 0)
                    # Same date already uploaded — overwrite quantities
                    db.execute(text(
                        "UPDATE Inventory SET "
                        "PackedQty = :packed, "
                        "UnpackedQty = :unpacked, "
                        "CurrentStock = :stock, "
                        "AsgWarehouseId = :wid, "
                        "LastInventoryDate = :today, LastUpdated = GETDATE() "
                        "WHERE Id = :inv_id"
                    ), {
                        "packed": packed_qty,
                        "unpacked": unpacked_qty,
                        "stock": current_stock,
                        "wid": asg_wh_id,
                        "today": today,
                        "inv_id": existing[0],
                    })
                    rows_updated += 1
                else:
                    prev_packed = None
                    prev_unpacked = None
                    # New date (today, past, or future) — insert a new date-wise row
                    db.execute(text(
                        "INSERT INTO Inventory "
                        "(ProductId, AsgWarehouseId, CurrentStock, PackedQty, UnpackedQty, "
                        "InventoryDate, LastInventoryDate, LastUpdated) "
                        "VALUES (:pid, :wid, :stock, :packed, :unpacked, :today, :today, GETDATE())"
                    ), {
                        "pid": product.Id,
                        "wid": asg_wh_id,
                        "stock": current_stock,
                        "packed": packed_qty,
                        "unpacked": unpacked_qty,
                        "today": today,
                    })
                    rows_processed += 1

                # Upsert into InventoryHistory: one row per product+warehouse+date.
                # Re-uploading the same date overwrites that date's row (last upload wins).
                try:
                    if asg_wh_id is not None:
                        hist_row = db.execute(text(
                            "SELECT Id FROM InventoryHistory "
                            "WHERE ProductId = :pid AND AsgWarehouseId = :wid AND InventoryDate = :today"
                        ), {"pid": product.Id, "wid": asg_wh_id, "today": today}).fetchone()
                    else:
                        hist_row = db.execute(text(
                            "SELECT Id FROM InventoryHistory "
                            "WHERE ProductId = :pid AND AsgWarehouseId IS NULL AND InventoryDate = :today"
                        ), {"pid": product.Id, "today": today}).fetchone()

                    if hist_row:
                        db.execute(text(
                            "UPDATE InventoryHistory SET "
                            "PackedQty = :packed, UnpackedQty = :unpacked, CurrentStock = :stock, "
                            "UploadedBy = :uid, CreatedAt = GETDATE() "
                            "WHERE Id = :hid"
                        ), {
                            "packed": packed_qty,
                            "unpacked": unpacked_qty,
                            "stock": current_stock,
                            "uid": current_user.Id,
                            "hid": hist_row[0],
                        })
                    else:
                        db.execute(text(
                            "INSERT INTO InventoryHistory "
                            "(ProductId, AsgWarehouseId, InventoryDate, PackedQty, UnpackedQty, "
                            "CurrentStock, UploadedBy, CreatedAt) "
                            "VALUES (:pid, :wid, :today, :packed, :unpacked, :stock, :uid, GETDATE())"
                        ), {
                            "pid": product.Id,
                            "wid": asg_wh_id,
                            "today": today,
                            "packed": packed_qty,
                            "unpacked": unpacked_qty,
                            "stock": current_stock,
                            "uid": current_user.Id,
                        })
                except Exception:
                    pass  # History write failure should never block the main upload

            except ValueError as ve:
                errors.append(f"Row {idx + 2}: Invalid numeric value - {str(ve)}")
                rows_skipped += 1
                continue
            except Exception as e:
                errors.append(f"Row {idx + 2}: {str(e)}")
                rows_skipped += 1
                continue

        log_upload(db, "Inventory", None, file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_processed + rows_updated, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "Inventory", None,
                  new_values={"type": "ASGInventory", "file": file.filename, "created": rows_processed, "updated": rows_updated})
        notify(db, current_user.Id, "ASG Stock Uploaded",
               f"{rows_processed} rows created, {rows_updated} updated from {file.filename}" + (f", {rows_skipped} skipped" if rows_skipped else ""),
               "upload")
        db.commit()

        return {
            "success": True,
            "message": "Inventory data uploaded successfully",
            "data": {
                "rows_created": rows_processed,
                "rows_updated": rows_updated,
                "rows_skipped": rows_skipped,
                "total_rows": len(df),
                "asg_warehouses_created": asg_warehouses_created,
                "errors": errors[:10] if errors else []  # Return first 10 errors
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


