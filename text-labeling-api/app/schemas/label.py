"""
app/schemas/label.py
Pydantic schemas for LabelSet, LabelGroup, and Label.
"""

import re
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ============================================================
# Label — Request
# ============================================================

class CreateLabelRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: str = Field(..., description="Hex color, e.g. #FF5733")
    shortcut_key: Optional[str] = Field(None, max_length=10)
    sort_order: int = Field(0, ge=0)
    is_required: bool = False
    label_group_id: Optional[UUID] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if not re.match(r"^#[0-9A-Fa-f]{6}$", v):
            raise ValueError("Color must be a hex code like #FF5733")
        return v.upper()


class UpdateLabelRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = None
    shortcut_key: Optional[str] = Field(None, max_length=10)
    sort_order: Optional[int] = Field(None, ge=0)
    is_required: Optional[bool] = None
    label_group_id: Optional[UUID] = None

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not re.match(r"^#[0-9A-Fa-f]{6}$", v):
            raise ValueError("Color must be a hex code like #FF5733")
        return v.upper()


# ============================================================
# Label — Response
# ============================================================

class LabelResponse(BaseModel):
    id: UUID
    label_set_id: UUID
    label_group_id: Optional[UUID] = None
    name: str
    color: str
    shortcut_key: Optional[str] = None
    sort_order: int
    is_required: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ============================================================
# LabelGroup — Request / Response
# ============================================================

class CreateLabelGroupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    sort_order: int = Field(0, ge=0)


class UpdateLabelGroupRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    sort_order: Optional[int] = Field(None, ge=0)


class LabelGroupResponse(BaseModel):
    id: UUID
    label_set_id: UUID
    name: str
    sort_order: int

    model_config = {"from_attributes": True}


# ============================================================
# LabelSet — Request / Response
# ============================================================

class CreateLabelSetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class UpdateLabelSetRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)


class LabelSetResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    created_at: datetime
    updated_at: datetime
    groups: List[LabelGroupResponse] = []
    labels: List[LabelResponse] = []

    model_config = {"from_attributes": True}


class LabelSetListResponse(BaseModel):
    label_sets: List[LabelSetResponse]