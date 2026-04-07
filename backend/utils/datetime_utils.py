"""Datetime helpers to enforce UTC-aware behavior across the backend."""
from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return the current UTC datetime as timezone-aware."""
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """Normalize datetime values to UTC-aware datetimes.

    - None stays None
    - Naive datetimes are assumed to be UTC
    - Aware datetimes are converted to UTC
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_iso_datetime(value: str) -> datetime:
    """Parse ISO datetime and normalize to UTC-aware datetime.

    Supports values ending in 'Z' by converting to '+00:00' first.
    """
    text = value.strip()
    if text.endswith('Z'):
        text = f"{text[:-1]}+00:00"
    parsed = datetime.fromisoformat(text)
    normalized = ensure_utc(parsed)
    if normalized is None:
        raise ValueError("Failed to parse datetime.")
    return normalized
