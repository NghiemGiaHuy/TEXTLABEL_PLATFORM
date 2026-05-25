"""
app/services/guideline_service.py
Business logic for project guidelines with auto-versioning (UC-3.4).
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.audit_log import AuditLog
from app.models.project import Guideline, Project, ProjectRole
from app.models.user import RoleName, User


class GuidelineService:
    """Manages versioned project guidelines."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # GET LATEST GUIDELINE
    # ================================================================

    async def get_latest(
        self, project_id: UUID, current_user: User
    ) -> Optional[dict]:
        """Get the latest guideline version for a project."""
        await self._check_project_access(project_id, current_user)

        result = await self.db.execute(
            select(Guideline)
            .where(Guideline.project_id == project_id)
            .order_by(Guideline.version.desc())
            .limit(1)
        )
        guideline = result.scalar_one_or_none()
        if not guideline:
            return None
        return self._build_response(guideline)

    # ================================================================
    # GET VERSION HISTORY
    # ================================================================

    async def get_history(
        self, project_id: UUID, current_user: User
    ) -> List[dict]:
        """Get all versions of the guideline, latest first."""
        await self._check_project_owner(project_id, current_user)

        result = await self.db.execute(
            select(Guideline)
            .where(Guideline.project_id == project_id)
            .order_by(Guideline.version.desc())
        )
        guidelines = result.scalars().all()
        return [self._build_response(g) for g in guidelines]

    # ================================================================
    # CREATE NEW VERSION
    # ================================================================

    async def create_version(
        self,
        project_id: UUID,
        current_user: User,
        content: str = "",
        file_url: Optional[str] = None,
    ) -> dict:
        """
        Create a new guideline version.
        Auto-increments version number per project.
        """
        await self._check_project_owner(project_id, current_user)

        # Get current max version
        result = await self.db.execute(
            select(func.max(Guideline.version)).where(
                Guideline.project_id == project_id
            )
        )
        current_max = result.scalar() or 0
        next_version = current_max + 1

        guideline = Guideline(
            project_id=project_id,
            content=content,
            file_url=file_url,
            version=next_version,
            created_by=current_user.id,
        )
        self.db.add(guideline)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="CREATE_GUIDELINE",
                entity_type="guideline",
                entity_id=project_id,
                details={"version": next_version},
            )
        )
        await self.db.flush()

        return self._build_response(guideline)

    # ================================================================
    # Access Control Helpers
    # ================================================================

    async def _check_project_access(
        self, project_id: UUID, user: User
    ) -> Project:
        """Any project member or admin can view guideline."""
        project = await self._get_project_or_404(project_id)
        if RoleName.ADMIN.value in user.role_names:
            return project
        member_ids = {m.user_id for m in project.members}
        if user.id not in member_ids:
            raise ForbiddenException("You don't have access to this project")
        return project

    async def _check_project_owner(
        self, project_id: UUID, user: User
    ) -> Project:
        project = await self._get_project_or_404(project_id)
        if RoleName.ADMIN.value in user.role_names:
            return project
        for m in project.members:
            if (
                m.user_id == user.id
                and m.role_in_project == ProjectRole.PROJECT_OWNER
            ):
                return project
        raise ForbiddenException(
            "Only project owners or admin can modify guidelines"
        )

    async def _get_project_or_404(self, project_id: UUID) -> Project:
        result = await self.db.execute(
            select(Project)
            .options(selectinload(Project.members))
            .where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise NotFoundException(f"Project '{project_id}' not found")
        return project

    def _build_response(self, g: Guideline) -> dict:
        return {
            "id": g.id,
            "project_id": g.project_id,
            "content": g.content,
            "file_url": g.file_url,
            "version": g.version,
            "created_by": g.created_by,
            "created_at": g.created_at,
        }