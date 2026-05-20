"""
app/models/review.py
Review model for annotation QA (UC-5.1).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin

if TYPE_CHECKING:
    from app.models.task import TaskSample
    from app.models.user import User


# ============================================================
# Enums
# ============================================================

class ReviewResult(str, enum.Enum):
    APPROVED = "approved"
    REJECTED = "rejected"


# ============================================================
# Review
# ============================================================

class Review(Base, UUIDMixin):
    __tablename__ = "reviews"

    task_sample_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_samples.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    result: Mapped[ReviewResult] = mapped_column(
        SAEnum(ReviewResult, name="review_result", create_constraint=True),
        nullable=False,
    )
    feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # --- Relationships ---
    task_sample: Mapped["TaskSample"] = relationship(
        "TaskSample", lazy="joined"
    )
    reviewer: Mapped["User"] = relationship(
        "User", foreign_keys=[reviewer_id], lazy="joined"
    )

    def __repr__(self) -> str:
        return f"<Review {self.result.value} by {self.reviewer_id}>"