"""
app/api/v1/endpoints/guidelines.py
Nested endpoints for project guidelines (UC-3.4).

All paths are prefixed: /projects/{project_id}/guidelines
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.guideline import (
    CreateGuidelineRequest,
    GuidelineHistoryResponse,
    GuidelineResponse,
)
from app.services.guideline_service import GuidelineService

router = APIRouter(prefix="/projects/{project_id}", tags=["Guidelines"])

AdminOrPO = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))


# ================================================================
# GET /projects/{project_id}/guidelines (UC-3.4)
# ================================================================
@router.get("/guidelines", response_model=GuidelineResponse)
async def get_latest_guideline(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the latest guideline for a project.
    Any member or admin can view.
    """
    service = GuidelineService(db)
    guideline = await service.get_latest(project_id, current_user)
    if not guideline:
        raise HTTPException(
            status_code=404,
            detail="No guideline has been created for this project yet",
        )
    return guideline


# ================================================================
# GET /projects/{project_id}/guidelines/history
# ================================================================
@router.get(
    "/guidelines/history", response_model=GuidelineHistoryResponse
)
async def get_guideline_history(
    project_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Get all versions of the guideline. PO/Admin only.
    """
    service = GuidelineService(db)
    guidelines = await service.get_history(project_id, current_user)
    return {"guidelines": guidelines}


# ================================================================
# POST /projects/{project_id}/guidelines
# ================================================================
@router.post(
    "/guidelines", response_model=GuidelineResponse, status_code=201
)
async def create_guideline_version(
    project_id: UUID,
    body: CreateGuidelineRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new guideline version.
    Version number auto-increments per project.
    """
    service = GuidelineService(db)
    return await service.create_version(
        project_id=project_id,
        current_user=current_user,
        content=body.content,
        file_url=body.file_url,
    )