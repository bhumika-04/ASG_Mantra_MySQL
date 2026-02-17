"""
Notifications Router - Notification Management
Handles user notifications
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.notification import Notification
from app.models.user import User
from app.utils.dependencies import get_current_user


class CreateNotificationRequest(BaseModel):
    user_id: Optional[str] = None  # If None, send to current user
    title: str
    message: str
    type: str = "info"  # info, warning, error, success


router = APIRouter()


@router.get("", include_in_schema=False)
@router.get("/")
async def get_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all notifications for the current user
    """
    user_id = str(current_user.Id)

    notifications = db.query(Notification)\
        .filter(Notification.UserId == user_id)\
        .order_by(Notification.CreatedAt.desc())\
        .all()

    return [
        {
            "id": notif.Id,
            "title": notif.Title,
            "message": notif.Message,
            "type": notif.Type,
            "is_read": notif.IsRead,
            "created_at": notif.CreatedAt.isoformat() if notif.CreatedAt else None,
        }
        for notif in notifications
    ]


@router.put("/{notification_id}/read")
async def mark_notification_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Mark a notification as read
    """
    user_id = str(current_user.Id)

    notification = db.query(Notification).filter(
        Notification.Id == notification_id,
        Notification.UserId == user_id
    ).first()

    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    notification.IsRead = True

    try:
        db.commit()
        return {
            "success": True,
            "message": "Notification marked as read"
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update notification: {str(e)}")


@router.post("")
@router.post("/")
async def create_notification(
    body: CreateNotificationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new notification.
    Admin/Manager can create for any user, others can only create for themselves.
    """
    target_user_id = body.user_id if body.user_id else str(current_user.Id)

    # Check permissions
    if body.user_id and str(current_user.Id) != body.user_id:
        if current_user.Role not in ["Admin", "Manager"]:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    notification = Notification(
        UserId=target_user_id,
        Title=body.title,
        Message=body.message,
        Type=body.type,
        IsRead=False,
    )

    try:
        db.add(notification)
        db.commit()
        db.refresh(notification)

        return {
            "success": True,
            "message": "Notification created successfully",
            "data": {
                "id": notification.Id,
                "title": notification.Title,
                "message": notification.Message,
                "type": notification.Type,
                "is_read": notification.IsRead,
                "created_at": notification.CreatedAt.isoformat() if notification.CreatedAt else None,
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create notification: {str(e)}")


@router.put("/mark-all-read")
async def mark_all_notifications_as_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Mark all notifications as read for the current user.
    """
    user_id = str(current_user.Id)

    try:
        updated_count = db.query(Notification).filter(
            Notification.UserId == user_id,
            Notification.IsRead == False
        ).update({"IsRead": True})

        db.commit()

        return {
            "success": True,
            "message": f"Marked {updated_count} notifications as read",
            "updatedCount": updated_count
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update notifications: {str(e)}")


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a notification.
    Users can only delete their own notifications.
    Admin can delete any notification.
    """
    user_id = str(current_user.Id)

    notification = db.query(Notification).filter(Notification.Id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    # Check permissions
    if notification.UserId != user_id and current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    try:
        db.delete(notification)
        db.commit()
        return {"success": True, "message": f"Notification {notification_id} deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete notification: {str(e)}")


@router.delete("/clear-all")
async def clear_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete all read notifications for the current user.
    """
    user_id = str(current_user.Id)

    try:
        deleted_count = db.query(Notification).filter(
            Notification.UserId == user_id,
            Notification.IsRead == True
        ).delete()

        db.commit()

        return {
            "success": True,
            "message": f"Deleted {deleted_count} read notifications",
            "deletedCount": deleted_count
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete notifications: {str(e)}")


@router.get("/stats")
async def get_notification_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get notification statistics for the current user.
    """
    user_id = str(current_user.Id)

    from sqlalchemy import func

    total_notifications = db.query(Notification).filter(Notification.UserId == user_id).count()
    unread_notifications = db.query(Notification).filter(
        Notification.UserId == user_id,
        Notification.IsRead == False
    ).count()

    # Notifications by type
    types_query = db.query(
        Notification.Type,
        func.count(Notification.Id).label('count')
    ).filter(
        Notification.UserId == user_id
    ).group_by(Notification.Type).all()

    type_breakdown = {notif_type: count for notif_type, count in types_query}

    return {
        "totalNotifications": total_notifications,
        "unreadNotifications": unread_notifications,
        "readNotifications": total_notifications - unread_notifications,
        "typeBreakdown": type_breakdown,
    }
