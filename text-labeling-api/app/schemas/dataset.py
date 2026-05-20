"""
app/schemas/dataset.py
Pydantic schemas for Dataset and DataSample (UC-3.3).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# DataSample — Inline
# ============================================================

class DataSampleInput(BaseModel):
    """Single sample for bulk import. Text is required, metadata optional."""

    content: str = Field(..., min_length=1)
    metadata_: Optional[Dict[str, Any]] = Field(None, alias="metadata")

    model_config = {"populate_by_name": True}


class DataSampleResponse(BaseModel):
    id: UUID
    dataset_id: UUID
    content: str
    metadata_: Optional[Dict[str, Any]] = Field(None, alias="metadata")
    sample_index: int
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


# ============================================================
# Dataset — Request
# ============================================================

class CreateDatasetRequest(BaseModel):
    """
    Import a dataset with inline samples.
    In production, this would parse a file upload; for now we accept
    a list of sample objects directly.
    """

    name: str = Field(..., min_length=1, max_length=255)
    source_format: str = Field(
        "json", description="csv, json, or jsonl"
    )
    field_mapping: Optional[Dict[str, Any]] = Field(
        None, description="Maps file fields to text/metadata"
    )
    samples: List[DataSampleInput] = Field(
        ..., min_length=1, description="List of text samples to import"
    )


# ============================================================
# Dataset — Response
# ============================================================

class DatasetResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    source_format: str
    file_url: Optional[str] = None
    total_samples: int
    assigned_samples: int = 0
    completed_samples: int = 0
    submitted_samples: int = 0
    approved_samples: int = 0
    rejected_samples: int = 0
    progress_percent: float = 0.0
    status: str
    field_mapping: Optional[Dict[str, Any]] = None
    imported_by: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class DatasetListResponse(BaseModel):
    datasets: List[DatasetResponse]


class DatasetDetailResponse(DatasetResponse):
    """Dataset with paginated samples."""

    samples: List[DataSampleResponse] = []


class ImportResultResponse(BaseModel):
    dataset: DatasetResponse
    total_imported: int
    errors_count: int = 0
    errors: List[str] = []


class SampleListResponse(BaseModel):
    samples: List[DataSampleResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
