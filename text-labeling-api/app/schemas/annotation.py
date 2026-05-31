"""
app/schemas/annotation.py
Pydantic schemas for Annotation and AnnotationDraft (UC-4.x).
"""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


# ============================================================
# Annotation — Request
# ============================================================

class CreateAnnotationRequest(BaseModel):
    label_id: UUID
    start_offset: int = Field(..., ge=0)
    end_offset: int = Field(..., ge=0)
    selected_text: str = Field(..., min_length=1, max_length=5000)
    is_ai_assisted: bool = False
    ai_model_name: Optional[str] = Field(None, max_length=100)
    ai_confidence: Optional[float] = Field(None, ge=0, le=1)

    @model_validator(mode="after")
    def validate_ai_metadata(self):
        if self.is_ai_assisted and not self.ai_model_name:
            raise ValueError("ai_model_name is required for AI-assisted annotations")
        if not self.is_ai_assisted and (
            self.ai_model_name is not None or self.ai_confidence is not None
        ):
            raise ValueError("AI metadata requires is_ai_assisted=true")
        return self


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
    is_ai_assisted: bool = False
    ai_model_name: Optional[str] = None
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
# Gemini AI suggestions
# ============================================================

AISuggestTaskType = Literal[
    "text_classification",
    "ner",
    "relation_extraction",
]


class AISuggestEntity(BaseModel):
    id: Optional[str] = Field(None, min_length=1, max_length=200)
    text: str = Field(..., min_length=1, max_length=5000)
    label: Optional[str] = Field(None, max_length=200)
    start: Optional[int] = Field(None, ge=0)
    end: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_offsets(self):
        if (self.start is None) != (self.end is None):
            raise ValueError("Entity start and end must be provided together")
        if self.start is not None and self.end is not None and self.start >= self.end:
            raise ValueError("Entity start must be less than end")
        return self


class AISuggestRequest(BaseModel):
    task_type: AISuggestTaskType
    text: str = Field(..., min_length=1, max_length=50000)
    labels: List[str] = Field(..., min_length=1, max_length=100)
    entities: Optional[List[AISuggestEntity]] = Field(None, max_length=500)

    @field_validator("labels")
    @classmethod
    def validate_labels(cls, labels: List[str]) -> List[str]:
        normalized = [label.strip() for label in labels]
        if any(not label for label in normalized):
            raise ValueError("Labels must not be blank")
        if any(len(label) > 200 for label in normalized):
            raise ValueError("Labels must not exceed 200 characters")
        if len(set(normalized)) != len(normalized):
            raise ValueError("Labels must be unique")
        return normalized


class AIClassificationSuggestion(BaseModel):
    label: str
    confidence: float = Field(..., ge=0, le=1)


class AINERSuggestion(BaseModel):
    text: str
    label: str
    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)
    confidence: float = Field(..., ge=0, le=1)


class AIRelationSuggestion(BaseModel):
    head: str
    tail: str
    relation: str
    confidence: float = Field(..., ge=0, le=1)
    head_id: Optional[str] = None
    tail_id: Optional[str] = None


class AISuggestResponse(BaseModel):
    task_type: AISuggestTaskType
    model_name: str
    suggestions: List[
        Union[
            AIClassificationSuggestion,
            AINERSuggestion,
            AIRelationSuggestion,
        ]
    ]


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
