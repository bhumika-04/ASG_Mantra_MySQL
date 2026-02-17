"""
Audit Logs Router - System Audit Trail
Handles audit log queries and management
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import datetime, timedelta

from app.database import get_db
from app.models.user import User
from app.models.audit_log import AuditLog
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def get_audit_logs(
    action: Optional[str] = Query(None, description="Filter by action (CREATE, UPDATE, DELETE, LOGIN, LOGOUT)"),
    table_name: Optional[str] = Query(None, description="Filter by table name"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get audit logs with optional filtering and pagination.
    Admin/Manager only.
    """
    # Check permissions
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions. Admin or Manager role required.")

    query = db.query(AuditLog, User.FullName, User.Email).outerjoin(
        User, AuditLog.UserId == User.Id
    )

    # Apply filters
    if action:
        query = query.filter(AuditLog.Action == action)

    if table_name:
        query = query.filter(AuditLog.TableName == table_name)

    if user_id:
        query = query.filter(AuditLog.UserId == user_id)

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(AuditLog.CreatedAt >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD.")

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date) + timedelta(days=1)
            query = query.filter(AuditLog.CreatedAt < end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD.")

    # Get total count
    total = query.count()

    # Pagination
    offset = (page - 1) * page_size
    rows = query.order_by(AuditLog.CreatedAt.desc()).offset(offset).limit(page_size).all()

    items = []
    for log, user_name, user_email in rows:
        items.append({
            "id": log.Id,
            "userId": str(log.UserId) if log.UserId else None,
            "userName": user_name,
            "userEmail": user_email,
            "action": log.Action,
            "tableName": log.TableName,
            "recordId": log.RecordId,
            "oldValues": log.OldValues,
            "newValues": log.NewValues,
            "createdAt": log.CreatedAt.isoformat() if log.CreatedAt else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/stats")
async def get_audit_stats(
    days: int = Query(30, ge=1, le=365, description="Number of days to analyze"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get audit log statistics for the last N days.
    Admin/Manager only.
    """
    if current_user.Role not in ["Admin", "Manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    start_date = datetime.now() - timedelta(days=days)

    # Total logs
    total_logs = db.query(AuditLog).filter(AuditLog.CreatedAt >= start_date).count()

    # Logs by action
    from sqlalchemy import func
    actions_query = db.query(
        AuditLog.Action,
        func.count(AuditLog.Id).label('count')
    ).filter(
        AuditLog.CreatedAt >= start_date
    ).group_by(AuditLog.Action).all()

    actions_breakdown = {action: count for action, count in actions_query}

    # Logs by table
    tables_query = db.query(
        AuditLog.TableName,
        func.count(AuditLog.Id).label('count')
    ).filter(
        AuditLog.CreatedAt >= start_date,
        AuditLog.TableName.isnot(None)
    ).group_by(AuditLog.TableName).order_by(func.count(AuditLog.Id).desc()).limit(10).all()

    top_tables = [{"tableName": table, "count": count} for table, count in tables_query]

    # Logs by user
    users_query = db.query(
        AuditLog.UserId,
        func.count(AuditLog.Id).label('count')
    ).filter(
        AuditLog.CreatedAt >= start_date,
        AuditLog.UserId.isnot(None)
    ).group_by(AuditLog.UserId).order_by(func.count(AuditLog.Id).desc()).limit(10).all()

    top_users = [{"userId": str(user_id), "count": count} for user_id, count in users_query]

    return {
        "totalLogs": total_logs,
        "days": days,
        "actionBreakdown": actions_breakdown,
        "topTables": top_tables,
        "topUsers": top_users,
    }


@router.delete("/{log_id}")
async def delete_audit_log(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a specific audit log entry.
    Admin only.
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    log = db.query(AuditLog).filter(AuditLog.Id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")

    db.delete(log)
    db.commit()

    return {"success": True, "message": f"Audit log {log_id} deleted"}


@router.delete("/cleanup")
async def cleanup_old_logs(
    days: int = Query(90, ge=30, description="Delete logs older than N days"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete audit logs older than specified days.
    Admin only.
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    cutoff_date = datetime.now() - timedelta(days=days)
    deleted_count = db.query(AuditLog).filter(AuditLog.CreatedAt < cutoff_date).delete()
    db.commit()

    return {
        "success": True,
        "message": f"Deleted {deleted_count} audit logs older than {days} days",
        "deletedCount": deleted_count
    }
