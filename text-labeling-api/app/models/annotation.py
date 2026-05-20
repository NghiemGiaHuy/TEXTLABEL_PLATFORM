"""
app/models/annotation.py
Annotation and AnnotationDraft models (UC-4.2).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.label import Label
    from app.models.task import TaskSample
    from app.models.user import User


# ============================================================
# Annotation
# ============================================================

class Annotation(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "annotations"

    task_sample_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_samples.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("labels.id", ondelete="RESTRICT"),
        nullable=False,
    )
    start_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    end_offset: Mapped[int] = mapped_column(Integer, nullable=False)
    selected_text: Mapped[str] = mapped_column(String(5000), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    is_ai_generated: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    ai_confidence: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )

    # --- Relationships ---
    task_sample: Mapped["TaskSample"] = relationship(
        "TaskSample", lazy="joined"
    )
    label: Mapped["Label"] = relationship("Label", lazy="joined")
    creator: Mapped["User"] = relationship(
        "User", foreign_keys=[created_by], lazy="joined"
    )

    def __repr__(self) -> str:
        return f"<Annotation [{self.start_offset}:{self.end_offset}]>"


# ============================================================
# AnnotationDraft
# ============================================================

class AnnotationDraft(Base, UUIDMixin):
    __tablename__ = "annotation_drafts"

    task_sample_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_samples.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    draft_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    auto_saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # --- Relationships ---
    task_sample: Mapped["TaskSample"] = relationship(
        "TaskSample", lazy="joined"
    )