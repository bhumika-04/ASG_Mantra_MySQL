"""Amazon PO PDF date order: ordered-on / expected are month-first, ship window day-first."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services.amazon_pdf_parser import _parse_date, _parse_date_mdy


def test_ordered_on_and_expected_are_month_first():
    assert _parse_date_mdy("9/11/2026") == "2026-09-11"   # was read as 9 Nov
    assert _parse_date_mdy("9/12/2026") == "2026-09-12"   # was read as 9 Dec
    assert _parse_date_mdy("9/13/2026") == "2026-09-13"


def test_month_first_falls_back_when_first_part_is_not_a_month():
    assert _parse_date_mdy("13/9/2026") == "2026-09-13"
    assert _parse_date_mdy("2026-09-11") == "2026-09-11"


def test_ship_window_stays_day_first():
    assert _parse_date("29/11/2025") == "2025-11-29"
    assert _parse_date("10/1/2026") == "2026-01-10"


def test_real_pdf_samples():
    # 2DST9HUI: Ordered On 11/17/2025, Ship window 17/11/2025 - 8/12/2025, Expected 12/15/2025
    assert _parse_date_mdy("11/17/2025") == "2025-11-17"
    assert _parse_date("17/11/2025") == "2025-11-17"
    assert _parse_date("8/12/2025") == "2025-12-08"
    assert _parse_date_mdy("12/15/2025") == "2025-12-15"
    # 1ITVPZOI: Ordered On 09/01/2026 (1 Sep), Ship window 2/9/2026 - 16/9/2026, Expected 10/01/2026 (1 Oct)
    assert _parse_date_mdy("09/01/2026") == "2026-09-01"
    assert _parse_date("2/9/2026") == "2026-09-02"
    assert _parse_date_mdy("10/01/2026") == "2026-10-01"
