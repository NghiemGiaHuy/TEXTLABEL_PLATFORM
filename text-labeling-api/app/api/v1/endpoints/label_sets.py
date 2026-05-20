"""
app/api/v1/endpoints/label_sets.py
Nested endpoints for LabelSet, LabelGroup, Label under a project (UC-3.2).

All paths are prefixed: /projects/{project_id}/label-sets
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.auth import MessageResponse
from app.schemas.label import (
    CreateLabelGroupRequest,
    CreateLabelRequest,
    CreateLabelSetRequest,
    LabelGroupResponse,
    LabelResponse,
    LabelSetListResponse,
    LabelSetResponse,
    UpdateLabelGroupRequest,
    UpdateLabelRequest,
    UpdateLabelSetRequest,
)
from app.services.label_service import LabelService

router = APIRouter(prefix="/projects/{project_id}", tags=["Label Sets"])

AdminOrPO = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))


# ================================================================
# LABEL SETS
# ================================================================

@router.get("/label-sets", response_model=LabelSetListResponse)
async def list_label_sets(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all label sets in a project. Any member or admin can view."""
    service = LabelService(db)
    label_sets = await service.list_label_sets(project_id, current_user)
    return {"label_sets": label_sets}


@router.post(
    "/label-sets", response_model=LabelSetResponse, status_code=201
)
async def create_label_set(
    project_id: UUID,
    body: CreateLabelSetRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Create a new label set in the project."""
    service = LabelService(db)
    return await service.create_label_set(
        project_id=project_id, current_user=current_user, name=body.name
    )


@router.put(
    "/label-sets/{label_set_id}", response_model=LabelSetResponse
)
async def update_label_set(
    project_id: UUID,
    label_set_id: UUID,
    body: UpdateLabelSetRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    return await service.update_label_set(
        project_id=project_id,
        label_set_id=label_set_id,
        current_user=current_user,
        name=body.name,
    )


@router.delete(
    "/label-sets/{label_set_id}", response_model=MessageResponse
)
async def delete_label_set(
    project_id: UUID,
    label_set_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    await service.delete_label_set(
        project_id=project_id,
        label_set_id=label_set_id,
        current_user=current_user,
    )
    return MessageResponse(message="Label set deleted")


# ================================================================
# LABEL GROUPS (nested under label set)
# ================================================================

@router.post(
    "/label-sets/{label_set_id}/groups",
    response_model=LabelGroupResponse,
    status_code=201,
)
async def create_group(
    project_id: UUID,
    label_set_id: UUID,
    body: CreateLabelGroupRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    return await service.create_group(
        project_id=project_id,
        label_set_id=label_set_id,
        current_user=current_user,
        name=body.name,
        sort_order=body.sort_order,
    )


@router.put(
    "/label-sets/{label_set_id}/groups/{group_id}",
    response_model=LabelGroupResponse,
)
async def update_group(
    project_id: UUID,
    label_set_id: UUID,
    group_id: UUID,
    body: UpdateLabelGroupRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    return await service.update_group(
        project_id=project_id,
        label_set_id=label_set_id,
        group_id=group_id,
        current_user=current_user,
        name=body.name,
        sort_order=body.sort_order,
    )


@router.delete(
    "/label-sets/{label_set_id}/groups/{group_id}",
    response_model=MessageResponse,
)
async def delete_group(
    project_id: UUID,
    label_set_id: UUID,
    group_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    await service.delete_group(
        project_id=project_id,
        label_set_id=label_set_id,
        group_id=group_id,
        current_user=current_user,
    )
    return MessageResponse(message="Label group deleted")


# ================================================================
# LABELS (nested under label set)
# ================================================================

@router.post(
    "/label-sets/{label_set_id}/labels",
    response_model=LabelResponse,
    status_code=201,
)
async def create_label(
    project_id: UUID,
    label_set_id: UUID,
    body: CreateLabelRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Add a new label to a label set."""
    service = LabelService(db)
    return await service.create_label(
        project_id=project_id,
        label_set_id=label_set_id,
        current_user=current_user,
        name=body.name,
        color=body.color,
        shortcut_key=body.shortcut_key,
        sort_order=body.sort_order,
        is_required=body.is_required,
        label_group_id=body.label_group_id,
    )


@router.put(
    "/label-sets/{label_set_id}/labels/{label_id}",
    response_model=LabelResponse,
)
async def update_label(
    project_id: UUID,
    label_set_id: UUID,
    label_id: UUID,
    body: UpdateLabelRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    return await service.update_label(
        project_id=project_id,
        label_set_id=label_set_id,
        label_id=label_id,
        current_user=current_user,
        **body.model_dump(exclude_unset=True),
    )


@router.delete(
    "/label-sets/{label_set_id}/labels/{label_id}",
    response_model=MessageResponse,
)
async def delete_label(
    project_id: UUID,
    label_set_id: UUID,
    label_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    service = LabelService(db)
    await service.delete_label(
        project_id=project_id,
        label_set_id=label_set_id,
        label_id=label_id,
        current_user=current_user,
    )
    return MessageResponse(message="Label deleted")