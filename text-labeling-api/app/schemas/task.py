"""
app/schemas/task.py
Pydantic schemas for Task and TaskSample (UC-3.5).
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import AliasChoices, BaseModel, Field, field_validator


# ============================================================
# Assignment — Request
# ============================================================

class ManualAssignment(BaseModel):
    """Single manual assignment: annotator + number of samples."""

    annotator_id: UUID = Field(
        ...,
        validation_alias=AliasChoices(
            "annotator_id",
            "assignee_id",
            "user_id",
            "annotatorId",
            "assigneeId",
            "userId",
        ),
    )
    sample_count: int = Field(
        ...,
        ge=0,
        validation_alias=AliasChoices(
            "sample_count",
            "sampleCount",
            "count",
            "samples",
        ),
    )

    @field_validator("sample_count", mode="before")
    @classmethod
    def blank_sample_count_to_zero(cls, value):
        if value is None or value == "":
            return 0
        return value


class UpdateManualAssignment(BaseModel):
    """Manual assignment row used by the edit modal."""

    annotator_id: UUID = Field(
        ...,
        validation_alias=AliasChoices(
            "annotator_id",
            "assignee_id",
            "user_id",
            "annotatorId",
            "assigneeId",
            "userId",
        ),
    )
    sample_count: Optional[int] = Field(
        None,
        ge=0,
        validation_alias=AliasChoices(
            "sample_count",
            "sampleCount",
            "count",
            "samples",
        ),
    )

    @field_validator("sample_count", mode="before")
    @classmethod
    def blank_sample_count_to_none(cls, value):
        if value == "":
            return None
        return value


class AssignTasksRequest(BaseModel):
    """
    Create tasks and assign samples.
    - manual: provide a list of assignments.
    - round_robin: provide dataset_id; optionally provide annotator_ids.
    """

    dataset_id: UUID = Field(
        ..., validation_alias=AliasChoices("dataset_id", "datasetId")
    )
    method: str = Field(
        ...,
        description="'manual' or 'round_robin'",
        validation_alias=AliasChoices(
            "method", "assignment_method", "assignmentMethod"
        ),
    )
    annotation_type: Optional[str] = Field(
        None,
        description="'text_classification', 'ner', or 'relation_extraction'",
        validation_alias=AliasChoices(
            "annotation_type", "annotationType", "task_type", "taskType"
        ),
    )
    label_set_id: Optional[UUID] = Field(
        None,
        description="Label set to use for annotation.",
        validation_alias=AliasChoices("label_set_id", "labelSetId"),
    )
    reviewer_ids: Optional[List[UUID]] = Field(
        None,
        description="Reviewer IDs to assign round-robin across created tasks.",
        validation_alias=AliasChoices("reviewer_ids", "reviewerIds"),
    )
    annotator_ids: Optional[List[UUID]] = Field(
        None,
        description="Annotator IDs to use for round_robin. Defaults to all project annotators.",
        validation_alias=AliasChoices("annotator_ids", "annotatorIds"),
    )
    assignments: Optional[List[ManualAssignment]] = Field(
        None,
        description="Required for manual method. Ignored for round_robin.",
    )


class UpdateAssignmentRequest(BaseModel):
    """
    Edit an assignment group from the UI.
    - not_started: may change dataset, method, annotation_type, label_set, annotators, reviewers.
    - in_progress: may only replace annotators/reviewers, keeping the existing work chunks.
    """

    task_ids: Optional[List[UUID]] = Field(
        None,
        description="Tasks that belong to the assignment group. Optional for task-scoped endpoint.",
        validation_alias=AliasChoices("task_ids", "taskIds"),
    )
    assignment_status: Optional[str] = Field(
        None,
        description="'not_started' or 'in_progress'. Alias: status.",
        validation_alias=AliasChoices(
            "assignment_status", "assignmentStatus", "status"
        ),
    )
    dataset_id: Optional[UUID] = Field(
        None, validation_alias=AliasChoices("dataset_id", "datasetId")
    )
    method: Optional[str] = Field(
        None,
        description="'manual' or 'round_robin'. Cannot be changed once in_progress.",
        validation_alias=AliasChoices(
            "method", "assignment_method", "assignmentMethod"
        ),
    )
    annotation_type: Optional[str] = Field(
        None,
        description="'text_classification', 'ner', or 'relation_extraction'. Cannot be changed once in_progress.",
        validation_alias=AliasChoices(
            "annotation_type", "annotationType", "task_type", "taskType"
        ),
    )
    label_set_id: Optional[UUID] = Field(
        None, validation_alias=AliasChoices("label_set_id", "labelSetId")
    )
    reviewer_ids: Optional[List[UUID]] = Field(
        None, validation_alias=AliasChoices("reviewer_ids", "reviewerIds")
    )
    annotator_ids: Optional[List[UUID]] = Field(
        None,
        description="Replacement annotator list for in_progress, or round_robin annotators for todo.",
        validation_alias=AliasChoices("annotator_ids", "annotatorIds"),
    )
    assignments: Optional[List[UpdateManualAssignment]] = Field(
        None,
        description="Manual assignment rows. For in_progress only annotator_id is used.",
    )


class ReassignTaskRequest(BaseModel):
    new_assignee_id: UUID


class UpdateReviewerRequest(BaseModel):
    new_reviewer_id: Optional[UUID] = None


# ============================================================
# Task — Response
# ============================================================

class TaskSampleResponse(BaseModel):
    id: UUID
    data_sample_id: UUID
    status: str
    sample_order: int
    content: Optional[str] = None

    model_config = {"from_attributes": True}


class TaskResponse(BaseModel):
    id: UUID
    project_id: UUID
    dataset_id: UUID
    assignee_id: UUID
    assignee_name: Optional[str] = None
    assigned_by: UUID
    status: str
    assignment_status: Optional[str] = None
    task_status: Optional[str] = None
    assignment_method: str
    annotation_type: Optional[str] = None
    task_type: Optional[str] = None
    label_set_id: Optional[UUID] = None
    reviewer_id: Optional[UUID] = None
    reviewer_name: Optional[str] = None
    dataset_name: Optional[str] = None
    assigned_at: datetime
    started_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime
    sample_count: int = 0

    model_config = {"from_attributes": True}


class TaskDetailResponse(TaskResponse):
    task_samples: List[TaskSampleResponse] = []
    progress: Optional[dict] = None


class TaskListResponse(BaseModel):
    tasks: List[TaskResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AssignResultResponse(BaseModel):
    tasks_created: int
    assignments: List[TaskResponse]


class UpdateAssignmentResponse(BaseModel):
    tasks_updated: int
    assignments: List[TaskResponse]
