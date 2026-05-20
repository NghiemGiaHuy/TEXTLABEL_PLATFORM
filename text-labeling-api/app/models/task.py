"""
app/models/task.py
Task and TaskSample models (UC-3.5).
"""

from __future__ import annotations

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.dataset import Dataset

import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin

if TYPE_CHECKING:
    from app.models.dataset import DataSample
    from app.models.project import Project
    from app.models.user import User


# ============================================================
# Enums
# ============================================================

class TaskStatus(str, enum.Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    REWORK = "rework"
    APPROVED = "approved"
    REJECTED = "rejected"


class AssignmentMethod(str, enum.Enum):
    MANUAL = "manual"
    ROUND_ROBIN = "round_robin"


class AnnotationType(str, enum.Enum):
    TEXT_CLASSIFICATION = "text_classification"
    NER = "ner"
    RELATION_EXTRACTION = "relation_extraction"
    SEQUENCE_LABELING = "sequence_labeling"


class TaskSampleStatus(str, enum.Enum):
    PENDING = "pending"
    ANNOTATED = "annotated"
    DONE = "done"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    REWORK = "rework"


# ============================================================
# Task
# ============================================================

class Task(Base, UUIDMixin):
    __tablename__ = "tasks"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    assignee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    assigned_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[TaskStatus] = mapped_column(
        SAEnum(TaskStatus, name="task_status", create_constraint=True),
        default=TaskStatus.TODO,
        nullable=False,
    )
    assignment_method: Mapped[AssignmentMethod] = mapped_column(
        SAEnum(
            AssignmentMethod,
            name="assignment_method",
            create_constraint=True,
        ),
        nullable=False,
    )
    annotation_type: Mapped[Optional[AnnotationType]] = mapped_column(
        SAEnum(
            AnnotationType,
            name="annotation_type",
            create_constraint=True,
        ),
        nullable=True,
    )
    reviewer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    label_set_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("label_sets.id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    submitted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # --- Relationships ---
    project: Mapped["Project"] = relationship(
        "Project", foreign_keys=[project_id], lazy="joined"
    )
    dataset: Mapped["Dataset"] = relationship(
        "Dataset", foreign_keys=[dataset_id], lazy="joined"
    )
    assignee: Mapped["User"] = relationship(
        "User", foreign_keys=[assignee_id], lazy="joined"
    )
    assigner: Mapped["User"] = relationship(
        "User", foreign_keys=[assigned_by], lazy="joined"
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[reviewer_id], lazy="joined"
    )
    task_samples: Mapped[List["TaskSample"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="TaskSample.sample_order",
    )

    def __repr__(self) -> str:
        return f"<Task {self.id} → {self.assignee_id}>"


# ============================================================
# TaskSample
# ============================================================

class TaskSample(Base, UUIDMixin):
    __tablename__ = "task_samples"

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    data_sample_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("data_samples.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[TaskSampleStatus] = mapped_column(
        SAEnum(
            TaskSampleStatus,
            name="task_sample_status",
            create_constraint=True,
        ),
        default=TaskSampleStatus.PENDING,
        nullable=False,
    )
    sample_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- Relationships ---
    task: Mapped["Task"] = relationship(back_populates="task_samples")
    data_sample: Mapped["DataSample"] = relationship(
        "DataSample", lazy="joined"
    )

    def __repr__(self) -> str:
        return f"<TaskSample task={self.task_id} order={self.sample_order}>"
