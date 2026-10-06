"""Correct Amazon PO dates in MySQL using the original PO PDFs as the source of truth.

Why: the PDF parser read Ordered On / Expected date (month/day/year) and Ship window
(day/month/year) all day-first, so dates with a day <= 12 were stored swapped.

Safe by design:
  * dry run by default; --apply writes.
  * old values go to AmazonPO_DateFix_Backup / AmazonPOItem_DateFix_Backup first, and to a CSV.
  * each UPDATE only fires if the row still holds the value that was read (no overwriting
    someone's later edit).
  * an expected date a user edited in the app (any AuditLogs 'expectedDate' entry for that
    item) is never changed.
  * only header dates (Ordered On, Ship window) that differ from the PDF are changed, and
    Expected date only where the stored value is the day/month swap of the PDF value.
    Expected dates that differ for any other reason (rescheduled) are left alone.
Usage:  python scripts/fix_amazon_po_dates.py <pdf_root> [--apply]
"""
import csv, glob, os, sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sqlalchemy import text
from app.database import engine
from app.services.amazon_pdf_parser import extract_amazon_po_from_pdf

root = sys.argv[1]; apply = "--apply" in sys.argv


def d(s):
    return date.fromisoformat(s) if s else None


def swap(x):
    return date(x.year, x.day, x.month) if x and x.day <= 12 and x.day != x.month else None


pdfs = {}
for f in glob.glob(os.path.join(root, "20*", "**", "*.pdf"), recursive=True):
    r = extract_amazon_po_from_pdf(open(f, "rb").read())
    if r.header.po_number:
        pdfs[r.header.po_number] = r

hdr_changes, item_changes = [], []
with engine.connect() as c:
    pos = {r.PONumber: r for r in c.execute(text(
        "SELECT Id,PONumber,OrderedOnDate,ShipWindowStartDate,ShipWindowEndDate FROM AmazonPO"))}
    items = {}
    user_edited = {str(r[0]) for r in c.execute(text(
        "SELECT DISTINCT RecordId FROM AuditLogs WHERE TableName='AmazonPOItem' AND NewValues LIKE '%expectedDate%'"))}
    for r in c.execute(text("SELECT Id,POId,ASIN,ExpectedDate FROM AmazonPOItem")):
        items.setdefault(r.POId, []).append(r)
for po, r in pdfs.items():
    row = pos.get(po)
    if row is None:
        continue
    h = r.header
    for col, new, old in (("OrderedOnDate", d(h.ordered_on_date), row.OrderedOnDate),
                          ("ShipWindowStartDate", d(h.ship_window_start_date), row.ShipWindowStartDate),
                          ("ShipWindowEndDate", d(h.ship_window_end_date), row.ShipWindowEndDate)):
        if new and old != new:
            hdr_changes.append((row.Id, po, col, old, new))
    by_asin = {}
    for it in r.items:
        by_asin.setdefault(it.asin, []).append(d(it.expected_date))
    for it in items.get(row.Id, []):
        cands = by_asin.get(it.ASIN) or []
        if str(it.Id) in user_edited:
            continue
        if it.ExpectedDate and cands and it.ExpectedDate not in cands:
            fixed = [x for x in cands if x and swap(x) == it.ExpectedDate]
            if len(fixed) == 1:
                item_changes.append((it.Id, po, "ExpectedDate", it.ExpectedDate, fixed[0]))

print(f"PDFs read: {len(pdfs)} | header changes: {len(hdr_changes)} on {len({c[1] for c in hdr_changes})} POs"
      f" | expected-date changes: {len(item_changes)} on {len({c[1] for c in item_changes})} POs")
for col in ("OrderedOnDate", "ShipWindowStartDate", "ShipWindowEndDate"):
    print(f"   {col}: {sum(1 for c in hdr_changes if c[2] == col)}")
out = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "po_date_fix_changes.csv")
with open(out, "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh); w.writerow(["table", "row_id", "PONumber", "column", "old", "new"])
    for c_ in hdr_changes: w.writerow(["AmazonPO", *c_])
    for c_ in item_changes: w.writerow(["AmazonPOItem", *c_])
print("change list:", out)
if not apply:
    print("DRY RUN - nothing written. Re-run with --apply.")
    sys.exit(0)

with engine.begin() as c:
    for t, src in (("AmazonPO_DateFix_Backup", "AmazonPO"), ("AmazonPOItem_DateFix_Backup", "AmazonPOItem")):
        c.execute(text(f"CREATE TABLE IF NOT EXISTS {t} AS SELECT * FROM {src} WHERE 1=0"))
    ids = sorted({c_[0] for c_ in hdr_changes}); iids = sorted({c_[0] for c_ in item_changes})
    for i in ids:
        c.execute(text("INSERT INTO AmazonPO_DateFix_Backup SELECT * FROM AmazonPO WHERE Id=:i"), {"i": i})
    for i in iids:
        c.execute(text("INSERT INTO AmazonPOItem_DateFix_Backup SELECT * FROM AmazonPOItem WHERE Id=:i"), {"i": i})
    done = skipped = 0
    for rid, po, col, old, new in hdr_changes:
        n = c.execute(text(f"UPDATE AmazonPO SET {col}=:n WHERE Id=:i AND {col}<=>:o"), {"n": new, "i": rid, "o": old}).rowcount
        done += n; skipped += 1 - n
    for rid, po, col, old, new in item_changes:
        n = c.execute(text("UPDATE AmazonPOItem SET ExpectedDate=:n WHERE Id=:i AND ExpectedDate<=>:o"), {"n": new, "i": rid, "o": old}).rowcount
        done += n; skipped += 1 - n
print(f"APPLIED: {done} values updated, {skipped} skipped (changed since read). Backups: AmazonPO_DateFix_Backup, AmazonPOItem_DateFix_Backup")
