"""
Eagle Network PO PDF Parser
Extracts structured PO data from Eagle Network Supply PVT. LTD. PDF files.
Uses pdfplumber for both table extraction and text extraction.

v2: Column-map based item parsing (robust to merged/empty cells in pdfplumber).
"""
import pdfplumber
import re
import io
from datetime import datetime
from typing import Optional, List, Dict
from dataclasses import dataclass, field, asdict


@dataclass
class POItemExtracted:
    """Single line item extracted from the PDF table."""
    sno: Optional[int] = None
    eagle_code: Optional[int] = None
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    mrp: Optional[float] = None
    size: Optional[str] = None
    hsn_code: Optional[str] = None
    qty: Optional[float] = None
    uom: Optional[str] = None
    unit_base_cost: Optional[float] = None
    discount: Optional[float] = None
    taxable_value: Optional[float] = None
    cgst_rate: Optional[float] = None
    cgst_amt: Optional[float] = None
    sgst_rate: Optional[float] = None
    sgst_amt: Optional[float] = None
    igst_rate: Optional[float] = None
    igst_amt: Optional[float] = None
    total_amount: Optional[float] = None


@dataclass
class POHeaderExtracted:
    """PO header fields extracted from the PDF."""
    po_number: Optional[str] = None
    po_date: Optional[str] = None
    po_release_date: Optional[str] = None
    po_expiry_date: Optional[str] = None
    payment_terms: Optional[str] = None
    freight_terms: Optional[str] = None
    expected_delivery_date: Optional[str] = None
    vendor_code: Optional[str] = None
    vendor_name: Optional[str] = None
    vendor_gstin: Optional[str] = None
    vendor_pan: Optional[str] = None
    issuer_name: Optional[str] = None
    issuer_gstin: Optional[str] = None
    bill_to_name: Optional[str] = None
    bill_to_address: Optional[str] = None
    bill_to_gstin: Optional[str] = None
    ship_to_name: Optional[str] = None
    ship_to_address: Optional[str] = None
    ship_to_gstin: Optional[str] = None
    total_taxable_amount: Optional[float] = None
    total_tax: Optional[float] = None
    discount_td: Optional[float] = None
    discount_cd: Optional[float] = None
    discount_sd: Optional[float] = None
    grand_total: Optional[float] = None


@dataclass
class POExtractResult:
    """Complete extraction result."""
    success: bool = True
    header: Optional[POHeaderExtracted] = None
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
    """Extract numeric value, handling commas/currency/whitespace."""
    if text is None:
        return None
    s = str(text).strip()
    if not s or s in ('-', '', 'nan'):
        return None
    s = re.sub(r'[₹$€,\s\u200e]', '', s)
    s = re.sub(r'[^\d.\-]', '', s)
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_date(text: str) -> Optional[str]:
    """Parse DD-MM-YYYY or similar date, return ISO string."""
    if not text or not text.strip():
        return None
    text = text.strip()
    for fmt in ('%d-%m-%Y', '%d/%m/%Y', '%d.%m.%Y', '%d-%m-%y',
                '%Y-%m-%d', '%m/%d/%Y'):
        try:
            return datetime.strptime(text.split()[0], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _cell_text(cell) -> str:
    """Safely get trimmed text from a table cell (replaces newlines with space)."""
    if cell is None:
        return ''
    return str(cell).strip().replace('\n', ' ')


def _dedup_merged_text(text: str) -> str:
    """When pdfplumber merges two side-by-side columns, text may appear doubled.
    E.g. 'EAGLE NETWORK PVT LTD  EAGLE NETWORK PVT LTD' → 'EAGLE NETWORK PVT LTD'
    Heuristic: if the string is longer than 20 chars and the first half repeats in the second, keep first half.
    """
    if not text or len(text) < 20:
        return text
    # Try progressively longer prefixes
    for split in range(len(text) // 4, len(text) // 2 + 1):
        prefix = text[:split].rstrip()
        remainder = text[split:].strip()
        if remainder.startswith(prefix):
            return prefix
    return text


def _normalize_item_code(code: str) -> str:
    """Fix PDF-wrapping spaces in item codes.

    Item codes are of the form 'ASG-SEGMENT1-SEGMENT2-...' with no intentional spaces.
    PDF cell wrapping inserts spaces at arbitrary points. Three cases:

      - Short fragment + hyphen: 'SAL T-1KG' / 'A SG-OM-...' / 'EUCALYPTU S-ESSENTIAL-...'
        → first word after space is ≤2 chars OR is a single letter before '-' → just concat
      - Trailing unit/chars without hyphen: '15 ML' → concat → '15ML'
      - Full-word break where hyphen was dropped: 'KASHMIRI WALNUT-200GM'
        → first word after space is ≥3 chars AND hyphenated → insert hyphen
    """
    if not code:
        return code

    def _fix_space(m: re.Match) -> str:
        after = m.group(1)
        first_word_m = re.match(r'^([A-Z0-9]+)', after)
        if not first_word_m:
            return after
        first_word = first_word_m.group(1)
        has_hyphen = '-' in after
        # Short fragment (≤2 chars) OR no hyphen after → mid-word or trailing unit → concat
        if len(first_word) <= 2 or not has_hyphen:
            return after
        # Long word + hyphenated → segment boundary where hyphen was lost → re-insert
        return '-' + after

    return re.sub(r'\s+([A-Z0-9]\S*)', _fix_space, code)


# ── Header field map (label → field name) ────────────────────

_HEADER_FIELD_MAP = {
    'po no': 'po_number',
    'po no:': 'po_number',
    'po date': 'po_date',
    'po date:': 'po_date',
    'po release date': 'po_release_date',
    'po release date:': 'po_release_date',
    'payment terms': 'payment_terms',
    'payment terms:': 'payment_terms',
    'po expiry date': 'po_expiry_date',
    'po expiry date:': 'po_expiry_date',
    'freight terms': 'freight_terms',
    'freight terms:': 'freight_terms',
    'expected delivery date': 'expected_delivery_date',
    'expected delivery date:': 'expected_delivery_date',
}

_DATE_FIELDS = {
    'po_date', 'po_release_date', 'po_expiry_date', 'expected_delivery_date'
}


# ── Column header keywords for item table detection ──────────

_ITEM_TABLE_KEYWORDS = {'sno', 'eagle', 'item code', 'item name', 'mrp', 'hsn', 'qty', 'uom'}

# Ordered list of (keywords_list, field_name) for column map building
# More specific patterns first; 'total' last to avoid false positives
_COL_KEYWORD_MAP = [
    (['s.no', 's no', 'sno'],              'sno'),
    (['eagle code', 'eagle\ncode'],         'eagle_code'),
    (['item code'],                         'item_code'),
    (['item name', 'description'],          'item_name'),
    (['mrp'],                               'mrp'),
    (['hsn code', 'hsn\ncode'],             'hsn_code'),
    (['qty', 'quantity'],                   'qty'),
    (['uom'],                               'uom'),
    (['unit base cost', 'unit base\ncost',
      'unit cost (inr)', 'unit cost'],      'unit_base_cost'),
    (['disc', 'discount'],                  'discount'),
    (['taxable value', 'taxable\nvalue'],   'taxable_value'),
    (['cgst rate', 'cgst\nrate'],           'cgst_rate'),
    (['cgst amt', 'cgst\namt'],             'cgst_amt'),
    (['sgst/ugst rate', 'sgst rate',
      'sgst\nrate', 'ugst rate'],           'sgst_rate'),
    (['sgst/ugst amt', 'sgst amt',
      'sgst\namt', 'ugst amt'],             'sgst_amt'),
    (['igst rate', 'igst\nrate'],           'igst_rate'),
    (['igst amt', 'igst\namt'],             'igst_amt'),
    (['size'],                              'size'),
    # 'total' last — only assign if not already taken
    (['total (inr)', 'total(inr)',
      'total inr', 'total'],               'total_amount'),
]


# ── Header extraction ─────────────────────────────────────────

def _extract_header_from_tables(tables: list) -> POHeaderExtracted:
    """Extract PO header by scanning all table cells for known label→value pairs."""
    header = POHeaderExtracted()

    for table in tables:
        for row in table:
            if not row or len(row) < 2:
                continue
            for i in range(len(row) - 1):
                label = _cell_text(row[i]).lower().rstrip(':').strip()
                value = ''
                for j in range(i + 1, len(row)):
                    v = _cell_text(row[j])
                    if v:
                        value = v
                        break
                if not label or not value:
                    continue
                field_name = _HEADER_FIELD_MAP.get(label) or _HEADER_FIELD_MAP.get(label + ':')
                if field_name:
                    if field_name in _DATE_FIELDS:
                        setattr(header, field_name, _parse_date(value))
                    else:
                        if field_name == 'po_number':
                            value = value.split(',')[0].strip()
                        setattr(header, field_name, value)

    return header


def _extract_header_from_text(text: str, header: POHeaderExtracted) -> POHeaderExtracted:
    """Fill in remaining header fields from raw text (vendor info, billing, totals)."""

    # Vendor Code & Name: V0000625 - ASG MANTRA
    # Stop before "PO No", "GSTIN", "GST", phone/email markers on the same line
    m = re.search(
        r'Vendor\s+Code\s*(?:&|and)\s*Name[:\s]*(V\d+)\s*[-–]\s*(.+?)(?:\s+(?:PO\s+No|GSTIN|GST[:\s]|Ph:|Tel:|Email:)|\n|$)',
        text, re.I
    )
    if m:
        header.vendor_code = m.group(1).strip()
        header.vendor_name = m.group(2).strip()

    # Fallback vendor name from "Vcode - Name" pattern
    if not header.vendor_name:
        m = re.search(r'V\d{7}\s*[-–]\s*([A-Z][A-Z\s&.]+?)(?:\s{2,}|\n|$)', text)
        if m:
            header.vendor_name = m.group(1).strip()

    # Vendor GSTIN (from dedicated line)
    if not header.vendor_gstin:
        m = re.search(r'GSTIN[:\s]+(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z])', text)
        if m:
            header.vendor_gstin = m.group(1)

    # All GSTINs in document
    all_gstins = re.findall(r'(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z]\d?\w?)', text)
    if len(all_gstins) >= 2:
        if not header.issuer_gstin:
            header.issuer_gstin = all_gstins[0]
        if not header.vendor_gstin:
            for g in all_gstins[1:]:
                if g != all_gstins[0]:
                    header.vendor_gstin = g
                    break

    # Vendor PAN
    m = re.search(r'PAN[:\s]+([A-Z]{5}\d{4}[A-Z])', text)
    if m:
        header.vendor_pan = m.group(1)

    # Issuer name (Eagle Network)
    m = re.search(r'(EAGLE\s+NETWORK\s+SUPPLY\s+PVT\.?\s*LTD\.?)', text, re.I)
    if m:
        header.issuer_name = m.group(1).strip()

    # Bill To / Ship To — flexible: capture name on first line after the label,
    # address on second line, GST on third line.
    # Note: in pdfplumber text, Bill To and Ship To may be on the same line
    # (side-by-side in the PDF), causing their content lines to be merged.
    # We de-duplicate by taking only the first half if the name repeats.
    for label, name_field, addr_field, gstin_field in [
        (r'Bill\s*To', 'bill_to_name', 'bill_to_address', 'bill_to_gstin'),
        (r'Ship\s*To', 'ship_to_name', 'ship_to_address', 'ship_to_gstin'),
    ]:
        m = re.search(
            label + r'\s*\n([^\n]+)\n([^\n]+)\nGST[-:]?(\w+)',
            text, re.I
        )
        if m:
            if not getattr(header, name_field):
                name_val = m.group(1).strip()
                # De-duplicate if pdfplumber merged both columns (e.g. "X PVT LTD  X PVT LTD")
                name_val = _dedup_merged_text(name_val)
                setattr(header, name_field, name_val)
            if not getattr(header, addr_field):
                addr_val = _dedup_merged_text(m.group(2).strip())
                setattr(header, addr_field, addr_val)
            if not getattr(header, gstin_field):
                setattr(header, gstin_field, m.group(3).strip())
        else:
            # Fallback: just grab the name after the label
            m2 = re.search(label + r'\s*\n([^\n]{5,})', text, re.I)
            if m2 and not getattr(header, name_field):
                setattr(header, name_field, _dedup_merged_text(m2.group(1).strip()))

    # Summary totals
    def _extract_total(label_pattern: str) -> Optional[float]:
        m = re.search(label_pattern + r'[\s:]*(\d[\d,]*\.?\d*)', text, re.I)
        return _clean_num(m.group(1)) if m else None

    header.total_taxable_amount = header.total_taxable_amount or _extract_total(r'Total\s*Taxable\s*Amt?\s*\(?INR\)?')
    header.total_tax            = header.total_tax            or _extract_total(r'Total\s*Tax\s*\(?INR\)?')
    header.discount_td          = header.discount_td          or _extract_total(r'Discount\s*\(?TD\)?')
    header.discount_cd          = header.discount_cd          or _extract_total(r'Discount\s*\(?CD\)?')
    header.discount_sd          = header.discount_sd          or _extract_total(r'Discount\s*\(?SD\)?')
    header.grand_total          = header.grand_total          or _extract_total(r'Grand\s*Total\s*\(?INR\)?')

    # PO number fallback
    if not header.po_number:
        m = re.search(r'([A-Z]{2}/\d{2}-\d{2}/\d+)', text)
        if m:
            header.po_number = m.group(1)

    # Date field fallbacks
    _DATE_PATTERN = r'([\d]{1,2}[-/.][\d]{1,2}[-/.][\d]{2,4})'
    for field_attr, label in [
        ('po_date',               r'PO\s+Date'),
        ('po_release_date',       r'PO\s+Release\s+Date'),
        ('po_expiry_date',        r'PO\s+Expiry\s+Date'),
        ('expected_delivery_date', r'Expected\s+Delivery\s+Date'),
    ]:
        if not getattr(header, field_attr):
            m = re.search(label + r'[:\s]*' + _DATE_PATTERN, text, re.I)
            if m:
                setattr(header, field_attr, _parse_date(m.group(1)))

    # Payment terms fallback
    if not header.payment_terms:
        m = re.search(r'Payment\s+Terms[:\s]*(Net[-\s]?\d+\s*(?:Days?)?)', text, re.I)
        if m:
            header.payment_terms = m.group(1).strip()

    # Freight terms fallback
    if not header.freight_terms:
        m = re.search(r'Freight\s+Terms[:\s]*([^\n,]+)', text, re.I)
        if m:
            header.freight_terms = m.group(1).strip()

    return header


# ── Line items: column-map approach ──────────────────────────

def _is_items_table(table: list) -> bool:
    """Check if a table contains line items by searching ALL rows for column header keywords."""
    if not table or len(table) < 2:
        return False
    for row in table:
        row_text = ' '.join(_cell_text(c).lower() for c in row if c)
        matches = sum(1 for kw in _ITEM_TABLE_KEYWORDS if kw in row_text)
        if matches >= 3:
            return True
    return False


def _find_best_header_row(table: list) -> int:
    """Return the index of the row that best matches column header keywords (-1 if none)."""
    best_idx, best_score = -1, 0
    for i, row in enumerate(table):
        row_text = ' '.join(_cell_text(c).lower() for c in row if c)
        score = sum(1 for kw in _ITEM_TABLE_KEYWORDS if kw in row_text)
        if score > best_score:
            best_score = score
            best_idx = i
    return best_idx if best_score >= 3 else -1


def _build_col_map(table: list, header_idx: int) -> Dict[str, int]:
    """Build {field_name: col_idx} by merging header_idx and header_idx+1 rows.

    Merging two rows handles split headers like:
      Row N:   ... | Unit Base Cost (INR) | Disc | Taxable Value (INR) | CGST       | SGST/UGST  | ...
      Row N+1: ... |                      |      |                     | Rate | Amt  | Rate | Amt  | ...
    """
    col_map: Dict[str, int] = {}

    # Merge text from header row and the next row per column
    merged: Dict[int, str] = {}
    for row_offset in range(2):
        row_i = header_idx + row_offset
        if row_i >= len(table):
            break
        for col_i, cell in enumerate(table[row_i]):
            text = _cell_text(cell).lower().strip()
            if text:
                if col_i in merged:
                    merged[col_i] = merged[col_i] + ' ' + text
                else:
                    merged[col_i] = text

    # Match merged cell text to field names
    for col_i, text in merged.items():
        text = text.strip()
        for keywords, field_name in _COL_KEYWORD_MAP:
            if field_name in col_map:
                continue  # already assigned
            if any(kw in text for kw in keywords):
                col_map[field_name] = col_i
                break

    # Infer Amt columns from Rate columns.
    # CGST spans 2 cols (Rate, Amt), but SGST/UGST may span 3 cols (Rate, empty, Amt).
    # So use +1 doesn't always work — scan ahead for the nearest col that has 'amt'.
    assigned_cols = set(col_map.values())
    for rate_f, amt_f in [
        ('cgst_rate', 'cgst_amt'),
        ('sgst_rate', 'sgst_amt'),
        ('igst_rate', 'igst_amt'),
    ]:
        if rate_f in col_map and amt_f not in col_map:
            rate_col = col_map[rate_f]
            for offset in range(1, 5):
                candidate = rate_col + offset
                cand_text = merged.get(candidate, '')
                if cand_text and 'amt' in cand_text.lower() and candidate not in assigned_cols:
                    col_map[amt_f] = candidate
                    assigned_cols.add(candidate)
                    break
            else:
                # Fallback: just use +1 if no 'amt' col found nearby
                if rate_col + 1 not in assigned_cols:
                    col_map[amt_f] = rate_col + 1
                    assigned_cols.add(rate_col + 1)

    return col_map


def _is_data_row(row: list) -> bool:
    """Return True if the row looks like a line item (starts with a small integer Sno)."""
    for cell in row[:5]:
        text = _cell_text(cell).strip()
        if text:
            try:
                val = int(float(text))
                if 1 <= val <= 999:
                    return True
            except (ValueError, TypeError):
                pass
            break  # First non-empty cell isn't a number
    return False


def _is_header_or_total_row(row: list) -> bool:
    """Skip column header rows and total/summary rows."""
    row_text = ' '.join(_cell_text(c).lower() for c in row if c)
    header_matches = sum(1 for kw in ['sno', 'eagle code', 'item code', 'item name', 'unit base'] if kw in row_text)
    if header_matches >= 2:
        return True
    if re.search(r'\btotal\b', row_text) and not re.search(r'^\s*\d+\s', row_text):
        return True
    if 'amount in word' in row_text or 'remarks' in row_text:
        return True
    return False


def _parse_item_row_mapped(row: list, col_map: Dict[str, int]) -> Optional[POItemExtracted]:
    """Parse a line item row using the pre-built column map."""
    if _is_header_or_total_row(row):
        return None
    if not _is_data_row(row):
        return None

    cells = [_cell_text(c) for c in row]

    def _gcol(field_name: str) -> str:
        idx = col_map.get(field_name)
        return cells[idx] if (idx is not None and idx < len(cells)) else ''

    item = POItemExtracted()

    # Sno
    sno_text = _gcol('sno')
    try:
        item.sno = int(float(sno_text)) if sno_text else None
    except (ValueError, TypeError):
        item.sno = None

    # Eagle Code
    eagle = _gcol('eagle_code')
    if eagle:
        try:
            item.eagle_code = int(float(eagle))
        except (ValueError, TypeError):
            pass

    # Item Code — normalize PDF-wrapping spaces
    raw_code = _gcol('item_code')
    item.item_code = _normalize_item_code(raw_code) if raw_code else None

    item.item_name      = _gcol('item_name') or None
    item.mrp            = _clean_num(_gcol('mrp'))
    item.size           = _gcol('size') or None
    item.hsn_code       = _gcol('hsn_code') or None
    item.qty            = _clean_num(_gcol('qty'))
    uom_val             = _gcol('uom').upper().strip() if _gcol('uom') else None
    item.uom            = uom_val if uom_val else None
    item.unit_base_cost = _clean_num(_gcol('unit_base_cost'))
    item.discount       = _clean_num(_gcol('discount'))
    item.taxable_value  = _clean_num(_gcol('taxable_value'))
    item.cgst_rate      = _clean_num(_gcol('cgst_rate'))
    item.cgst_amt       = _clean_num(_gcol('cgst_amt'))
    item.sgst_rate      = _clean_num(_gcol('sgst_rate'))
    item.sgst_amt       = _clean_num(_gcol('sgst_amt'))
    item.igst_rate      = _clean_num(_gcol('igst_rate'))
    item.igst_amt       = _clean_num(_gcol('igst_amt'))
    item.total_amount   = _clean_num(_gcol('total_amount'))

    # Validate: need at minimum item_name or eagle_code
    if not item.item_name and not item.eagle_code:
        return None

    return item


def _parse_item_row_positional(row: list) -> Optional[POItemExtracted]:
    """Fallback positional parser when no column map is available.

    Expected column order (Eagle Network standard):
    Sno | Eagle Code | Item Code | Item Name | MRP | Size | HSN Code | QTY | UOM |
    Unit Base Cost | Disc | Taxable Value | CGST Rate | CGST Amt | SGST Rate | SGST Amt |
    IGST Rate | IGST Amt | Total
    """
    if _is_header_or_total_row(row):
        return None

    non_empty = [c for c in row if c and str(c).strip()]
    if len(non_empty) < 5:
        return None

    item = POItemExtracted()
    cells = [_cell_text(c) for c in row]

    # Find Sno
    start_idx = 0
    for i, c in enumerate(cells):
        try:
            val = int(float(c))
            if 1 <= val <= 999:
                start_idx = i
                item.sno = val
                break
        except (ValueError, TypeError):
            continue

    idx = start_idx + (1 if item.sno is not None else 0)

    def _get(offset: int) -> str:
        pos = idx + offset
        return cells[pos] if pos < len(cells) else ''

    try:
        eagle = _get(0)
        if eagle:
            try:
                item.eagle_code = int(float(eagle))
            except (ValueError, TypeError):
                pass

        item.item_code = _normalize_item_code(_get(1)) or None
        item.item_name = _get(2) or None
        item.mrp = _clean_num(_get(3))

        # HSN anchor: look for 6+ digit numeric string in positions 4-6
        val4, val5 = _get(4), _get(5)
        if val5 and len(val5.strip()) >= 6 and val5.strip().isdigit():
            item.size = val4 or None
            item.hsn_code = val5.strip()
            offset_adj = 6
        elif val4 and len(val4.strip()) >= 6 and val4.strip().isdigit():
            item.size = None
            item.hsn_code = val4.strip()
            offset_adj = 5
        else:
            item.size = val4 or None
            item.hsn_code = None
            offset_adj = 5

        item.qty = _clean_num(_get(offset_adj)); offset_adj += 1

        uom_val = _get(offset_adj)
        if uom_val and uom_val.upper() in ('NOS', 'KG', 'LTR', 'PCS', 'BOX', 'SET', 'PKT'):
            item.uom = uom_val.upper()
            offset_adj += 1

        # Skip empty cells before unit_base_cost
        while offset_adj < len(cells) - 1 and not _get(offset_adj):
            offset_adj += 1

        item.unit_base_cost = _clean_num(_get(offset_adj)); offset_adj += 1

        # Skip empty discount cell if it's empty
        disc_val = _get(offset_adj)
        if _clean_num(disc_val) is not None:
            item.discount = _clean_num(disc_val)
        offset_adj += 1

        # Skip empty cells before taxable_value
        while offset_adj < len(cells) - 1 and not _get(offset_adj):
            offset_adj += 1

        item.taxable_value = _clean_num(_get(offset_adj)); offset_adj += 1
        item.cgst_rate = _clean_num(_get(offset_adj)); offset_adj += 1
        item.cgst_amt  = _clean_num(_get(offset_adj)); offset_adj += 1
        item.sgst_rate = _clean_num(_get(offset_adj)); offset_adj += 1
        item.sgst_amt  = _clean_num(_get(offset_adj)); offset_adj += 1
        item.igst_rate = _clean_num(_get(offset_adj)); offset_adj += 1
        item.igst_amt  = _clean_num(_get(offset_adj)); offset_adj += 1
        item.total_amount = _clean_num(_get(offset_adj))

    except (IndexError, ValueError, TypeError):
        pass

    if not item.item_name and not item.eagle_code:
        return None

    return item


# ── Main entry point ──────────────────────────────────────────

def extract_po_from_pdf(pdf_bytes: bytes) -> POExtractResult:
    """
    Extract PO data from Eagle Network PDF bytes.
    Returns POExtractResult with header, items, warnings, errors.
    """
    result = POExtractResult()

    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as e:
        result.success = False
        result.errors.append(f"Failed to open PDF: {str(e)}")
        return result

    try:
        result.page_count = len(pdf.pages)

        if result.page_count == 0:
            result.success = False
            result.errors.append("PDF has no pages")
            return result

        # ── Step 1: Extract tables from all pages ──
        all_tables = []
        for page in pdf.pages:
            try:
                tables = page.extract_tables()
                if tables:
                    all_tables.extend(tables)
            except Exception as e:
                result.warnings.append(f"Table extraction issue on page {page.page_number}: {str(e)}")

        # ── Step 2: Extract full text from all pages ──
        full_text = ''
        for page in pdf.pages:
            try:
                full_text += (page.extract_text() or '') + '\n'
            except Exception:
                pass

        # Validate Eagle Network PO
        text_lower = full_text.lower()
        if 'eagle' not in text_lower and 'purchase order' not in text_lower:
            result.warnings.append(
                "This PDF may not be an Eagle Network Purchase Order. "
                "Could not find 'Eagle' or 'Purchase Order' keywords."
            )

        # ── Step 3: Extract header from tables ──
        header = _extract_header_from_tables(all_tables)

        # ── Step 4: Fill remaining header from text ──
        header = _extract_header_from_text(full_text, header)
        result.header = header

        # ── Step 5: Extract line items using column-map approach ──
        seen_items_table = False
        for table in all_tables:
            if not _is_items_table(table):
                continue

            seen_items_table = True
            header_row_idx = _find_best_header_row(table)

            if header_row_idx >= 0:
                col_map = _build_col_map(table, header_row_idx)
                for row_i, row in enumerate(table):
                    if row_i <= header_row_idx + 1:
                        continue  # skip header rows
                    if row:
                        item = _parse_item_row_mapped(row, col_map)
                        if item:
                            result.items.append(item)
            else:
                # No header row identified — fall back to positional
                result.warnings.append("Column header row not found in items table; using positional parsing.")
                for row in table:
                    if row:
                        item = _parse_item_row_positional(row)
                        if item:
                            result.items.append(item)

        # Last-resort fallback: try all rows in all tables
        if not seen_items_table and all_tables:
            result.warnings.append("Could not identify the line items table by headers; trying all table rows.")
            for table in all_tables:
                for row in table:
                    if row:
                        item = _parse_item_row_positional(row)
                        if item:
                            result.items.append(item)

    finally:
        pdf.close()

    # ── Step 6: Validation warnings ──
    if not result.header.po_number:
        result.warnings.append("PO Number could not be extracted")
    if len(result.items) == 0:
        result.warnings.append("No line items could be extracted from the PDF tables")
    if not result.header.po_date:
        result.warnings.append("PO Date could not be extracted")

    return result
