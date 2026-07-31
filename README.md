# ASG Mantra — Inventory & Analytics Platform

A full-stack inventory management and analytics dashboard for **ASG Mantra**, consolidating stock, sales, and purchase order data across Amazon and Blinkit channels via their distributors — **R&K Inventory** (Amazon) and **Eagle Network** (Blinkit).

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup](#setup)
- [Features](#features)
- [API Endpoints](#api-endpoints)
- [Roles & Permissions](#roles--permissions)
- [Data Sources & File Formats](#data-sources--file-formats)
- [Upload Flow](#upload-flow)

---

## Overview

The platform provides a unified view across the supply chain:

```
ASG Warehouse → Distributor (Eagle / R&K) → Channel (Blinkit / Amazon)
```

Key capabilities:
- Track **packed/unpacked ASG stock** with date snapshots
- Monitor **Amazon inventory, sales, and POs** (PDF + CSV upload)
- Monitor **Blinkit inventory** (FE dark stores + BE hubs), **sales, and POs**
- Track **Eagle Network** distributor stock across 4 regional warehouses (DL, MH, KT, WB)
- **Purchase Order lifecycle** from creation through fulfilment
- Role-based access for Admin, Manager, and Viewer roles
- Audit trail of all user actions with 60-day auto-retention

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend | FastAPI, SQLAlchemy ORM, Python 3.11+ |
| Database | Microsoft SQL Server (MSSQL) via `pyodbc` |
| Auth | JWT-based with role-based access control |
| PDF Parsing | pdfplumber (Amazon PO PDFs, Eagle stock PDFs) |
| File Processing | Pandas, openpyxl (CSV/XLSX uploads) |

---

## Project Structure

```
ASG_Mantra/
├── backend/
│   ├── app/
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── routers/             # FastAPI route handlers
│   │   │   ├── amazon_data.py   # Amazon sales, inventory, PO upload
│   │   │   ├── blinkit_data.py  # Blinkit sales, inventory, PO upload
│   │   │   ├── purchase_orders.py
│   │   │   ├── dashboard.py
│   │   │   ├── inventory.py
│   │   │   ├── notifications.py
│   │   │   ├── audit_logs.py
│   │   │   └── upload_logs.py
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── services/            # PDF parsers
│   │   │   ├── amazon_pdf_parser.py
│   │   │   └── eagle_pdf_parser.py
│   │   └── utils/               # Audit logging, auth dependencies
│   ├── main.py                  # App entry, startup tasks, audit cleanup loop
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/(dashboard)/     # All dashboard pages (Next.js App Router)
│   │   ├── components/          # Shared UI components + shadcn primitives
│   │   ├── contexts/            # AuthContext, FilterContext (global date filter)
│   │   ├── lib/                 # API client (api.ts), navigation, utilities
│   │   └── types/               # Route permission definitions
│   └── package.json
│
├── database/
│   ├── Script.sql               # Full DB creation script
│   └── CleanUp.sql              # Reset script for test runs
│
└── README.md
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- Microsoft SQL Server (Express or full edition)
- ODBC Driver 17 for SQL Server

### Database

1. Open SSMS or Azure Data Studio
2. Run `database/Script.sql` to create `TechGenia_Analytics` database and all tables
3. Default admin is created automatically: `admin@techgenia.com` / `Admin@123`

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Create `backend/.env`:
```env
DATABASE_URL=mssql+pyodbc://localhost\SQLEXPRESS/TechGenia_Analytics?driver=ODBC+Driver+17+for+SQL+Server&trusted_connection=yes
SECRET_KEY=your-secret-key-minimum-32-chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
```

Start the server:
```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

> **Note (Windows):** Uvicorn hot reload can be unreliable on Windows. Do a full stop + restart after editing backend files.

API docs available at: `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at: `http://localhost:3000`

> **Production:** [https://asg-mantra.vercel.app](https://asg-mantra.vercel.app)

---

## Features

### Dashboard
- KPI cards: Total SKUs, Packed Qty, Unpacked Qty, Pending POs, Low Stock count
- Monthly sales trend chart (Amazon + Blinkit combined)
- Top products by revenue
- Low inventory alert panel

Low stock is one threshold, **50 units**, defined in `backend/app/routers/inventory.py`,
`backend/app/routers/alerts.py` and `frontend/src/lib/constants.ts`. Keep the three in
step — they previously held 10, 50 and 200, so the same product read as low in one view
and healthy in another.

Dashboard responses are cached in-process for 60s and PO stats for 15s. The stats cache
is cleared immediately on any PO status change, so KPIs never lag an edit.

### Inventory
- Cross-channel stock view per product: ASG (packed / unpacked) + Amazon + Blinkit (FE dark store / BE hub)
- **Snapshot date picker** — highlights dates that have uploaded data with green dots; latest snapshot shown in blue
- Filter by channel (Amazon / Blinkit) and stock status
- Export to CSV

### Sales Analytics
- Amazon sales: total units, revenue, active ASINs, monthly growth
- Blinkit sales: qty sold, MRP revenue, active items, monthly growth
- Daily trend chart, top products table
- Global date range filter (header) applies to all chart and KPI data

### Purchase Orders
- Amazon: PDF upload → auto-parse line items → preview → confirm
- Blinkit: CSV/PDF upload → preview → confirm
- Duplicate PO detection before confirm. A PO already in the database is **skipped**
  rather than re-imported — its line items would otherwise be appended a second time and
  every quantity would double. Skipped PO numbers are reported after upload; amend an
  existing PO on the Blinkit PO page rather than by re-uploading. The PDF path rejects a
  duplicate outright with `409`.
- Status update per PO and per line item
- PO overview (paginated, with search, status and date filters)
- PO Lifecycle page combining both channels, with a status funnel and stage flow
- All five PO pages share one KPI row: **All PO · Created · Dispatched · In Transit ·
  Delivered · Delayed · Cancelled · Expired**. `All PO` is the unfiltered total for the
  active date range and the seven statuses sum to it. Export sends every filtered row,
  not just the page on screen.

#### PO status

Status is computed by the backend and returned on every PO payload; the frontend never
re-derives it. A PO becomes **Expired** either because the header stores that status or
because its expiry date passed more than `_EXPIRY_DAYS` (15) ago while the PO was still
open. Statuses that mean the PO has moved on — Delivered, Received, Cancelled, Closed,
Dispatched, In Transit — are never overridden by expiry.

Row colour follows that same status: red means Expired, yellow means within 7 days of
expiry or past it but still inside the grace period.

### Distributors
- Eagle Network weekly stock report upload (XLSX)
- Per-region stock view (DL, MH, KT, WB)
- Download CSV template for data entry

### Administration
- User management (create, edit, deactivate)
- Role management with permission badges
- Activity log (audit trail — Admin/Manager only)
- Upload history log
- Notifications with unread badge in header (polled every 60s)
- Audit logs auto-deleted after 60 days via background task

---

## API Endpoints

| Prefix | Purpose |
|---|---|
| `POST /api/auth/login` | Authenticate, returns JWT |
| `GET /api/dashboard/inventory-stats` | Dashboard KPIs |
| `GET /api/dashboard/charts` | Sales trend + top products |
| `/api/upload/amazon-data/...` | Amazon sales, inventory, PO upload/confirm |
| `/api/upload/blinkit-data/...` | Blinkit sales, inventory, PO upload/confirm |
| `/api/purchase-orders/amazon` | Amazon PO line items (paginated) |
| `/api/purchase-orders/blinkit` | Blinkit PO line items (paginated) |
| `/api/purchase-orders/amazon/stats` | Amazon PO status counts |
| `/api/purchase-orders/amazon/states` | Distinct ship-to states |
| `/api/purchase-orders/amazon/overview` | Aggregated Amazon PO overview (one row per PO) |
| `/api/purchase-orders/lifecycle/overview` | Amazon + Blinkit POs in one paginated set |
| `/api/products/resolve` | Map an ASIN / Blinkit item id / ASG SKU to a product's per-channel identifiers |
| `/api/inventory/dispatch-overview` | Cross-channel inventory per product |
| `/api/inventory/low-stock` | Products below threshold |
| `/api/notifications` | Notification CRUD, mark-as-read |
| `/api/audit-logs` | Activity log (Admin/Manager) |
| `/api/upload-logs` | Upload history |
| `/api/users` | User CRUD |
| `/api/roles` | Role management |

### Pagination and totals

List endpoints return `{ items, total, page, page_size, total_pages }`. The PO endpoints
also return figures carrying the **same filters as the rows**, so a KPI built from them
cannot pair a filtered count with an unfiltered one:

| Endpoint | Extra fields |
|---|---|
| `/purchase-orders/amazon`, `/blinkit` | `total_units`, `total_pos` |
| `/purchase-orders/*/overview`, `/lifecycle/overview` | `total_units` |

Those two item-grid endpoints deliberately declare **no** `response_model` — the shared
`PaginatedResponse` lists only the five standard fields and FastAPI silently strips
anything else.

### Authentication errors

| Code | Meaning |
|---|---|
| `401` | Not authenticated — missing, malformed or expired token. The frontend clears the session and redirects to login. |
| `403` | Authenticated but not permitted — the role lacks access. |

`HTTPBearer` is configured with `auto_error=False` so a missing header returns 401 rather
than FastAPI's default 403; otherwise an expired session surfaced as a permission error
and never triggered the redirect.

---

## Roles & Permissions

| Role | Access |
|---|---|
| **Admin** | Full access — all pages including user management, role management, audit logs |
| **Manager** | All data pages, uploads, audit logs — no user/role management |
| **Viewer** | Read-only access to dashboard, sales, inventory, POs |

Route-level permissions are defined in `frontend/src/types/route-permissions.ts`.

---

## Data Sources & File Formats

All Amazon CSV files have a **metadata row on line 1** that is skipped on upload (`skiprows=1`). Row 2 is the actual header.

| File Pattern | Channel | Type | Notes |
|---|---|---|---|
| `Sales_DD.MM.YY.csv` | Amazon | Sales | ASIN, Product Title, Ordered Units, Revenue |
| `Inventory_DD.MM.YY.csv` (Format A) | Amazon | Inventory | No Model Number — products get placeholder SKU |
| `Inventory_DD.MM.YY.csv` (Format B) | Amazon | Inventory | Has Model Number — creates products with ASG SKU |
| `sales_DD.MM.YY.csv` (lowercase) | Blinkit | Sales | item_id, city, date, qty_sold, mrp |
| `Blinkit_Inventory Report_*.csv` | Blinkit | Inventory | Aggregated by item_id across facilities |
| `RK Inventory & Sale Report.xlsx` | Amazon/R&K | Distributor | Multi-sheet, ASIN, SKU, Sellable, DRR |
| `STOCK & SALE REPORT.xlsx` | Internal | ASG Stock | 3 sheets: SALE REPORT, SALE DATA, STOCK REPORT |

**Recommended upload order for Amazon:**
1. Inventory Format B files (creates products with proper ASG SKU)
2. Sales files (links to existing products)
3. PO PDFs
4. Inventory Format A (product already exists, SKU not overwritten)

---

## Upload Flow

All data uploads use a **2-step preview → confirm** pattern:

1. **Preview** — file is parsed and validated; returns `validRows`, `newProducts`, `duplicateWarning`, `poSummary` — nothing is written to the database
2. **Confirm** — user reviews the preview and submits; data is written to the database

Duplicate detection:
- Sales/Inventory: checks if the same report date already exists
- PO CSV: checks each PO number against existing records
- PO PDF: checks PO number before parsing

---

## License

Proprietary — ASG Mantra / Indus Analytics
