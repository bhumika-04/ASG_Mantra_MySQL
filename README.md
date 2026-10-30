# ASG Mantra Analytics

Inventory, sales and purchase-order (PO) dashboard for the ASG Mantra brand. It combines data from **Amazon** (via distributor R&K) and **Blinkit** (via distributor Eagle Network) with the in-house ASG warehouse stock.

Flow: `ASG warehouse → distributor → channel (Amazon / Blinkit)`

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, shadcn/Radix, Recharts |
| Backend | FastAPI, SQLAlchemy 2, pandas, pdfplumber |
| Database | MySQL 8.0.16+ (`database/schema.sql`) |
| Auth | JWT, role-based access (`Admin`, `Manager`, `Amazon Distributor`, `Blinkit Distributor`) |

## Layout

```
backend/
  main.py                      app entry: CORS, error handlers, routers, audit-log cleanup
  app/config.py                settings read from backend/.env
  app/database.py              engine, session, connection retry
  app/models/                  SQLAlchemy models
  app/routers/                 one module per feature area
  app/schemas/                 request schemas
  app/services/                PDF parsers (Amazon PO, Eagle stock report)
  app/utils/                   auth, audit, IST time helpers, stock rules
  scripts/run_mysql_schema.py  creates the database from database/schema.sql
  tests/                       pytest suite (in-memory SQLite, no MySQL needed)
database/
  schema.sql                   full MySQL schema
  upgrade_warehouse_address.sql  adds Address / Pincode to an existing Warehouses table
frontend/
  src/app/(dashboard)/         pages
  src/lib/api.ts               API client (adds the JWT, 401 returns to login)
  src/types/route-permissions.ts   route → allowed roles
```

## Run locally

Backend (Python 3.11 or 3.12):

```
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` (git-ignored):

```
MYSQL_HOST=...
MYSQL_PORT=3306
MYSQL_DB=TechGenia_Analytics
MYSQL_USER=...
MYSQL_PASSWORD=...
SECRET_KEY=...
ALLOWED_ORIGINS=http://localhost:3000
```

```
python scripts/run_mysql_schema.py   # once, on an empty database
uvicorn main:app --port 8000         # API docs at /api/docs
```

Frontend:

```
cd frontend
npm ci
# .env.local: NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Tests: `cd backend && pytest`.

## Business rules

- **Time zone:** business time is IST. Every date or timestamp the backend creates comes from `app/utils/timeutil.py`. JWT expiry is the only UTC value.
- **ASG stock** comes only from the daily ASG stock sheet. PO quantity edits never change inventory. One row per product, warehouse and date; uploading the same date overwrites it.
- **Last known stock:** each product shows its latest recorded stock with that sheet's date, flagged "needs verification" after 15 days (`app/utils/stock.py`).
- **Low stock:** Packed + Unpacked ≤ 50 (`LOW_STOCK_THRESHOLD` in `app/utils/stock.py` and `frontend/src/lib/constants.ts`; keep both equal).
- **Blinkit stock** is Hub + Store quantity.
- **Uploads** run in two steps: preview (validate, nothing saved), then confirm. A file without a date is refused. Every upload is logged in `UploadLogs` and `AuditLogs`.
- **Amazon PO PDFs:** *Ordered On* and *Expected* dates are `MM/DD/YYYY`; the ship window is `DD/MM/YYYY` (`_parse_date_mdy` in `app/services/amazon_pdf_parser.py`). Slash dates in CSV uploads that could be read either way are refused.
- **PO status** is computed by the backend. A stored header status (Delivered, Cancelled, Dispatched…) wins over item statuses; an open PO shows Expired 15 days after its expiry date. A Delivered PO cannot move back to an earlier status, and an expected date cannot precede the order date.
- **Products:** ASG SKU is the item code; Amazon and Blinkit ids are unique and validated. Bulk upload saves valid rows and reports each skipped row with its reason.
- **Warehouses** keep name, code, location, address and pincode. The Blinkit distributor is always Eagle Network.
- **Retention:** audit logs older than 60 days are deleted daily.

## Deploying

- Frontend: Vercel (`NEXT_PUBLIC_API_URL` set in the project settings).
- Backend: any Python 3.11+ host running `uvicorn main:app`. Apply `database/upgrade_warehouse_address.sql` before deploying a version that uses warehouse address fields against an older database.
