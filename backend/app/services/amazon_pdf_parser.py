"""
Amazon Vendor Central PO PDF Parser
Extracts structured PO data from Amazon PO PDFs (downloaded from Vendor Central).
Uses pdfplumber for table extraction and text extraction.

Sample PDF structure:
  PO: 1HM2M2IL
  Header table: Status, Vendor, Ship to location, Ordered On, Ship window,
                Freight terms, Payment Method, Payment terms, Purchasing entity
  Summary table: Submitted/Accepted/Cancelled/Received — Items, Quantity, Total cost
  PO items table: ASIN, External Id, Model Number, Title, Window Type, Expected date,
                  Quantity Requested, Accepted quantity, ASN quantity,
                  Quantity received, Quantity Outstanding, Unit Cost, Total cost
"""
import pdfplumber
import re
import io
from datetime import datetime
from typing import Optional, List
from dataclasses import dataclass, field, asdict


@dataclass
class AmazonPOItemExtracted:
    """Single line item from the Amazon PO items table."""
    asin: Optional[str] = None
    external_id: Optional[str] = None
    model_number: Optional[str] = None
    hsn: Optional[str] = None
    title: Optional[str] = None
    cancellation_status: Optional[str] = None
    cancellation_date: Optional[str] = None
    window_type: Optional[str] = None
    expected_date: Optional[str] = None
    quantity_requested: Optional[int] = None
    accepted_quantity: Optional[int] = None
    quantity_received: Optional[int] = None
    quantity_outstanding: Optional[int] = None
    unit_cost: Optional[float] = None
    total_cost: Optional[float] = None


@dataclass
class AmazonPOHeaderExtracted:
    """PO header fields from the Amazon PO PDF."""
    po_number: Optional[str] = None
    po_status: Optional[str] = None
    vendor_code: Optional[str] = None
    ship_to_location_code: Optional[str] = None
    ship_to_city: Optional[str] = None
    ship_to_state: Optional[str] = None
    ordered_on_date: Optional[str] = None
    ship_window_start_date: Optional[str] = None
    ship_window_end_date: Optional[str] = None
    freight_terms: Optional[str] = None
    payment_method: Optional[str] = None
    payment_terms: Optional[str] = None
    purchasing_entity_name: Optional[str] = None
    # Summary — Submitted
    submitted_items: Optional[int] = None
    submitted_quantity: Optional[int] = None
    submitted_total_cost: Optional[float] = None
    # Summary — Accepted
    accepted_items: Optional[int] = None
    accepted_quantity: Optional[int] = None
    accepted_total_cost: Optional[float] = None
    # Summary — Cancelled
    cancelled_items: Optional[int] = None
    cancelled_quantity: Optional[int] = None
    cancelled_total_cost: Optional[float] = None
    # Summary — Received
    received_items: Optional[int] = None
    received_quantity: Optional[int] = None
    received_total_cost: Optional[float] = None


@dataclass
class AmazonPOExtractResult:
    """Complete extraction result."""
    success: bool = True
    header: Optional[AmazonPOHeaderExtracted] = None
    items: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    page_count: int = 0

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "header": asdict(self.header) if self.header else None,
            "items": [asdict(item) for item in self.items],
            "warnings": self.warnings,
            "errors": self.errors,
            "page_count": self.page_count,
            "item_count": len(self.items),
        }


# ── Helpers ──────────────────────────────────────────────────

def _clean_num(text) -> Optional[float]:
    """Extract numeric value, handling INR suffix, commas, etc."""
    if text is None:
        return None
    s = str(text).strip()
    if not s or s in ('-', '', 'nan'):
        return None
    # Remove "INR", currency symbols, commas, whitespace
    s = re.sub(r'(?i)\s*INR\s*', '', s)
    s = re.sub(r'[₹$€,\s\u200e]', '', s)
    s = re.sub(r'[^\d.\-]', '', s)
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _clean_int(text) -> Optional[int]:
    """Extract integer value."""
    val = _clean_num(text)
    if val is not None:
        return int(val)
    return None


def _parse_date(text: str) -> Optional[str]:
    """Parse date from various formats, return ISO string."""
    if not text or not text.strip():
        return None
    text = text.strip()
    for fmt in ('%m/%d/%Y', '%d/%m/%Y', '%m/%d/%y', '%d/%m/%y',
                '%Y-%m-%d', '%d-%m-%Y'):
        try:
            return datetime.strptime(text.split()[0], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _cell(cell) -> str:
    """Safely get trimmed text from a table cell."""
    if cell is None:
        return ''
    return str(cell).strip().replace('\n', ' ')


# ── Header extraction ────────────────────────────────────────

# Label → field name mapping (lowercase label to header attribute)
_HEADER_MAP = {
    'status': 'po_status',
    'vendor': 'vendor_code',
    'ordered on': 'ordered_on_date',
    'freight terms': 'freight_terms',
    'payment method': 'payment_method',
    'payment terms': 'payment_terms',
    'purchasing entity': 'purchasing_entity_name',
}


def _extract_header(tables: list, full_text: str) -> AmazonPOHeaderExtracted:
    """Extract header fields from tables and text."""
    header = AmazonPOHeaderExtracted()

    # PO Number from text: "PO: 1HM2M2IL" or "PO: XXXX"
    m = re.search(r'PO[:\s]+([A-Z0-9]{6,})', full_text)
    if m:
        header.po_number = m.group(1).strip()

    # Scan all tables for header label→value pairs
    for table in tables:
        for row in table:
            if not row or len(row) < 2:
                continue
            for i in range(len(row) - 1):
                label = _cell(row[i]).lower().rstrip(':').strip()
                # Look for the next non-empty cell as the value
                value = ''
                for j in range(i + 1, len(row)):
                    v = _cell(row[j])
                    if v:
                        value = v
                        break
                if not label or not value:
                    continue

                field_name = _HEADER_MAP.get(label)
                if field_name:
                    if field_name == 'ordered_on_date':
                        setattr(header, field_name, _parse_date(value))
                    else:
                        setattr(header, field_name, value)

                # Ship to location: "DED5 - GURUGRAM, HARYANA"
                if 'ship to location' in label:
                    header.ship_to_location_code = value.split('-')[0].strip() if '-' in value else value
                    parts = value.split('-', 1)
                    if len(parts) > 1:
                        loc = parts[1].strip()
                        city_state = loc.split(',')
                        header.ship_to_city = city_state[0].strip() if city_state else loc
                        header.ship_to_state = city_state[1].strip() if len(city_state) > 1 else None

                # Ship window: "29/11/2025 - 10/1/2026"
                if 'ship window' in label:
                    dates = value.split('-')
                    if len(dates) >= 2:
                        header.ship_window_start_date = _parse_date(dates[0].strip())
                        header.ship_window_end_date = _parse_date(dates[1].strip())

    # Regex fallback for payment terms if still not found
    # Matches: "Payment terms NET DUE IN 45 DAYS" or "Payment Terms: NET DUE IN 45 DAYS"
    if not header.payment_terms:
        m = re.search(r'payment\s+terms[:\s]+([A-Z0-9 ]+(?:DAYS?|NET|DUE)[A-Z0-9 ]*)', full_text, re.I)
        if m:
            header.payment_terms = m.group(1).strip()

    # Regex fallback for payment method
    if not header.payment_method:
        m = re.search(r'payment\s+method[:\s]+([^\n]+)', full_text, re.I)
        if m:
            header.payment_method = m.group(1).strip()

    # Summary table: Submitted/Accepted/Cancelled/Received
    _extract_summary(tables, full_text, header)

    return header


def _extract_summary(tables: list, full_text: str, header: AmazonPOHeaderExtracted):
    """Extract the summary table (Submitted/Accepted/Cancelled/Received)."""
    summary_map = {
        'submitted': ('submitted_items', 'submitted_quantity', 'submitted_total_cost'),
        'accepted': ('accepted_items', 'accepted_quantity', 'accepted_total_cost'),
        'cancelled': ('cancelled_items', 'cancelled_quantity', 'cancelled_total_cost'),
        'received': ('received_items', 'received_quantity', 'received_total_cost'),
    }

    for table in tables:
        for row in table:
            if not row:
                continue
            row_text = _cell(row[0]).lower() if row[0] else ''
            for key, (items_f, qty_f, cost_f) in summary_map.items():
                if key in row_text:
                    # Row format: [Label, Items, Quantity, Total cost] or variations
                    nums = []
                    for cell in row[1:]:
                        val = _clean_num(cell)
                        if val is not None:
                            nums.append(val)
                    if len(nums) >= 3:
                        setattr(header, items_f, int(nums[0]))
                        setattr(header, qty_f, int(nums[1]))
                        setattr(header, cost_f, nums[2])
                    elif len(nums) == 2:
                        setattr(header, qty_f, int(nums[0]))
                        setattr(header, cost_f, nums[1])
                    break

    # Fallback: regex on full text for summary values
    for key, (items_f, qty_f, cost_f) in summary_map.items():
        if getattr(header, qty_f) is None:
            pattern = rf'{key}\s+(\d+)\s+(\d[\d,]*)\s+([\d,]+\.?\d*)\s*(?:INR)?'
            m = re.search(pattern, full_text, re.I)
            if m:
                setattr(header, items_f, int(m.group(1)))
                setattr(header, qty_f, int(m.group(2).replace(',', '')))
                setattr(header, cost_f, float(m.group(3).replace(',', '')))


# ── Items extraction ─────────────────────────────────────────

_ITEM_TABLE_KEYWORDS = {'asin', 'external id', 'model number', 'title', 'quantity requested', 'unit cost'}


def _is_items_table(table: list) -> bool:
    """Identify the PO items table by its header row."""
    if not table or len(table) < 2:
        return False
    for row in table[:2]:
        text = ' '.join(_cell(c).lower() for c in row if c)
        matches = sum(1 for kw in _ITEM_TABLE_KEYWORDS if kw in text)
        if matches >= 3:
            return True
    return False


def _is_header_row(row: list) -> bool:
    """Check if a row is the column header row."""
    text = ' '.join(_cell(c).lower() for c in row if c)
    return sum(1 for kw in _ITEM_TABLE_KEYWORDS if kw in text) >= 3


def _parse_item_row(row: list, col_map: dict) -> Optional[AmazonPOItemExtracted]:
    """Parse a PO item row using a column index map."""
    if _is_header_row(row):
        return None

    cells = [_cell(c) for c in row]

    # Must have ASIN
    asin_idx = col_map.get('asin')
    if asin_idx is None or asin_idx >= len(cells):
        return None
    asin = cells[asin_idx]
    if not asin or len(asin) < 5:
        return None

    item = AmazonPOItemExtracted()
    item.asin = asin

    def _get(key: str) -> str:
        idx = col_map.get(key)
        if idx is not None and idx < len(cells):
            return cells[idx]
        return ''

    item.external_id = _get('external_id') or None
    item.model_number = _get('model_number') or None
    item.hsn = _get('hsn') or None
    item.title = _get('title') or None
    item.window_type = _get('window_type') or None
    item.expected_date = _parse_date(_get('expected_date'))
    item.quantity_requested = _clean_int(_get('quantity_requested'))
    item.accepted_quantity = _clean_int(_get('accepted_quantity'))
    item.quantity_received = _clean_int(_get('quantity_received'))
    item.quantity_outstanding = _clean_int(_get('quantity_outstanding'))
    item.unit_cost = _clean_num(_get('unit_cost'))
    item.total_cost = _clean_num(_get('total_cost'))

    return item


def _build_col_map(header_row: list) -> dict:
    """Build a column name → index map from the header row."""
    col_map = {}
    keyword_map = {
        'asin': 'asin',
        'external id': 'external_id',
        'model number': 'model_number',
        'hsn': 'hsn',
        'title': 'title',
        'cancellation status': 'cancellation_status',
        'cancellation date': 'cancellation_date',
        'window type': 'window_type',
        'expected date': 'expected_date',
        'quantity requested': 'quantity_requested',
        'accepted quantity': 'accepted_quantity',
        'asn quantit': 'asn_quantity',  # PDF may truncate "ASN quantity"
        'quantity received': 'quantity_received',
        'quantity outstanding': 'quantity_outstanding',
        'unit cost': 'unit_cost',
        'total cost': 'total_cost',
    }

    for idx, cell in enumerate(header_row):
        text = _cell(cell).lower()
        for kw, field_name in keyword_map.items():
            if kw in text:
                col_map[field_name] = idx
                break

    return col_map


# ── Main entry point ─────────────────────────────────────────

def extract_amazon_po_from_pdf(pdf_bytes: bytes) -> AmazonPOExtractResult:
    """
    Extract PO data from Amazon Vendor Central PO PDF.

    Returns AmazonPOExtractResult with header, items, warnings, errors.
    """
    result = AmazonPOExtractResult()

    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as e:
        result.success = False
        result.errors.append(f"Failed to open PDF: {str(e)}")
        return result

    result.page_count = len(pdf.pages)

    if result.page_count == 0:
        result.success = False
        result.errors.append("PDF has no pages")
        pdf.close()
        return result

    # Collect all tables and text from all pages
    all_tables = []
    full_text = ''
    for page in pdf.pages:
        try:
            tables = page.extract_tables()
            if tables:
                all_tables.extend(tables)
        except Exception as e:
            result.warnings.append(f"Table extraction issue on page {page.page_number}: {str(e)}")
        try:
            text = page.extract_text() or ''
            full_text += text + '\n'
        except Exception:
            pass

    # Validate it's an Amazon PO
    text_lower = full_text.lower()
    if 'po:' not in text_lower and 'po items' not in text_lower:
        result.warnings.append("This PDF may not be an Amazon PO. Could not find 'PO:' or 'PO items' keywords.")

    # Extract header
    header = _extract_header(all_tables, full_text)
    result.header = header

    # Extract items
    for table in all_tables:
        if _is_items_table(table):
            # Find header row and build column map
            col_map = None
            for row in table:
                if _is_header_row(row):
                    col_map = _build_col_map(row)
                    continue
                if col_map:
                    item = _parse_item_row(row, col_map)
                    if item:
                        result.items.append(item)

    # Fallback: if no items found via table detection, try all tables
    if not result.items:
        result.warnings.append("Could not identify PO items table by headers; trying all tables.")
        for table in all_tables:
            col_map = None
            for row in table:
                if row and any('asin' in _cell(c).lower() for c in row if c):
                    col_map = _build_col_map(row)
                    continue
                if col_map:
                    item = _parse_item_row(row, col_map)
                    if item:
                        result.items.append(item)

    pdf.close()

    # Validation warnings
    if not header.po_number:
        result.warnings.append("PO Number could not be extracted")
    if len(result.items) == 0:
        result.warnings.append("No PO items could be extracted from the PDF")
    if not header.ordered_on_date:
        result.warnings.append("Ordered On date could not be extracted")

    return result
