"""
app/services/notification_service.py
Helper for creating notifications from other services.
"""

from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType
from app.models.user import User


_DEFAULT_PREFS = {
    "task_assigned": True,
    "task_rejected": True,
    "project_deadline": True,
    "review_complete": True,
    "task_submitted": True,
    "annotation_milestone": False,
    "export_ready": True,
}

_TYPE_PREF_KEYS = {
    NotificationType.TASK_APPROVED: "review_complete",
}


async def notification_enabled(
    db: AsyncSession,
    *,
    user_id: UUID,
    type: NotificationType,
) -> bool:
    result = await db.execute(
        select(User.notification_prefs).where(User.id == user_id)
    )
    row = result.one_or_none()
    if row is None:
        return False

    prefs = row[0] or {}
    pref_key = _TYPE_PREF_KEYS.get(type, type.value)
    merged = {**_DEFAULT_PREFS, **prefs}
    return bool(merged.get(pref_key, True))


async def create_notification(
    db: AsyncSession,
    *,
    user_id: UUID,
    type: NotificationType,
    title: str,
    message: str,
    link: str | None = None,
    actor_name: str | None = None,
) -> None:
    if not await notification_enabled(db, user_id=user_id, type=type):
        return

    n = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        link=link,
        actor_name=actor_name,
    )
    db.add(n)
    await db.flush()
