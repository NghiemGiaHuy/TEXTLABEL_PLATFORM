"""
app/schemas/user.py
Pydantic schemas for Admin User Management module (UC-2.1, UC-2.2).
"""

import re
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


# ============================================================
# Request Schemas
# ============================================================

class CreateUserRequest(BaseModel):
    """Admin creates a new user account."""

    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role_ids: List[UUID] = Field(
        ..., min_length=1, description="At least one role must be assigned"
    )

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        return v


class UpdateUserRequest(BaseModel):
    """Admin updates user profile and/or roles."""

    full_name: Optional[str] = Field(None, min_length=1, max_length=255)
    role_ids: Optional[List[UUID]] = Field(
        None,
        min_length=1,
        description="Replace all roles. At least one role required.",
    )


class AdminResetPasswordRequest(BaseModel):
    """Admin directly sets a new password for a user."""

    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserListParams(BaseModel):
    """Query parameters for listing users with filters."""

    search: Optional[str] = Field(
        None, max_length=100, description="Search by name or email"
    )
    role: Optional[str] = Field(
        None, description="Filter by role name (admin, project_owner, annotator, reviewer)"
    )
    status: Optional[str] = Field(
        None, description="Filter by status (active, locked)"
    )
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
    sort_by: str = Field("created_at", description="Sort field: created_at, email, full_name")
    sort_order: str = Field("desc", description="asc or desc")

    @field_validator("sort_by")
    @classmethod
    def validate_sort_by(cls, v: str) -> str:
        allowed = {"created_at", "email", "full_name", "status"}
        if v not in allowed:
            raise ValueError(f"sort_by must be one of: {', '.join(allowed)}")
        return v

    @field_validator("sort_order")
    @classmethod
    def validate_sort_order(cls, v: str) -> str:
        if v.lower() not in {"asc", "desc"}:
            raise ValueError("sort_order must be 'asc' or 'desc'")
        return v.lower()


# ============================================================
# Response Schemas
# ============================================================

class RoleResponse(BaseModel):
    """Single role in responses."""

    id: UUID
    name: str
    description: Optional[str] = None

    model_config = {"from_attributes": True}


class UserProjectResponse(BaseModel):
    """Project membership summary for user list/detail views."""

    id: UUID
    code: str
    name: str
    role_in_project: str


class UserRoleCounts(BaseModel):
    """System role totals for user management summary cards."""

    admin: int = 0
    project_owner: int = 0
    annotator: int = 0
    reviewer: int = 0


class UserDetailResponse(BaseModel):
    """
    Full user detail for admin views.
    Extends the basic UserResponse with roles as objects, timestamps, login info.
    """

    id: UUID
    email: str
    full_name: str
    avatar_url: Optional[str] = None
    status: str
    roles: List[RoleResponse] = []
    project_count: int = 0
    projects: List[UserProjectResponse] = []
    task_done_count: int = 0
    last_login_at: Optional[datetime] = None
    failed_login_count: int = 0
    locked_until: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    """Paginated list of users."""

    users: List[UserDetailResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    role_counts: UserRoleCounts = Field(default_factory=UserRoleCounts)


class RoleListResponse(BaseModel):
    """List of all available roles."""

    roles: List[RoleResponse]
