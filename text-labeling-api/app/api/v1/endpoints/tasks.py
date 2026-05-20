"""
app/api/v1/endpoints/tasks.py
Task assignment and management endpoints (UC-3.5).
Nested under /projects/{project_id}/tasks.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.auth import MessageResponse
from app.schemas.task import (
    AssignResultResponse,
    AssignTasksRequest,
    ReassignTaskRequest,
    TaskDetailResponse,
    TaskListResponse,
    TaskResponse,
    UpdateAssignmentRequest,
    UpdateAssignmentResponse,
    UpdateReviewerRequest,
)
from app.services.task_service import TaskService

router = APIRouter(
    prefix="/projects/{project_id}", tags=["Tasks"]
)

AdminOrPO = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))


# ================================================================
# POST /projects/{project_id}/tasks/assign (UC-3.5)
# ================================================================
@router.post(
    "/tasks/assign",
    response_model=AssignResultResponse,
    status_code=201,
)
async def assign_tasks(
    project_id: UUID,
    body: AssignTasksRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Create tasks and assign samples to annotators.

    Method 'manual': provide assignments list with annotator_id + sample_count.
    Method 'round_robin': splits unassigned samples across selected annotators,
    or all project annotators when annotator_ids is omitted.
    """
    service = TaskService(db)
    assignments_data = None
    if body.assignments:
        assignments_data = [
            {
                "annotator_id": a.annotator_id,
                "sample_count": a.sample_count,
            }
            for a in body.assignments
        ]
    return await service.assign_tasks(
        project_id=project_id,
        current_user=current_user,
        dataset_id=body.dataset_id,
        method=body.method,
        assignments=assignments_data,
        annotation_type=body.annotation_type,
        label_set_id=str(body.label_set_id) if body.label_set_id else None,
        reviewer_ids=[str(r) for r in body.reviewer_ids] if body.reviewer_ids else None,
        annotator_ids=[str(a) for a in body.annotator_ids] if body.annotator_ids else None,
    )


# ================================================================
# PUT /projects/{project_id}/tasks/assignments
# ================================================================
@router.put(
    "/tasks/assignments",
    response_model=UpdateAssignmentResponse,
)
async def update_assignment(
    project_id: UUID,
    body: UpdateAssignmentRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Edit an assignment group.

    For 'not_started' assignments the whole configuration can be changed.
    For 'in_progress' assignments only annotators/reviewers can be replaced, and
    the existing task samples stay attached to the same task chunks.
    """
    service = TaskService(db)
    assignments_data = None
    if body.assignments:
        assignments_data = [
            {
                "annotator_id": a.annotator_id,
                "sample_count": a.sample_count,
            }
            for a in body.assignments
        ]
    return await service.update_assignment(
        project_id=project_id,
        current_user=current_user,
        task_ids=body.task_ids,
        assignment_status=body.assignment_status,
        dataset_id=body.dataset_id,
        method=body.method,
        assignments=assignments_data,
        annotation_type=body.annotation_type,
        label_set_id=str(body.label_set_id) if body.label_set_id else None,
        reviewer_ids=(
            [str(r) for r in body.reviewer_ids]
            if body.reviewer_ids is not None
            else None
        ),
        annotator_ids=(
            [str(a) for a in body.annotator_ids]
            if body.annotator_ids is not None
            else None
        ),
        provided_fields=body.model_fields_set,
    )


# ================================================================
# GET /projects/{project_id}/tasks
# ================================================================
@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(
    project_id: UUID,
    status: str = Query(None, description="Filter: todo, in_progress, submitted, etc."),
    assignee_id: UUID = Query(None, description="Filter by annotator"),
    dataset_id: UUID = Query(None, description="Filter by dataset"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List tasks in a project with optional filters."""
    service = TaskService(db)
    return await service.list_tasks(
        project_id=project_id,
        current_user=current_user,
        status=status,
        assignee_id=assignee_id,
        dataset_id=dataset_id,
        page=page,
        page_size=page_size,
    )


# ================================================================
# GET /projects/{project_id}/tasks/{task_id}
# ================================================================
@router.get(
    "/tasks/{task_id}", response_model=TaskDetailResponse
)
async def get_task(
    project_id: UUID,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get task detail including samples and progress."""
    service = TaskService(db)
    return await service.get_task(project_id, task_id, current_user)


# ================================================================
# PUT /projects/{project_id}/tasks/{task_id}/assignment
# ================================================================
@router.put(
    "/tasks/{task_id}/assignment", response_model=UpdateAssignmentResponse
)
async def update_assignment_by_task(
    project_id: UUID,
    task_id: UUID,
    body: UpdateAssignmentRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Edit an assignment group using one task as the scope anchor.
    If body.task_ids is omitted, sibling tasks with the same assignment
    configuration are updated together.
    """
    service = TaskService(db)
    assignments_data = None
    if body.assignments:
        assignments_data = [
            {
                "annotator_id": a.annotator_id,
                "sample_count": a.sample_count,
            }
            for a in body.assignments
        ]
    return await service.update_assignment(
        project_id=project_id,
        current_user=current_user,
        task_ids=body.task_ids,
        source_task_id=task_id,
        assignment_status=body.assignment_status,
        dataset_id=body.dataset_id,
        method=body.method,
        assignments=assignments_data,
        annotation_type=body.annotation_type,
        label_set_id=str(body.label_set_id) if body.label_set_id else None,
        reviewer_ids=(
            [str(r) for r in body.reviewer_ids]
            if body.reviewer_ids is not None
            else None
        ),
        annotator_ids=(
            [str(a) for a in body.annotator_ids]
            if body.annotator_ids is not None
            else None
        ),
        provided_fields=body.model_fields_set,
    )


# ================================================================
# PUT /projects/{project_id}/tasks/{task_id}/reassign
# ================================================================
@router.put(
    "/tasks/{task_id}/reassign", response_model=TaskResponse
)
async def reassign_task(
    project_id: UUID,
    task_id: UUID,
    body: ReassignTaskRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Re-assign a task to a different annotator.
    Allowed for tasks with 'todo' or 'in_progress' status.
    """
    service = TaskService(db)
    return await service.reassign_task(
        project_id=project_id,
        task_id=task_id,
        current_user=current_user,
        new_assignee_id=body.new_assignee_id,
    )


# ================================================================
# PUT /projects/{project_id}/tasks/{task_id}/update-reviewer
# ================================================================
@router.put(
    "/tasks/{task_id}/update-reviewer", response_model=TaskResponse
)
async def update_task_reviewer(
    project_id: UUID,
    task_id: UUID,
    body: UpdateReviewerRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Update the reviewer of a task.
    Pass new_reviewer_id=null to allow any reviewer.
    Not allowed for tasks in APPROVED or REJECTED status.
    """
    service = TaskService(db)
    return await service.update_reviewer(
        project_id=project_id,
        task_id=task_id,
        current_user=current_user,
        new_reviewer_id=body.new_reviewer_id,
    )


# ================================================================
# DELETE /projects/{project_id}/tasks/{task_id}
# ================================================================
@router.delete(
    "/tasks/{task_id}", response_model=MessageResponse
)
async def delete_task(
    project_id: UUID,
    task_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete an assignment task.
    Only allowed for tasks with 'todo' status.
    """
    service = TaskService(db)
    await service.delete_task(
        project_id=project_id,
        task_id=task_id,
        current_user=current_user,
    )
    return MessageResponse(message="Task deleted successfully")
