"""
Audit & Upload logging helpers.
Called from upload endpoints and status-change endpoints.
Both functions add records to the existing DB session — the caller's db.commit() persists them.
Wrapped in try/except so logging never breaks the main operation.
"""
import json
import logging
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.audit_log import AuditLog
from app.models.upload_log import UploadLog

logger = logging.getLogger(__name__)


def log_audit(
    db: Session,
    user_id,
    action: str,
    table_name: str,
    record_id: str = None,
    old_values: dict = None,
    new_values: dict = None,
):
    """Write a row to AuditLogs. Never raises."""
    try:
        entry = AuditLog(
            UserId=user_id,
            Action=action,
            TableName=table_name,
            RecordId=str(record_id) if record_id else None,
            OldValues=json.dumps(old_values) if old_values else None,
            NewValues=json.dumps(new_values) if new_values else None,
            CreatedAt=datetime.now(),
        )
        db.add(entry)
    except Exception:
        logger.exception("Failed to write audit log")


def log_upload(
    db: Session,
    upload_type: str,
    channel: str,
    filename: str,
    file_size: int,
    uploaded_by,
    total_rows: int = 0,
    success_rows: int = 0,
    error_rows: int = 0,
    errors: list = None,
    status: str = "Success",
):
    """Write a row to UploadLogs. Never raises."""
    try:
        entry = UploadLog(
            UploadType=upload_type,
            Channel=channel,
            FileName=filename or "unknown",
            FileSize=file_size,
            UploadedBy=uploaded_by,
            TotalRows=total_rows,
            SuccessRows=success_rows,
            ErrorRows=error_rows,
            Errors=json.dumps(errors[:20]) if errors else None,
            Status=status,
            ProcessedAt=datetime.now(),
        )
        db.add(entry)
    except Exception:
        logger.exception("Failed to write upload log")
