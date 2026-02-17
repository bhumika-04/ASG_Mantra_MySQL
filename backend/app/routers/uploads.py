"""
Uploads Router - File Upload Processing
Handles Excel/CSV file uploads for sales, purchase orders, and stock data
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from datetime import datetime
import pandas as pd
import io
import re

from app.database import get_db
from app.models.user import User
from app.models.sales import Sales
from app.models.purchase_order import PurchaseOrder
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.warehouse import Warehouse
from app.models.asg_warehouse import AsgWarehouse
from app.utils.dependencies import get_current_user
from app.utils.audit import log_audit, log_upload

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
        # Update missing fields
        if asin and asin != 'nan' and not product.AmazonId:
            product.AmazonId = asin[:50]
        if blinkit_id and blinkit_id != 'nan' and not product.BlinkitId:
            product.BlinkitId = blinkit_id[:50]
        if brand and brand != 'nan' and not product.Brand:
            product.Brand = brand[:100]

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


@router.post("/amazon/sales")
async def upload_amazon_sales(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Amazon Vendor Central Sales report (CSV/Excel).
    Handles real Amazon format:
    - Row 1: Metadata filter row (skipped)
    - Row 2: Headers (ASIN, Product Title, Model Number, Ordered Units, Ordered Revenue, ...)
    - Currency values like ₹1,02,243.13 are cleaned automatically
    - Products auto-created if not found
    Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        contents = await file.read()
        # Amazon Vendor Central CSVs have a metadata row first
        df = read_file(contents, file.filename, skiprows=1)

        # Normalize column names
        col_map = {}
        for col in df.columns:
            cl = str(col).strip().lower()
            if cl == 'asin':
                col_map[col] = 'asin'
            elif 'product title' in cl or cl == 'product name':
                col_map[col] = 'product_title'
            elif cl == 'brand':
                col_map[col] = 'brand'
            elif 'model number' in cl:
                col_map[col] = 'model_number'
            elif cl == 'ordered units':
                col_map[col] = 'ordered_units'
            elif cl == 'ordered revenue':
                col_map[col] = 'ordered_revenue'
            elif cl == 'shipped units':
                col_map[col] = 'shipped_units'
            elif cl == 'shipped revenue':
                col_map[col] = 'shipped_revenue'
            elif 'customer returns' in cl:
                col_map[col] = 'customer_returns'
        df = df.rename(columns=col_map)
        df = df.loc[:, ~df.columns.duplicated()]

        today = datetime.utcnow().date()
        rows_processed = 0
        rows_skipped = 0
        products_created = 0
        errors = []

        for idx, row in df.iterrows():
            try:
                asin = str(row.get('asin', '')).strip()
                model_number = str(row.get('model_number', '')).strip()
                product_title = str(row.get('product_title', '')).strip()
                brand = str(row.get('brand', '')).strip()

                if not asin or asin == 'nan':
                    rows_skipped += 1
                    continue

                ordered_units = int(clean_numeric(row.get('ordered_units', 0)))
                if ordered_units == 0:
                    rows_skipped += 1
                    continue

                ordered_revenue = clean_numeric(row.get('ordered_revenue', 0))
                unit_price = round(ordered_revenue / ordered_units, 2) if ordered_units > 0 else 0.0
                # CHK_Sales_Amounts: TotalAmount must equal Quantity * UnitPrice exactly
                total_amount = round(unit_price * ordered_units, 2)

                product = find_or_create_product(
                    db, asin=asin, model_number=model_number,
                    product_title=product_title, brand=brand
                )
                if product.Id is None:
                    db.flush()
                    products_created += 1

                db.execute(text("""
                    INSERT INTO Sales
                    (OrderId, Channel, ProductId, WarehouseId, Quantity, UnitPrice,
                     TotalAmount, OrderDate, Status, CreatedAt)
                    VALUES (NULL, 'Amazon', :pid, NULL, :qty, :unit_price,
                            :total, :order_date, 'Delivered', GETDATE())
                """), {
                    "pid": product.Id,
                    "qty": ordered_units,
                    "unit_price": unit_price,
                    "total": total_amount,
                    "order_date": today,
                })
                rows_processed += 1

            except Exception as e:
                errors.append(f"Row {idx + 3}: {str(e)}")
                rows_skipped += 1
                continue

        log_upload(db, "AmazonSales", "Amazon", file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "Sales", None,
                  new_values={"type": "AmazonSales", "file": file.filename, "rows": rows_processed})
        db.commit()

        return {
            "success": True,
            "message": "Amazon sales data uploaded successfully",
            "data": {
                "rows_processed": rows_processed,
                "rows_skipped": rows_skipped,
                "products_created": products_created,
                "total_rows": len(df),
                "errors": errors[:10]
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/amazon/purchase-orders")
async def upload_amazon_purchase_orders(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Amazon purchase orders from Excel/CSV file
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
            raise HTTPException(status_code=400, detail="File must be Excel or CSV")

        rows_processed = 0
        rows_skipped = 0

        for _, row in df.iterrows():
            try:
                # Find product
                product = db.query(Product).filter(
                    (Product.AmazonId == str(row.get('AmazonId', ''))) |
                    (Product.AsgSku == str(row.get('SKU', '')))
                ).first()

                if not product:
                    rows_skipped += 1
                    continue

                # Create PO record
                po = PurchaseOrder(
                    PoNumber=str(row.get('PONumber', '')),
                    ProductId=product.Id,
                    Channel="Amazon",
                    OrderDate=pd.to_datetime(row.get('OrderDate', datetime.utcnow())),
                    ExpectedDeliveryDate=pd.to_datetime(row.get('ExpectedDeliveryDate', None)) if row.get('ExpectedDeliveryDate') else None,
                    Quantity=int(row.get('Quantity', 0)),
                    ReceivedQuantity=int(row.get('ReceivedQuantity', 0)),
                    UnitPrice=float(row.get('UnitPrice', product.UnitPrice)),
                    TotalAmount=float(row.get('TotalAmount', 0)),
                    Status=str(row.get('Status', 'Created')),
                    WarehouseId=row.get('WarehouseId', None),
                )

                db.add(po)
                rows_processed += 1

            except Exception as e:
                rows_skipped += 1
                continue

        log_upload(db, "AmazonPO", "Amazon", file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "PurchaseOrders", None,
                  new_values={"type": "AmazonPO", "file": file.filename, "rows": rows_processed})
        db.commit()

        return {
            "success": True,
            "message": "Amazon purchase orders uploaded successfully",
            "data": {
                "rows_processed": rows_processed,
                "rows_skipped": rows_skipped,
                "total_rows": len(df)
            }
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/amazon/inventory")
async def upload_amazon_inventory(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Amazon Vendor Central inventory report CSV.
    Handles the real Amazon format with:
    - Row 1: Metadata/filter row (skipped)
    - Row 2: Actual column headers (ASIN, Product Title, Brand, Model Number, etc.)
    - Data rows with currency symbols and comma-separated numbers

    Key columns mapped:
    - ASIN -> Product.AmazonId
    - Product Title -> Product.ProductName
    - Model Number -> Product.AsgSku
    - Sellable On Hand Units -> PackedQty (ready-to-sell)
    - Unsellable On-Hand Units -> UnpackedQty
    - Open Purchase Order Quantity -> tracked for reference
    - Brand -> Product.Brand

    Auto-creates products if ASIN/Model Number not found in DB.
    Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        contents = await file.read()
        df = read_file(contents, file.filename, skiprows=1)

        # Normalize columns - skip cost/monetary columns to avoid duplicates
        col_map = {}
        for col in df.columns:
            cl = str(col).strip().lower()
            if 'cost' in cl or 'price' in cl:
                continue
            if cl == 'asin':
                col_map[col] = 'asin'
            elif 'product title' in cl or cl == 'product name':
                col_map[col] = 'product_title'
            elif cl == 'brand':
                col_map[col] = 'brand'
            elif 'model number' in cl:
                col_map[col] = 'model_number'
            elif ('sellable on' in cl or cl == 'sellable units') and 'unsellable' not in cl:
                col_map[col] = 'sellable_units'
            elif 'unsellable on' in cl or 'unsellable units' in cl:
                col_map[col] = 'unsellable_units'
        df = df.rename(columns=col_map)
        df = df.loc[:, ~df.columns.duplicated()]

        rows_created = 0
        rows_updated = 0
        rows_skipped = 0
        products_created = 0
        errors = []
        today = datetime.utcnow().date()

        for idx, row in df.iterrows():
            try:
                asin = str(row.get('asin', '')).strip()
                model_number = str(row.get('model_number', '')).strip()
                product_title = str(row.get('product_title', '')).strip()
                brand = str(row.get('brand', '')).strip()

                if not asin or asin == 'nan':
                    rows_skipped += 1
                    continue

                sellable_units = int(clean_numeric(row.get('sellable_units', 0)))
                unsellable_units = int(clean_numeric(row.get('unsellable_units', 0)))
                total_stock = sellable_units + unsellable_units

                product = find_or_create_product(
                    db, asin=asin, model_number=model_number,
                    product_title=product_title, brand=brand
                )
                if product.Id is None:
                    db.flush()
                    products_created += 1

                # Amazon inventory lives in AmazonInventory table (via amazon_data.py).
                # No longer write to generic Inventory table — that's for ASG stock only.
                rows_created += 1

            except Exception as e:
                errors.append(f"Row {idx + 3}: {str(e)}")
                rows_skipped += 1
                continue

        log_upload(db, "AmazonInventory", "Amazon", file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_created + rows_updated, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "Inventory", None,
                  new_values={"type": "AmazonInventory", "file": file.filename, "created": rows_created, "updated": rows_updated})
        db.commit()

        return {
            "success": True,
            "message": "Amazon inventory data uploaded successfully",
            "data": {
                "rows_created": rows_created,
                "rows_updated": rows_updated,
                "rows_skipped": rows_skipped,
                "products_created": products_created,
                "total_rows": len(df),
                "errors": errors[:10]
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/blinkit/sales")
async def upload_blinkit_sales(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Blinkit sales report CSV.
    Real Blinkit format columns:
    - item_id, item_name, manufacturer_id, manufacturer_name,
      city_id, city_name, category, date, qty_sold, mrp
    - item_id maps to Product.BlinkitId
    - mrp is the TOTAL for that row (qty_sold * unit_price)
    - Each row is per city per date - stored with CustomerCity
    Products auto-created if not found.
    Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        contents = await file.read()
        df = read_file(contents, file.filename)

        # Normalize columns
        col_map = {}
        for col in df.columns:
            cl = str(col).strip().lower().replace(' ', '_')
            if cl in ('item_id', 'itemid'):
                col_map[col] = 'item_id'
            elif cl in ('item_name', 'itemname'):
                col_map[col] = 'item_name'
            elif cl in ('city_name', 'cityname', 'city'):
                col_map[col] = 'city_name'
            elif cl == 'date':
                col_map[col] = 'date'
            elif cl in ('qty_sold', 'qtysold', 'quantity'):
                col_map[col] = 'qty_sold'
            elif cl == 'mrp':
                col_map[col] = 'mrp'
            elif cl in ('category',):
                col_map[col] = 'category'
        df = df.rename(columns=col_map)

        rows_processed = 0
        rows_skipped = 0
        products_created = 0
        errors = []

        for idx, row in df.iterrows():
            try:
                item_id = str(row.get('item_id', '')).strip()
                item_name = str(row.get('item_name', '')).strip()
                city_name = str(row.get('city_name', '')).strip()

                if not item_id or item_id == 'nan':
                    rows_skipped += 1
                    continue

                qty_sold = int(clean_numeric(row.get('qty_sold', 0)))
                if qty_sold == 0:
                    rows_skipped += 1
                    continue

                mrp_total = clean_numeric(row.get('mrp', 0))
                unit_price = round(mrp_total / qty_sold, 2) if qty_sold > 0 else 0.0
                # CHK_Sales_Amounts: TotalAmount must equal Quantity * UnitPrice exactly
                total_amount = round(unit_price * qty_sold, 2)

                # Parse date
                try:
                    order_date = pd.to_datetime(row.get('date', datetime.utcnow())).date()
                except Exception:
                    order_date = datetime.utcnow().date()

                product = find_or_create_product(
                    db, blinkit_id=item_id,
                    product_title=item_name if item_name != 'nan' else None
                )
                if product.Id is None:
                    db.flush()
                    products_created += 1

                db.execute(text("""
                    INSERT INTO Sales
                    (OrderId, Channel, ProductId, WarehouseId, Quantity, UnitPrice,
                     TotalAmount, OrderDate, CustomerCity, Status, CreatedAt)
                    VALUES (NULL, 'Blinkit', :pid, NULL, :qty, :unit_price,
                            :total, :order_date, :city, 'Delivered', GETDATE())
                """), {
                    "pid": product.Id,
                    "qty": qty_sold,
                    "unit_price": unit_price,
                    "total": total_amount,
                    "order_date": order_date,
                    "city": city_name if city_name != 'nan' else None,
                })
                rows_processed += 1

            except Exception as e:
                errors.append(f"Row {idx + 2}: {str(e)}")
                rows_skipped += 1
                continue

        log_upload(db, "BlinkitSales", "Blinkit", file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "Sales", None,
                  new_values={"type": "BlinkitSales", "file": file.filename, "rows": rows_processed})
        db.commit()

        return {
            "success": True,
            "message": "Blinkit sales data uploaded successfully",
            "data": {
                "rows_processed": rows_processed,
                "rows_skipped": rows_skipped,
                "products_created": products_created,
                "total_rows": len(df),
                "errors": errors[:10]
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/blinkit/purchase-orders")
async def upload_blinkit_purchase_orders(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Blinkit purchase orders from Excel/CSV file
    Admin and Manager only
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
            raise HTTPException(status_code=400, detail="File must be Excel or CSV")

        rows_processed = 0
        rows_skipped = 0

        for _, row in df.iterrows():
            try:
                # Find product by Blinkit ID or SKU
                product = db.query(Product).filter(
                    (Product.BlinkitId == str(row.get('BlinkitId', ''))) |
                    (Product.AsgSku == str(row.get('SKU', '')))
                ).first()

                if not product:
                    rows_skipped += 1
                    continue

                # Create PO record
                po = PurchaseOrder(
                    PoNumber=str(row.get('PONumber', '')),
                    ProductId=product.Id,
                    Channel="Blinkit",
                    OrderDate=pd.to_datetime(row.get('OrderDate', datetime.utcnow())),
                    ExpectedDeliveryDate=pd.to_datetime(row.get('ExpectedDeliveryDate', None)) if row.get('ExpectedDeliveryDate') else None,
                    Quantity=int(row.get('Quantity', 0)),
                    ReceivedQuantity=int(row.get('ReceivedQuantity', 0)),
                    UnitPrice=float(row.get('UnitPrice', product.UnitPrice)),
                    TotalAmount=float(row.get('TotalAmount', 0)),
                    Status=str(row.get('Status', 'Created')),
                    WarehouseId=row.get('WarehouseId', None),
                )

                db.add(po)
                rows_processed += 1

            except Exception as e:
                rows_skipped += 1
                continue

        log_upload(db, "BlinkitPO", "Blinkit", file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_processed, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "PurchaseOrders", None,
                  new_values={"type": "BlinkitPO", "file": file.filename, "rows": rows_processed})
        db.commit()

        return {
            "success": True,
            "message": "Blinkit purchase orders uploaded successfully",
            "data": {
                "rows_processed": rows_processed,
                "rows_skipped": rows_skipped,
                "total_rows": len(df)
            }
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/blinkit/inventory")
async def upload_blinkit_inventory(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload Blinkit Inventory Report CSV.
    Real Blinkit format columns:
    - created_at, backend_facility_name, backend_facility_id,
      item_id, item_name, backend_inv_qty, frontend_inv_qty
    - Multiple rows per item (one per warehouse/facility)
    - Aggregates backend_inv_qty across all facilities per item
    - item_id maps to Product.BlinkitId
    Products auto-created if not found.
    Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        contents = await file.read()
        df = read_file(contents, file.filename)

        # Normalize columns
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
            elif 'facility_name' in cl or 'backend_facility' in cl:
                col_map[col] = 'facility_name'
        df = df.rename(columns=col_map)

        # Auto-create Blinkit warehouses from facility names before aggregation
        warehouses_created = []
        if 'facility_name' in df.columns:
            unique_facilities = df['facility_name'].dropna().unique()
            for fac_name in unique_facilities:
                fac_name_str = str(fac_name).strip()
                if fac_name_str and fac_name_str != 'nan':
                    wh_id, wh_created = find_or_create_warehouse(
                        db, fac_name_str, channel="Blinkit",
                        warehouse_type="Backend"
                    )
                    if wh_created:
                        warehouses_created.append({"name": fac_name_str, "id": wh_id})

        # Aggregate by item_id: sum backend_inv_qty across facilities
        agg_df = df.groupby('item_id').agg({
            'item_name': 'first',
            'backend_inv_qty': 'sum',
            'frontend_inv_qty': 'sum',
        }).reset_index()

        today = datetime.utcnow().date()
        rows_created = 0
        rows_updated = 0
        rows_skipped = 0
        products_created = 0
        errors = []

        for idx, row in agg_df.iterrows():
            try:
                item_id = str(row.get('item_id', '')).strip()
                item_name = str(row.get('item_name', '')).strip()

                if not item_id or item_id == 'nan':
                    rows_skipped += 1
                    continue

                backend_qty = int(clean_numeric(row.get('backend_inv_qty', 0)))
                # backend_inv_qty is total stock across all Blinkit warehouses
                total_stock = backend_qty

                product = find_or_create_product(
                    db, blinkit_id=item_id,
                    product_title=item_name if item_name != 'nan' else None
                )
                if product.Id is None:
                    db.flush()
                    products_created += 1

                # Blinkit inventory lives in BlinkitInventory table (via blinkit_data.py).
                # No longer write to generic Inventory table — that's for ASG stock only.
                rows_created += 1

            except Exception as e:
                errors.append(f"Row {idx + 2}: {str(e)}")
                rows_skipped += 1
                continue

        log_upload(db, "BlinkitInventory", "Blinkit", file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_created + rows_updated, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "BlinkitInventory", None,
                  new_values={"type": "BlinkitInventory", "file": file.filename, "created": rows_created, "updated": rows_updated})
        db.commit()

        return {
            "success": True,
            "message": "Blinkit inventory data uploaded successfully",
            "data": {
                "rows_created": rows_created,
                "rows_updated": rows_updated,
                "rows_skipped": rows_skipped,
                "products_created": products_created,
                "warehouses_created": warehouses_created,
                "total_rows": len(agg_df),
                "errors": errors[:10]
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/inventory/preview")
async def preview_inventory_data(
    file: UploadFile = File(...),
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

                # Inventory table = ASG internal stock only.
                # Upsert by ProductId + AsgWarehouseId + InventoryDate (date-wise snapshot)
                if asg_wh_id is not None:
                    existing = db.execute(text(
                        "SELECT Id FROM Inventory WHERE ProductId = :pid AND AsgWarehouseId = :wid AND InventoryDate = :today"
                    ), {"pid": product.Id, "wid": asg_wh_id, "today": str(today)}).fetchone()
                else:
                    existing = db.execute(text(
                        "SELECT Id FROM Inventory WHERE ProductId = :pid AND AsgWarehouseId IS NULL AND InventoryDate = :today"
                    ), {"pid": product.Id, "today": str(today)}).fetchone()

                if existing:
                    db.execute(text(
                        "UPDATE Inventory SET PackedQty = :packed, UnpackedQty = :unpacked, "
                        "CurrentStock = :stock, AsgWarehouseId = :wid, "
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
                        "today": str(today),
                    })
                    rows_processed += 1

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


@router.post("/stock")
async def upload_stock_data(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Legacy endpoint - Use /inventory instead for Packed/Unpacked support.
    Upload stock/inventory data from Excel/CSV file
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
            raise HTTPException(status_code=400, detail="File must be Excel or CSV")

        rows_processed = 0
        rows_skipped = 0
        rows_updated = 0

        for _, row in df.iterrows():
            try:
                # Find product
                product = db.query(Product).filter(
                    Product.AsgSku == str(row.get('SKU', ''))
                ).first()

                if not product:
                    rows_skipped += 1
                    continue

                # Check if inventory record exists (ASG stock only)
                inventory = db.query(Inventory).filter(
                    Inventory.ProductId == product.Id,
                ).first()

                if inventory:
                    # Update existing
                    inventory.CurrentStock = int(row.get('CurrentStock', 0))
                    inventory.LastUpdated = datetime.utcnow()
                    rows_updated += 1
                else:
                    # Create new inventory record
                    inventory = Inventory(
                        ProductId=product.Id,
                        WarehouseId=row.get('WarehouseId', None),
                        CurrentStock=int(row.get('CurrentStock', 0)),
                        PackedQty=0,
                        UnpackedQty=0,
                        LastUpdated=datetime.utcnow(),
                    )
                    db.add(inventory)
                    rows_processed += 1

            except Exception as e:
                rows_skipped += 1
                continue

        log_upload(db, "Stock", None, file.filename, len(contents), current_user.Id,
                   total_rows=len(df), success_rows=rows_processed + rows_updated, error_rows=rows_skipped, status="Success")
        log_audit(db, current_user.Id, "UPLOAD", "Inventory", None,
                  new_values={"type": "Stock", "file": file.filename, "created": rows_processed, "updated": rows_updated})
        db.commit()

        return {
            "success": True,
            "message": "Stock data uploaded successfully",
            "data": {
                "rows_created": rows_processed,
                "rows_updated": rows_updated,
                "rows_skipped": rows_skipped,
                "total_rows": len(df)
            }
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")
