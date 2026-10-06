"""Inventory adjustment on PO accepted-quantity edits.

Regression for the phantom-stock bug: accepting more than the packed stock only
deducts what is available, so undoing it must restore only that amount.
Runs on in-memory SQLite — no MySQL needed (env vars are dummies for config).
"""
import os
import sys
from datetime import date

os.environ.setdefault("MYSQL_HOST", "x")
os.environ.setdefault("MYSQL_DB", "x")
os.environ.setdefault("MYSQL_USER", "x")
os.environ.setdefault("MYSQL_PASSWORD", "x")
os.environ.setdefault("SECRET_KEY", "x")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base
import app.models  # noqa: F401  (registers tables)
from app.models.inventory import Inventory
from app.models.product import Product
from app.routers.purchase_orders import _adjust_inventory_for_product

DAY = date(2026, 9, 15)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.execute(text(
        "CREATE TABLE InventoryHistory (ProductId INT, AsgWarehouseId INT, "
        "InventoryDate DATE, PackedQty INT)"
    ))
    s.add(Product(Id=1, ProductName="p", AsgSku="SKU1"))
    s.add(Inventory(ProductId=1, AsgWarehouseId=None, CurrentStock=200, PackedQty=152,
                    UnpackedQty=48, InventoryDate=DAY))
    s.execute(text("INSERT INTO InventoryHistory VALUES (1, NULL, :d, 152)"), {"d": DAY})
    s.commit()
    yield s
    s.close()


def packed(db):
    return db.query(Inventory).one().PackedQty


def test_oversized_accept_then_undo_does_not_create_stock(db):
    r = _adjust_inventory_for_product(db, 1, 504)   # accept 504, only 152 packed
    assert r["deducted"] == 152 and r["shortfall"] == 352
    assert packed(db) == 0

    r = _adjust_inventory_for_product(db, 1, -504)  # undo the accept
    assert packed(db) == 152                        # back to the uploaded 152, not 504
    assert r["deducted"] == -152 and r["shortfall"] == 352
    assert db.query(Inventory).one().CurrentStock == 200


def test_normal_deduct_and_full_restore(db):
    _adjust_inventory_for_product(db, 1, 100)
    assert packed(db) == 52
    _adjust_inventory_for_product(db, 1, -100)
    assert packed(db) == 152


def test_restore_with_nothing_deducted_is_a_noop(db):
    r = _adjust_inventory_for_product(db, 1, -50)
    assert packed(db) == 152 and r["deducted"] == 0
