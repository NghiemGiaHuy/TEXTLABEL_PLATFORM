"""
app/models/label.py
LabelSet, LabelGroup, Label models for project ontology.
"""

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.models.project import Project

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


# ============================================================
# LabelSet
# ============================================================

class LabelSet(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "label_sets"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # --- Relationships ---
    project: Mapped["Project"] = relationship(  # noqa: F821
        "Project", back_populates="label_sets"
    )
    groups: Mapped[List["LabelGroup"]] = relationship(
        back_populates="label_set",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="LabelGroup.sort_order",
    )
    labels: Mapped[List["Label"]] = relationship(
        back_populates="label_set",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Label.sort_order",
    )


# ============================================================
# LabelGroup
# ============================================================

class LabelGroup(Base, UUIDMixin):
    __tablename__ = "label_groups"

    label_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("label_sets.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- Relationships ---
    label_set: Mapped["LabelSet"] = relationship(back_populates="groups")
    labels: Mapped[List["Label"]] = relationship(
        back_populates="group", order_by="Label.sort_order"
    )


# ============================================================
# Label
# ============================================================

class Label(Base, UUIDMixin):
    __tablename__ = "labels"
    __table_args__ = (
        UniqueConstraint(
            "label_set_id", "shortcut_key", name="uq_label_shortcut"
        ),
    )

    label_set_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("label_sets.id", ondelete="CASCADE"),
        nullable=False,
    )
    label_group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("label_groups.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    shortcut_key: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # --- Relationships ---
    label_set: Mapped["LabelSet"] = relationship(back_populates="labels")
    group: Mapped[Optional["LabelGroup"]] = relationship(back_populates="labels")