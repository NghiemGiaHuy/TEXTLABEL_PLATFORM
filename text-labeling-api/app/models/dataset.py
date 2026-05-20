"""
app/models/dataset.py
Dataset and DataSample models (UC-3.3).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import UUIDMixin

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.user import User


# ============================================================
# Enums
# ============================================================

class SourceFormat(str, enum.Enum):
    CSV = "csv"
    JSON = "json"
    JSONL = "jsonl"


class DatasetStatus(str, enum.Enum):
    IMPORTING = "importing"
    READY = "ready"
    ERROR = "error"


# ============================================================
# Dataset
# ============================================================

class Dataset(Base, UUIDMixin):
    __tablename__ = "datasets"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_format: Mapped[SourceFormat] = mapped_column(
        SAEnum(SourceFormat, name="source_format", create_constraint=True),
        nullable=False,
    )
    file_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    total_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[DatasetStatus] = mapped_column(
        SAEnum(DatasetStatus, name="dataset_status", create_constraint=True),
        default=DatasetStatus.IMPORTING,
        nullable=False,
    )
    field_mapping: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    imported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
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
    importer: Mapped["User"] = relationship(
        "User", foreign_keys=[imported_by], lazy="joined"
    )
    samples: Mapped[List["DataSample"]] = relationship(
        back_populates="dataset",
        cascade="all, delete-orphan",
        order_by="DataSample.sample_index",
    )

    def __repr__(self) -> str:
        return f"<Dataset {self.name} ({self.total_samples} samples)>"


# ============================================================
# DataSample
# ============================================================

class DataSample(Base, UUIDMixin):
    __tablename__ = "data_samples"

    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[Optional[dict]] = mapped_column(
        "metadata", JSONB, nullable=True
    )
    sample_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    # --- Relationships ---
    dataset: Mapped["Dataset"] = relationship(back_populates="samples")

    def __repr__(self) -> str:
        return f"<DataSample #{self.sample_index}>"