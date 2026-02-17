"""
Inventory Router - Inventory Management
Handles inventory queries, updates, and low stock alerts
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import Optional, List
from datetime import datetime, date as date_type

from app.database import get_db
from app.models.user import User
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.amazon_inventory import AmazonInventoryData
from app.models.blinkit_inventory import BlinkitInventoryData
from app.schemas.inventory import InventoryResponse, InventoryUpdate
from app.schemas.common import PaginatedResponse
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("", response_model=PaginatedResponse, include_in_schema=False)
@router.get("/", response_model=PaginatedResponse)
async def get_inventory(
    search: Optional[str] = Query(None, description="Search by product name or SKU"),
    channel: Optional[str] = Query(None, description="Filter by channel (Amazon/Blinkit)"),
    inventory_date: Optional[str] = Query(None, description="Filter by inventory date (YYYY-MM-DD). Defaults to latest."),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=1000, description="Items per page"),
    low_stock_only: Optional[bool] = Query(False, description="Show only low stock items"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get inventory list with search, filtering, and pagination.
    Defaults to latest inventory date (date-wise snapshots).
    """
    # Base query with product join
    query = db.query(Inventory).join(Product, Inventory.ProductId == Product.Id)

    # Date filtering — default to latest date
    if inventory_date:
        try:
            inv_date = datetime.strptime(inventory_date, "%Y-%m-%d").date()
            query = query.filter(Inventory.InventoryDate == inv_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid inventory_date format. Use YYYY-MM-DD.")
    else:
        latest_date = db.query(func.max(Inventory.InventoryDate)).scalar()
        if latest_date:
            query = query.filter(Inventory.InventoryDate == latest_date)

    # Apply search filter
    if search:
        query = query.filter(
            or_(
                Product.ProductName.ilike(f"%{search}%"),
                Product.AsgSku.ilike(f"%{search}%"),
                Product.AmazonId.ilike(f"%{search}%"),
                Product.BlinkitId.ilike(f"%{search}%")
            )
        )

    # Apply low stock filter
    if low_stock_only:
        query = query.filter(Inventory.CurrentStock == 0)

    # Get total count
    total = query.count()

    # Apply pagination
    offset = (page - 1) * page_size
    inventory_items = query.order_by(Inventory.LastUpdated.desc()).offset(offset).limit(page_size).all()

    # Available dates for the date picker
    available_dates = db.query(Inventory.InventoryDate).distinct().order_by(
        Inventory.InventoryDate.desc()
    ).limit(60).all()

    # Format response with product details
    items = []
    for item in inventory_items:
        product = item.product
        items.append({
            "id": item.Id,
            "product_id": item.ProductId,
            "product_name": product.ProductName,
            "asg_sku": product.AsgSku,
            "amazon_id": product.AmazonId,
            "blinkit_id": product.BlinkitId,
            "asg_warehouse_id": item.AsgWarehouseId,
            "warehouse_name": item.asg_warehouse.WarehouseName if item.asg_warehouse else None,
            "current_stock": item.CurrentStock,
            "packed_qty": item.PackedQty,
            "unpacked_qty": item.UnpackedQty,
            "inventory_date": item.InventoryDate.isoformat() if item.InventoryDate else None,
            "last_updated": item.LastUpdated.isoformat() if item.LastUpdated else None,
            "is_low_stock": item.CurrentStock == 0,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
        "available_dates": [d[0].isoformat() for d in available_dates if d[0]],
    }


@router.get("/low-stock", response_model=dict)
async def get_low_stock_dashboard(
    limit: int = Query(5, ge=1, le=50, description="Number of items to return"),
    channel: Optional[str] = Query(None, description="Filter by channel"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get low stock items for dashboard display
    Returns items that have pending 'To Pack' quantities in Purchase Orders
    (Ordered quantity > Packed quantity), indicating need for more inventory
    """
    from sqlalchemy import func, case
    from app.models.purchase_order import PurchaseOrder

    # Query to find products with pending "To Pack" quantities
    # Group PO quantities by product (across all channels)
    subquery = db.query(
        PurchaseOrder.ProductId,
        func.sum(
            case(
                (PurchaseOrder.Quantity > PurchaseOrder.ReceivedQuantity,
                 PurchaseOrder.Quantity - PurchaseOrder.ReceivedQuantity),
                else_=0
            )
        ).label('to_pack_qty')
    ).filter(
        PurchaseOrder.Status.in_(['Created', 'Packed', 'Dispatched', 'In Transit', 'Delayed'])
    ).group_by(PurchaseOrder.ProductId).subquery()

    # Join with Inventory (ASG stock) and Product
    query = db.query(
        Inventory,
        Product,
        subquery.c.to_pack_qty
    ).join(
        Product, Inventory.ProductId == Product.Id
    ).join(
        subquery,
        Inventory.ProductId == subquery.c.ProductId
    ).filter(
        subquery.c.to_pack_qty > 0
    )

    # Order by highest to_pack_qty first (most urgent)
    query = query.order_by(subquery.c.to_pack_qty.desc()).limit(limit)

    results = query.all()

    items = []
    for inv, prod, to_pack_qty in results:
        items.append({
            "id": inv.Id,
            "productName": prod.ProductName,
            "asgSku": prod.AsgSku,
            "currentStock": inv.CurrentStock,
            "toPackQty": int(to_pack_qty or 0),
        })

    return {"items": items, "total": len(items)}


@router.get("/alerts/low-stock", response_model=List[dict])
async def get_low_stock_items(
    channel: Optional[str] = Query(None, description="Filter by channel"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all low stock items across inventory
    Returns items with pending 'To Pack' quantities from Purchase Orders
    """
    from sqlalchemy import func, case
    from app.models.purchase_order import PurchaseOrder

    # Query to find products with pending "To Pack" quantities
    subquery = db.query(
        PurchaseOrder.ProductId,
        func.sum(
            case(
                (PurchaseOrder.Quantity > PurchaseOrder.ReceivedQuantity,
                 PurchaseOrder.Quantity - PurchaseOrder.ReceivedQuantity),
                else_=0
            )
        ).label('to_pack_qty')
    ).filter(
        PurchaseOrder.Status.in_(['Created', 'Packed', 'Dispatched', 'In Transit', 'Delayed'])
    ).group_by(PurchaseOrder.ProductId).subquery()

    # Join with Inventory (ASG stock) and Product
    query = db.query(
        Inventory,
        Product,
        subquery.c.to_pack_qty
    ).join(
        Product, Inventory.ProductId == Product.Id
    ).join(
        subquery,
        Inventory.ProductId == subquery.c.ProductId
    ).filter(
        subquery.c.to_pack_qty > 0
    )

    # Order by highest to_pack_qty first (most urgent)
    query = query.order_by(subquery.c.to_pack_qty.desc())

    results = query.all()

    items = []
    for inv, prod, to_pack_qty in results:
        items.append({
            "id": inv.Id,
            "product_id": inv.ProductId,
            "product_name": prod.ProductName,
            "asg_sku": prod.AsgSku,
            "current_stock": inv.CurrentStock,
            "packed_qty": inv.PackedQty,
            "unpacked_qty": inv.UnpackedQty,
            "to_pack_qty": int(to_pack_qty or 0),
            "last_updated": inv.LastUpdated.isoformat() if inv.LastUpdated else None,
        })

    return items


@router.get("/dispatch-overview", response_model=dict)
async def get_dispatch_overview(
    search: Optional[str] = Query(None, description="Search by name, SKU, ASIN or Blinkit ID"),
    inventory_date: Optional[str] = Query(None, description="ASG inventory date (YYYY-MM-DD). Defaults to latest."),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Per-product inventory overview using correct platform data sources:
    - PackedQty / UnpackedQty : Inventory table  (ASG warehouse stock)
    - Amazon stock            : AmazonInventory.SellableOnHandUnits (latest ReportDate)
    - Blinkit stock           : BlinkitInventory.BackendInvQty       (latest ReportDate)
    """
    # ── Latest report dates for each platform ────────────────────────────
    latest_amazon = db.query(func.max(AmazonInventoryData.ReportDate)).scalar()
    latest_blinkit = db.query(func.max(BlinkitInventoryData.ReportDate)).scalar()

    # ── Amazon stock subquery ─────────────────────────────────────────────
    amz_q = db.query(
        AmazonInventoryData.ASIN.label('asin'),
        func.sum(AmazonInventoryData.SellableOnHandUnits).label('amazon_stock'),
    )
    if latest_amazon:
        amz_q = amz_q.filter(AmazonInventoryData.ReportDate == latest_amazon)
    else:
        amz_q = amz_q.filter(False)
    amazon_sq = amz_q.group_by(AmazonInventoryData.ASIN).subquery()

    # ── Blinkit stock subquery ────────────────────────────────────────────
    blk_q = db.query(
        BlinkitInventoryData.ItemId.label('item_id'),
        func.sum(BlinkitInventoryData.BackendInvQty).label('blinkit_stock'),
    )
    if latest_blinkit:
        blk_q = blk_q.filter(BlinkitInventoryData.ReportDate == latest_blinkit)
    else:
        blk_q = blk_q.filter(False)
    blinkit_sq = blk_q.group_by(BlinkitInventoryData.ItemId).subquery()

    # ── ASG warehouse packed/unpacked subquery (latest or selected date) ──
    # Available dates for picker
    available_inv_dates = db.query(Inventory.InventoryDate).distinct().order_by(
        Inventory.InventoryDate.desc()
    ).limit(60).all()
    available_inv_dates = [d[0].isoformat() for d in available_inv_dates if d[0]]

    if inventory_date:
        try:
            selected_inv_date = datetime.strptime(inventory_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid inventory_date format. Use YYYY-MM-DD.")
    else:
        selected_inv_date = db.query(func.max(Inventory.InventoryDate)).scalar()

    wh_q = db.query(
        Inventory.ProductId.label('product_id'),
        func.sum(Inventory.PackedQty).label('packed_qty'),
        func.sum(Inventory.UnpackedQty).label('unpacked_qty'),
    )
    if selected_inv_date:
        wh_q = wh_q.filter(Inventory.InventoryDate == selected_inv_date)
    wh_sq = wh_q.group_by(Inventory.ProductId).subquery()

    # ── Main query ────────────────────────────────────────────────────────
    query = (
        db.query(
            Product.Id.label('product_id'),
            Product.ProductName.label('product_name'),
            Product.AsgSku.label('asg_sku'),
            Product.AmazonId.label('amazon_id'),
            Product.BlinkitId.label('blinkit_id'),
            Product.Gs1.label('gs1'),
            func.coalesce(wh_sq.c.packed_qty, 0).label('packed_qty'),
            func.coalesce(wh_sq.c.unpacked_qty, 0).label('unpacked_qty'),
            func.coalesce(amazon_sq.c.amazon_stock, 0).label('amazon_stock'),
            func.coalesce(blinkit_sq.c.blinkit_stock, 0).label('blinkit_stock'),
        )
        .filter(Product.IsActive == True)
        .outerjoin(wh_sq, wh_sq.c.product_id == Product.Id)
        .outerjoin(amazon_sq, amazon_sq.c.asin == Product.AmazonId)
        .outerjoin(blinkit_sq, blinkit_sq.c.item_id == Product.BlinkitId)
    )

    if search:
        q_lower = f"%{search}%"
        query = query.filter(
            or_(
                Product.ProductName.ilike(q_lower),
                Product.AsgSku.ilike(q_lower),
                Product.AmazonId.ilike(q_lower),
                Product.BlinkitId.ilike(q_lower),
            )
        )

    total = query.count()
    offset = (page - 1) * page_size
    rows = query.order_by(Product.ProductName).offset(offset).limit(page_size).all()

    items = []
    for row in rows:
        packed = int(row.packed_qty or 0)
        unpacked = int(row.unpacked_qty or 0)
        amazon = int(row.amazon_stock or 0)
        blinkit = int(row.blinkit_stock or 0)
        total_stock = amazon + blinkit

        # Simplified status (ReorderLevel removed)
        if total_stock == 0:
            status = 'Out of Stock'
        else:
            status = 'Healthy'

        items.append({
            'id': row.product_id,
            'productName': row.product_name,
            'asgSku': row.asg_sku,
            'amazonId': row.amazon_id,
            'blinkitId': row.blinkit_id,
            'gs1': row.gs1,
            'packedQty': packed,
            'unpackedQty': unpacked,
            'amazonStock': amazon,
            'blinkitStock': blinkit,
            'totalStock': total_stock,
            'status': status,
        })

    return {
        'items': items,
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': (total + page_size - 1) // page_size,
        'amazonDate': str(latest_amazon) if latest_amazon else None,
        'blinkitDate': str(latest_blinkit) if latest_blinkit else None,
        'inventoryDate': str(selected_inv_date) if selected_inv_date else None,
        'availableDates': available_inv_dates,
    }


@router.get("/{inventory_id}", response_model=dict)
async def get_inventory_by_id(
    inventory_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get a single inventory item by ID with full details
    """
    inventory = db.query(Inventory).filter(Inventory.Id == inventory_id).first()

    if not inventory:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    product = inventory.product
    asg_warehouse = inventory.asg_warehouse if inventory.asg_warehouse else None

    return {
        "id": inventory.Id,
        "product_id": inventory.ProductId,
        "product_name": product.ProductName,
        "asg_sku": product.AsgSku,
        "amazon_id": product.AmazonId,
        "blinkit_id": product.BlinkitId,
        "category": product.Category,
        "brand": product.Brand,
        "unit_price": float(product.UnitPrice) if product.UnitPrice is not None else None,
        "asg_warehouse_id": inventory.AsgWarehouseId,
        "warehouse_name": asg_warehouse.WarehouseName if asg_warehouse else None,
        "current_stock": inventory.CurrentStock,
        "packed_qty": inventory.PackedQty,
        "unpacked_qty": inventory.UnpackedQty,
        "last_inventory_date": inventory.LastInventoryDate.isoformat() if inventory.LastInventoryDate else None,
        "last_updated": inventory.LastUpdated.isoformat() if inventory.LastUpdated else None,
        "is_low_stock": inventory.CurrentStock == 0,  # Simplified: out of stock only
    }


@router.put("/{inventory_id}", response_model=dict)
async def update_inventory(
    inventory_id: int,
    update_data: InventoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update inventory quantities and thresholds
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    inventory = db.query(Inventory).filter(Inventory.Id == inventory_id).first()

    if not inventory:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    # Update fields if provided
    if update_data.packedQty is not None:
        inventory.PackedQty = update_data.packedQty

    if update_data.unpackedQty is not None:
        inventory.UnpackedQty = update_data.unpackedQty

    # Recalculate CurrentStock after both fields are updated
    if update_data.packedQty is not None or update_data.unpackedQty is not None:
        inventory.CurrentStock = inventory.PackedQty + inventory.UnpackedQty

    # Note: minStockLevel and maxStockLevel removed (ReorderLevel/MaxStockLevel columns deleted)

    inventory.LastUpdated = datetime.utcnow()

    try:
        db.commit()
        db.refresh(inventory)

        return {
            "success": True,
            "message": "Inventory updated successfully",
            "data": {
                "id": inventory.Id,
                "current_stock": inventory.CurrentStock,
                "packed_qty": inventory.PackedQty,
                "unpacked_qty": inventory.UnpackedQty,
                "last_updated": inventory.LastUpdated.isoformat()
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update inventory: {str(e)}")
