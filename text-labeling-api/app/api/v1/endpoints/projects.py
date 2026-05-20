"""
app/api/v1/endpoints/projects.py
Project CRUD and member management endpoints (UC-3.1).

Role requirements:
- CRUD operations: Admin or Project Owner
- Member ops: Project Owner (of that project) or Admin
- List/detail: any authenticated user (scoped by access)
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User
from app.schemas.auth import MessageResponse
from app.schemas.project import (
    AddMemberRequest,
    CreateProjectRequest,
    MemberListResponse,
    ProjectListResponse,
    ProjectMemberResponse,
    ProjectResponse,
    UpdateMemberRequest,
    UpdateProjectRequest,
)
from app.services.project_service import ProjectService

router = APIRouter(prefix="/projects", tags=["Projects"])

# Shared dependency: create/update requires Admin or PO
AdminOrPO = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))


# ================================================================
# GET /projects (UC-3.1 — list)
# ================================================================
@router.get("", response_model=ProjectListResponse)
async def list_projects(
    search: str = Query(None, max_length=100),
    status: str = Query(None, description="draft, active, completed, archived"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List projects. Admin sees all, others see only their projects.
    """
    service = ProjectService(db)
    return await service.list_projects(
        current_user=current_user,
        search=search,
        status=status,
        page=page,
        page_size=page_size,
    )


# ================================================================
# POST /projects (UC-3.1 — create)
# ================================================================
@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    body: CreateProjectRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Create a new project. Creator automatically becomes project_owner."""
    service = ProjectService(db)
    return await service.create_project(
        current_user=current_user,
        code=body.code,
        name=body.name,
        description=body.description,
        objective=body.objective,
        priority=body.priority,
        deadline=body.deadline,
    )


# ================================================================
# GET /projects/{project_id} (UC-3.1 — detail)
# ================================================================
@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get project detail. Requires access (admin or member)."""
    service = ProjectService(db)
    return await service.get_project(project_id, current_user)


# ================================================================
# PUT /projects/{project_id} (UC-3.1 — A1)
# ================================================================
@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    body: UpdateProjectRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Update project. Only project_owner or Admin."""
    service = ProjectService(db)
    return await service.update_project(
        project_id=project_id,
        current_user=current_user,
        name=body.name,
        description=body.description,
        objective=body.objective,
        priority=body.priority,
        deadline=body.deadline,
        status=body.status,
    )


# ================================================================
# DELETE /projects/{project_id} (UC-3.1 — A3)
# ================================================================
@router.delete("/{project_id}", response_model=MessageResponse)
async def delete_project(
    project_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Delete a project. Only allowed for Draft projects."""
    service = ProjectService(db)
    await service.delete_project(project_id, current_user)
    return MessageResponse(message="Project deleted successfully")


# ================================================================
# POST /projects/{project_id}/archive (UC-3.1 — A2)
# ================================================================
@router.post("/{project_id}/archive", response_model=ProjectResponse)
async def archive_project(
    project_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Archive a project (read-only)."""
    service = ProjectService(db)
    return await service.archive_project(project_id, current_user)


# ================================================================
# Member Management
# ================================================================

@router.get("/{project_id}/members", response_model=MemberListResponse)
async def list_members(
    project_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all members of a project."""
    service = ProjectService(db)
    members = await service.list_members(project_id, current_user)
    return {"members": members}


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=201,
)
async def add_member(
    project_id: UUID,
    body: AddMemberRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Add a user to the project with a specific role."""
    service = ProjectService(db)
    return await service.add_member(
        project_id=project_id,
        current_user=current_user,
        user_id=body.user_id,
        role_in_project=body.role_in_project,
    )


@router.put(
    "/{project_id}/members/{user_id}",
    response_model=ProjectMemberResponse,
)
async def update_member(
    project_id: UUID,
    user_id: UUID,
    body: UpdateMemberRequest,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Change a member's role within the project."""
    service = ProjectService(db)
    return await service.update_member(
        project_id=project_id,
        current_user=current_user,
        user_id=user_id,
        role_in_project=body.role_in_project,
    )


@router.delete(
    "/{project_id}/members/{user_id}",
    response_model=MessageResponse,
)
async def remove_member(
    project_id: UUID,
    user_id: UUID,
    current_user: User = AdminOrPO,
    db: AsyncSession = Depends(get_db),
):
    """Remove a member from the project."""
    service = ProjectService(db)
    await service.remove_member(
        project_id=project_id,
        current_user=current_user,
        user_id=user_id,
    )
    return MessageResponse(message="Member removed from project")