"""
app/api/v1/endpoints/annotations.py
Annotation endpoints for annotators (UC-4.x).

Endpoints:
  GET    /annotations/my-tasks              — Annotator's task list
  POST   /annotations/tasks/{id}/start      — Start a task
  POST   /annotations/tasks/{id}/submit     — Submit for review
  GET    /annotations/tasks/{t}/samples/{s} — Get sample for annotation
  POST   /annotations/tasks/{t}/samples/{s}/annotations      — Create
  PUT    /annotations/tasks/{t}/samples/{s}/annotations/{a}  — Update
  DELETE /annotations/tasks/{t}/samples/{s}/annotations/{a}  — Delete
  PUT    /annotations/tasks/{t}/samples/{s}/annotations/bulk — Bulk replace
  PUT    /annotations/tasks/{t}/samples/{s}/draft            — Save draft
  GET    /annotations/tasks/{t}/samples/{s}/draft            — Get draft
  GET    /annotations/tasks/{t}/samples/{s}/adjacent         — Prev/Next
  GET    /annotations/my-stats                               — Stats
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.annotation import (
    AdjacentSamplesResponse,
    AnnotationResponse,
    AnnotationSampleResponse,
    BulkAnnotationsRequest,
    CreateAnnotationRequest,
    DraftResponse,
    MyStatsResponse,
    MyTaskListResponse,
    SaveDraftRequest,
    UpdateAnnotationRequest,
)
from app.schemas.auth import MessageResponse
from app.services.annotation_service import AnnotationService

router = APIRouter(prefix="/annotations", tags=["Annotations"])

AnnotatorRole = Depends(
    require_roles(RoleName.ANNOTATOR, RoleName.ADMIN)
)


# ================================================================
# MY TASKS (UC-4.1)
# ================================================================
@router.get("/my-tasks", response_model=MyTaskListResponse)
async def my_tasks(
    project_id: UUID = Query(None),
    status: str = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """List tasks assigned to the current annotator."""
    service = AnnotationService(db)
    return await service.my_tasks(
        current_user=current_user,
        project_id=project_id,
        status=status,
        page=page,
        page_size=page_size,
    )


# ================================================================
# START TASK (UC-4.1 — step 5)
# ================================================================
@router.post("/tasks/{task_id}/start")
async def start_task(
    task_id: UUID,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Mark task as in_progress. Only from 'todo' status."""
    service = AnnotationService(db)
    return await service.start_task(task_id, current_user)


# ================================================================
# SUBMIT TASK (UC-4.2 — step 7)
# ================================================================
@router.post("/tasks/{task_id}/submit")
async def submit_task(
    task_id: UUID,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Submit task for review. Validates required labels."""
    service = AnnotationService(db)
    return await service.submit_task(task_id, current_user)


# ================================================================
# REJECTION FEEDBACK (for annotator rework view)
# ================================================================
@router.get("/tasks/{task_id}/rejection-feedback")
async def get_rejection_feedback(
    task_id: UUID,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Get latest rejection feedback per sample for annotator rework."""
    service = AnnotationService(db)
    return await service.get_rejection_feedback(task_id, current_user)


# ================================================================
# GET SAMPLE (UC-4.2 — step 1)
# ================================================================
@router.get(
    "/tasks/{task_id}/samples/{task_sample_id}",
    response_model=AnnotationSampleResponse,
)
async def get_sample(
    task_id: UUID,
    task_sample_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full sample data for annotation UI."""
    service = AnnotationService(db)
    return await service.get_sample(task_id, task_sample_id, current_user)


@router.get(
    "/tasks/{task_id}/samples/{task_sample_id}/entities",
    response_model=list[AnnotationResponse],
)
async def get_sample_entities(
    task_id: UUID,
    task_sample_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get NER entities for relation extraction on this sample."""
    service = AnnotationService(db)
    return await service.get_sample_entities(task_id, task_sample_id, current_user)


# ================================================================
# CREATE ANNOTATION (UC-4.2 — step 3)
# ================================================================
@router.post(
    "/tasks/{task_id}/samples/{task_sample_id}/annotations",
    response_model=AnnotationResponse,
    status_code=201,
)
async def create_annotation(
    task_id: UUID,
    task_sample_id: UUID,
    body: CreateAnnotationRequest,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Create a new annotation on a text span."""
    service = AnnotationService(db)
    return await service.create_annotation(
        task_id=task_id,
        task_sample_id=task_sample_id,
        current_user=current_user,
        label_id=body.label_id,
        start_offset=body.start_offset,
        end_offset=body.end_offset,
        selected_text=body.selected_text,
    )


# ================================================================
# UPDATE ANNOTATION (UC-4.2 — step 5)
# ================================================================
@router.put(
    "/tasks/{task_id}/samples/{task_sample_id}/annotations/{annotation_id}",
    response_model=AnnotationResponse,
)
async def update_annotation(
    task_id: UUID,
    task_sample_id: UUID,
    annotation_id: UUID,
    body: UpdateAnnotationRequest,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    service = AnnotationService(db)
    return await service.update_annotation(
        task_id=task_id,
        task_sample_id=task_sample_id,
        annotation_id=annotation_id,
        current_user=current_user,
        **body.model_dump(exclude_unset=True),
    )


# ================================================================
# DELETE ANNOTATION (UC-4.2 — step 5)
# ================================================================
@router.delete(
    "/tasks/{task_id}/samples/{task_sample_id}/annotations/{annotation_id}",
    status_code=204,
)
async def delete_annotation(
    task_id: UUID,
    task_sample_id: UUID,
    annotation_id: UUID,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    service = AnnotationService(db)
    await service.delete_annotation(
        task_id, task_sample_id, annotation_id, current_user
    )


# ================================================================
# BULK UPDATE (UC-4.2 — A1 undo/redo)
# ================================================================
@router.put(
    "/tasks/{task_id}/samples/{task_sample_id}/annotations/bulk",
    response_model=list[AnnotationResponse],
)
async def bulk_update_annotations(
    task_id: UUID,
    task_sample_id: UUID,
    body: BulkAnnotationsRequest,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Replace all annotations for a sample (full state replacement)."""
    service = AnnotationService(db)
    return await service.bulk_update_annotations(
        task_id=task_id,
        task_sample_id=task_sample_id,
        current_user=current_user,
        annotations_data=[a.model_dump() for a in body.annotations],
    )


# ================================================================
# MARK SAMPLE STATUS (annotator done/undone toggle)
# ================================================================
@router.patch(
    "/tasks/{task_id}/samples/{task_sample_id}/status",
)
async def mark_sample_status(
    task_id: UUID,
    task_sample_id: UUID,
    body: dict,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Toggle sample status between 'annotated' and 'done'."""
    service = AnnotationService(db)
    return await service.mark_sample_status(
        task_id=task_id,
        task_sample_id=task_sample_id,
        current_user=current_user,
        status=body.get("status", "annotated"),
    )


# ================================================================
# SAVE DRAFT (NF-09 auto-save)
# ================================================================
@router.put(
    "/tasks/{task_id}/samples/{task_sample_id}/draft",
    response_model=DraftResponse,
)
async def save_draft(
    task_id: UUID,
    task_sample_id: UUID,
    body: SaveDraftRequest,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Upsert annotation draft (auto-save every 30s)."""
    service = AnnotationService(db)
    return await service.save_draft(
        task_id, task_sample_id, current_user, body.draft_data
    )


@router.get(
    "/tasks/{task_id}/samples/{task_sample_id}/draft",
)
async def get_draft(
    task_id: UUID,
    task_sample_id: UUID,
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Get saved draft for a sample."""
    service = AnnotationService(db)
    draft = await service.get_draft(task_id, task_sample_id, current_user)
    if not draft:
        return None
    return draft


# ================================================================
# NAVIGATE (UC-4.2 — A2)
# ================================================================
@router.get(
    "/tasks/{task_id}/samples/{task_sample_id}/adjacent",
    response_model=AdjacentSamplesResponse,
)
async def get_adjacent(
    task_id: UUID,
    task_sample_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get previous/next sample IDs for navigation."""
    service = AnnotationService(db)
    return await service.get_adjacent(
        task_id, task_sample_id, current_user
    )


# ================================================================
# MY STATS (UC-4.3)
# ================================================================
@router.get("/my-stats", response_model=MyStatsResponse)
async def my_stats(
    project_id: UUID = Query(None),
    current_user: User = AnnotatorRole,
    db: AsyncSession = Depends(get_db),
):
    """Get personal annotation statistics."""
    service = AnnotationService(db)
    return await service.my_stats(current_user, project_id)
