"""Report PO line items whose received/accepted quantity exceeds the ordered quantity.

Read-only. Writes a CSV for review and prints a summary; nothing in the database is
modified.

These rows pre-date the bounds validation added to the quantity endpoints, which now
rejects any value above the ordered quantity. They may be genuine over-delivery rather
than data entry errors, so they are reported rather than clamped.

Usage:
    cd backend
    venv\\Scripts\\python.exe scripts\\report_qty_overruns.py
    venv\\Scripts\\python.exe scripts\\report_qty_overruns.py --out C:\\path\\to\\file.csv
"""
import argparse
import csv
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402
from app.database import SessionLocal  # noqa: E402


QUERIES = {
    "Amazon / received > ordered": """
        SELECT p.PONumber, p.POStatus, i.Id, i.ASIN, i.Title,
               i.QuantityRequested AS ordered, i.QuantityReceived AS actual
        FROM AmazonPOItem i
        JOIN AmazonPO p ON p.Id = i.POId
        WHERE i.QuantityReceived > i.QuantityRequested
    """,
    "Amazon / accepted > ordered": """
        SELECT p.PONumber, p.POStatus, i.Id, i.ASIN, i.Title,
               i.QuantityRequested AS ordered, i.AcceptedQuantity AS actual
        FROM AmazonPOItem i
        JOIN AmazonPO p ON p.Id = i.POId
        WHERE i.AcceptedQuantity > i.QuantityRequested
    """,
    "Blinkit / received > ordered": """
        SELECT p.PONumber, p.Status, i.Id, i.ItemCode, i.ItemName,
               i.QTY AS ordered, i.ReceivedQty AS actual
        FROM BlinkitPOItem i
        JOIN BlinkitPO p ON p.Id = i.POId
        WHERE i.ReceivedQty > i.QTY
    """,
    "Blinkit / accepted > ordered": """
        SELECT p.PONumber, p.Status, i.Id, i.ItemCode, i.ItemName,
               i.QTY AS ordered, i.AcceptedQty AS actual
        FROM BlinkitPOItem i
        JOIN BlinkitPO p ON p.Id = i.POId
        WHERE i.AcceptedQty > i.QTY
    """,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "qty_overruns.csv"),
        help="CSV output path",
    )
    args = parser.parse_args()

    db = SessionLocal()
    rows_out = []
    try:
        for label, sql in QUERIES.items():
            rows = db.execute(text(sql)).fetchall()
            print(f"{label:<32} {len(rows)} rows")
            for r in rows:
                ordered = int(r[5] or 0)
                actual = int(r[6] or 0)
                rows_out.append({
                    "category": label,
                    "po_number": r[0],
                    "po_status": r[1],
                    "item_id": r[2],
                    "product_code": r[3],
                    "product_name": (r[4] or "")[:80],
                    "ordered": ordered,
                    "actual": actual,
                    "excess": actual - ordered,
                })
    finally:
        db.close()

    if not rows_out:
        print("\nNo overruns found.")
        return

    rows_out.sort(key=lambda x: x["excess"], reverse=True)
    with open(args.out, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows_out[0].keys()))
        writer.writeheader()
        writer.writerows(rows_out)

    total_excess = sum(r["excess"] for r in rows_out)
    distinct_pos = len({r["po_number"] for r in rows_out})
    print(f"\ntotal rows        {len(rows_out)}")
    print(f"distinct POs      {distinct_pos}")
    print(f"total excess qty  {total_excess:,}")
    print(f"largest excess    {rows_out[0]['excess']:,} on PO {rows_out[0]['po_number']}")
    print(f"\nwritten to {args.out}")
    print(f"generated {datetime.now():%Y-%m-%d %H:%M}  (read-only — no data was changed)")


if __name__ == "__main__":
    main()
