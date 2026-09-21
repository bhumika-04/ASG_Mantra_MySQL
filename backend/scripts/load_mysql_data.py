"""Load the CSVs from export_mssql_data.py into the MySQL database created
by run_mysql_schema.py.

Historical migration step (the one-time MSSQL -> MySQL data move, already
completed — this project runs on MySQL only now, no Microsoft products):
  1. export_mssql_data.py  — pull every table out of MSSQL to CSV   (done)
  2. run_mysql_schema.py   — create the empty structure on MySQL    (done)
  3. load_mysql_data.py    — this script: CSV -> MySQL              (done)
Kept for reference / in case the MySQL database ever needs reloading from
the same CSV snapshot.

Tables are loaded in an order that respects foreign keys (e.g. Products
before Sales, which references it) — loading out of order will fail with
a foreign-key error rather than silently corrupting anything.

Safe to re-run against an EMPTY set of tables. Re-running it against
tables that already have rows in them will duplicate every row — if a
previous run failed partway through, truncate the tables it reached
before trying again (see the printed progress to know where it stopped).

Usage:
    cd backend
    venv\\Scripts\\python.exe scripts\\load_mysql_data.py
    venv\\Scripts\\python.exe scripts\\load_mysql_data.py --csv-dir D:\\some\\folder
"""
import argparse
import os
import sys

import pandas as pd

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DEFAULT_CSV_DIR = os.path.join(ROOT_DIR, "database", "export")

sys.path.insert(0, BACKEND_DIR)
from app.database import engine  # noqa: E402 — reuses the app's own MySQL engine

# Load order: every table appears after everything it has a foreign key
# to. Tables with no incoming-dependency requirement come first; within
# a group, order doesn't matter.
LOAD_ORDER = [
    # independent — no FK to anything
    "Roles", "Users", "Distributors", "AsgWarehouses", "Warehouses", "Products",
    "AmazonPO", "BlinkitPO", "AmazonSales", "BlinkitSales",
    # depend on Distributors
    "DistributorFacilities", "DistributorStock", "AmazonInventory", "BlinkitInventory",
    # depend on AmazonPO/BlinkitPO + Products
    "AmazonPOItem", "BlinkitPOItem",
    # depend on Products (+ AsgWarehouses)
    "Inventory", "Alerts",
    # depend on Products + Warehouses
    "PurchaseOrders", "Sales",
    # depend on AsgWarehouses + Products + Users
    "InventoryHistory",
    # depend on Users
    "Notifications", "AuditLogs", "UploadLogs",
]


def load_table(engine, csv_dir: str, table: str) -> int:
    path = os.path.join(csv_dir, f"{table}.csv")
    if not os.path.exists(path):
        print(f"  {table:<24} SKIPPED — {table}.csv not found in {csv_dir}")
        return 0

    df = pd.read_csv(path, encoding="utf-8-sig", keep_default_na=True)
    if df.empty:
        print(f"  {table:<24} {0:>8,} rows (CSV was empty)")
        return 0

    # Blank CSV fields become NaN on read; make them real SQL NULLs on insert
    # rather than the literal empty string.
    df = df.where(pd.notnull(df), None)

    df.to_sql(table, engine, if_exists="append", index=False, chunksize=1000, method="multi")
    print(f"  {table:<24} {len(df):>8,} rows loaded")
    return len(df)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv-dir", default=DEFAULT_CSV_DIR,
                         help="Folder containing the CSVs from export_mssql_data.py")
    args = parser.parse_args()

    from app.config import settings
    print(f"Loading from {args.csv_dir} into "
          f"{settings.MYSQL_HOST}/{settings.MYSQL_DB}\n")

    total = 0
    for table in LOAD_ORDER:
        total += load_table(engine, args.csv_dir, table)

    print(f"\nDone. {total:,} rows loaded.")
    print("Now compare this against the row counts export_mssql_data.py printed —")
    print("every table should match exactly.")


if __name__ == "__main__":
    main()
