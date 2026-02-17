"""
Dashboard Router - Analytics and KPIs
UPDATED: Dashboard is now INVENTORY-focused, not sales-focused
Sales metrics belong in Sales Overview, not Dashboard
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_, or_, literal_column, text
from datetime import date, timedelta
from typing import Optional

from ..database import get_db
from ..models.sales import Sales
from ..models.inventory import Inventory
from ..models.product import Product
from ..models.purchase_order import PurchaseOrder
from ..models.alert import LowStockAlert
from ..models.amazon_sales import AmazonSalesData
from ..models.amazon_inventory import AmazonInventoryData
from ..models.blinkit_sales import BlinkitSalesData
from ..models.blinkit_inventory import BlinkitInventoryData
from ..utils.dependencies import get_current_active_user

router = APIRouter()


@router.get("/inventory-stats")
async def get_inventory_stats(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get inventory-focused dashboard stats (NEW - per Technical Spec v1.1)

    Dashboard is for high-level inventory control:
    - Total SKUs
    - Packed/Unpacked inventory
    - Platform allocation
    - PO status

    Sales metrics belong in Sales Overview page.
    """
    # Total active SKUs
    total_skus = (
        db.query(func.count(Product.Id))
        .filter(Product.IsActive == True)
        .scalar()
        or 0
    )

    # Total inventory (all channels)
    total_inventory = (
        db.query(func.sum(Inventory.CurrentStock))
        .scalar()
        or 0
    )

    # Packed inventory (ready-to-ship)
    packed_inventory = (
        db.query(func.sum(Inventory.PackedQty))
        .scalar()
        or 0
    )

    # Unpacked inventory (raw stock)
    unpacked_inventory = (
        db.query(func.sum(Inventory.UnpackedQty))
        .scalar()
        or 0
    )

    # Amazon inventory stats from AmazonInventory table (latest report date)
    latest_amazon_date = db.query(func.max(AmazonInventoryData.ReportDate)).scalar()
    if latest_amazon_date:
        amazon_inv_total = (
            db.query(func.sum(AmazonInventoryData.SellableOnHandUnits))
            .filter(AmazonInventoryData.ReportDate == latest_amazon_date)
            .scalar() or 0
        )
    else:
        amazon_inv_total = 0

    # Blinkit inventory stats from BlinkitInventory table (latest report date)
    latest_blinkit_date = db.query(func.max(BlinkitInventoryData.ReportDate)).scalar()
    if latest_blinkit_date:
        blinkit_inv_total = (
            db.query(func.sum(BlinkitInventoryData.BackendInvQty))
            .filter(BlinkitInventoryData.ReportDate == latest_blinkit_date)
            .scalar() or 0
        )
    else:
        blinkit_inv_total = 0

    # Low inventory count - now based on unresolved alerts (ReorderLevel column deleted)
    low_inventory_count = (
        db.query(func.count(LowStockAlert.Id))
        .filter(LowStockAlert.IsResolved == False)
        .scalar()
        or 0
    )

    # Out of stock count
    out_of_stock_count = (
        db.query(func.count(Inventory.Id))
        .filter(Inventory.CurrentStock == 0)
        .scalar()
        or 0
    )

    # Active (not yet delivered/cancelled) POs — lifecycle: Created → Dispatched → In Transit
    ACTIVE_STATUSES = ['Created', 'Dispatched', 'In Transit']

    pending_pos = (
        db.query(func.count(PurchaseOrder.Id))
        .filter(PurchaseOrder.Status.in_(ACTIVE_STATUSES))
        .scalar()
        or 0
    )

    # Delayed POs count
    delayed_pos = (
        db.query(func.count(PurchaseOrder.Id))
        .filter(PurchaseOrder.Status == 'Delayed')
        .scalar()
        or 0
    )

    # Amazon pending POs
    amazon_pending_pos = (
        db.query(func.count(PurchaseOrder.Id))
        .filter(
            and_(
                PurchaseOrder.Channel == 'Amazon',
                PurchaseOrder.Status.in_(ACTIVE_STATUSES)
            )
        )
        .scalar()
        or 0
    )

    # Blinkit pending POs
    blinkit_pending_pos = (
        db.query(func.count(PurchaseOrder.Id))
        .filter(
            and_(
                PurchaseOrder.Channel == 'Blinkit',
                PurchaseOrder.Status.in_(ACTIVE_STATUSES)
            )
        )
        .scalar()
        or 0
    )

    return {
        "totalSKUs": total_skus,
        "totalInventory": int(total_inventory or 0),
        "packedInventory": int(packed_inventory or 0),
        "unpackedInventory": int(unpacked_inventory or 0),
        "pendingPOs": pending_pos,
        "delayedPOs": delayed_pos,
        "lowInventoryCount": low_inventory_count,
        "outOfStockCount": out_of_stock_count,
        "amazonInventory": int(amazon_inv_total),
        "amazonPacked": 0,
        "amazonUnpacked": 0,
        "amazonPendingPOs": amazon_pending_pos,
        "blinkitInventory": int(blinkit_inv_total),
        "blinkitPacked": 0,
        "blinkitUnpacked": 0,
        "blinkitPendingPOs": blinkit_pending_pos,
    }


@router.get("/stats")
async def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get dashboard KPIs

    Returns:
        - Total Revenue
        - Total Orders
        - Amazon Revenue
        - Blinkit Revenue
        - Low Stock Count
    """
    # Date range: Last 30 days
    start_date = date.today() - timedelta(days=30)
    end_date = date.today()

    # Total Revenue
    total_revenue = (
        db.query(func.sum(Sales.TotalAmount))
        .filter(Sales.OrderDate.between(start_date, end_date))
        .scalar()
        or 0
    )

    # Total Orders
    total_orders = (
        db.query(func.count(Sales.Id))
        .filter(Sales.OrderDate.between(start_date, end_date))
        .scalar()
        or 0
    )

    # Amazon Revenue
    amazon_revenue = (
        db.query(func.sum(Sales.TotalAmount))
        .filter(
            Sales.Channel == "Amazon", Sales.OrderDate.between(start_date, end_date)
        )
        .scalar()
        or 0
    )

    # Blinkit Revenue
    blinkit_revenue = (
        db.query(func.sum(Sales.TotalAmount))
        .filter(
            Sales.Channel == "Blinkit", Sales.OrderDate.between(start_date, end_date)
        )
        .scalar()
        or 0
    )

    # Low Stock Count
    low_stock_count = (
        db.query(func.count(LowStockAlert.Id))
        .filter(LowStockAlert.IsResolved == False)
        .scalar()
        or 0
    )

    return {
        "total_revenue": float(total_revenue),
        "total_orders": total_orders,
        "amazon_revenue": float(amazon_revenue),
        "blinkit_revenue": float(blinkit_revenue),
        "low_stock_count": low_stock_count,
    }


@router.get("/charts")
async def get_dashboard_charts(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get dashboard chart data from dedicated AmazonSales and BlinkitSales tables.

    Returns:
        - Monthly revenue trend (Amazon OrderedRevenue + Blinkit MRP)
        - Top Amazon products (by OrderedRevenue)
        - Top Blinkit products (by MRP revenue)
    """
    # NO DATE FILTER - Show all historical sales data
    # This ensures charts display all available data regardless of dates
    try:
        # Use raw T-SQL for all chart queries to guarantee MSSQL/pyodbc compatibility.

        # Find the latest date in each table
        latest_amz = db.execute(text("SELECT MAX(ReportDate) FROM AmazonSales WHERE ReportDate IS NOT NULL")).scalar()
        latest_blinkit = db.execute(text("SELECT MAX(SaleDate) FROM BlinkitSales WHERE SaleDate IS NOT NULL")).scalar()

        from datetime import date as date_type, timedelta
        today = date_type.today()
        ref_date = latest_amz or latest_blinkit or today

        # If latest data is within last 60 days → show WEEKLY breakdown for that month
        # Otherwise → show MONTHLY data for last 6 months from latest date
        use_weekly = (today - ref_date).days <= 60 if ref_date else False

        if use_weekly:
            # Weekly view: group into W1-W4 within the latest month
            amz_weekly_rows = db.execute(text("""
                WITH WeekData AS (
                    SELECT
                        DATEDIFF(week, DATEADD(month, DATEDIFF(month, 0, :ref), 0), ReportDate) + 1 AS wnum,
                        OrderedRevenue
                    FROM AmazonSales
                    WHERE YEAR(ReportDate) = YEAR(:ref)
                      AND MONTH(ReportDate) = MONTH(:ref)
                      AND ReportDate IS NOT NULL
                )
                SELECT 'W' + CAST(wnum AS VARCHAR) AS week_label, SUM(OrderedRevenue) AS revenue
                FROM WeekData
                WHERE wnum BETWEEN 1 AND 5
                GROUP BY wnum
                ORDER BY wnum
            """), {"ref": ref_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_weekly_rows}

            blinkit_weekly_rows = db.execute(text("""
                WITH WeekData AS (
                    SELECT
                        DATEDIFF(week, DATEADD(month, DATEDIFF(month, 0, :ref), 0), SaleDate) + 1 AS wnum,
                        MRP
                    FROM BlinkitSales
                    WHERE YEAR(SaleDate) = YEAR(:ref)
                      AND MONTH(SaleDate) = MONTH(:ref)
                      AND SaleDate IS NOT NULL
                )
                SELECT 'W' + CAST(wnum AS VARCHAR) AS week_label, SUM(MRP) AS revenue
                FROM WeekData
                WHERE wnum BETWEEN 1 AND 5
                GROUP BY wnum
                ORDER BY wnum
            """), {"ref": ref_date}).fetchall()
            blinkit_by_period = {row[0]: float(row[1] or 0) for row in blinkit_weekly_rows}

            all_periods = sorted(
                set(amazon_by_period.keys()) | set(blinkit_by_period.keys()),
                key=lambda x: int(x[1:])
            )
        else:
            # Monthly view: last 6 months from latest date
            amz_monthly_rows = db.execute(text("""
                SELECT CONVERT(varchar(7), ReportDate, 120) AS month, SUM(OrderedRevenue) AS revenue
                FROM AmazonSales
                WHERE ReportDate >= DATEADD(month, -6, :ref)
                  AND ReportDate IS NOT NULL
                GROUP BY CONVERT(varchar(7), ReportDate, 120)
                ORDER BY CONVERT(varchar(7), ReportDate, 120)
            """), {"ref": ref_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_monthly_rows}

            blinkit_monthly_rows = db.execute(text("""
                SELECT CONVERT(varchar(7), SaleDate, 120) AS month, SUM(MRP) AS revenue
                FROM BlinkitSales
                WHERE SaleDate >= DATEADD(month, -6, :ref)
                  AND SaleDate IS NOT NULL
                GROUP BY CONVERT(varchar(7), SaleDate, 120)
                ORDER BY CONVERT(varchar(7), SaleDate, 120)
            """), {"ref": ref_date}).fetchall()
            blinkit_by_period = {row[0]: float(row[1] or 0) for row in blinkit_monthly_rows}

            all_periods = sorted(set(amazon_by_period.keys()) | set(blinkit_by_period.keys()))

        monthly_data = [
            {
                'month':   p,
                'Amazon':  amazon_by_period.get(p, 0.0),
                'Blinkit': blinkit_by_period.get(p, 0.0),
            }
            for p in all_periods
        ]

        # 3. Top 5 Amazon Products (ALL TIME)
        amz_top_rows = db.execute(text("""
            SELECT TOP 5
                MAX(ProductTitle)                       AS name,
                SUM(OrderedRevenue)                     AS revenue,
                SUM(ISNULL(OrderedUnits, 0))            AS quantity
            FROM AmazonSales
            WHERE ReportDate IS NOT NULL AND SourceFile = 'VendorCSV'
            GROUP BY ASIN
            ORDER BY SUM(OrderedRevenue) DESC
        """)).fetchall()

        amazon_product_data = [
            {
                'name':     (row[0] or 'Unknown')[:25] + ('...' if row[0] and len(row[0]) > 25 else ''),
                'revenue':  float(row[1] or 0),
                'quantity': int(row[2] or 0),
            }
            for row in amz_top_rows
        ]

        # 4. Top 5 Blinkit Products (ALL TIME)
        blinkit_top_rows = db.execute(text("""
            SELECT TOP 5
                MAX(ItemName)   AS name,
                SUM(MRP)        AS revenue,
                SUM(QtySold)    AS quantity
            FROM BlinkitSales
            WHERE SaleDate IS NOT NULL
            GROUP BY ItemId
            ORDER BY SUM(MRP) DESC
        """)).fetchall()

        blinkit_product_data = [
            {
                'name':     (row[0] or 'Unknown')[:25] + ('...' if row[0] and len(row[0]) > 25 else ''),
                'revenue':  float(row[1] or 0),
                'quantity': float(row[2] or 0),
            }
            for row in blinkit_top_rows
        ]

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Dashboard charts query failed: {exc}"
        )

    overall_product_data = sorted(
        [{'name': p['name'], 'channel': 'Amazon',  'revenue': p['revenue'], 'quantity': p['quantity']} for p in amazon_product_data] +
        [{'name': p['name'], 'channel': 'Blinkit', 'revenue': p['revenue'], 'quantity': p['quantity']} for p in blinkit_product_data],
        key=lambda x: x['revenue'], reverse=True
    )[:10]

    return {
        "monthly_sales":    monthly_data,
        "amazon_products":  amazon_product_data,
        "blinkit_products": blinkit_product_data,
        "top_products":     overall_product_data,
    }


@router.get("/product-overview")
async def get_product_overview(
    search: Optional[str] = Query(None, description="Search by name, SKU, ASIN, or Blinkit ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Consolidated product mapping with cross-platform inventory.
    Returns per-product rows: ASG SKU, Product Name, Amazon ASIN, Blinkit ID,
    Amazon Stock, Blinkit Stock, Total Stock, and health status.
    """
    # Amazon stock from AmazonInventory table (latest report date)
    latest_amz = db.query(func.max(AmazonInventoryData.ReportDate)).scalar()
    if latest_amz:
        amazon_inv = (
            db.query(
                Product.Id.label("ProductId"),
                func.sum(AmazonInventoryData.SellableOnHandUnits).label("amazon_stock"),
            )
            .join(Product, Product.AmazonId == AmazonInventoryData.ASIN)
            .filter(AmazonInventoryData.ReportDate == latest_amz)
            .group_by(Product.Id)
            .subquery()
        )
    else:
        amazon_inv = (
            db.query(
                Product.Id.label("ProductId"),
                literal_column("0").label("amazon_stock"),
            )
            .filter(False)
            .subquery()
        )

    # Blinkit stock from BlinkitInventory table (latest report date)
    latest_blk = db.query(func.max(BlinkitInventoryData.ReportDate)).scalar()
    if latest_blk:
        blinkit_inv = (
            db.query(
                Product.Id.label("ProductId"),
                func.sum(BlinkitInventoryData.BackendInvQty).label("blinkit_stock"),
            )
            .join(Product, Product.BlinkitId == BlinkitInventoryData.ItemId)
            .filter(BlinkitInventoryData.ReportDate == latest_blk)
            .group_by(Product.Id)
            .subquery()
        )
    else:
        blinkit_inv = (
            db.query(
                Product.Id.label("ProductId"),
                literal_column("0").label("blinkit_stock"),
            )
            .filter(False)
            .subquery()
        )

    # Packed / Unpacked totals from Inventory table (ASG stock only)
    packed_sub = (
        db.query(
            Inventory.ProductId,
            func.sum(Inventory.PackedQty).label("total_packed"),
            func.sum(Inventory.UnpackedQty).label("total_unpacked"),
        )
        .group_by(Inventory.ProductId)
        .subquery()
    )

    # Main query: active products LEFT JOIN each channel
    query = (
        db.query(
            Product.Id,
            Product.ProductName,
            Product.AsgSku,
            Product.AmazonId,
            Product.BlinkitId,
            Product.Gs1,
            Product.Category,
            Product.Brand,
            func.coalesce(amazon_inv.c.amazon_stock, 0).label("amazonStock"),
            func.coalesce(blinkit_inv.c.blinkit_stock, 0).label("blinkitStock"),
            (
                func.coalesce(amazon_inv.c.amazon_stock, 0)
                + func.coalesce(blinkit_inv.c.blinkit_stock, 0)
            ).label("totalStock"),
            func.coalesce(packed_sub.c.total_packed, 0).label("packedQty"),
            func.coalesce(packed_sub.c.total_unpacked, 0).label("unpackedQty"),
        )
        .outerjoin(amazon_inv, Product.Id == amazon_inv.c.ProductId)
        .outerjoin(blinkit_inv, Product.Id == blinkit_inv.c.ProductId)
        .outerjoin(packed_sub, Product.Id == packed_sub.c.ProductId)
        .filter(Product.IsActive == True)
    )

    # Search filter
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                Product.ProductName.ilike(term),
                Product.AsgSku.ilike(term),
                Product.AmazonId.ilike(term),
                Product.BlinkitId.ilike(term),
            )
        )

    total = query.count()
    query = query.order_by(Product.ProductName)
    offset = (page - 1) * page_size
    rows = query.offset(offset).limit(page_size).all()

    items = []
    for row in rows:
        total_stock = int(row.totalStock or 0)

        # Simplified status: Out of Stock if 0, otherwise Healthy
        # (ReorderLevel column deleted - use Low Inventory Alerts for low stock tracking)
        if total_stock == 0:
            status = "Out of Stock"
        else:
            status = "Healthy"

        items.append({
            "id": row.Id,
            "productName": row.ProductName,
            "asgSku": row.AsgSku,
            "amazonId": row.AmazonId,
            "blinkitId": row.BlinkitId,
            "gs1": row.Gs1,
            "category": row.Category,
            "brand": row.Brand,
            "amazonStock": int(row.amazonStock or 0),
            "blinkitStock": int(row.blinkitStock or 0),
            "totalStock": total_stock,
            "packedQty": int(row.packedQty or 0),
            "unpackedQty": int(row.unpackedQty or 0),
            "status": status,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }
