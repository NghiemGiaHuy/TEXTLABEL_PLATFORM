"""
app/schemas/guideline.py
Pydantic schemas for project guidelines.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# Request
# ============================================================

class CreateGuidelineRequest(BaseModel):
    content: str = Field("", description="Rich text or markdown content")
    file_url: Optional[str] = Field(None, max_length=500)


# ============================================================
# Response
# ============================================================

class GuidelineResponse(BaseModel):
    id: UUID
    project_id: UUID
    content: str
    file_url: Optional[str] = None
    version: int
    created_by: UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class GuidelineHistoryResponse(BaseModel):
    guidelines: List[GuidelineResponse]