"""
Products Router - Product Master Management
Handles product CRUD operations and product catalog
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional, List
import pandas as pd
import io
from decimal import Decimal

from app.database import get_db
from app.models.user import User
from app.models.product import Product
from app.schemas.product import ProductCreate, ProductUpdate
from app.schemas.common import PaginatedResponse
from app.utils.dependencies import get_current_user

router = APIRouter()


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

    # Create new product
    new_product = Product(
        ProductName=product_data.productName,
        AsgSku=product_data.asgSku,
        AmazonId=product_data.amazonId,
        BlinkitId=product_data.blinkitId,
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
        product.AmazonId = product_data.amazonId

    if product_data.blinkitId is not None:
        product.BlinkitId = product_data.blinkitId

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


@router.post("/upload")
async def upload_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Upload products from Excel/CSV file with duplicate checking
    Only uploads products that don't exist based on ASG SKU
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_extension = file.filename.split('.')[-1].lower()
    if file_extension not in ['csv', 'xlsx', 'xls']:
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload CSV or Excel file")

    try:
        # Read file content
        contents = await file.read()

        # Parse file based on type
        if file_extension == 'csv':
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))

        # Normalize column names - handle common variations
        column_mapping = {
            # Product Name variations
            'product name': 'productName',
            'productname': 'productName',
            'product_name': 'productName',
            'name': 'productName',

            # ASG SKU variations
            'asg sku': 'asgSku',
            'asgsku': 'asgSku',
            'asg_sku': 'asgSku',
            'asg-sku': 'asgSku',
            'asg sku id': 'asgSku',
            'asg-sku-id': 'asgSku',
            'asg_sku_id': 'asgSku',
            'sku': 'asgSku',

            # Amazon ID variations
            'amazon id': 'amazonId',
            'amazonid': 'amazonId',
            'amazon_id': 'amazonId',
            'amazon asin': 'amazonId',
            'asin': 'amazonId',

            # Blinkit ID variations
            'blinkit id': 'blinkitId',
            'blinkitid': 'blinkitId',
            'blinkit_id': 'blinkitId',
            'blinkit sku': 'blinkitId',
            'blinkit sku id': 'blinkitId',
            'blinkit_sku_id': 'blinkitId',

            # GS1 variations
            'gs1': 'gs1',
            'gs-1': 'gs1',
            'gs1 code': 'gs1',
            'gs-1 code': 'gs1',
            'gs1_code': 'gs1',

            # Category variations
            'category': 'category',

            # Brand variations
            'brand': 'brand',

            # Unit Price variations
            'unit price': 'unitPrice',
            'unitprice': 'unitPrice',
            'unit_price': 'unitPrice',
            'price': 'unitPrice',
            'mrp': 'unitPrice',

            # Unit Weight variations
            'unit weight': 'unitWeight',
            'unitweight': 'unitWeight',
            'unit_weight': 'unitWeight',
            'weight': 'unitWeight',

            # Pack Size variations
            'pack size': 'packSize',
            'packsize': 'packSize',
            'pack_size': 'packSize',
            'size': 'packSize',
        }

        # Create a mapping of current columns to standardized names
        new_columns = {}
        for col in df.columns:
            col_lower = str(col).strip().lower()
            if col_lower in column_mapping:
                new_columns[col] = column_mapping[col_lower]
            else:
                new_columns[col] = col

        # Rename columns
        df = df.rename(columns=new_columns)

        # Validate required columns
        required_columns = ['productName', 'asgSku']
        missing_columns = [col for col in required_columns if col not in df.columns]

        if missing_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {', '.join(missing_columns)}. Your file has columns: {', '.join(df.columns.tolist())}"
            )

        total_rows = len(df)
        uploaded_products = []
        skipped_products = []
        errors = []

        # Process each row
        for index, row in df.iterrows():
            try:
                # Check if ASG SKU is provided
                if pd.isna(row.get('asgSku')) or str(row.get('asgSku')).strip() == '':
                    errors.append({
                        'row': index + 2,  # +2 because Excel rows start at 1 and we have header
                        'error': 'Missing ASG SKU'
                    })
                    continue

                asg_sku = str(row['asgSku']).strip()

                # Check if product already exists
                existing = db.query(Product).filter(Product.AsgSku == asg_sku).first()

                if existing:
                    skipped_products.append({
                        'asgSku': asg_sku,
                        'productName': str(row.get('productName', '')),
                        'reason': 'Already exists in database'
                    })
                    continue

                # Create new product
                new_product = Product(
                    ProductName=str(row.get('productName', '')).strip() if not pd.isna(row.get('productName')) else '',
                    AsgSku=asg_sku,
                    AmazonId=str(row.get('amazonId', '')).strip() if not pd.isna(row.get('amazonId')) else None,
                    BlinkitId=str(row.get('blinkitId', '')).strip() if not pd.isna(row.get('blinkitId')) else None,
                    Gs1=str(row.get('gs1', '')).strip() if not pd.isna(row.get('gs1')) else None,
                    Category=str(row.get('category', '')).strip() if not pd.isna(row.get('category')) else None,
                    Brand=str(row.get('brand', '')).strip() if not pd.isna(row.get('brand')) else None,
                    UnitPrice=Decimal(str(row.get('unitPrice', 0))) if not pd.isna(row.get('unitPrice')) and row.get('unitPrice') != '' else None,
                    UnitWeight=str(row.get('unitWeight', '')).strip() if not pd.isna(row.get('unitWeight')) else None,
                    PackSize=int(row.get('packSize')) if not pd.isna(row.get('packSize')) and str(row.get('packSize')).strip() != '' else None,
                    IsActive=True
                )

                db.add(new_product)
                uploaded_products.append({
                    'asgSku': asg_sku,
                    'productName': new_product.ProductName
                })

            except Exception as e:
                errors.append({
                    'row': index + 2,
                    'error': str(e)
                })

        # Commit all new products
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to save products: {str(e)}")

        return {
            "success": True,
            "message": f"Upload completed. {len(uploaded_products)} products added, {len(skipped_products)} skipped",
            "summary": {
                "totalRows": total_rows,
                "uploaded": len(uploaded_products),
                "skipped": len(skipped_products),
                "errors": len(errors)
            },
            "uploadedProducts": uploaded_products,
            "skippedProducts": skipped_products,
            "errors": errors
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")


@router.post("/preview")
async def preview_products_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Preview what a product CSV/Excel upload would do — no DB writes.
    Returns per-row status: valid | duplicate | error
    Validates required fields: productName, asgSku
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    file_extension = file.filename.split('.')[-1].lower()
    if file_extension not in ['csv', 'xlsx', 'xls']:
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload CSV or Excel file")

    try:
        contents = await file.read()

        if file_extension == 'csv':
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))

        # Same column normalization as upload
        column_mapping = {
            'product name': 'productName', 'productname': 'productName',
            'product_name': 'productName', 'name': 'productName',
            'asg sku': 'asgSku', 'asgsku': 'asgSku', 'asg_sku': 'asgSku',
            'asg-sku': 'asgSku', 'asg sku id': 'asgSku', 'asg-sku-id': 'asgSku',
            'asg_sku_id': 'asgSku', 'sku': 'asgSku',
            'amazon id': 'amazonId', 'amazonid': 'amazonId', 'amazon_id': 'amazonId',
            'amazon asin': 'amazonId', 'asin': 'amazonId',
            'blinkit id': 'blinkitId', 'blinkitid': 'blinkitId', 'blinkit_id': 'blinkitId',
            'blinkit sku': 'blinkitId', 'blinkit sku id': 'blinkitId', 'blinkit_sku_id': 'blinkitId',
            'gs1': 'gs1', 'gs-1': 'gs1', 'gs1 code': 'gs1', 'gs-1 code': 'gs1', 'gs1_code': 'gs1',
            'category': 'category', 'brand': 'brand',
            'unit price': 'unitPrice', 'unitprice': 'unitPrice', 'unit_price': 'unitPrice',
            'price': 'unitPrice', 'mrp': 'unitPrice',
            'unit weight': 'unitWeight', 'unitweight': 'unitWeight', 'unit_weight': 'unitWeight',
            'weight': 'unitWeight',
            'pack size': 'packSize', 'packsize': 'packSize', 'pack_size': 'packSize', 'size': 'packSize',
        }
        new_columns = {}
        for col in df.columns:
            col_lower = str(col).strip().lower()
            new_columns[col] = column_mapping.get(col_lower, col)
        df = df.rename(columns=new_columns)

        # Check required columns exist in file
        if 'productName' not in df.columns and 'asgSku' not in df.columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: productName, asgSku. File has: {', '.join(df.columns.tolist())}"
            )

        rows = []
        valid_count = 0
        duplicate_count = 0
        error_count = 0

        for index, row in df.iterrows():
            row_number = index + 2  # +2: header row + 1-based

            product_name = str(row.get('productName', '')).strip() if not pd.isna(row.get('productName', '')) else ''
            asg_sku = str(row.get('asgSku', '')).strip() if not pd.isna(row.get('asgSku', '')) else ''

            # Validate required fields
            if not product_name and not asg_sku:
                error_count += 1
                rows.append({
                    'rowNumber': row_number,
                    'status': 'error',
                    'reason': 'Missing both Product Name and ASG SKU',
                    'productName': '', 'asgSku': '', 'amazonId': None,
                    'blinkitId': None, 'gs1': None, 'brand': None,
                    'category': None, 'unitPrice': None, 'unitWeight': None, 'packSize': None,
                })
                continue

            if not product_name:
                error_count += 1
                rows.append({
                    'rowNumber': row_number,
                    'status': 'error',
                    'reason': 'Missing Product Name (required)',
                    'productName': '', 'asgSku': asg_sku, 'amazonId': None,
                    'blinkitId': None, 'gs1': None, 'brand': None,
                    'category': None, 'unitPrice': None, 'unitWeight': None, 'packSize': None,
                })
                continue

            if not asg_sku:
                error_count += 1
                rows.append({
                    'rowNumber': row_number,
                    'status': 'error',
                    'reason': 'Missing ASG SKU (required)',
                    'productName': product_name, 'asgSku': '', 'amazonId': None,
                    'blinkitId': None, 'gs1': None, 'brand': None,
                    'category': None, 'unitPrice': None, 'unitWeight': None, 'packSize': None,
                })
                continue

            # Check duplicate in DB
            existing = db.query(Product).filter(Product.AsgSku == asg_sku).first()
            if existing:
                duplicate_count += 1
                rows.append({
                    'rowNumber': row_number,
                    'status': 'duplicate',
                    'reason': f'ASG SKU "{asg_sku}" already exists in database',
                    'productName': product_name,
                    'asgSku': asg_sku,
                    'amazonId': str(row.get('amazonId', '')).strip() if not pd.isna(row.get('amazonId', '')) else None,
                    'blinkitId': str(row.get('blinkitId', '')).strip() if not pd.isna(row.get('blinkitId', '')) else None,
                    'gs1': str(row.get('gs1', '')).strip() if not pd.isna(row.get('gs1', '')) else None,
                    'brand': str(row.get('brand', '')).strip() if not pd.isna(row.get('brand', '')) else None,
                    'category': str(row.get('category', '')).strip() if not pd.isna(row.get('category', '')) else None,
                    'unitPrice': float(row.get('unitPrice')) if not pd.isna(row.get('unitPrice', float('nan'))) else None,
                    'unitWeight': str(row.get('unitWeight', '')).strip() if not pd.isna(row.get('unitWeight', '')) else None,
                    'packSize': int(row.get('packSize')) if not pd.isna(row.get('packSize', float('nan'))) else None,
                })
                continue

            valid_count += 1
            rows.append({
                'rowNumber': row_number,
                'status': 'valid',
                'reason': None,
                'productName': product_name,
                'asgSku': asg_sku,
                'amazonId': str(row.get('amazonId', '')).strip() if not pd.isna(row.get('amazonId', '')) else None,
                'blinkitId': str(row.get('blinkitId', '')).strip() if not pd.isna(row.get('blinkitId', '')) else None,
                'gs1': str(row.get('gs1', '')).strip() if not pd.isna(row.get('gs1', '')) else None,
                'brand': str(row.get('brand', '')).strip() if not pd.isna(row.get('brand', '')) else None,
                'category': str(row.get('category', '')).strip() if not pd.isna(row.get('category', '')) else None,
                'unitPrice': float(row.get('unitPrice')) if not pd.isna(row.get('unitPrice', float('nan'))) else None,
                'unitWeight': str(row.get('unitWeight', '')).strip() if not pd.isna(row.get('unitWeight', '')) else None,
                'packSize': int(row.get('packSize')) if not pd.isna(row.get('packSize', float('nan'))) else None,
            })

        return {
            "success": True,
            "totalRows": len(df),
            "valid": valid_count,
            "duplicates": duplicate_count,
            "errors": error_count,
            "rows": rows,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to preview file: {str(e)}")
