"""
app/schemas/export.py
Pydantic schemas for data export (UC-6.1).
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# Request
# ============================================================

class CreateExportRequest(BaseModel):
    dataset_id: Optional[UUID] = None
    format: str = Field(
        ..., description="json, jsonl, or csv"
    )
    filter_status: str = Field(
        "approved_only", description="approved_only or all"
    )
    include_metadata: bool = False


# ============================================================
# Response
# ============================================================

class ExportResponse(BaseModel):
    id: UUID
    project_id: UUID
    dataset_id: Optional[UUID] = None
    exported_by: UUID
    format: str
    filter_status: str
    file_url: Optional[str] = None
    total_records: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ExportListResponse(BaseModel):
    exports: List[ExportResponse]


class ExportDataItem(BaseModel):
    """Single record in the exported data."""
    sample_id: str
    content: str
    annotations: List[dict] = []
    metadata: Optional[dict] = None
    annotator: Optional[str] = None
    review_status: Optional[str] = None


class ExportDownloadResponse(BaseModel):
    export_info: ExportResponse
    data: List[ExportDataItem] = []