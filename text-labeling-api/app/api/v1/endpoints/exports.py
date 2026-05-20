"""
app/api/v1/endpoints/exports.py
Export endpoints (UC-6.1).

Endpoints:
  POST   /projects/{id}/exports                — Create export
  GET    /projects/{id}/exports                — List exports
  GET    /projects/{id}/exports/{eid}          — Export detail
  GET    /projects/{id}/exports/{eid}/download — Download export data
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import require_roles
from app.models.user import RoleName, User
from app.schemas.export import (
    CreateExportRequest,
    ExportDownloadResponse,
    ExportListResponse,
    ExportResponse,
)
from app.services.export_service import ExportService

router = APIRouter(prefix="/projects/{project_id}", tags=["Exports"])

AdminOrPO = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))


# ================================================================
# POST /projects/{project_id}/exports (UC-6.1)
# ================================================================
@router.post("/exports", response_model=ExportResponse, status_code=201)
async def create_export(
    project_id: UUID,
    body: CreateExportRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a data export.
    Generates JSON/JSONL/CSV file from approved (or all) annotations.
    """
    service = ExportService(db)
    return await service.create_export(
        project_id=project_id,
        current_user=current_user,
        format=body.format,
        filter_status=body.filter_status,
        dataset_id=body.dataset_id,
        include_metadata=body.include_metadata,
    )


# ================================================================
# GET /projects/{project_id}/exports
# ================================================================
@router.get("/exports", response_model=ExportListResponse)
async def list_exports(
    project_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """List all exports for a project."""
    service = ExportService(db)
    exports = await service.list_exports(project_id, current_user)
    return {"exports": exports}


# ================================================================
# GET /projects/{project_id}/exports/{export_id}
# ================================================================
@router.get("/exports/{export_id}", response_model=ExportResponse)
async def get_export(
    project_id: UUID,
    export_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Get export detail and metadata."""
    service = ExportService(db)
    return await service.get_export(project_id, export_id, current_user)


# ================================================================
# GET /projects/{project_id}/exports/{export_id}/download
# ================================================================
@router.get(
    "/exports/{export_id}/download",
    response_model=ExportDownloadResponse,
)
async def download_export(
    project_id: UUID,
    export_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Download export data (JSON response with full dataset)."""
    service = ExportService(db)
    return await service.get_export_data(
        project_id, export_id, current_user
    )


# ================================================================
# DELETE /projects/{project_id}/exports/{export_id}
# ================================================================
@router.delete("/exports/{export_id}", status_code=204)
async def delete_export(
    project_id: UUID,
    export_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Delete an export record (and its file if present)."""
    service = ExportService(db)
    await service.delete_export(project_id, export_id, current_user)
    return Response(status_code=204)