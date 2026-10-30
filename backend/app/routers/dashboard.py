"""
Dashboard Router - Analytics and KPIs
The dashboard is inventory-focused; sales metrics live in the Sales Overview pages.
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, literal_column, text
from typing import Optional

from ..database import get_db
from ..models.product import Product
from ..models.amazon_inventory import AmazonInventoryData
from ..models.blinkit_inventory import BlinkitInventoryData
from ..utils.dependencies import get_current_active_user
from ..utils.stock import VERIFY_AFTER_DAYS, latest_stock_subquery, needs_verification
from ..utils.timeutil import today_ist
import time as _time

router = APIRouter()

# Simple in-memory cache for dashboard endpoints — 60s TTL
_dash_cache: dict = {}
_DASH_TTL = 60.0

def _dash_get(key: str):
    e = _dash_cache.get(key)
    if e and _time.monotonic() - e["ts"] < _DASH_TTL:
        return e["data"]
    return None

def _dash_set(key: str, data):
    _dash_cache[key] = {"data": data, "ts": _time.monotonic()}


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
    cached = _dash_get("inventory_stats")
    if cached:
        return cached

    row = db.execute(text("""
        WITH
        max_dates AS (
            SELECT
                (SELECT MAX(InventoryDate) FROM Inventory)      AS inv_date,
                (SELECT MAX(ReportDate)    FROM AmazonInventory) AS amz_inv_date,
                (SELECT MAX(ReportDate)    FROM BlinkitInventory) AS blk_inv_date
        ),
        latest_inv AS (
            SELECT ProductId, MAX(InventoryDate) AS d FROM Inventory GROUP BY ProductId
        ),
        inv_agg AS (
            -- each active product's last available stock (not only the newest sheet)
            SELECT
                COALESCE(SUM(i.CurrentStock), 0) AS total_inventory,
                COALESCE(SUM(i.PackedQty),    0) AS packed,
                COALESCE(SUM(i.UnpackedQty),  0) AS unpacked,
                COUNT(CASE WHEN i.CurrentStock = 0 THEN 1 END) AS out_of_stock,
                COUNT(DISTINCT CASE WHEN DATEDIFF(:today, l.d) > :verify_days THEN i.ProductId END) AS needs_verification
            FROM Inventory i
            JOIN latest_inv l ON l.ProductId = i.ProductId AND i.InventoryDate = l.d
            JOIN Products p ON p.Id = i.ProductId AND p.IsActive = 1
        ),
        amz_cancel AS (
            SELECT POId, MIN(CancellationDate) AS min_cancel
            FROM AmazonPOItem GROUP BY POId
        )
        SELECT
          (SELECT COUNT(*) FROM Products WHERE IsActive = 1)                         AS total_skus,
          inv_agg.total_inventory,
          inv_agg.packed,
          inv_agg.unpacked,
          inv_agg.out_of_stock,
          inv_agg.needs_verification,
          (SELECT COUNT(*) FROM Alerts WHERE IsResolved = 0)                         AS low_stock,
          (SELECT COUNT(DISTINCT p.PONumber) FROM AmazonPO p
           LEFT JOIN amz_cancel ac ON ac.POId = p.Id
           WHERE p.POStatus IN ('Created','Packed','Dispatched','In Transit')
             AND NOT (ac.min_cancel IS NOT NULL AND DATEDIFF(NOW(), ac.min_cancel) >= 15))
          + (SELECT COUNT(DISTINCT PONumber) FROM BlinkitPO
             WHERE Status IN ('Created','Packed','Dispatched','In Transit')
               AND NOT (POExpiryDate IS NOT NULL AND DATEDIFF(NOW(), POExpiryDate) >= 15)) AS pending_pos,
          (SELECT COUNT(DISTINCT PONumber) FROM AmazonPO WHERE POStatus = 'Delayed')
          + (SELECT COUNT(DISTINCT PONumber) FROM BlinkitPO WHERE Status = 'Delayed') AS delayed_pos,
          (SELECT COUNT(DISTINCT p.PONumber) FROM AmazonPO p
           LEFT JOIN amz_cancel ac ON ac.POId = p.Id
           WHERE p.POStatus IN ('Created','Packed','Dispatched','In Transit')
             AND NOT (ac.min_cancel IS NOT NULL AND DATEDIFF(NOW(), ac.min_cancel) >= 15)) AS amazon_pending,
          (SELECT COUNT(DISTINCT PONumber) FROM BlinkitPO
           WHERE Status IN ('Created','Packed','Dispatched','In Transit')
             AND NOT (POExpiryDate IS NOT NULL AND DATEDIFF(NOW(), POExpiryDate) >= 15))  AS blinkit_pending,
          (SELECT COALESCE(SUM(SellableOnHandUnits), 0)
           FROM AmazonInventory ai, max_dates m WHERE ai.ReportDate = m.amz_inv_date) AS amazon_inv,
          (SELECT COALESCE(SUM(BackendInvQty), 0)
           FROM BlinkitInventory bi, max_dates m WHERE bi.ReportDate = m.blk_inv_date) AS blinkit_hub,
          (SELECT COALESCE(SUM(FrontendInvQty), 0)
           FROM BlinkitInventory bi, max_dates m WHERE bi.ReportDate = m.blk_inv_date) AS blinkit_store
        FROM inv_agg, max_dates
    """), {"today": today_ist(), "verify_days": VERIFY_AFTER_DAYS}).fetchone()

    result = {
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
        "blinkitInventory": int(row.blinkit_hub or 0) + int(row.blinkit_store or 0),
        "blinkitHub":       int(row.blinkit_hub   or 0),
        "blinkitStore":     int(row.blinkit_store or 0),
        "needsVerificationCount": int(row.needs_verification or 0),
        "blinkitPacked": 0,
        "blinkitUnpacked": 0,
        "blinkitPendingPOs":int(row.blinkit_pending or 0),
    }
    _dash_set("inventory_stats", result)
    return result


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

    cache_key = f"charts:{start_date}:{end_date}"
    cached = _dash_get(cache_key)
    if cached:
        return cached

    try:
        s_date = date_type.fromisoformat(start_date) if start_date else None
        e_date = date_type.fromisoformat(end_date) if end_date else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # Determine granularity: daily ≤31 days, weekly ≤90 days, monthly otherwise
    if s_date and e_date:
        _days = (e_date - s_date).days
        if _days <= 31:
            granularity = 'daily'
        elif _days <= 90:
            granularity = 'weekly'
        else:
            granularity = 'monthly'
    else:
        granularity = 'monthly'

    # Weekly buckets start on Monday: DATE_SUB(x, INTERVAL WEEKDAY(x) DAY).
    try:
        if granularity == 'daily':
            # Daily grouping: YYYY-MM-DD labels
            amz_rows = db.execute(text("""
                SELECT DATE_FORMAT(ReportDate, '%Y-%m-%d') AS period, SUM(OrderedRevenue) AS revenue
                FROM AmazonSales
                WHERE ReportDate IS NOT NULL AND ReportDate BETWEEN :start AND :end
                GROUP BY DATE_FORMAT(ReportDate, '%Y-%m-%d')
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_rows}

            blk_rows = db.execute(text("""
                SELECT DATE_FORMAT(SaleDate, '%Y-%m-%d') AS period, SUM(MRP) AS revenue
                FROM BlinkitSales
                WHERE SaleDate IS NOT NULL AND SaleDate BETWEEN :start AND :end
                GROUP BY DATE_FORMAT(SaleDate, '%Y-%m-%d')
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            blinkit_by_period = {row[0]: float(row[1] or 0) for row in blk_rows}

        elif granularity == 'weekly':
            # Weekly grouping: group by Monday of each week, label as YYYY-MM-DD
            amz_rows = db.execute(text("""
                SELECT
                    DATE_FORMAT(DATE_SUB(ReportDate, INTERVAL WEEKDAY(ReportDate) DAY), '%Y-%m-%d') AS period,
                    SUM(OrderedRevenue) AS revenue
                FROM AmazonSales
                WHERE ReportDate IS NOT NULL
                  AND ReportDate BETWEEN :start AND :end
                GROUP BY period
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_rows}

            blk_rows = db.execute(text("""
                SELECT
                    DATE_FORMAT(DATE_SUB(SaleDate, INTERVAL WEEKDAY(SaleDate) DAY), '%Y-%m-%d') AS period,
                    SUM(MRP) AS revenue
                FROM BlinkitSales
                WHERE SaleDate IS NOT NULL
                  AND SaleDate BETWEEN :start AND :end
                GROUP BY period
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            blinkit_by_period = {row[0]: float(row[1] or 0) for row in blk_rows}

        else:
            # Monthly grouping: YYYY-MM labels, optional date range filter
            amz_rows = db.execute(text("""
                SELECT DATE_FORMAT(ReportDate, '%Y-%m') AS period, SUM(OrderedRevenue) AS revenue
                FROM AmazonSales
                WHERE ReportDate IS NOT NULL
                  AND (:start IS NULL OR ReportDate >= :start)
                  AND (:end IS NULL OR ReportDate <= :end)
                GROUP BY DATE_FORMAT(ReportDate, '%Y-%m')
                ORDER BY period
            """), {"start": s_date, "end": e_date}).fetchall()
            amazon_by_period = {row[0]: float(row[1] or 0) for row in amz_rows}

            blk_rows = db.execute(text("""
                SELECT DATE_FORMAT(SaleDate, '%Y-%m') AS period, SUM(MRP) AS revenue
                FROM BlinkitSales
                WHERE SaleDate IS NOT NULL
                  AND (:start IS NULL OR SaleDate >= :start)
                  AND (:end IS NULL OR SaleDate <= :end)
                GROUP BY DATE_FORMAT(SaleDate, '%Y-%m')
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
            SELECT
                s.ASIN,
                MAX(s.ProductTitle)            AS name,
                SUM(s.OrderedRevenue)          AS revenue,
                SUM(IFNULL(s.OrderedUnits, 0)) AS quantity,
                MAX(p.AsgSku)                  AS sku
            FROM AmazonSales s
            LEFT JOIN Products p ON p.AmazonId = s.ASIN
            WHERE s.ReportDate IS NOT NULL AND s.SourceFile = 'VendorCSV'
              AND (:start IS NULL OR s.ReportDate >= :start)
              AND (:end IS NULL OR s.ReportDate <= :end)
            GROUP BY s.ASIN
            ORDER BY SUM(s.OrderedRevenue) DESC
            LIMIT 5
        """), {"start": s_date, "end": e_date}).fetchall()
        amazon_product_data = [
            {
                'name':     row[1] or 'Unknown',
                'revenue':  float(row[2] or 0),
                'quantity': int(row[3] or 0),
                'sku':      row[4] or row[0] or '',
            }
            for row in amz_top_rows
        ]

        # Top 5 Blinkit products, filtered by date range if provided
        blinkit_top_rows = db.execute(text("""
            SELECT
                s.ItemId,
                MAX(s.ItemName) AS name,
                SUM(s.MRP)      AS revenue,
                SUM(s.QtySold)  AS quantity,
                MAX(p.AsgSku)   AS sku
            FROM BlinkitSales s
            LEFT JOIN Products p ON p.BlinkitId = CAST(s.ItemId AS CHAR(50)) COLLATE utf8mb4_general_ci
            WHERE s.SaleDate IS NOT NULL
              AND (:start IS NULL OR s.SaleDate >= :start)
              AND (:end IS NULL OR s.SaleDate <= :end)
            GROUP BY s.ItemId
            ORDER BY SUM(s.MRP) DESC
            LIMIT 5
        """), {"start": s_date, "end": e_date}).fetchall()
        blinkit_product_data = [
            {
                'name':     row[1] or 'Unknown',
                'revenue':  float(row[2] or 0),
                'quantity': float(row[3] or 0),
                'sku':      row[4] or '',
            }
            for row in blinkit_top_rows
        ]

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Dashboard charts query failed: {exc}"
        )

    overall_product_data = sorted(
        [{'name': p['name'], 'sku': p['sku'], 'channel': 'Amazon',  'revenue': p['revenue'], 'quantity': p['quantity']} for p in amazon_product_data] +
        [{'name': p['name'], 'sku': p['sku'], 'channel': 'Blinkit', 'revenue': p['revenue'], 'quantity': p['quantity']} for p in blinkit_product_data],
        key=lambda x: x['revenue'], reverse=True
    )[:10]

    result = {
        "monthly_sales":    monthly_data,
        "amazon_products":  amazon_product_data,
        "blinkit_products": blinkit_product_data,
        "top_products":     overall_product_data,
        "granularity":      granularity,
    }
    _dash_set(cache_key, result)
    return result


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
    # Fetch all three latest dates in a single round-trip
    dates_row = db.execute(text("""
        SELECT
            (SELECT MAX(ReportDate)   FROM AmazonInventory)  AS amz_date,
            (SELECT MAX(ReportDate)   FROM BlinkitInventory) AS blk_date,
            (SELECT MAX(InventoryDate) FROM Inventory)        AS inv_date
    """)).fetchone()
    latest_amz = dates_row.amz_date if dates_row else None
    latest_blk = dates_row.blk_date if dates_row else None

    # Amazon stock from AmazonInventory table (latest report date)
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
    if latest_blk:
        blinkit_inv = (
            db.query(
                Product.Id.label("ProductId"),
                func.sum(BlinkitInventoryData.BackendInvQty).label("blinkit_hub"),
                func.sum(BlinkitInventoryData.FrontendInvQty).label("blinkit_store"),
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
                literal_column("0").label("blinkit_hub"),
                literal_column("0").label("blinkit_store"),
            )
            .filter(False)
            .subquery()
        )

    # Packed / Unpacked from the ASG sheet: each product's last available stock and its date
    inv_sub = latest_stock_subquery(db)

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
            func.coalesce(blinkit_inv.c.blinkit_hub, 0).label("blinkitHub"),
            func.coalesce(blinkit_inv.c.blinkit_store, 0).label("blinkitStoreQty"),
            (
                func.coalesce(amazon_inv.c.amazon_stock, 0)
                + func.coalesce(blinkit_inv.c.blinkit_hub, 0)
                + func.coalesce(blinkit_inv.c.blinkit_store, 0)
            ).label("totalStock"),
            func.coalesce(inv_sub.c.packed_qty, 0).label("packedQty"),
            func.coalesce(inv_sub.c.unpacked_qty, 0).label("unpackedQty"),
            inv_sub.c.stock_date.label("stockDate"),
        )
        .outerjoin(amazon_inv, Product.Id == amazon_inv.c.ProductId)
        .outerjoin(blinkit_inv, Product.Id == blinkit_inv.c.ProductId)
        .outerjoin(inv_sub, Product.Id == inv_sub.c.product_id)
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

    offset = (page - 1) * page_size
    rows = (
        query.add_columns(func.count().over().label('_total'))
        .order_by(Product.ProductName)
        .offset(offset).limit(page_size).all()
    )
    # COUNT(*) OVER() only rides along on returned rows, so paging past the end reported
    # a total of 0 and broke the pagination controls. Fall back to an explicit count.
    total = rows[0]._total if rows else query.count()

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
            "blinkitHubStock": int(row.blinkitHub or 0),
            "blinkitStoreStock": int(row.blinkitStoreQty or 0),
            "blinkitStock": int(row.blinkitHub or 0) + int(row.blinkitStoreQty or 0),
            "totalStock": total_stock,
            "packedQty": int(row.packedQty or 0),
            "unpackedQty": int(row.unpackedQty or 0),
            "stockDate": row.stockDate.isoformat() if row.stockDate else None,
            "needsVerification": needs_verification(row.stockDate),
            "status": status,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }
