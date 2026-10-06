"""Business time is Indian Standard Time (IST, UTC+05:30, no daylight saving).

Every date or timestamp the application creates uses these helpers, so it does not depend on
the time zone of the server it runs on (a UTC server previously made 'today' wrong between
00:00 and 05:30 IST). Values are naive IST datetimes, matching the DATETIME columns.

JWT expiry is the one exception: tokens stay in UTC, as the JWT standard requires.
"""
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    """Current Indian time as a naive datetime (for DATETIME columns)."""
    return datetime.now(IST).replace(tzinfo=None)


def today_ist() -> date:
    """Today's date in India."""
    return now_ist().date()
