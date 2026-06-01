"""
app/models/project.py
Project and ProjectMember models.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.label import LabelSet


import enum
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


# ============================================================
# Enums
# ============================================================

class ProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ProjectPriority(str, enum.Enum):
    IMMEDIATE = "immediate"
    HIGH = "high"
    NORMAL = "normal"


class ProjectRole(str, enum.Enum):
    PROJECT_OWNER = "project_owner"
    ANNOTATOR = "annotator"
    REVIEWER = "reviewer"


# ============================================================
# Project
# ============================================================

class Project(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "projects"

    code: Mapped[str] = mapped_column(
        String(20), unique=True, index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(
        SAEnum(ProjectStatus, name="project_status", create_constraint=True),
        default=ProjectStatus.DRAFT,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    priority: Mapped[ProjectPriority] = mapped_column(
        SAEnum(
            ProjectPriority,
            name="project_priority",
            create_constraint=True,
            values_callable=lambda x: [e.value for e in x],
        ),
        default=ProjectPriority.NORMAL,
        server_default="normal",
        nullable=False,
    )
    objective: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- Relationships ---
    creator: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by], lazy="joined"
    )
    members: Mapped[List["ProjectMember"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    label_sets: Mapped[List["LabelSet"]] = relationship(  # noqa: F821
        "LabelSet", back_populates="project", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Project {self.code} — {self.name}>"


# ============================================================
# ProjectMember
# ============================================================

class ProjectMember(Base, UUIDMixin):
    __tablename__ = "project_members"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_in_project: Mapped[ProjectRole] = mapped_column(
        SAEnum(ProjectRole, name="project_role", create_constraint=True),
        nullable=False,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # --- Relationships ---
    project: Mapped["Project"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship("User", lazy="joined")  # noqa: F821
