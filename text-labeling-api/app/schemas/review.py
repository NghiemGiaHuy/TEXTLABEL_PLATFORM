"""
app/schemas/review.py
Pydantic schemas for Review / QA (UC-5.1).
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# Request
# ============================================================

class ApproveRequest(BaseModel):
    feedback: Optional[str] = None


class RejectRequest(BaseModel):
    feedback: str = Field(..., min_length=1, description="Rejection reason is required")


# ============================================================
# Response
# ============================================================

class ReviewResponse(BaseModel):
    id: UUID
    task_sample_id: UUID
    reviewer_id: UUID
    reviewer_name: Optional[str] = None
    result: str
    feedback: Optional[str] = None
    reviewed_at: datetime

    model_config = {"from_attributes": True}


class ReviewSubmitResponse(BaseModel):
    status: str
    message: str
    rejected_count: int = 0
    approved_count: int = 0


class ReviewQueueItem(BaseModel):
    task_sample_id: UUID
    task_id: UUID
    project_id: UUID
    project_name: Optional[str] = None
    annotator_name: Optional[str] = None
    content_preview: Optional[str] = None
    submitted_at: Optional[datetime] = None


class ReviewQueueResponse(BaseModel):
    queue: List[ReviewQueueItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class ReviewSampleDetailResponse(BaseModel):
    """Full sample data for the review UI."""
    task_sample_id: UUID
    task_id: UUID
    content: str
    metadata: Optional[dict] = None
    annotations: List[dict] = []
    annotator_name: Optional[str] = None
    guideline_version: Optional[int] = None
    review_history: List[ReviewResponse] = []


class ReviewerStatsResponse(BaseModel):
    total_reviewed: int = 0
    approved_count: int = 0
    rejected_count: int = 0
    avg_review_time: Optional[float] = None
