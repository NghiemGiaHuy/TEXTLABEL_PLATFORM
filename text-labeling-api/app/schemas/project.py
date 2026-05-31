"""
app/schemas/project.py
Pydantic schemas for Project and ProjectMember modules.
"""

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================
# Project — Request
# ============================================================

class CreateProjectRequest(BaseModel):
    code: Optional[str] = Field(None, max_length=20, pattern=r'^[A-Za-z0-9\-_]+$')
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    objective: Optional[str] = None
    priority: Optional[str] = Field(None, description="immediate, high, normal")
    deadline: Optional[date] = None


class UpdateProjectRequest(BaseModel):
    code: Optional[str] = Field(None, max_length=20, pattern=r'^[A-Za-z0-9\-_]+$')
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    objective: Optional[str] = None
    priority: Optional[str] = Field(None, description="immediate, high, normal")
    deadline: Optional[date] = None
    status: Optional[str] = Field(
        None,
        description="One of: draft, active, completed, archived",
    )


# ============================================================
# Project — Response
# ============================================================

class CreatorInfo(BaseModel):
    id: UUID
    full_name: str
    email: str


class ProjectResponse(BaseModel):
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    objective: Optional[str] = None
    priority: str = "normal"
    status: str
    created_by: UUID
    creator: Optional[CreatorInfo] = None
    deadline: Optional[date] = None
    member_count: int = 0
    total_samples: int = 0
    assigned_samples: int = 0
    annotated_samples: int = 0
    pending_review_samples: int = 0
    approved_samples: int = 0
    exported_samples: int = 0
    annotation_progress: float = 0.0
    review_progress: float = 0.0
    export_progress: float = 0.0
    completion_progress: float = 0.0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    projects: List[ProjectResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ============================================================
# ProjectMember — Request
# ============================================================

class AddMemberRequest(BaseModel):
    user_id: UUID
    role_in_project: str = Field(
        ..., description="One of: project_owner, annotator, reviewer"
    )


class UpdateMemberRequest(BaseModel):
    role_in_project: str = Field(
        ..., description="One of: project_owner, annotator, reviewer"
    )


# ============================================================
# ProjectMember — Response
# ============================================================

class ProjectMemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    full_name: str
    email: str
    role_in_project: str
    joined_at: datetime


class MemberListResponse(BaseModel):
    members: List[ProjectMemberResponse]
