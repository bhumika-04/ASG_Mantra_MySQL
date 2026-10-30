"""Behaviour agreed with the client on the 7 report questions. Runs on in-memory SQLite."""
import asyncio
import os
import sys
import uuid
from datetime import date, timedelta

os.environ.setdefault("MYSQL_HOST", "x")
os.environ.setdefault("MYSQL_DB", "x")
os.environ.setdefault("MYSQL_USER", "x")
os.environ.setdefault("MYSQL_PASSWORD", "x")
os.environ.setdefault("SECRET_KEY", "x")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
import app.models  # noqa: F401
from app.models.amazon_po import AmazonPOData
from app.models.amazon_po_item import AmazonPOItemData
from app.models.inventory import Inventory
from app.models.product import Product
from app.models.warehouse import Warehouse
from app.utils.stock import latest_stock_subquery, needs_verification
from app.utils.timeutil import today_ist


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


class Admin:
    Role = "Admin"
    Id = uuid.uuid4()


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ Q1: accepted quantity never moves stock
def test_accepted_quantity_does_not_change_inventory(db):
    from app.routers.purchase_orders import update_amazon_item_accepted_qty
    p = Product(Id=1, ProductName="Rosemary", AsgSku="ROSE-15", AmazonId="B000000001")
    db.add(p)
    db.add(Inventory(ProductId=1, CurrentStock=200, PackedQty=152, UnpackedQty=48, InventoryDate=today_ist()))
    po = AmazonPOData(Id=1, PONumber="PO1")
    db.add(po)
    db.flush()
    db.add(AmazonPOItemData(Id=1, POId=1, PONumber="PO1", ASIN="B000000001", ProductId=1, QuantityRequested=504, AcceptedQuantity=0))
    db.commit()

    res = run(update_amazon_item_accepted_qty(1, {"accepted_qty": 504}, db=db, current_user=Admin()))
    assert res["success"] and res["accepted_quantity"] == 504
    inv = db.query(Inventory).one()
    assert (inv.PackedQty, inv.UnpackedQty, inv.CurrentStock) == (152, 48, 200)   # untouched

    run(update_amazon_item_accepted_qty(1, {"accepted_qty": 0}, db=db, current_user=Admin()))
    inv = db.query(Inventory).one()
    assert (inv.PackedQty, inv.CurrentStock) == (152, 200)


# ------------------------------------------------------------------ Q2: warehouse details are saved
def test_create_warehouse_saves_address_pincode_location(db):
    from app.routers.warehouses import create_warehouse
    from app.schemas.warehouse import WarehouseCreate
    data = WarehouseCreate(warehouseCode="HHS6", warehouseName="Gurgaon FC", channel="Amazon", fcType="Standard",
                           state="Haryana", city="Gurgaon", location="Dhateer",
                           address="Khasra number 2 to 24, Village Dhateer", pincode="121102")
    res = run(create_warehouse(data, db=db, current_user=Admin()))
    assert res["success"]
    w = db.query(Warehouse).one()
    assert (w.Address, w.Pincode, w.Location) == ("Khasra number 2 to 24, Village Dhateer", "121102", "Dhateer")
    assert res["data"]["address"] == w.Address and res["data"]["pincode"] == "121102"


# ------------------------------------------------------------------ Q3/Q6: low stock = total, last available stock
def test_latest_stock_uses_each_products_last_sheet(db):
    d1, d2 = today_ist() - timedelta(days=20), today_ist() - timedelta(days=1)
    for i, sku in ((1, "A"), (2, "B")):
        db.add(Product(Id=i, ProductName=sku, AsgSku=sku))
    db.add_all([
        Inventory(ProductId=1, CurrentStock=10, PackedQty=5, UnpackedQty=5, InventoryDate=d1),
        Inventory(ProductId=1, CurrentStock=90, PackedQty=60, UnpackedQty=30, InventoryDate=d2),
        Inventory(ProductId=2, CurrentStock=425, PackedQty=400, UnpackedQty=25, InventoryDate=d1),   # missing from newest sheet
    ])
    db.commit()
    sq = latest_stock_subquery(db)
    got = {r.product_id: (r.stock_date, r.packed_qty, r.unpacked_qty) for r in db.query(sq).all()}
    assert got[1] == (d2, 60, 30)
    assert got[2] == (d1, 400, 25)               # keeps its last known stock, with its own date, not zero


def test_needs_verification_after_15_days():
    t = date(2026, 10, 20)
    assert not needs_verification(date(2026, 10, 5), t)       # exactly 15 days
    assert needs_verification(date(2026, 10, 4), t)           # 16 days
    assert needs_verification(None, t)


def test_low_stock_widget_uses_total_and_flags_old_stock(db):
    from app.routers.inventory import get_low_stock_dashboard
    d_new, d_old = today_ist() - timedelta(days=1), today_ist() - timedelta(days=40)
    db.add_all([Product(Id=1, ProductName="Sleep Spray", AsgSku="SLEEP"),      # packed 46 but total 481 -> not low
                Product(Id=2, ProductName="Tiny", AsgSku="TINY"),              # total 30 -> low
                Product(Id=3, ProductName="Zero", AsgSku="ZERO"),              # total 0 -> critical
                Product(Id=4, ProductName="Stale", AsgSku="STALE"),            # last seen 40 days ago, total 12
                Product(Id=5, ProductName="NeverSeen", AsgSku="NEVER")])       # no stock record -> critical
    db.add_all([
        Inventory(ProductId=1, CurrentStock=481, PackedQty=46, UnpackedQty=435, InventoryDate=d_new),
        Inventory(ProductId=2, CurrentStock=30, PackedQty=10, UnpackedQty=20, InventoryDate=d_new),
        Inventory(ProductId=3, CurrentStock=0, PackedQty=0, UnpackedQty=0, InventoryDate=d_new),
        Inventory(ProductId=4, CurrentStock=12, PackedQty=12, UnpackedQty=0, InventoryDate=d_old),
    ])
    db.commit()
    res = run(get_low_stock_dashboard(limit=50, db=db, current_user=Admin()))
    by = {i["asgSku"]: i for i in res["items"]}
    assert "SLEEP" not in by
    assert by["TINY"]["severity"] == "low" and by["TINY"]["totalQty"] == 30
    assert by["ZERO"]["severity"] == "critical" and by["NEVER"]["severity"] == "critical"
    assert by["STALE"]["needsVerification"] is True and by["STALE"]["inventoryDate"] == d_old.isoformat()
    assert by["TINY"]["needsVerification"] is False


# ------------------------------------------------------------------ Q5: strict product upload
def _df(rows):
    return pd.DataFrame(rows, dtype=str)


def test_product_validation_skips_bad_rows_and_keeps_good_ones(db):
    from app.routers.products import _validate_products, _id_text
    db.add(Product(Id=1, ProductName="Old", AsgSku="EXIST-1", AmazonId="B000000001", BlinkitId="10169422"))
    db.commit()
    df = _df([
        {"productName": "Good", "asgSku": "NEW-1", "amazonId": "B000000002", "blinkitId": "10012345.0"},   # numeric id -> text
        {"productName": "Dup in db", "asgSku": "exist-1"},
        {"productName": "Dup in file", "asgSku": "NEW-1"},
        {"productName": "Amazon id taken", "asgSku": "NEW-2", "amazonId": "B000000001"},
        {"productName": "Blinkit id taken", "asgSku": "NEW-3", "blinkitId": "10169422"},
        {"productName": "Bad asin", "asgSku": "NEW-4", "amazonId": "12345"},
        {"productName": "Amazon id repeated", "asgSku": "NEW-5", "amazonId": "B000000002"},
        {"productName": "Bad price", "asgSku": "NEW-6", "unitPrice": "abc"},
        {"productName": "", "asgSku": "NEW-7"},
        {"productName": "Another good", "asgSku": "NEW-8", "unitPrice": "1,299.50", "packSize": "3"},
    ])
    rows = _validate_products(df, db)
    status = {r["asgSku"] or "(blank)": (r["status"], r["reason"]) for r in rows}
    assert [r["status"] for r in rows].count("valid") == 2
    assert rows[0]["status"] == "valid" and rows[0]["blinkitId"] == "10012345"
    assert status["exist-1"][0] == "duplicate" and "database" in status["exist-1"][1]
    assert rows[2]["status"] == "duplicate" and "repeated" in rows[2]["reason"]
    assert "belongs to product EXIST-1" in status["NEW-2"][1]
    assert "belongs to product EXIST-1" in status["NEW-3"][1]
    assert "valid ASIN" in status["NEW-4"][1]
    assert "repeated in this file" in status["NEW-5"][1]
    assert "price" in status["NEW-6"][1].lower()
    assert rows[8]["status"] == "error"
    assert rows[9]["status"] == "valid" and str(rows[9]["unitPrice"]) == "1299.50" and rows[9]["packSize"] == 3
    assert _id_text("10012345.0") == "10012345" and _id_text(float("nan")) is None and _id_text("  ") is None


def test_product_upload_saves_valid_rows_and_reports_skipped(db):
    from app.routers.products import upload_products

    class F:
        filename = "p.csv"
        async def read(self):
            return (b"Product Name,ASG SKU,Amazon ID,Blinkit ID\n"
                    b"Good one,G-1,B000000011,10000001\n"
                    b"Same sku,G-1,B000000012,10000002\n"
                    b"Taken asin,G-2,B000000011,\n"
                    b"Good two,G-3,,\n")
    res = run(upload_products(file=F(), db=db, current_user=Admin()))
    assert res["summary"]["uploaded"] == 2 and res["summary"]["skipped"] == 2
    assert {p.AsgSku for p in db.query(Product).all()} == {"G-1", "G-3"}
    reasons = " | ".join(s["reason"] for s in res["skippedProducts"])
    assert "repeated in this file" in reasons and "Amazon ID B000000011" in reasons
    assert all("row" in s for s in res["skippedProducts"])


# ------------------------------------------------------------------ Q7: special characters are kept
@pytest.mark.parametrize("module", ["app.routers.blinkit_data", "app.routers.amazon_data"])
def test_names_keep_special_characters(module):
    import importlib
    safe_str = importlib.import_module(module).safe_str
    name = "Rosemary Oil – 100ml (₹299) Café Edition रोज़मेरी"
    assert safe_str(name) == name
    assert safe_str("﻿Tea​ Tree Oil\x00") == "Tea Tree Oil"      # invisible junk removed, NBSP -> space
    assert safe_str(float("nan")) is None and safe_str("  ") is None
    assert safe_str("abcdef", 3) == "abc"
