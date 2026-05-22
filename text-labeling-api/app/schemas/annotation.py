"""
app/schemas/annotation.py
Pydantic schemas for Annotation and AnnotationDraft (UC-4.x).
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# Annotation — Request
# ============================================================

class CreateAnnotationRequest(BaseModel):
    label_id: UUID
    start_offset: int = Field(..., ge=0)
    end_offset: int = Field(..., ge=0)
    selected_text: str = Field(..., min_length=1, max_length=5000)


class UpdateAnnotationRequest(BaseModel):
    label_id: Optional[UUID] = None
    start_offset: Optional[int] = Field(None, ge=0)
    end_offset: Optional[int] = Field(None, ge=0)
    selected_text: Optional[str] = Field(None, min_length=1, max_length=5000)


class BulkAnnotationsRequest(BaseModel):
    """Replace all annotations for a task sample (used for save-all / undo-redo)."""
    annotations: List[CreateAnnotationRequest]


# ============================================================
# Annotation — Response
# ============================================================

class AnnotationResponse(BaseModel):
    id: UUID
    task_sample_id: UUID
    label_id: UUID
    label_name: Optional[str] = None
    label_color: Optional[str] = None
    label_group_id: Optional[UUID] = None
    label_group_name: Optional[str] = None
    start_offset: int
    end_offset: int
    selected_text: str
    created_by: UUID
    is_ai_generated: bool = False
    ai_confidence: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Draft — Request / Response
# ============================================================

class SaveDraftRequest(BaseModel):
    draft_data: Dict[str, Any] = Field(
        ..., description="Full draft state as JSON"
    )


class DraftResponse(BaseModel):
    id: UUID
    task_sample_id: UUID
    draft_data: Dict[str, Any]
    auto_saved_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# Task Sample — Annotation View
# ============================================================

class AnnotationSampleResponse(BaseModel):
    """Full data for the annotation UI to render a single sample."""
    task_sample_id: UUID
    data_sample_id: UUID
    content: str
    metadata: Optional[Dict[str, Any]] = None
    status: str
    annotations: List[AnnotationResponse] = []
    draft: Optional[DraftResponse] = None
    labels: List[dict] = []
    guideline_version: Optional[int] = None


class AdjacentSamplesResponse(BaseModel):
    prev_sample_id: Optional[UUID] = None
    next_sample_id: Optional[UUID] = None
    current_index: int
    total_samples: int


# ============================================================
# My Tasks — Annotator view
# ============================================================

class MyTaskResponse(BaseModel):
    id: UUID
    project_id: UUID
    project_name: Optional[str] = None
    sample_count: int = 0
    status: str
    deadline: Optional[datetime] = None
    assigned_at: datetime

    model_config = {"from_attributes": True}


class MyTaskListResponse(BaseModel):
    tasks: List[MyTaskResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class MyStatsResponse(BaseModel):
    total_tasks: int = 0
    completed: int = 0
    in_progress: int = 0
    rework: int = 0
    approval_rate: float = 0.0
    avg_time_per_sample: Optional[float] = None
    daily_progress: List[dict] = []
