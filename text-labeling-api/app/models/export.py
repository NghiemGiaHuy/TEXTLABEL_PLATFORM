"""
app/models/export.py
Export model for labeled data export (UC-6.1).
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
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin

if TYPE_CHECKING:
    from app.models.dataset import Dataset
    from app.models.project import Project
    from app.models.user import User


# ============================================================
# Enums
# ============================================================

class ExportFormat(str, enum.Enum):
    JSON = "json"
    JSONL = "jsonl"
    CSV = "csv"


class ExportFilterStatus(str, enum.Enum):
    APPROVED_ONLY = "approved_only"
    ALL = "all"


# ============================================================
# Export
# ============================================================

class Export(Base, UUIDMixin):
    __tablename__ = "exports"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dataset_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="SET NULL"),
        nullable=True,
    )
    exported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    format: Mapped[ExportFormat] = mapped_column(
        SAEnum(ExportFormat, name="export_format", create_constraint=True),
        nullable=False,
    )
    filter_status: Mapped[ExportFilterStatus] = mapped_column(
        SAEnum(
            ExportFilterStatus,
            name="export_filter_status",
            create_constraint=True,
        ),
        nullable=False,
    )
    file_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    total_records: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # --- Relationships ---
    project: Mapped["Project"] = relationship(
        "Project", foreign_keys=[project_id], lazy="joined"
    )
    dataset: Mapped[Optional["Dataset"]] = relationship(
        "Dataset", foreign_keys=[dataset_id], lazy="joined"
    )
    exporter: Mapped["User"] = relationship(
        "User", foreign_keys=[exported_by], lazy="joined"
    )

    def __repr__(self) -> str:
        return f"<Export {self.format.value} ({self.total_records} records)>"