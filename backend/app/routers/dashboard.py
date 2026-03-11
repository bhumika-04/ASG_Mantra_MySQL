"""
Dashboard Router - Analytics and KPIs
UPDATED: Dashboard is now INVENTORY-focused, not sales-focused
Sales metrics belong in Sales Overview, not Dashboard
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, literal_column, text
from datetime import date, timedelta
from typing import Optional

from ..database import get_db
from ..models.inventory import Inventory
from ..models.product import Product
from ..models.alert import LowStockAlert
from ..models.amazon_inventory import AmazonInventoryData
from ..models.blinkit_inventory import BlinkitInventoryData
from ..utils.dependencies import get_current_active_user

router = APIRouter()


@router.get("/inventory-stats")
async def get_inventory_stats(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get inventory-focused dashboard stats.
    Uses a single raw SQL query instead of 14 separate ORM calls to minimise
    round-trips to the remote DB.
    """
    row = db.execute(text("""
        SELECT
          (SELECT COUNT(*)
           FROM Products WHERE IsActive = 1)                                          AS total_skus,
          (SELECT COALESCE(SUM(CurrentStock), 0)
           FROM Inventory
           WHERE InventoryDate = (SELECT MAX(InventoryDate) FROM Inventory))          AS total_inventory,
          (SELECT COALESCE(SUM(PackedQty), 0)
           FROM Inventory
           WHERE InventoryDate = (SELECT MAX(InventoryDate) FROM Inventory))          AS packed,
          (SELECT COALESCE(SUM(UnpackedQty), 0)
           FROM Inventory
           WHERE InventoryDate = (SELECT MAX(InventoryDate) FROM Inventory))          AS unpacked,
          (SELECT COUNT(*)
           FROM Inventory
           WHERE CurrentStock = 0
             AND InventoryDate = (SELECT MAX(InventoryDate) FROM Inventory))          AS out_of_stock,
          (SELECT COUNT(*) FROM Alerts WHERE IsResolved = 0)                          AS low_stock,
          (SELECT COUNT(DISTINCT PONumber) FROM AmazonPO
           WHERE POStatus IN ('Created','Packed','Dispatched','In Transit'))
          + (SELECT COUNT(DISTINCT PONumber) FROM BlinkitPO
             WHERE Status IN ('Created','Packed','Dispatched','In Transit'))          AS pending_pos,
          (SELECT COUNT(DISTINCT PONumber) FROM AmazonPO WHERE POStatus = 'Delayed')
          + (SELECT COUNT(DISTINCT PONumber) FROM BlinkitPO WHERE Status = 'Delayed') AS delayed_pos,
          (SELECT COUNT(DISTINCT PONumber) FROM AmazonPO
           WHERE POStatus IN ('Created','Packed','Dispatched','In Transit'))          AS amazon_pending,
          (SELECT COUNT(DISTINCT PONumber) FROM BlinkitPO
           WHERE Status IN ('Created','Packed','Dispatched','In Transit'))            AS blinkit_pending,
          (SELECT COALESCE(SUM(SellableOnHandUnits), 0)
           FROM AmazonInventory
           WHERE ReportDate = (SELECT MAX(ReportDate) FROM AmazonInventory))          AS amazon_inv,
          (SELECT COALESCE(SUM(BackendInvQty), 0)
           FROM BlinkitInventory
           WHERE ReportDate = (SELECT MAX(ReportDate) FROM BlinkitInventory))         AS blinkit_inv
    """)).fetchone()

    return {
        "totalSKUs":        int(row.total_skus    or 0),
        "totalInventory":   int(row.total_inventory or 0),
        "packedInventory":  int(row.packed         or 0),
        "unpackedInventory":int(row.unpacked        or 0),
        "pendingPOs":       int(row.pending_pos     or 0),
        "delayedPOs":       int(row.delayed_pos     or 0),
        "lowInventoryCount":int(row.low_stock       or 0),
        "outOfStockCount":  int(row.out_of_stock    or 0),
        "amazonInventory":  int(row.amazon_inv      or 0),
        "amazonPacked": 0,
        "amazonUnpacked": 0,
        "amazonPendingPOs": int(row.amazon_pending  or 0),
        "blinkitInventory": int(row.blinkit_inv     or 0),
        "blinkitPacked": 0,
        "blinkitUnpacked": 0,
        "blinkitPendingPOs":int(row.blinkit_pending or 0),
    }


@router.get("/charts")
async def get_dashboard_charts(
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_active_user),
):
    """
    Get dashboard chart data with optional date range filter.
    Granularity: weekly if range <= 31 days, monthly otherwise.
    Returns is_weekly flag so frontend knows which label format to use.
    """
    from datetime import date as date_type

    try:
        s_date = date_type.fromisoformat(start_date) if start_date else None
        e_date = date_type.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # Determine granularity: weekly if range <= 31 days, monthly otherwise
    use_weekly = bool(s_date and e_date and (e_date - s_date).days <= 31)

    try:
        if use_weekly:
            # Weekly grouping: group by Monday of each week, label as YYYY-MM-DD
            amz_rows = db.execute(text("""
                SELECT
                    CONVERT(varchar(10),
                        DATEADD(dd, -((DATEPART(weekday, ReportDate) - 2 + 7) % 7), ReportDate),
                        120) AS period,
                    SUM(OrderedRevenue) AS revenue
                FROM AmazonSales
                WHERE ReportDate IS NOT NULL
                  AND ReportDate BETWEEN :start AND :end
                GROUP BY DATEADD(dd, -((DATEPART(weekday, ReportDate) - 2 + 7) % 7), ReportDate)
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_rows}

            blk_rows = db.execute(text("""
                SELECT
                    CONVERT(varchar(10),
                        DATEADD(dd, -((DATEPART(weekday, SaleDate) - 2 + 7) % 7), SaleDate),
                        120) AS period,
                    SUM(MRP) AS revenue
                FROM BlinkitSales
                WHERE SaleDate IS NOT NULL
                  AND SaleDate BETWEEN :start AND :end
                GROUP BY DATEADD(dd, -((DATEPART(weekday, SaleDate) - 2 + 7) % 7), SaleDate)
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            blinkit_by_period = {row[0]: float(row[1] or 0) for row in blk_rows}

        else:
            # Monthly grouping: YYYY-MM labels, optional date range filter
            amz_rows = db.execute(text("""
                SELECT CONVERT(varchar(7), ReportDate, 120) AS period, SUM(OrderedRevenue) AS revenue
                FROM AmazonSales
                WHERE ReportDate IS NOT NULL
                  AND (:start IS NULL OR ReportDate >= :start)
                  AND (:end IS NULL OR ReportDate <= :end)
                GROUP BY CONVERT(varchar(7), ReportDate, 120)
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_rows}

            blk_rows = db.execute(text("""
                SELECT CONVERT(varchar(7), SaleDate, 120) AS period, SUM(MRP) AS revenue
                FROM BlinkitSales
                WHERE SaleDate IS NOT NULL
                  AND (:start IS NULL OR SaleDate >= :start)
                  AND (:end IS NULL OR SaleDate <= :end)
                GROUP BY CONVERT(varchar(7), SaleDate, 120)
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            blinkit_by_period = {row[0]: float(row[1] or 0) for row in blk_rows}

        all_periods = sorted(set(amazon_by_period.keys()) | set(blinkit_by_period.keys()))
        monthly_data = [
            {
                'month':   p,
                'Amazon':  amazon_by_period.get(p, 0.0),
                'Blinkit': blinkit_by_period.get(p, 0.0),
            }
            for p in all_periods
        ]

        # Top 5 Amazon Products — filtered by date range if provided
        amz_top_rows = db.execute(text("""
            SELECT TOP 5
                MAX(ProductTitle)            AS name,
                SUM(OrderedRevenue)          AS revenue,
                SUM(ISNULL(OrderedUnits, 0)) AS quantity
            FROM AmazonSales
            WHERE ReportDate IS NOT NULL AND SourceFile = 'VendorCSV'
              AND (:start IS NULL OR ReportDate >= :start)
              AND (:end IS NULL OR ReportDate <= :end)
            GROUP BY ASIN
            ORDER BY SUM(OrderedRevenue) DESC
        """), {"start": s_date, "end": e_date}).fetchall()
        amazon_product_data = [
            {
                'name':     (row[0] or 'Unknown')[:25] + ('...' if row[0] and len(row[0]) > 25 else ''),
                'revenue':  float(row[1] or 0),
                'quantity': int(row[2] or 0),
            }
            for row in amz_top_rows
        ]

        # Top 5 Blinkit Products — filtered by date range if provided
        blinkit_top_rows = db.execute(text("""
            SELECT TOP 5
                MAX(ItemName) AS name,
                SUM(MRP)      AS revenue,
                SUM(QtySold)  AS quantity
            FROM BlinkitSales
            WHERE SaleDate IS NOT NULL
              AND (:start IS NULL OR SaleDate >= :start)
              AND (:end IS NULL OR SaleDate <= :end)
            GROUP BY ItemId
            ORDER BY SUM(MRP) DESC
        """), {"start": s_date, "end": e_date}).fetchall()
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
        "is_weekly":        use_weekly,
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

    # Packed / Unpacked totals from Inventory table (ASG stock only, latest date)
    latest_inv = db.query(func.max(Inventory.InventoryDate)).scalar()
    packed_sub_q = db.query(
        Inventory.ProductId,
        func.sum(Inventory.PackedQty).label("total_packed"),
        func.sum(Inventory.UnpackedQty).label("total_unpacked"),
    ).group_by(Inventory.ProductId)
    if latest_inv:
        packed_sub_q = packed_sub_q.filter(Inventory.InventoryDate == latest_inv)
    packed_sub = packed_sub_q.subquery()

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
