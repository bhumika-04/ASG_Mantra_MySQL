"""
Upload Logs Router - File Upload History
Tracks and manages all file upload operations
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta

from app.database import get_db
from app.models.user import User
from app.models.upload_log import UploadLog
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def get_upload_logs(
    upload_type: Optional[str] = Query(None, description="Filter by type (Inventory, AmazonSales, BlinkitSales, AmazonPO, BlinkitPO, EagleStock)"),
    channel: Optional[str] = Query(None, description="Filter by channel (Amazon, Blinkit)"),
    status: Optional[str] = Query(None, description="Filter by status (Pending, Processing, Success, Failed)"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get upload logs with optional filtering and pagination.
    """
    query = db.query(UploadLog)

    # Apply filters
    if upload_type:
        query = query.filter(UploadLog.UploadType == upload_type)

    if channel:
        query = query.filter(UploadLog.Channel == channel)

    if status:
        query = query.filter(UploadLog.Status == status)

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(UploadLog.UploadDate >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD.")

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date) + timedelta(days=1)
            query = query.filter(UploadLog.UploadDate < end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD.")

    # Get total count
    total = query.count()

    # Pagination
    offset = (page - 1) * page_size
    logs = query.order_by(UploadLog.UploadDate.desc()).offset(offset).limit(page_size).all()

    return {
        "items": [log.to_dict() for log in logs],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/stats")
async def get_upload_stats(
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get upload statistics for the last N days.
    """
    start_date = datetime.now() - timedelta(days=days)

    from sqlalchemy import func

    # Total uploads
    total_uploads = db.query(UploadLog).filter(UploadLog.UploadDate >= start_date).count()

    # Success rate
    success_count = db.query(UploadLog).filter(
        UploadLog.UploadDate >= start_date,
        UploadLog.Status == 'Success'
    ).count()

    failed_count = db.query(UploadLog).filter(
        UploadLog.UploadDate >= start_date,
        UploadLog.Status == 'Failed'
    ).count()

    success_rate = (success_count / total_uploads * 100) if total_uploads > 0 else 0

    # Uploads by type
    types_query = db.query(
        UploadLog.UploadType,
        func.count(UploadLog.Id).label('count')
    ).filter(
        UploadLog.UploadDate >= start_date
    ).group_by(UploadLog.UploadType).all()

    upload_types = {upload_type: count for upload_type, count in types_query}

    # Uploads by channel
    channels_query = db.query(
        UploadLog.Channel,
        func.count(UploadLog.Id).label('count')
    ).filter(
        UploadLog.UploadDate >= start_date,
        UploadLog.Channel.isnot(None)
    ).group_by(UploadLog.Channel).all()

    channels = {channel: count for channel, count in channels_query}

    # Total rows processed
    total_rows = db.query(func.sum(UploadLog.TotalRows)).filter(
        UploadLog.UploadDate >= start_date
    ).scalar() or 0

    total_errors = db.query(func.sum(UploadLog.ErrorRows)).filter(
        UploadLog.UploadDate >= start_date
    ).scalar() or 0

    return {
        "totalUploads": total_uploads,
        "successCount": success_count,
        "failedCount": failed_count,
        "successRate": round(success_rate, 2),
        "uploadTypes": upload_types,
        "channels": channels,
        "totalRowsProcessed": int(total_rows),
        "totalErrors": int(total_errors),
        "days": days,
    }


@router.get("/{log_id}")
async def get_upload_log_details(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get detailed information about a specific upload log.
    """
    log = db.query(UploadLog).filter(UploadLog.Id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Upload log not found")

    return log.to_dict()


@router.delete("/{log_id}")
async def delete_upload_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a specific upload log entry.
    Admin/Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    log = db.query(UploadLog).filter(UploadLog.Id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Upload log not found")

    db.delete(log)
    db.commit()

    return {"success": True, "message": f"Upload log {log_id} deleted"}


@router.delete("/cleanup")
async def cleanup_old_upload_logs(
    days: int = Query(180, ge=30, description="Delete logs older than N days"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete upload logs older than specified days.
    Admin only.
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    cutoff_date = datetime.now() - timedelta(days=days)
    deleted_count = db.query(UploadLog).filter(UploadLog.UploadDate < cutoff_date).delete()
    db.commit()

    return {
        "success": True,
        "message": f"Deleted {deleted_count} upload logs older than {days} days",
        "deletedCount": deleted_count
    }
