"""
Purchase Orders Router - PO Management
Handles purchase order lifecycle, creation, and tracking
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional, List
from datetime import datetime

from datetime import date

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
from app.utils.audit import log_audit

router = APIRouter()


@router.get("/amazon", response_model=PaginatedResponse)
async def get_amazon_purchase_orders(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
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

    total = query.count()
    offset = (page - 1) * page_size
    po_items = query.order_by(desc(AmazonPOData.OrderedOnDate)).offset(offset).limit(page_size).all()

    today = date.today()
    items = []
    for item in po_items:
        po = item.po
        packed_qty = 0
        product_id = None
        asg_sku = None
        product_name = item.Title or item.ModelNumber or item.ASIN or ''

        # Look up Product by ASIN to get packed qty
        product = db.query(Product).filter(Product.AmazonId == item.ASIN).first()
        if product:
            product_id = product.Id
            asg_sku = product.AsgSku
            product_name = product.ProductName
            from sqlalchemy import func
            packed_qty = db.query(func.sum(Inventory.PackedQty)).filter(
                Inventory.ProductId == product.Id
            ).scalar() or 0

        qty_requested = item.QuantityRequested or 0
        gap = max(0, qty_requested - packed_qty)

        # Use item-level ExpectedDate; fall back to PO-level
        expected_date = None
        if item.ExpectedDate:
            expected_date = item.ExpectedDate.isoformat()
        elif po and po.OrderedOnDate:
            expected_date = None  # no fallback — leave None

        po_status = (po.POStatus if po else None) or 'Created'
        is_delayed = bool(
            item.ExpectedDate
            and item.ExpectedDate < today
            and po_status not in ('Received', 'Delivered', 'Cancelled', 'Closed')
        )

        items.append({
            "id": item.Id,
            "po_number": item.PONumber,
            "product_id": product_id,
            "product_name": product_name,
            "asg_sku": asg_sku,
            "amazon_id": item.ASIN,
            "order_date": po.OrderedOnDate.isoformat() if po and po.OrderedOnDate else None,
            "expected_delivery_date": expected_date,
            "quantity": qty_requested,
            "received_quantity": item.QuantityReceived or 0,
            "packed_qty": packed_qty,
            "gap": gap,
            "unit_price": float(item.UnitCost) if item.UnitCost else 0.0,
            "total_amount": float(item.TotalCost) if item.TotalCost else 0.0,
            "status": po_status,
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


@router.get("/blinkit", response_model=PaginatedResponse)
async def get_blinkit_purchase_orders(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
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

    total = query.count()
    offset = (page - 1) * page_size
    po_items = query.order_by(desc(BlinkitPOData.PODate)).offset(offset).limit(page_size).all()

    today = date.today()
    items = []
    for item in po_items:
        po = item.po
        packed_qty = 0
        product_id = None
        asg_sku = None
        blinkit_id = item.ItemCode or (str(item.EagleCode) if item.EagleCode else None)
        product_name = item.ItemName or item.ItemCode or ''

        # Look up Product: BlinkitId by EagleCode, then BlinkitId by ItemCode, then AsgSku by ItemCode
        product = None
        if item.EagleCode:
            product = db.query(Product).filter(Product.BlinkitId == str(item.EagleCode)).first()
        if not product and item.ItemCode:
            product = db.query(Product).filter(Product.BlinkitId == item.ItemCode).first()
        if not product and item.ItemCode:
            product = db.query(Product).filter(Product.AsgSku == item.ItemCode).first()

        if product:
            product_id = product.Id
            asg_sku = product.AsgSku
            product_name = product.ProductName
            from sqlalchemy import func
            packed_qty = db.query(func.sum(Inventory.PackedQty)).filter(
                Inventory.ProductId == product.Id
            ).scalar() or 0

        qty = float(item.QTY) if item.QTY else 0
        gap = max(0, qty - packed_qty)

        po_status = (po.Status if po else None) or 'Created'
        is_delayed = bool(
            po and po.ExpectedDeliveryDate
            and po.ExpectedDeliveryDate < today
            and po_status not in ('Received', 'Delivered', 'Cancelled', 'Closed')
        )

        items.append({
            "id": item.Id,
            "po_number": item.PONumber,
            "product_id": product_id,
            "product_name": product_name,
            "asg_sku": asg_sku,
            "blinkit_id": blinkit_id,
            "order_date": po.PODate.isoformat() if po and po.PODate else None,
            "expected_delivery_date": po.ExpectedDeliveryDate.isoformat() if po and po.ExpectedDeliveryDate else None,
            "quantity": qty,
            "received_quantity": 0,
            "packed_qty": packed_qty,
            "gap": gap,
            "unit_price": float(item.UnitBaseCost) if item.UnitBaseCost else 0.0,
            "total_amount": float(item.TotalAmount) if item.TotalAmount else 0.0,
            "status": po_status,
            "is_delayed": is_delayed,
            "ship_to_name": po.ShipToName if po else None,
            "ship_to_address": po.ShipToAddress if po else None,
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
                "quantity": float(item.QTY) if item.QTY else 0,
                "unit_price": float(item.UnitBaseCost) if item.UnitBaseCost else 0.0,
                "total_amount": float(item.TotalAmount) if item.TotalAmount else 0.0,
                "status": po_status,
                "is_delayed": is_delayed,
                "warehouse_id": None,
                "hub": hub,
                "tat": tat,
            })

    # Sort by order_date descending and paginate in Python
    combined.sort(key=lambda x: x.get("order_date") or "", reverse=True)

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
    """Update Amazon PO status by item ID (updates the parent PO header)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    item = db.query(AmazonPOItemData).filter(AmazonPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Amazon PO item not found")

    po = db.query(AmazonPOData).filter(AmazonPOData.PONumber == item.PONumber).first()
    if not po:
        raise HTTPException(status_code=404, detail="Amazon PO not found")

    old_status = po.POStatus
    po.POStatus = status_data.status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "AmazonPO", str(po.Id),
              old_values={"status": old_status},
              new_values={"status": status_data.status})
    try:
        db.commit()
        return {"success": True, "message": f"Amazon PO {po.PONumber} status updated to {status_data.status}"}
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
    """Update Blinkit PO status by item ID (updates the parent PO header)."""
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    item = db.query(BlinkitPOItemData).filter(BlinkitPOItemData.Id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Blinkit PO item not found")

    po = db.query(BlinkitPOData).filter(BlinkitPOData.PONumber == item.PONumber).first()
    if not po:
        raise HTTPException(status_code=404, detail="Blinkit PO not found")

    old_status = po.Status
    po.Status = status_data.status
    log_audit(db, current_user.Id, "STATUS_CHANGE", "BlinkitPO", str(po.Id),
              old_values={"status": old_status},
              new_values={"status": status_data.status})
    try:
        db.commit()
        return {"success": True, "message": f"Blinkit PO {po.PONumber} status updated to {status_data.status}"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
