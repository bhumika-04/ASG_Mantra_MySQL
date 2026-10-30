"""CSV/Excel Amazon PO upload must not silently swap day and month."""
import os
import sys

os.environ.setdefault("MYSQL_HOST", "x")
os.environ.setdefault("MYSQL_DB", "x")
os.environ.setdefault("MYSQL_USER", "x")
os.environ.setdefault("MYSQL_PASSWORD", "x")
os.environ.setdefault("SECRET_KEY", "x")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
from app.routers.amazon_data import _ambiguous_date_issues, _is_ambiguous_date, _parse_date


def test_ambiguous_detection():
    assert _is_ambiguous_date("09/01/2026")
    assert _is_ambiguous_date("1.9.2026")
    assert not _is_ambiguous_date("13/09/2026")      # 13 cannot be a month
    assert not _is_ambiguous_date("2026-09-01")      # ISO
    assert not _is_ambiguous_date("2026-09-01 00:00:00")  # Excel date cell
    assert not _is_ambiguous_date("05/05/2026")      # same either way
    assert not _is_ambiguous_date(None) and not _is_ambiguous_date(float("nan"))


def test_issues_report_row_and_column():
    df = pd.DataFrame({"PONumber": ["A", "B"], "OrderedOnDate": ["2026-09-01", "09/01/2026"],
                       "ExpectedDate": ["13/10/2026", "10/01/2026"]})
    issues = _ambiguous_date_issues(df)
    assert issues == ["Row 3, column OrderedOnDate: '09/01/2026'", "Row 3, column ExpectedDate: '10/01/2026'"]


def test_iso_dates_still_parse():
    assert str(_parse_date("2026-09-01")) == "2026-09-01"
