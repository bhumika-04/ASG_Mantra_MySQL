"""
Products Router - Product Master Management
Handles product CRUD operations and product catalog
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional
import pandas as pd
import io
import re
from decimal import Decimal, InvalidOperation

from app.database import get_db
from app.models.user import User
from app.models.product import Product
from app.schemas.product import ProductCreate, ProductUpdate
from app.schemas.common import PaginatedResponse
from app.utils.dependencies import get_current_user

router = APIRouter()


def _norm_identifier(value: Optional[str]) -> Optional[str]:
    """Store a blank channel identifier as NULL, never ''.

    Product resolution matches on equality (Product.AmazonId == asin) across ~25 call
    sites. An empty string sitting in this column is matched by any lookup that
    receives an empty value, silently resolving to the wrong product and moving that
    product's stock. A cleared field must be stored as NULL, never ''.
    """
    if value is None:
        return None
    return value.strip() or None


_ASIN_RE = re.compile(r'^[A-Z0-9]{10}$')
_BLINKIT_RE = re.compile(r'^\d{5,12}$')


def _id_text(value) -> Optional[str]:
    """Channel ID as clean text. Blank -> None. A spreadsheet number such as 10012345.0 -> '10012345'."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    t = str(value).strip()
    if t == '' or t.lower() == 'nan':
        return None
    if re.fullmatch(r'\d+\.0+', t):
        t = t.split('.')[0]
    return t


def _id_problem(amazon_id: Optional[str], blinkit_id: Optional[str]) -> Optional[str]:
    """Format problem with a channel ID, or None."""
    if amazon_id and not _ASIN_RE.match(amazon_id):
        return f"Amazon ID '{amazon_id}' is not a valid ASIN (10 letters/digits)"
    if blinkit_id and not _BLINKIT_RE.match(blinkit_id):
        return f"Blinkit ID '{blinkit_id}' is not valid (digits only)"
    return None


def _id_owner(db: Session, column, value: str, exclude_id: Optional[int] = None):
    """Product that already owns this Amazon/Blinkit ID, or None."""
    q = db.query(Product).filter(column == value)
    if exclude_id is not None:
        q = q.filter(Product.Id != exclude_id)
    return q.first()


@router.get("/categories/list")
async def get_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get list of all unique categories
    """
    categories = db.query(Product.Category).distinct().filter(Product.Category.isnot(None)).all()
    return [cat[0] for cat in categories if cat[0]]


@router.get("/brands/list")
async def get_brands(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get list of all unique brands
    """
    brands = db.query(Product.Brand).distinct().filter(Product.Brand.isnot(None)).all()
    return [brand[0] for brand in brands if brand[0]]


@router.get("/resolve")
async def resolve_product_identifiers(
    q: str = Query(..., min_length=1, description="ASIN, Blinkit item id, or ASG SKU"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Resolve a search term to one product's per-channel identifiers.

    Sales Overview queries Amazon by ASIN and Blinkit by item_id. Sending the same raw
    term to both means searching a cross-listed product by its ASIN reports zero Blinkit
    revenue, and searching by its Blinkit id reports zero Amazon revenue — each view
    hides half the product's sales. Resolving the term first lets every channel be
    queried by the identifier it actually stores.

    Returns matched=False when the term is ambiguous or unmatched (e.g. free-text like
    "Epsom"), so the caller falls back to plain name matching on both channels.
    """
    term = q.strip()
    if not term:
        return {"matched": False}

    matches = db.query(Product).filter(
        or_(
            Product.AmazonId == term,
            Product.BlinkitId == term,
            func.lower(Product.AsgSku) == term.lower(),
        )
    ).all()

    if len(matches) != 1:
        return {"matched": False}

    p = matches[0]
    return {
        "matched": True,
        "asg_sku": p.AsgSku,
        "amazon_id": p.AmazonId,
        "blinkit_id": p.BlinkitId,
        "product_name": p.ProductName,
    }


@router.get("", response_model=PaginatedResponse)
async def get_all_products(
    search: Optional[str] = Query(None, description="Search by product name, SKU, or brand"),
    category: Optional[str] = Query(None, description="Filter by category"),
    brand: Optional[str] = Query(None, description="Filter by brand"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all products with search, filtering, and pagination
    """
    query = db.query(Product)

    # Apply search filter
    if search:
        query = query.filter(
            or_(
                Product.ProductName.ilike(f"%{search}%"),
                Product.AsgSku.ilike(f"%{search}%"),
                Product.AmazonId.ilike(f"%{search}%"),
                Product.BlinkitId.ilike(f"%{search}%"),
                Product.Brand.ilike(f"%{search}%")
            )
        )

    # Apply category filter
    if category:
        query = query.filter(Product.Category == category)

    # Apply brand filter
    if brand:
        query = query.filter(Product.Brand == brand)

    # Apply active status filter
    if is_active is not None:
        query = query.filter(Product.IsActive == is_active)

    # Get total count
    total = query.count()

    # Apply pagination
    offset = (page - 1) * page_size
    products = query.order_by(Product.ProductName).offset(offset).limit(page_size).all()

    # Format response
    items = [
        {
            "id": product.Id,
            "productName": product.ProductName,
            "asgSku": product.AsgSku,
            "amazonId": product.AmazonId,
            "blinkitId": product.BlinkitId,
            "gs1": product.Gs1,
            "category": product.Category,
            "brand": product.Brand,
            "unitPrice": float(product.UnitPrice) if product.UnitPrice else None,
            "unitWeight": product.UnitWeight,
            "packSize": product.PackSize,
            "isActive": product.IsActive,
        }
        for product in products
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/{product_id}")
async def get_product_by_id(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get a single product by ID with full details
    """
    product = db.query(Product).filter(Product.Id == product_id).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    return {
        "id": product.Id,
        "productName": product.ProductName,
        "asgSku": product.AsgSku,
        "amazonId": product.AmazonId,
        "blinkitId": product.BlinkitId,
        "category": product.Category,
        "brand": product.Brand,
        "unitPrice": float(product.UnitPrice) if product.UnitPrice is not None else None,
        "isActive": product.IsActive,
        "createdAt": product.CreatedAt.isoformat() if product.CreatedAt else None,
    }


@router.post("")
async def create_product(
    product_data: ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new product
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Check if ASG SKU already exists
    existing = db.query(Product).filter(Product.AsgSku == product_data.asgSku).first()
    if existing:
        raise HTTPException(status_code=400, detail="Product with this ASG SKU already exists")

    amazon_id = _id_text(product_data.amazonId)
    blinkit_id = _id_text(product_data.blinkitId)
    problem = _id_problem(amazon_id, blinkit_id)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if amazon_id:
        owner = _id_owner(db, Product.AmazonId, amazon_id)
        if owner:
            raise HTTPException(status_code=400, detail=f"Amazon ID {amazon_id} already belongs to product {owner.AsgSku}")
    if blinkit_id:
        owner = _id_owner(db, Product.BlinkitId, blinkit_id)
        if owner:
            raise HTTPException(status_code=400, detail=f"Blinkit ID {blinkit_id} already belongs to product {owner.AsgSku}")

    # Create new product
    new_product = Product(
        ProductName=product_data.productName,
        AsgSku=product_data.asgSku,
        AmazonId=amazon_id,
        BlinkitId=blinkit_id,
        Gs1=product_data.gs1,
        Category=product_data.category,
        Brand=product_data.brand,
        UnitPrice=product_data.unitPrice,
        UnitWeight=product_data.unitWeight,
        PackSize=product_data.packSize,
        IsActive=True,
    )

    try:
        db.add(new_product)
        db.commit()
        db.refresh(new_product)

        return {
            "success": True,
            "message": "Product created successfully",
            "data": {
                "id": new_product.Id,
                "productName": new_product.ProductName,
                "asgSku": new_product.AsgSku,
                "category": new_product.Category,
                "brand": new_product.Brand,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create product: {str(e)}")


@router.put("/{product_id}")
async def update_product(
    product_id: int,
    product_data: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update a product
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    product = db.query(Product).filter(Product.Id == product_id).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Update fields if provided
    if product_data.productName is not None:
        product.ProductName = product_data.productName

    if product_data.asgSku is not None:
        # Check if new SKU conflicts with another product
        existing = db.query(Product).filter(
            Product.AsgSku == product_data.asgSku,
            Product.Id != product_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Another product with this ASG SKU already exists")
        product.AsgSku = product_data.asgSku

    if product_data.amazonId is not None:
        new_amazon = _id_text(product_data.amazonId)
        problem = _id_problem(new_amazon, None)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if new_amazon:
            owner = _id_owner(db, Product.AmazonId, new_amazon, exclude_id=product_id)
            if owner:
                raise HTTPException(status_code=400, detail=f"Amazon ID {new_amazon} already belongs to product {owner.AsgSku}")
        product.AmazonId = new_amazon

    if product_data.blinkitId is not None:
        new_blinkit = _id_text(product_data.blinkitId)
        problem = _id_problem(None, new_blinkit)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if new_blinkit:
            owner = _id_owner(db, Product.BlinkitId, new_blinkit, exclude_id=product_id)
            if owner:
                raise HTTPException(status_code=400, detail=f"Blinkit ID {new_blinkit} already belongs to product {owner.AsgSku}")
        product.BlinkitId = new_blinkit

    if product_data.category is not None:
        product.Category = product_data.category

    if product_data.brand is not None:
        product.Brand = product_data.brand

    if product_data.unitPrice is not None:
        product.UnitPrice = product_data.unitPrice

    if product_data.unitWeight is not None:
        product.UnitWeight = product_data.unitWeight

    if product_data.packSize is not None:
        product.PackSize = product_data.packSize

    if product_data.gs1 is not None:
        product.Gs1 = product_data.gs1

    if product_data.isActive is not None:
        product.IsActive = product_data.isActive

    try:
        db.commit()
        db.refresh(product)

        return {
            "success": True,
            "message": "Product updated successfully",
            "data": {
                "id": product.Id,
                "productName": product.ProductName,
                "asgSku": product.AsgSku,
                "category": product.Category,
                "brand": product.Brand,
                "unitPrice": float(product.UnitPrice) if product.UnitPrice is not None else None,
                "isActive": product.IsActive,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update product: {str(e)}")


@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a product (soft delete by setting IsActive = False)
    Admin only
    """
    # Check permissions - only admin can delete
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can delete products")

    product = db.query(Product).filter(Product.Id == product_id).first()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Soft delete by setting IsActive to False
    product.IsActive = False

    try:
        db.commit()
        return {
            "success": True,
            "message": "Product deactivated successfully"
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete product: {str(e)}")


@router.post("/link-blinkit")
async def link_blinkit_product(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Link a Blinkit item_id to an existing ASG product.
    - Finds the UNLINKED-BLNK-{blinkit_id} placeholder product
    - Sets BlinkitId on the target (real) ASG product
    - Migrates all BlinkitSales / BlinkitInventory rows to the target product
    - Deactivates the placeholder
    Admin/Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    blinkit_id = str(data.get("blinkit_id", "")).strip()
    target_product_id = data.get("target_product_id")

    if not blinkit_id or not target_product_id:
        raise HTTPException(status_code=400, detail="blinkit_id and target_product_id are required")

    target = db.query(Product).filter(Product.Id == target_product_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target product not found")

    # Prevent overwriting an existing different BlinkitId
    if target.BlinkitId and target.BlinkitId != blinkit_id:
        raise HTTPException(
            status_code=400,
            detail=f"Target product already has Blinkit ID {target.BlinkitId}. Unlink it first."
        )

    placeholder_sku = f"UNLINKED-BLNK-{blinkit_id}"[:50]
    placeholder = db.query(Product).filter(Product.AsgSku == placeholder_sku).first()

    try:
        # 1. Set BlinkitId on the real/target product
        target.BlinkitId = blinkit_id

        if placeholder and placeholder.Id != target.Id:
            # 2. Clear BlinkitId on placeholder so BlinkitSales/BlinkitInventory rows
            #    (which join via Product.BlinkitId = ItemId) only resolve to the target — no double-counting
            placeholder.BlinkitId = None

            # 3. Migrate ProductId FK rows from placeholder → target
            from app.models.blinkit_po_item import BlinkitPOItemData
            from app.models.inventory import Inventory
            db.query(BlinkitPOItemData).filter(
                BlinkitPOItemData.ProductId == placeholder.Id
            ).update({"ProductId": target.Id}, synchronize_session=False)
            db.query(Inventory).filter(
                Inventory.ProductId == placeholder.Id
            ).update({"ProductId": target.Id}, synchronize_session=False)

            # 4. Deactivate the placeholder
            placeholder.IsActive = False

        db.commit()
        return {
            "success": True,
            "message": f"Blinkit ID {blinkit_id} linked to {target.ProductName}",
            "target_sku": target.AsgSku,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/link-amazon")
async def link_amazon_product(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Link an Amazon ASIN to an existing ASG product.
    - Finds the UNLINKED-AMZN-{asin} placeholder product
    - Sets AmazonId on the target (real) ASG product
    - Migrates AmazonPOItemData.ProductId and Inventory.ProductId from placeholder → target
    - Deactivates the placeholder
    Admin/Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    asin = str(data.get("asin", "")).strip()
    target_product_id = data.get("target_product_id")

    if not asin or not target_product_id:
        raise HTTPException(status_code=400, detail="asin and target_product_id are required")

    target = db.query(Product).filter(Product.Id == target_product_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target product not found")

    # Prevent overwriting an existing different AmazonId
    if target.AmazonId and target.AmazonId != asin:
        raise HTTPException(
            status_code=400,
            detail=f"Target product already has Amazon ID {target.AmazonId}. Unlink it first."
        )

    placeholder_sku = f"UNLINKED-AMZN-{asin}"[:50]
    placeholder = db.query(Product).filter(Product.AsgSku == placeholder_sku).first()

    try:
        # 1. Set AmazonId on the real/target product
        target.AmazonId = asin

        if placeholder and placeholder.Id != target.Id:
            # 2. Clear AmazonId on placeholder to prevent double-counting in any AmazonId joins
            placeholder.AmazonId = None

            # 3. Migrate ProductId FK rows from placeholder → target
            from app.models.amazon_po_item import AmazonPOItemData
            from app.models.inventory import Inventory
            db.query(AmazonPOItemData).filter(
                AmazonPOItemData.ProductId == placeholder.Id
            ).update({"ProductId": target.Id}, synchronize_session=False)
            db.query(Inventory).filter(
                Inventory.ProductId == placeholder.Id
            ).update({"ProductId": target.Id}, synchronize_session=False)

            # 4. Deactivate the placeholder
            placeholder.IsActive = False

        db.commit()
        return {
            "success": True,
            "message": f"Amazon ASIN {asin} linked to {target.ProductName}",
            "target_sku": target.AsgSku,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


_COLUMN_MAPPING = {
    'product name': 'productName', 'productname': 'productName', 'product_name': 'productName', 'name': 'productName',
    'asg sku': 'asgSku', 'asgsku': 'asgSku', 'asg_sku': 'asgSku', 'asg-sku': 'asgSku', 'asg sku id': 'asgSku',
    'asg-sku-id': 'asgSku', 'asg_sku_id': 'asgSku', 'sku': 'asgSku',
    'amazon id': 'amazonId', 'amazonid': 'amazonId', 'amazon_id': 'amazonId', 'amazon asin': 'amazonId', 'asin': 'amazonId',
    'blinkit id': 'blinkitId', 'blinkitid': 'blinkitId', 'blinkit_id': 'blinkitId', 'blinkit sku': 'blinkitId',
    'blinkit sku id': 'blinkitId', 'blinkit_sku_id': 'blinkitId',
    'gs1': 'gs1', 'gs-1': 'gs1', 'gs1 code': 'gs1', 'gs-1 code': 'gs1', 'gs1_code': 'gs1',
    'category': 'category', 'brand': 'brand',
    'unit price': 'unitPrice', 'unitprice': 'unitPrice', 'unit_price': 'unitPrice', 'price': 'unitPrice', 'mrp': 'unitPrice',
    'unit weight': 'unitWeight', 'unitweight': 'unitWeight', 'unit_weight': 'unitWeight', 'weight': 'unitWeight',
    'pack size': 'packSize', 'packsize': 'packSize', 'pack_size': 'packSize', 'size': 'packSize',
}


def _read_products_file(contents: bytes, ext: str) -> pd.DataFrame:
    """Read the file with every cell as text, so IDs are never turned into numbers (10012345.0)."""
    if ext == 'csv':
        df = pd.read_csv(io.BytesIO(contents), dtype=str)
    else:
        df = pd.read_excel(io.BytesIO(contents), dtype=str)
    df = df.rename(columns={c: _COLUMN_MAPPING.get(str(c).strip().lower(), c) for c in df.columns})
    return df


def _text(value) -> Optional[str]:
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    t = str(value).strip()
    return None if t == '' or t.lower() == 'nan' else t


def _validate_products(df: pd.DataFrame, db: Session) -> list:
    """Check every row. Returns one dict per row with status 'valid' | 'duplicate' | 'error' and a reason.

    Skipped (never saved): a missing name or SKU, a SKU already in the database or earlier in the
    file, an Amazon/Blinkit ID that is malformed or already belongs to another product or an earlier
    row, and a bad price or pack size. Valid rows are not affected by the skipped ones.
    """
    existing_skus = {(p[0] or '').strip().lower() for p in db.query(Product.AsgSku).all()}
    amazon_owner = {p[0]: p[1] for p in db.query(Product.AmazonId, Product.AsgSku).filter(Product.AmazonId.isnot(None)).all()}
    blinkit_owner = {p[0]: p[1] for p in db.query(Product.BlinkitId, Product.AsgSku).filter(Product.BlinkitId.isnot(None)).all()}
    seen_sku, seen_amz, seen_blk = {}, {}, {}
    rows = []

    for index, row in df.iterrows():
        n = index + 2  # header row + 1-based
        name, sku = _text(row.get('productName')), _text(row.get('asgSku'))
        amz, blk = _id_text(row.get('amazonId')), _id_text(row.get('blinkitId'))
        out = {
            'rowNumber': n, 'status': 'valid', 'reason': None,
            'productName': name or '', 'asgSku': sku or '', 'amazonId': amz, 'blinkitId': blk,
            'gs1': _text(row.get('gs1')), 'brand': _text(row.get('brand')), 'category': _text(row.get('category')),
            'unitPrice': None, 'unitWeight': _text(row.get('unitWeight')), 'packSize': None,
        }

        def fail(status, reason):
            out['status'], out['reason'] = status, reason
            rows.append(out)

        if not name and not sku:
            fail('error', 'Missing both Product Name and ASG SKU'); continue
        if not name:
            fail('error', 'Missing Product Name (required)'); continue
        if not sku:
            fail('error', 'Missing ASG SKU (required)'); continue
        key = sku.lower()
        if key in existing_skus:
            fail('duplicate', f'ASG SKU "{sku}" already exists in the database'); continue
        if key in seen_sku:
            fail('duplicate', f'ASG SKU "{sku}" is repeated in this file (first on row {seen_sku[key]})'); continue
        problem = _id_problem(amz, blk)
        if problem:
            fail('error', problem); continue
        if amz and amz in amazon_owner:
            fail('error', f'Amazon ID {amz} already belongs to product {amazon_owner[amz]}'); continue
        if amz and amz in seen_amz:
            fail('error', f'Amazon ID {amz} is repeated in this file (first on row {seen_amz[amz]})'); continue
        if blk and blk in blinkit_owner:
            fail('error', f'Blinkit ID {blk} already belongs to product {blinkit_owner[blk]}'); continue
        if blk and blk in seen_blk:
            fail('error', f'Blinkit ID {blk} is repeated in this file (first on row {seen_blk[blk]})'); continue
        price, pack = _text(row.get('unitPrice')), _text(row.get('packSize'))
        if price is not None:
            try:
                out['unitPrice'] = Decimal(price.replace(',', ''))
                if out['unitPrice'] < 0:
                    raise InvalidOperation
            except InvalidOperation:
                fail('error', f'Unit price "{price}" is not a valid amount'); continue
        if pack is not None:
            try:
                out['packSize'] = int(float(pack))
                if out['packSize'] < 1:
                    raise ValueError
            except ValueError:
                fail('error', f'Pack size "{pack}" is not a whole number of 1 or more'); continue

        seen_sku[key] = n
        if amz:
            seen_amz[amz] = n
        if blk:
            seen_blk[blk] = n
        rows.append(out)
    return rows


def _check_products_upload(file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    ext = file.filename.split('.')[-1].lower()
    if ext not in ('csv', 'xlsx', 'xls'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload CSV or Excel file")
    return ext


@router.post("/upload")
async def upload_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload products from Excel/CSV. Valid rows are saved; rows that are skipped (duplicate SKU,
    duplicate or malformed Amazon/Blinkit ID, missing fields, bad price) are listed with the
    reason. Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ext = _check_products_upload(file)

    try:
        df = _read_products_file(await file.read(), ext)
        missing = [c for c in ('productName', 'asgSku') if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {', '.join(missing)}. Your file has columns: {', '.join(map(str, df.columns))}"
            )
        rows = _validate_products(df, db)
        uploaded, skipped = [], []
        for r in rows:
            if r['status'] == 'valid':
                db.add(Product(
                    ProductName=r['productName'], AsgSku=r['asgSku'], AmazonId=r['amazonId'], BlinkitId=r['blinkitId'],
                    Gs1=r['gs1'], Category=r['category'], Brand=r['brand'], UnitPrice=r['unitPrice'],
                    UnitWeight=r['unitWeight'], PackSize=r['packSize'], IsActive=True,
                ))
                uploaded.append({'asgSku': r['asgSku'], 'productName': r['productName']})
            else:
                skipped.append({'row': r['rowNumber'], 'asgSku': r['asgSku'], 'productName': r['productName'],
                                'reason': r['reason'], 'type': r['status']})
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to save products: {str(e)}")

        return {
            "success": True,
            "message": f"Upload completed. {len(uploaded)} products added, {len(skipped)} skipped",
            "summary": {"totalRows": len(df), "uploaded": len(uploaded), "skipped": len(skipped), "errors": 0},
            "uploadedProducts": uploaded,
            "skippedProducts": skipped,
            "errors": [],
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/preview")
async def preview_products_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Preview what a product CSV/Excel upload would do — no DB writes. Uses exactly the same checks
    as the upload, so every row marked valid will be saved and every other row is skipped with its reason.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    ext = _check_products_upload(file)

    try:
        df = _read_products_file(await file.read(), ext)
        if 'productName' not in df.columns and 'asgSku' not in df.columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: productName, asgSku. File has: {', '.join(map(str, df.columns))}"
            )
        for need in ('productName', 'asgSku'):
            if need not in df.columns:
                df[need] = None
        rows = _validate_products(df, db)
        for r in rows:
            r['unitPrice'] = float(r['unitPrice']) if r['unitPrice'] is not None else None
        return {
            "success": True,
            "totalRows": len(df),
            "valid": sum(1 for r in rows if r['status'] == 'valid'),
            "duplicates": sum(1 for r in rows if r['status'] == 'duplicate'),
            "errors": sum(1 for r in rows if r['status'] == 'error'),
            "rows": rows,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")
