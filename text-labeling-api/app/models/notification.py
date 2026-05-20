"""
app/models/notification.py
Notification model for user alerts.
"""

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin

if TYPE_CHECKING:
    from app.models.user import User


class NotificationType(str, enum.Enum):
    TASK_ASSIGNED = "task_assigned"
    TASK_REJECTED = "task_rejected"
    TASK_APPROVED = "task_approved"
    TASK_SUBMITTED = "task_submitted"
    PROJECT_DEADLINE = "project_deadline"
    REVIEW_COMPLETE = "review_complete"
    ANNOTATION_MILESTONE = "annotation_milestone"
    EXPORT_READY = "export_ready"


class Notification(Base, UUIDMixin):
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[NotificationType] = mapped_column(
        SAEnum(NotificationType, name="notification_type", create_constraint=True),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    actor_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    def __repr__(self) -> str:
        return f"<Notification {self.type} → user={self.user_id}>"
