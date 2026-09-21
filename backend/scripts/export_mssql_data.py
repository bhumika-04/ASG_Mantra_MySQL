"""Export every table in the (former) MSSQL database to one CSV file each.

HISTORICAL — this was step 1 of the one-time MSSQL -> MySQL data migration
(see docs/MYSQL_MIGRATION_BRIEF.md) and has already been run; the project now
runs on MySQL only (no Microsoft products, per client requirement) and
`app.database` no longer has an MSSQL connection to import. Kept for
reference. To ever run this again, it needs its own MSSQL connection details
and `pip install pyodbc` — both removed from the main app's config/deps —
plus a running SQL Server to point at. It only ever *reads*; nothing here
writes or deletes anything.

What it does, per table:
  1. Runs SELECT * (uniqueidentifier/GUID columns are cast to plain text
     first, so the CSV always contains a clean 36-character string like
     MySQL's CHAR(36) expects — no driver-specific UUID objects).
  2. Writes the result to database/export/<TableName>.csv
  3. Prints how many rows were written.

At the end it prints a summary table of row counts per file — keep that
output, it's exactly what you compare against after loading into MySQL
("row-count parity" in the migration brief) to prove nothing was lost.

Usage:
    cd backend
    venv\\Scripts\\python.exe scripts\\export_mssql_data.py
    venv\\Scripts\\python.exe scripts\\export_mssql_data.py --out D:\\some\\other\\folder
"""
import argparse
import os
import sys
import uuid

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import engine  # noqa: E402  (reuses the app's own DB connection)


# Every table in the live database (see the archived MSSQL schema script (moved outside the repo)).
# Order doesn't matter for export — we're only reading — but it's kept
# in the same order as WholeDbMySQL.sql for easy cross-checking later.
TABLES = [
    "Inventory", "Products", "PurchaseOrders", "Alerts", "AmazonInventory",
    "AmazonPO", "AmazonPOItem", "AmazonSales", "AsgWarehouses", "AuditLogs",
    "BlinkitInventory", "BlinkitPO", "BlinkitPOItem", "BlinkitSales",
    "DistributorFacilities", "Distributors", "DistributorStock",
    "InventoryHistory", "Notifications", "Roles", "Sales", "UploadLogs",
    "Users", "Warehouses",
]

# Columns that are `uniqueidentifier` in MSSQL — cast to VARCHAR(36) in the
# SELECT so the CSV holds a plain string, matching the CHAR(36) columns in
# database/WholeDbMySQL.sql. (Generic detection isn't used here because a
# straight `SELECT *` through pyodbc can return these either as Python
# uuid.UUID objects or as strings depending on driver settings — casting
# in SQL removes that ambiguity entirely.)
GUID_COLUMNS = {
    "Users": ["Id", "CreatedBy"],
    "Products": ["CreatedBy"],
    "PurchaseOrders": ["CreatedBy", "UpdatedBy"],
    "Alerts": ["ResolvedBy"],
    "AuditLogs": ["UserId"],
    "Inventory": ["UpdatedBy"],
    "InventoryHistory": ["UploadedBy"],
    "Notifications": ["UserId"],
    "UploadLogs": ["UploadedBy"],
}


def stringify_stray_uuids(df: pd.DataFrame) -> pd.DataFrame:
    """Belt-and-braces: convert any uuid.UUID objects that slipped through
    (e.g. from a table/column not listed in GUID_COLUMNS) to plain strings,
    so nothing in the CSV is a Python object repr like UUID('...')."""
    for col in df.columns:
        if df[col].map(lambda v: isinstance(v, uuid.UUID)).any():
            df[col] = df[col].map(lambda v: str(v) if isinstance(v, uuid.UUID) else v)
    return df


def build_select(table: str) -> str:
    guid_cols = set(GUID_COLUMNS.get(table, []))
    if not guid_cols:
        return f"SELECT * FROM [{table}]"

    # Need the full column list to replace just the GUID ones with a CAST.
    with engine.connect() as conn:
        cols = pd.read_sql_query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            conn, params=(table,),
        )["COLUMN_NAME"].tolist()

    parts = [
        f"CAST([{c}] AS VARCHAR(36)) AS [{c}]" if c in guid_cols else f"[{c}]"
        for c in cols
    ]
    return f"SELECT {', '.join(parts)} FROM [{table}]"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out", default=None,
        help="Output folder for the CSV files (default: database/export next to this repo)",
    )
    args = parser.parse_args()

    out_dir = args.out or os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "database", "export",
    )
    os.makedirs(out_dir, exist_ok=True)

    print(f"Exporting {len(TABLES)} tables to: {out_dir}\n")

    summary = []
    with engine.connect() as conn:
        for table in TABLES:
            sql = build_select(table)
            df = pd.read_sql_query(sql, conn)
            df = stringify_stray_uuids(df)

            out_path = os.path.join(out_dir, f"{table}.csv")
            df.to_csv(out_path, index=False, encoding="utf-8-sig")

            print(f"  {table:<24} {len(df):>8,} rows -> {table}.csv")
            summary.append((table, len(df)))

    total = sum(n for _, n in summary)
    print(f"\nDone. {total:,} rows across {len(TABLES)} tables.")
    print("Keep this row-count list — compare it against MySQL after loading:")
    for table, n in summary:
        print(f"  {table}: {n}")


if __name__ == "__main__":
    main()
