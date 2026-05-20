"""
app/api/v1/endpoints/datasets.py
Dataset import and management endpoints (UC-3.3).
Nested under /projects/{project_id}/datasets.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.auth import MessageResponse
from app.schemas.dataset import (
    CreateDatasetRequest,
    DatasetDetailResponse,
    DatasetListResponse,
    DatasetResponse,
    ImportResultResponse,
    SampleListResponse,
)
from app.services.dataset_service import DatasetService

router = APIRouter(
    prefix="/projects/{project_id}", tags=["Datasets"]
)

AdminOrPO = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))


# ================================================================
# POST /projects/{project_id}/datasets/import (UC-3.3)
# ================================================================
@router.post(
    "/datasets/import",
    response_model=ImportResultResponse,
    status_code=201,
)
async def import_dataset(
    project_id: UUID,
    body: CreateDatasetRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Import a dataset with inline samples.
    Creates the Dataset record and bulk-inserts DataSample records.
    Returns import result with success/error counts.
    """
    service = DatasetService(db)
    samples_data = [
        {
            "content": s.content,
            "metadata_": s.metadata_,
        }
        for s in body.samples
    ]
    return await service.import_dataset(
        project_id=project_id,
        current_user=current_user,
        name=body.name,
        source_format=body.source_format,
        samples=samples_data,
        field_mapping=body.field_mapping,
    )


# ================================================================
# GET /projects/{project_id}/datasets
# ================================================================
@router.get("/datasets", response_model=DatasetListResponse)
async def list_datasets(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all datasets in a project."""
    service = DatasetService(db)
    datasets = await service.list_datasets(project_id, current_user)
    return {"datasets": datasets}


# ================================================================
# GET /projects/{project_id}/datasets/{dataset_id}
# ================================================================
@router.get(
    "/datasets/{dataset_id}", response_model=DatasetDetailResponse
)
async def get_dataset(
    project_id: UUID,
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get dataset detail."""
    service = DatasetService(db)
    return await service.get_dataset(project_id, dataset_id, current_user)


# ================================================================
# GET /projects/{project_id}/datasets/{dataset_id}/samples
# ================================================================
@router.get(
    "/datasets/{dataset_id}/samples",
    response_model=SampleListResponse,
)
async def list_samples(
    project_id: UUID,
    dataset_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List samples in a dataset (paginated)."""
    service = DatasetService(db)
    return await service.list_samples(
        project_id=project_id,
        dataset_id=dataset_id,
        current_user=current_user,
        page=page,
        page_size=page_size,
    )


# ================================================================
# DELETE /projects/{project_id}/datasets/{dataset_id}
# ================================================================
@router.delete(
    "/datasets/{dataset_id}", response_model=MessageResponse
)
async def delete_dataset(
    project_id: UUID,
    dataset_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a dataset. Blocked if it has tasks assigned (409).
    """
    service = DatasetService(db)
    await service.delete_dataset(project_id, dataset_id, current_user)
    return MessageResponse(message="Dataset deleted successfully")