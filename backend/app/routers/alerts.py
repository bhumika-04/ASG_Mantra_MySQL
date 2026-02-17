"""
Alerts Router - Alert Management
Handles inventory alerts and notifications
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.models.user import User
from app.models.alert import LowStockAlert
from app.models.product import Product
from app.models.inventory import Inventory
from app.utils.dependencies import get_current_user

LOW_STOCK_THRESHOLD = 50  # Products with total stock below this are "Warning"


class ResolveAlertRequest(BaseModel):
    remarks: Optional[str] = None


class CreateAlertRequest(BaseModel):
    product_id: int
    channel: Optional[str] = None
    alert_type: str = "Low Stock"
    severity: str = "Medium"
    message: str


router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def get_all_alerts(
    severity: Optional[str] = Query(None, description="Filter by severity (High/Medium/Low)"),
    is_resolved: Optional[bool] = Query(None, description="Filter by resolved status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all alerts with optional filtering and pagination
    """
    query = db.query(LowStockAlert).join(Product, LowStockAlert.ProductId == Product.Id)

    if severity:
        query = query.filter(LowStockAlert.Severity == severity)

    if is_resolved is not None:
        query = query.filter(LowStockAlert.IsResolved == is_resolved)

    total = query.count()
    offset = (page - 1) * page_size
    alerts = query.order_by(LowStockAlert.CreatedAt.desc()).offset(offset).limit(page_size).all()

    items = []
    for alert in alerts:
        product = alert.product
        items.append({
            "id": alert.Id,
            "product_id": alert.ProductId,
            "product_name": product.ProductName,
            "asg_sku": product.AsgSku,
            "channel": alert.Channel,
            "alert_type": alert.AlertType,
            "severity": alert.Severity,
            "message": alert.Message,
            "is_resolved": alert.IsResolved,
            "resolved_at": alert.ResolvedAt.isoformat() if alert.ResolvedAt else None,
            "remarks": alert.Remarks,
            "created_at": alert.CreatedAt.isoformat() if alert.CreatedAt else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.put("/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    body: ResolveAlertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Resolve an alert
    Admin and Manager only
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    alert = db.query(LowStockAlert).filter(LowStockAlert.Id == alert_id).first()

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if alert.IsResolved:
        raise HTTPException(status_code=400, detail="Alert is already resolved")

    # Mark as resolved
    alert.IsResolved = True
    alert.ResolvedAt = datetime.utcnow()
    if body.remarks is not None:
        alert.Remarks = body.remarks

    try:
        db.commit()
        db.refresh(alert)

        return {
            "success": True,
            "message": "Alert resolved successfully",
            "data": {
                "id": alert.Id,
                "is_resolved": alert.IsResolved,
                "resolved_at": alert.ResolvedAt.isoformat() if alert.ResolvedAt else None,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to resolve alert: {str(e)}")


@router.post("")
@router.post("/")
async def create_alert(
    body: CreateAlertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Manually create a new alert.
    Admin and Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Verify product exists
    product = db.query(Product).filter(Product.Id == body.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Create alert
    alert = LowStockAlert(
        ProductId=body.product_id,
        Channel=body.channel,
        AlertType=body.alert_type,
        Severity=body.severity,
        Message=body.message,
        IsResolved=False,
    )

    try:
        db.add(alert)
        db.commit()
        db.refresh(alert)

        return {
            "success": True,
            "message": "Alert created successfully",
            "data": {
                "id": alert.Id,
                "product_id": alert.ProductId,
                "channel": alert.Channel,
                "alert_type": alert.AlertType,
                "severity": alert.Severity,
                "message": alert.Message,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create alert: {str(e)}")


@router.delete("/{alert_id}")
async def delete_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete an alert.
    Admin only.
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    alert = db.query(LowStockAlert).filter(LowStockAlert.Id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    try:
        db.delete(alert)
        db.commit()
        return {"success": True, "message": f"Alert {alert_id} deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete alert: {str(e)}")


@router.post("/sync")
async def sync_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Auto-generate alerts by scanning inventory levels.
    - Products with 0 total stock → Critical "Out of Stock" alert
    - Products with total stock < LOW_STOCK_THRESHOLD → Warning "Low Stock" alert
    Skips products that already have an unresolved alert.
    """
    # Get total stock per product across all channels
    stock_sub = (
        db.query(
            Inventory.ProductId,
            func.sum(Inventory.CurrentStock).label("total_stock"),
        )
        .group_by(Inventory.ProductId)
        .subquery()
    )

    # Get all active products with their stock
    products = (
        db.query(
            Product.Id,
            Product.ProductName,
            Product.AsgSku,
            func.coalesce(stock_sub.c.total_stock, 0).label("total_stock"),
        )
        .outerjoin(stock_sub, Product.Id == stock_sub.c.ProductId)
        .filter(Product.IsActive == True)
        .all()
    )

    # Get product IDs that already have unresolved alerts
    existing_alert_product_ids = set(
        row[0] for row in
        db.query(LowStockAlert.ProductId)
        .filter(LowStockAlert.IsResolved == False)
        .all()
    )

    created_count = 0
    for product in products:
        total_stock = int(product.total_stock or 0)
        product_id = product.Id

        if product_id in existing_alert_product_ids:
            continue

        if total_stock == 0:
            alert = LowStockAlert(
                ProductId=product_id,
                Channel=None,
                AlertType="Out of Stock",
                Severity="High",
                Message=f"{product.ProductName} ({product.AsgSku or 'N/A'}) has 0 stock across all channels",
                IsResolved=False,
            )
            db.add(alert)
            created_count += 1
        elif total_stock < LOW_STOCK_THRESHOLD:
            alert = LowStockAlert(
                ProductId=product_id,
                Channel=None,
                AlertType="Low Stock",
                Severity="Medium",
                Message=f"{product.ProductName} ({product.AsgSku or 'N/A'}) has only {total_stock} units remaining",
                IsResolved=False,
            )
            db.add(alert)
            created_count += 1

    # Also auto-resolve alerts where stock is now healthy
    resolved_count = 0
    if existing_alert_product_ids:
        for product in products:
            total_stock = int(product.total_stock or 0)
            if product.Id in existing_alert_product_ids and total_stock >= LOW_STOCK_THRESHOLD:
                unresolved = (
                    db.query(LowStockAlert)
                    .filter(
                        LowStockAlert.ProductId == product.Id,
                        LowStockAlert.IsResolved == False,
                    )
                    .all()
                )
                for a in unresolved:
                    a.IsResolved = True
                    a.ResolvedAt = datetime.utcnow()
                    a.Remarks = "Auto-resolved: stock restored"
                    resolved_count += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to sync alerts: {str(e)}")

    return {
        "success": True,
        "created": created_count,
        "auto_resolved": resolved_count,
    }


@router.get("/stats")
async def get_alert_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get alert statistics.
    """
    from sqlalchemy import func

    # Total alerts
    total_alerts = db.query(LowStockAlert).count()
    unresolved_alerts = db.query(LowStockAlert).filter(LowStockAlert.IsResolved == False).count()
    resolved_alerts = total_alerts - unresolved_alerts

    # Alerts by severity
    severity_query = db.query(
        LowStockAlert.Severity,
        func.count(LowStockAlert.Id).label('count')
    ).filter(
        LowStockAlert.IsResolved == False
    ).group_by(LowStockAlert.Severity).all()

    severity_breakdown = {severity: count for severity, count in severity_query}

    # Alerts by channel
    channel_query = db.query(
        LowStockAlert.Channel,
        func.count(LowStockAlert.Id).label('count')
    ).filter(
        LowStockAlert.IsResolved == False
    ).group_by(LowStockAlert.Channel).all()

    channel_breakdown = {channel if channel else "All": count for channel, count in channel_query}

    return {
        "totalAlerts": total_alerts,
        "unresolvedAlerts": unresolved_alerts,
        "resolvedAlerts": resolved_alerts,
        "severityBreakdown": severity_breakdown,
        "channelBreakdown": channel_breakdown,
    }
