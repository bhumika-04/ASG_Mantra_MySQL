"""Rules agreed with the client: India time, no silent 'today', Delivered cannot go back,
expected date not before order date, Sync alerts for Admin only."""
import asyncio
import os
import sys
from datetime import date, datetime, timedelta

os.environ.setdefault("MYSQL_HOST", "x")
os.environ.setdefault("MYSQL_DB", "x")
os.environ.setdefault("MYSQL_USER", "x")
os.environ.setdefault("MYSQL_PASSWORD", "x")
os.environ.setdefault("SECRET_KEY", "x")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import pytest
from fastapi import HTTPException

from app.utils.timeutil import now_ist, today_ist
from app.routers.purchase_orders import _check_expected_not_before_order, _check_status_move
from app.schemas.purchase_order import POStatus


def test_ist_is_five_thirty_ahead_of_utc():
    diff = now_ist() - datetime.utcnow()
    assert timedelta(hours=5, minutes=29) < diff < timedelta(hours=5, minutes=31)
    assert today_ist() == now_ist().date()


@pytest.mark.parametrize("old,new", [("Delivered", "Created"), ("Delivered", "In Transit"),
                                     ("Received", "Dispatched"), ("Delivered", "Delayed"),
                                     (POStatus.DELIVERED, POStatus.CREATED)])
def test_delivered_cannot_go_back(old, new):
    with pytest.raises(HTTPException) as e:
        _check_status_move(old, new)
    assert e.value.status_code == 422


@pytest.mark.parametrize("old,new", [("Created", "Delivered"), ("In Transit", "Delivered"),
                                     ("Delivered", "Cancelled"), ("Delivered", "Delivered"), (None, "Created")])
def test_other_moves_allowed(old, new):
    _check_status_move(old, new)


def test_expected_date_before_order_refused():
    with pytest.raises(HTTPException) as e:
        _check_expected_not_before_order(date(2026, 1, 26), date(2026, 6, 1))
    assert e.value.status_code == 422
    _check_expected_not_before_order(date(2026, 6, 1), date(2026, 6, 1))      # same day is fine
    _check_expected_not_before_order(date(2026, 7, 1), date(2026, 6, 1))
    _check_expected_not_before_order(date(2026, 7, 1), None)                  # no order date: nothing to compare
    _check_expected_not_before_order(None, date(2026, 6, 1))


def test_sync_alerts_is_admin_only():
    from app.routers.alerts import sync_alerts

    class U:
        Role = "Manager"

    with pytest.raises(HTTPException) as e:
        asyncio.run(sync_alerts(db=None, current_user=U()))
    assert e.value.status_code == 403


def test_blinkit_inventory_without_date_is_refused():
    from app.routers.blinkit_data import _extract_blinkit_inventory_date
    df = pd.DataFrame({"item_id": [1], "backend_inv_qty": [5]})
    with pytest.raises(HTTPException) as e:
        _extract_blinkit_inventory_date(df, "stock_report.csv")          # no date column, no date in name
    assert e.value.status_code == 400
    assert _extract_blinkit_inventory_date(df, "Bilnkit_stock_report_10.09.26.csv") == date(2026, 9, 10)


def test_amazon_metadata_date_not_found_flag():
    from app.routers.amazon_data import extract_date_from_metadata
    _, found = extract_date_from_metadata(b"no metadata here\nASIN,Units\n", "report.csv")
    assert found is False
    d, found = extract_date_from_metadata(b"Viewing Range=[09/09/26 - 09/09/26]\n", "x.csv")
    assert found is True and d == date(2026, 9, 9)
