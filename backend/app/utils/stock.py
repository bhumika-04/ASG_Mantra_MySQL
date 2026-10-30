"""Shared ASG stock rules (agreed with the client).

* Stock comes only from the daily uploaded packed/unpacked sheet.
* A product missing from the latest sheet keeps its last available stock, shown with that
  sheet's date. After VERIFY_AFTER_DAYS without an update it is marked "needs verification".
* Low stock means total stock (Packed + Unpacked) at or below LOW_STOCK_THRESHOLD.
"""
from datetime import date
from typing import Optional

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.utils.timeutil import today_ist

LOW_STOCK_THRESHOLD = 50
VERIFY_AFTER_DAYS = 15


def needs_verification(stock_date: Optional[date], today: Optional[date] = None) -> bool:
    """True when the stock figure has not been updated for more than VERIFY_AFTER_DAYS."""
    if stock_date is None:
        return True
    today = today or today_ist()
    return (today - stock_date).days > VERIFY_AFTER_DAYS


def is_low_stock(packed, unpacked) -> bool:
    return int(packed or 0) + int(unpacked or 0) <= LOW_STOCK_THRESHOLD


def latest_snapshot_dates(db: Session):
    """Subquery: each product's most recent inventory date (columns: pid, d)."""
    return (
        db.query(Inventory.ProductId.label("pid"), func.max(Inventory.InventoryDate).label("d"))
        .group_by(Inventory.ProductId)
        .subquery()
    )


def latest_stock_subquery(db: Session):
    """Subquery: each product's last available stock, summed over warehouses.

    Columns: product_id, stock_date, packed_qty, unpacked_qty.
    """
    latest = latest_snapshot_dates(db)
    return (
        db.query(
            Inventory.ProductId.label("product_id"),
            latest.c.d.label("stock_date"),
            func.sum(Inventory.PackedQty).label("packed_qty"),
            func.sum(Inventory.UnpackedQty).label("unpacked_qty"),
        )
        .join(latest, and_(Inventory.ProductId == latest.c.pid, Inventory.InventoryDate == latest.c.d))
        .group_by(Inventory.ProductId, latest.c.d)
        .subquery()
    )
