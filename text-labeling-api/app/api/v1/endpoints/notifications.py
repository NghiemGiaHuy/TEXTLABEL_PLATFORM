"""
app/api/v1/endpoints/notifications.py
Notification endpoints.

Endpoints:
  GET  /notifications               — List for current user
  POST /notifications/{id}/read     — Mark one as read
  POST /notifications/read-all      — Mark all as read
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    NotificationListResponse,
    NotificationPrefsSchema,
    NotificationResponse,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])

_DEFAULT_PREFS = {
    "task_assigned": True,
    "task_rejected": True,
    "project_deadline": True,
    "review_complete": True,
    "task_submitted": True,
    "annotation_milestone": False,
    "export_ready": True,
}


@router.get("/preferences", response_model=NotificationPrefsSchema)
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
):
    """Get notification preferences for the current user."""
    prefs = current_user.notification_prefs or {}
    merged = {**_DEFAULT_PREFS, **prefs}
    return NotificationPrefsSchema(**merged)


@router.put("/preferences", response_model=NotificationPrefsSchema)
async def update_notification_preferences(
    body: NotificationPrefsSchema,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update notification preferences for the current user."""
    await db.execute(
        update(User)
        .where(User.id == current_user.id)
        .values(notification_prefs=body.model_dump())
    )
    await db.commit()
    return body


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    unread_only: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List notifications for the current user, newest first."""
    base = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        base = base.where(Notification.is_read == False)  # noqa: E712

    q = base.order_by(Notification.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()

    unread_count = (
        await db.execute(
            select(func.count()).where(
                Notification.user_id == current_user.id,
                Notification.is_read == False,  # noqa: E712
            )
        )
    ).scalar() or 0

    total = (
        await db.execute(
            select(func.count()).where(Notification.user_id == current_user.id)
        )
    ).scalar() or 0

    return NotificationListResponse(
        notifications=[NotificationResponse.model_validate(n) for n in rows],
        unread_count=unread_count,
        total=total,
    )


@router.post("/read-all")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read."""
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,  # noqa: E712
        )
        .values(is_read=True)
    )
    await db.commit()
    return {"status": "ok"}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single notification as read."""
    await db.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
        .values(is_read=True)
    )
    await db.commit()
    return {"status": "ok"}
