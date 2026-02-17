"""
Sales Router - Sales Management and Analytics
Handles sales queries, reporting, and analytics across channels
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_, Date
from typing import Optional, List
from datetime import datetime, timedelta

from app.database import get_db
from app.models.user import User
from app.models.sales import Sales
from app.models.product import Product
from app.schemas.common import PaginatedResponse
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("/", response_model=PaginatedResponse)
async def get_all_sales(
    search: Optional[str] = Query(None, description="Search by product name or order ID"),
    channel: Optional[str] = Query(None, description="Filter by channel (Amazon/Blinkit)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all sales with filtering and pagination
    """
    query = db.query(Sales).join(Product, Sales.ProductId == Product.Id)

    # Apply search filter
    if search:
        query = query.filter(
            (Product.ProductName.ilike(f"%{search}%")) |
            (Sales.OrderId.ilike(f"%{search}%"))
        )

    # Apply channel filter
    if channel:
        query = query.filter(Sales.Channel == channel)

    # Apply date filters
    if start_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(Sales.OrderDate >= start)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")

    if end_date:
        try:
            end = datetime.strptime(end_date, "%Y-%m-%d")
            query = query.filter(Sales.OrderDate <= end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")

    # Get total count
    total = query.count()

    # Apply pagination
    offset = (page - 1) * page_size
    sales = query.order_by(desc(Sales.OrderDate)).offset(offset).limit(page_size).all()

    # Format response
    items = []
    for sale in sales:
        product = sale.product
        items.append({
            "id": sale.Id,
            "order_id": sale.OrderId,
            "product_id": sale.ProductId,
            "product_name": product.ProductName,
            "asg_sku": product.AsgSku,
            "channel": sale.Channel,
            "order_date": sale.OrderDate.isoformat() if sale.OrderDate else None,
            "quantity": sale.Quantity,
            "unit_price": float(sale.UnitPrice),
            "total_amount": float(sale.TotalAmount),
            "warehouse_id": sale.WarehouseId,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/amazon", response_model=PaginatedResponse)
async def get_amazon_sales(
    search: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get Amazon-specific sales
    """
    query = db.query(Sales).join(Product, Sales.ProductId == Product.Id)
    query = query.filter(Sales.Channel == "Amazon")

    if search:
        query = query.filter(
            (Product.ProductName.ilike(f"%{search}%")) |
            (Sales.OrderId.ilike(f"%{search}%"))
        )

    if start_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(Sales.OrderDate >= start)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")

    if end_date:
        try:
            end = datetime.strptime(end_date, "%Y-%m-%d")
            query = query.filter(Sales.OrderDate <= end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")

    total = query.count()
    offset = (page - 1) * page_size
    sales = query.order_by(desc(Sales.OrderDate)).offset(offset).limit(page_size).all()

    items = []
    for sale in sales:
        product = sale.product
        items.append({
            "id": sale.Id,
            "order_id": sale.OrderId,
            "product_id": sale.ProductId,
            "product_name": product.ProductName,
            "asg_sku": product.AsgSku,
            "amazon_id": product.AmazonId,
            "order_date": sale.OrderDate.isoformat() if sale.OrderDate else None,
            "quantity": sale.Quantity,
            "unit_price": float(sale.UnitPrice),
            "total_amount": float(sale.TotalAmount),
            "warehouse_id": sale.WarehouseId,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/blinkit", response_model=PaginatedResponse)
async def get_blinkit_sales(
    search: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get Blinkit-specific sales
    """
    query = db.query(Sales).join(Product, Sales.ProductId == Product.Id)
    query = query.filter(Sales.Channel == "Blinkit")

    if search:
        query = query.filter(
            (Product.ProductName.ilike(f"%{search}%")) |
            (Sales.OrderId.ilike(f"%{search}%"))
        )

    if start_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(Sales.OrderDate >= start)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")

    if end_date:
        try:
            end = datetime.strptime(end_date, "%Y-%m-%d")
            query = query.filter(Sales.OrderDate <= end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")

    total = query.count()
    offset = (page - 1) * page_size
    sales = query.order_by(desc(Sales.OrderDate)).offset(offset).limit(page_size).all()

    items = []
    for sale in sales:
        product = sale.product
        items.append({
            "id": sale.Id,
            "order_id": sale.OrderId,
            "product_id": sale.ProductId,
            "product_name": product.ProductName,
            "asg_sku": product.AsgSku,
            "blinkit_id": product.BlinkitId,
            "order_date": sale.OrderDate.isoformat() if sale.OrderDate else None,
            "quantity": sale.Quantity,
            "unit_price": float(sale.UnitPrice),
            "total_amount": float(sale.TotalAmount),
            "warehouse_id": sale.WarehouseId,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/analytics")
async def get_sales_analytics(
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    channel: Optional[str] = Query(None, description="Filter by channel"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get sales analytics and insights
    """
    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    # Base query
    query = db.query(Sales).filter(Sales.OrderDate >= start_date)

    if channel:
        query = query.filter(Sales.Channel == channel)

    # Total revenue
    total_revenue = query.with_entities(func.sum(Sales.TotalAmount)).scalar() or 0

    # Total orders
    total_orders = query.count()

    # Average order value
    avg_order_value = float(total_revenue / total_orders) if total_orders > 0 else 0

    # Revenue by channel
    channel_revenue = db.query(
        Sales.Channel,
        func.sum(Sales.TotalAmount).label('revenue'),
        func.count(Sales.Id).label('orders')
    ).filter(Sales.OrderDate >= start_date).group_by(Sales.Channel).all()

    channels = [
        {
            "channel": row.Channel,
            "revenue": float(row.revenue or 0),
            "orders": row.orders or 0
        }
        for row in channel_revenue
    ]

    # Top selling products (apply channel filter so Blinkit/Amazon are separate)
    top_products_query = db.query(
        Product.ProductName,
        Product.AsgSku,
        func.sum(Sales.Quantity).label('total_quantity'),
        func.sum(Sales.TotalAmount).label('total_revenue')
    ).join(Sales, Sales.ProductId == Product.Id)\
     .filter(Sales.OrderDate >= start_date)

    if channel:
        top_products_query = top_products_query.filter(Sales.Channel == channel)

    top_products = top_products_query\
        .group_by(Product.Id, Product.ProductName, Product.AsgSku)\
        .order_by(desc('total_revenue'))\
        .limit(10).all()

    top_products_list = [
        {
            "product_name": row.ProductName,
            "asg_sku": row.AsgSku,
            "total_quantity": row.total_quantity or 0,
            "total_revenue": float(row.total_revenue or 0)
        }
        for row in top_products
    ]

    # Daily sales trend (apply channel filter consistently)
    # Note: Sales.OrderDate is already a Date column — no cast needed
    # Avoid using 'date' as a label since it is a reserved word in SQL Server
    daily_sales_query = db.query(
        Sales.OrderDate.label('order_date'),
        func.sum(Sales.TotalAmount).label('revenue'),
        func.count(Sales.Id).label('orders')
    ).filter(Sales.OrderDate >= start_date)

    if channel:
        daily_sales_query = daily_sales_query.filter(Sales.Channel == channel)

    daily_sales = daily_sales_query\
        .group_by(Sales.OrderDate)\
        .order_by(Sales.OrderDate).all()

    daily_trend = [
        {
            "date": row.order_date.isoformat() if row.order_date else None,
            "revenue": float(row.revenue or 0),
            "orders": row.orders or 0
        }
        for row in daily_sales
    ]

    return {
        "summary": {
            "total_revenue": float(total_revenue),
            "total_orders": total_orders,
            "avg_order_value": avg_order_value,
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
                "days": days
            }
        },
        "channels": channels,
        "top_products": top_products_list,
        "daily_trend": daily_trend
    }
