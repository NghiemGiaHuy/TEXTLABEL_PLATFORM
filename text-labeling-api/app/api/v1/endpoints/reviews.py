"""
app/api/v1/endpoints/reviews.py
Review & QA endpoints (UC-5.1).

Endpoints:
  GET    /reviews/queue                              — Review queue
  GET    /reviews/tasks/{t}/samples/{s}              — Sample detail for review
  POST   /reviews/tasks/{t}/samples/{s}/approve      — Approve
  POST   /reviews/tasks/{t}/samples/{s}/reject       — Reject
  GET    /reviews/my-stats                           — Reviewer stats
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.review import (
    ApproveRequest,
    RejectRequest,
    ReviewQueueResponse,
    ReviewResponse,
    ReviewSampleDetailResponse,
    ReviewSubmitResponse,
    ReviewerStatsResponse,
)
from app.services.review_service import ReviewService

router = APIRouter(prefix="/reviews", tags=["Reviews & QA"])

ReviewerRole = Depends(
    require_roles(RoleName.REVIEWER, RoleName.ADMIN)
)


# ================================================================
# REVIEW QUEUE (UC-5.1 — step 1)
# ================================================================
@router.get("/queue", response_model=ReviewQueueResponse)
async def get_review_queue(
    project_id: UUID = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = ReviewerRole,
    db: AsyncSession = Depends(get_db),
):
    """
    Get submitted samples awaiting review.
    Scoped to projects where the user is a reviewer (or all for admin).
    """
    service = ReviewService(db)
    return await service.get_queue(
        current_user=current_user,
        project_id=project_id,
        page=page,
        page_size=page_size,
    )


# ================================================================
# GET SAMPLE FOR REVIEW (UC-5.1 — step 2-3)
# ================================================================
@router.get(
    "/tasks/{task_id}/samples/{task_sample_id}",
    response_model=ReviewSampleDetailResponse,
)
async def get_review_sample(
    task_id: UUID,
    task_sample_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get full sample with annotations for review.
    Includes annotation data, annotator info, and review history.
    """
    service = ReviewService(db)
    return await service.get_review_sample(
        task_id, task_sample_id, current_user
    )


# ================================================================
# APPROVE (UC-5.1 — step 6a)
# ================================================================
@router.post(
    "/tasks/{task_id}/samples/{task_sample_id}/approve",
    response_model=ReviewResponse,
)
async def approve_sample(
    task_id: UUID,
    task_sample_id: UUID,
    body: ApproveRequest,
    current_user: User = ReviewerRole,
    db: AsyncSession = Depends(get_db),
):
    """
    Approve a submitted sample.
    If all samples in the task are approved, the task is marked approved.
    """
    service = ReviewService(db)
    return await service.approve(
        task_id=task_id,
        task_sample_id=task_sample_id,
        current_user=current_user,
        feedback=body.feedback,
    )


# ================================================================
# REJECT (UC-5.1 — step 6b)
# ================================================================
@router.post(
    "/tasks/{task_id}/samples/{task_sample_id}/reject",
    response_model=ReviewResponse,
)
async def reject_sample(
    task_id: UUID,
    task_sample_id: UUID,
    body: RejectRequest,
    current_user: User = ReviewerRole,
    db: AsyncSession = Depends(get_db),
):
    """
    Reject a submitted sample with mandatory feedback.
    Task is moved to 'rework' status. Annotator sees the feedback.
    """
    service = ReviewService(db)
    return await service.reject(
        task_id=task_id,
        task_sample_id=task_sample_id,
        current_user=current_user,
        feedback=body.feedback,
    )


# ================================================================
# DELETE REVIEW DECISION
# ================================================================
@router.delete(
    "/tasks/{task_id}/samples/{task_sample_id}",
    status_code=204,
)
async def delete_review(
    task_id: UUID,
    task_sample_id: UUID,
    current_user: User = ReviewerRole,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete the latest decision for a sample before the task review is
    submitted, then return the sample to the review queue.
    """
    service = ReviewService(db)
    await service.delete_review(
        task_id=task_id,
        task_sample_id=task_sample_id,
        current_user=current_user,
    )


# ================================================================
# SUBMIT REVIEW (task-level final decision)
# ================================================================
@router.post(
    "/tasks/{task_id}/submit",
    response_model=ReviewSubmitResponse,
)
async def submit_review(
    task_id: UUID,
    current_user: User = ReviewerRole,
    db: AsyncSession = Depends(get_db),
):
    """
    Finalize review for a task.
    If at least one sample is rejected, the task returns to annotator rework.
    If every sample is approved, the task is completed.
    """
    service = ReviewService(db)
    return await service.submit_review(
        task_id=task_id,
        current_user=current_user,
    )


# ================================================================
# REVIEWER STATS
# ================================================================
@router.get("/my-stats", response_model=ReviewerStatsResponse)
async def reviewer_stats(
    current_user: User = ReviewerRole,
    db: AsyncSession = Depends(get_db),
):
    """Get personal review statistics."""
    service = ReviewService(db)
    return await service.my_stats(current_user)
