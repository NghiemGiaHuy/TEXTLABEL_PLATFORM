"""
app/services/project_service.py
Business logic for Project CRUD and ProjectMember management (UC-3.1).
"""

import math
import secrets
import string
from types import SimpleNamespace
from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.task import Task, TaskSample, TaskSampleStatus
from app.models.annotation import Annotation
from app.models.dataset import Dataset
from app.models.export import Export, ExportFilterStatus

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.models.audit_log import AuditLog
from app.models.project import (
    Project,
    ProjectMember,
    ProjectPriority,
    ProjectRole,
    ProjectStatus,
)
from app.models.user import RoleName, User


class ProjectService:
    """Handles project CRUD and member management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # LIST PROJECTS (UC-3.1 — list)
    # ================================================================

    async def list_projects(
        self,
        current_user: User,
        search: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """
        List projects with filters. Status is computed from sample data in real-time.
        - Admin sees all projects.
        - PO sees only projects they created or are a member of.
        """
        query = select(Project)
        filters = []

        # --- Scope by role ---
        is_admin = RoleName.ADMIN.value in current_user.role_names
        if not is_admin:
            member_subquery = select(ProjectMember.project_id).where(
                ProjectMember.user_id == current_user.id
            )
            filters.append(
                or_(
                    Project.created_by == current_user.id,
                    Project.id.in_(member_subquery),
                )
            )

        # --- Search filter ---
        if search:
            term = f"%{search}%"
            filters.append(
                or_(Project.name.ilike(term), Project.code.ilike(term))
            )

        if filters:
            query = query.where(and_(*filters))

        # --- Fetch all matching projects (status filter applied in Python) ---
        query = query.order_by(Project.created_at.desc())
        result = await self.db.execute(query)
        all_projects = list(result.scalars().unique().all())

        # --- Batch-fetch sample stats for all projects ---
        stats_map = await self._fetch_sample_stats([p.id for p in all_projects])

        # --- Compute status and apply status filter ---
        valid_statuses = {"not_started", "active", "completed"}
        if status and status not in valid_statuses:
            raise BadRequestException(f"Invalid status: '{status}'")

        projects_with_status = []
        for p in all_projects:
            computed = self._compute_project_status(stats_map.get(p.id))
            if not status or computed == status:
                projects_with_status.append((p, computed))

        # --- Paginate in Python ---
        total = len(projects_with_status)
        total_pages = math.ceil(total / page_size) if total > 0 else 1
        start = (page - 1) * page_size
        page_slice = projects_with_status[start:start + page_size]

        return {
            "projects": [
                self._build_project_response(p, cs, stats_map.get(p.id))
                for p, cs in page_slice
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    # ================================================================
    # CREATE PROJECT (UC-3.1 — main flow)
    # ================================================================

    async def create_project(
        self,
        current_user: User,
        name: str,
        code: Optional[str] = None,
        description: Optional[str] = None,
        objective: Optional[str] = None,
        priority: Optional[str] = None,
        deadline=None,
    ) -> dict:
        """
        Create a new project. Creator becomes project_owner automatically.
        If code is supplied it is used (must be unique); otherwise auto-generated.
        """
        if code:
            existing = await self.db.execute(
                select(Project.id).where(Project.code == code)
            )
            if existing.scalar_one_or_none():
                raise ConflictException(f"Project code '{code}' is already taken")
            project_code = code.upper()
        else:
            project_code = await self._generate_unique_code()

        priority_enum = ProjectPriority.NORMAL
        if priority:
            try:
                priority_enum = ProjectPriority(priority)
            except ValueError:
                pass

        project = Project(
            code=project_code,
            name=name,
            description=description,
            objective=objective,
            priority=priority_enum,
            deadline=deadline,
            status=ProjectStatus.DRAFT,
            created_by=current_user.id,
        )
        self.db.add(project)
        await self.db.flush()

        # Creator joins as project_owner
        self.db.add(
            ProjectMember(
                project_id=project.id,
                user_id=current_user.id,
                role_in_project=ProjectRole.PROJECT_OWNER,
            )
        )

        # Audit log
        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="CREATE_PROJECT",
                entity_type="project",
                entity_id=project.id,
                details={"code": project.code, "name": name},
            )
        )
        await self.db.flush()

        return await self.get_project(project.id, current_user)

    # ================================================================
    # GET PROJECT (UC-3.1 — detail)
    # ================================================================

    async def get_project(self, project_id: UUID, current_user: User) -> dict:
        """Get project detail. Requires access (admin or member)."""
        project = await self._get_project_or_404(project_id)
        await self._check_access(project, current_user)
        stats_map = await self._fetch_sample_stats([project.id])
        stats = stats_map.get(project.id)
        computed = self._compute_project_status(stats)
        return self._build_project_response(project, computed, stats)

    # ================================================================
    # UPDATE PROJECT (UC-3.1 — A1)
    # ================================================================

    async def update_project(
        self,
        project_id: UUID,
        current_user: User,
        code: Optional[str] = None,
        name: Optional[str] = None,
        description: Optional[str] = None,
        objective: Optional[str] = None,
        priority: Optional[str] = None,
        deadline=None,
        status: Optional[str] = None,
    ) -> dict:
        """Only project_owner or Admin can edit."""
        project = await self._get_project_or_404(project_id)
        await self._check_owner(project, current_user)

        if project.status == ProjectStatus.ARCHIVED:
            raise BadRequestException("Cannot edit an archived project")

        if code is not None:
            project_code = code.upper()
            existing = await self.db.execute(
                select(Project.id).where(
                    Project.code == project_code,
                    Project.id != project_id,
                )
            )
            if existing.scalar_one_or_none():
                raise ConflictException(f"Project code '{project_code}' is already taken")
            project.code = project_code
        if name is not None:
            project.name = name
        if description is not None:
            project.description = description
        if objective is not None:
            project.objective = objective
        if priority is not None:
            try:
                project.priority = ProjectPriority(priority)
            except ValueError:
                raise BadRequestException(f"Invalid priority: '{priority}'")
        if deadline is not None:
            project.deadline = deadline
        if status is not None:
            try:
                project.status = ProjectStatus(status)
            except ValueError:
                raise BadRequestException(f"Invalid status: '{status}'")

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="UPDATE_PROJECT",
                entity_type="project",
                entity_id=project.id,
            )
        )
        await self.db.flush()

        stats_map = await self._fetch_sample_stats([project.id])
        stats = stats_map.get(project.id)
        computed = self._compute_project_status(stats)
        return self._build_project_response(project, computed, stats)

    # ================================================================
    # ARCHIVE PROJECT (UC-3.1 — A2)
    # ================================================================

    async def archive_project(self, project_id: UUID, current_user: User) -> dict:
        project = await self._get_project_or_404(project_id)
        await self._check_owner(project, current_user)

        if project.status == ProjectStatus.ARCHIVED:
            raise BadRequestException("Project is already archived")

        project.status = ProjectStatus.ARCHIVED
        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="ARCHIVE_PROJECT",
                entity_type="project",
                entity_id=project.id,
            )
        )
        await self.db.flush()

        stats_map = await self._fetch_sample_stats([project.id])
        stats = stats_map.get(project.id)
        computed = self._compute_project_status(stats)
        return self._build_project_response(project, computed, stats)

    # ================================================================
    # DELETE PROJECT (UC-3.1 — A3)
    # ================================================================

    async def delete_project(self, project_id: UUID, current_user: User) -> None:
        """
        Delete a project.
        Only allowed when displayed annotation progress is 0% or 100%.
        """
        project = await self._get_project_or_404(project_id)
        await self._check_owner(project, current_user)

        stats_map = await self._fetch_sample_stats([project.id])
        annotation_pct = self._get_display_annotation_progress_percent(stats_map.get(project.id))
        if annotation_pct not in {0, 100}:
            raise ConflictException(
                "Chỉ có thể xóa dự án khi tiến độ annotation là 0% hoặc 100%."
            )

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="DELETE_PROJECT",
                entity_type="project",
                entity_id=project.id,
                details={"code": project.code, "name": project.name},
            )
        )
        await self.db.delete(project)
        await self.db.flush()

    # ================================================================
    # MEMBER MANAGEMENT
    # ================================================================

    async def list_members(
        self, project_id: UUID, current_user: User
    ) -> List[dict]:
        project = await self._get_project_or_404(project_id)
        await self._check_access(project, current_user)

        return [
            {
                "id": m.id,
                "user_id": m.user_id,
                "full_name": m.user.full_name,
                "email": m.user.email,
                "role_in_project": m.role_in_project.value,
                "joined_at": m.joined_at,
            }
            for m in project.members
        ]

    async def add_member(
        self,
        project_id: UUID,
        current_user: User,
        user_id: UUID,
        role_in_project: str,
    ) -> dict:
        project = await self._get_project_or_404(project_id)
        await self._check_owner(project, current_user)

        # Validate role
        try:
            role_enum = ProjectRole(role_in_project)
        except ValueError:
            raise BadRequestException(
                f"Invalid role_in_project: '{role_in_project}'"
            )

        # Validate user exists
        user_result = await self.db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise NotFoundException(f"User '{user_id}' not found")

        # Check if already a member
        existing = await self.db.execute(
            select(ProjectMember).where(
                and_(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                )
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictException("User is already a member of this project")

        member = ProjectMember(
            project_id=project_id,
            user_id=user_id,
            role_in_project=role_enum,
        )
        self.db.add(member)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="ADD_MEMBER",
                entity_type="project_member",
                entity_id=project_id,
                details={"user_id": str(user_id), "role": role_in_project},
            )
        )
        await self.db.flush()
        await self.db.refresh(member, ["user"])

        return {
            "id": member.id,
            "user_id": member.user_id,
            "full_name": member.user.full_name,
            "email": member.user.email,
            "role_in_project": member.role_in_project.value,
            "joined_at": member.joined_at,
        }

    async def update_member(
        self,
        project_id: UUID,
        current_user: User,
        user_id: UUID,
        role_in_project: str,
    ) -> dict:
        project = await self._get_project_or_404(project_id)
        await self._check_owner(project, current_user)

        try:
            role_enum = ProjectRole(role_in_project)
        except ValueError:
            raise BadRequestException(
                f"Invalid role_in_project: '{role_in_project}'"
            )

        result = await self.db.execute(
            select(ProjectMember).where(
                and_(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                )
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise NotFoundException("Member not found in this project")

        # Guard: cannot demote the last project_owner
        # Admin users bypass this guard (they retain implicit management access)
        member_user_result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        member_user = member_user_result.scalar_one_or_none()
        is_member_admin = (
            member_user is not None
            and RoleName.ADMIN.value in member_user.role_names
        )
        if (
            not is_member_admin
            and member.role_in_project == ProjectRole.PROJECT_OWNER
            and role_enum != ProjectRole.PROJECT_OWNER
        ):
            await self._guard_last_owner(project_id, member.user_id)

        member.role_in_project = role_enum
        await self.db.flush()
        await self.db.refresh(member, ["user"])

        return {
            "id": member.id,
            "user_id": member.user_id,
            "full_name": member.user.full_name,
            "email": member.user.email,
            "role_in_project": member.role_in_project.value,
            "joined_at": member.joined_at,
        }

    async def remove_member(
        self, project_id: UUID, current_user: User, user_id: UUID
    ) -> None:
        project = await self._get_project_or_404(project_id)
        await self._check_owner(project, current_user)

        result = await self.db.execute(
            select(ProjectMember).where(
                and_(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                )
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise NotFoundException("Member not found in this project")

        # Guard: cannot remove the last project_owner
        if member.role_in_project == ProjectRole.PROJECT_OWNER:
            await self._guard_last_owner(project_id, user_id)

        await self._guard_member_has_no_assigned_tasks(project_id, user_id)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="REMOVE_MEMBER",
                entity_type="project_member",
                entity_id=project_id,
                details={"user_id": str(user_id)},
            )
        )
        await self.db.delete(member)
        await self.db.flush()

    # ================================================================
    # Private Helpers
    # ================================================================

    async def _get_project_or_404(self, project_id: UUID) -> Project:
        result = await self.db.execute(
            select(Project)
            .options(
                selectinload(Project.members).selectinload(ProjectMember.user)
            )
            .where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise NotFoundException(f"Project '{project_id}' not found")
        return project

    async def _check_access(self, project: Project, user: User) -> None:
        """Any member or admin can view."""
        if RoleName.ADMIN.value in user.role_names:
            return
        member_ids = {m.user_id for m in project.members}
        if user.id not in member_ids and project.created_by != user.id:
            raise ForbiddenException("You don't have access to this project")

    async def _check_owner(self, project: Project, user: User) -> None:
        """Only project_owner or system admin can modify."""
        if RoleName.ADMIN.value in user.role_names:
            return
        for m in project.members:
            if (
                m.user_id == user.id
                and m.role_in_project == ProjectRole.PROJECT_OWNER
            ):
                return
        raise ForbiddenException(
            "Only project owners or admin can modify this project"
        )

    async def _guard_last_owner(
        self, project_id: UUID, user_id: UUID
    ) -> None:
        """Prevent removing/demoting the last project_owner."""
        result = await self.db.execute(
            select(func.count(ProjectMember.id)).where(
                and_(
                    ProjectMember.project_id == project_id,
                    ProjectMember.role_in_project == ProjectRole.PROJECT_OWNER,
                    ProjectMember.user_id != user_id,
                )
            )
        )
        other_owners = result.scalar() or 0
        if other_owners == 0:
            raise BadRequestException(
                "Cannot remove the last project owner. "
                "Assign another owner first."
            )

    async def _guard_member_has_no_assigned_tasks(
        self, project_id: UUID, user_id: UUID
    ) -> None:
        """Prevent removing members who are assigned to project tasks."""
        result = await self.db.execute(
            select(func.count(Task.id)).where(
                and_(
                    Task.project_id == project_id,
                    or_(
                        Task.assignee_id == user_id,
                        Task.reviewer_id == user_id,
                    ),
                )
            )
        )
        assigned_task_count = result.scalar() or 0
        if assigned_task_count > 0:
            raise ConflictException(
                "Không thể xoá thành viên vì thành viên này đang được phân công task trong dự án."
            )

    async def _generate_unique_code(self) -> str:
        """Generate unique project code like 'PRJ-A3F9K2'."""
        alphabet = string.ascii_uppercase + string.digits
        for _ in range(10):
            code = "PRJ-" + "".join(secrets.choice(alphabet) for _ in range(6))
            existing = await self.db.execute(
                select(Project.id).where(Project.code == code)
            )
            if not existing.scalar_one_or_none():
                return code
        raise RuntimeError("Unable to generate unique project code")

    async def _fetch_sample_stats(self, project_ids: list) -> dict:
        """Return sample-level progress stats keyed by project_id."""
        if not project_ids:
            return {}

        dataset_result = await self.db.execute(
            select(
                Dataset.project_id,
                func.coalesce(func.sum(Dataset.total_samples), 0).label("dataset_total"),
            )
            .where(Dataset.project_id.in_(project_ids))
            .group_by(Dataset.project_id)
        )
        stats_map = {
            row.project_id: SimpleNamespace(
                total_samples=int(row.dataset_total or 0),
                assigned_samples=0,
                annotated_count=0,
                submitted_count=0,
                approved_count=0,
                exported_count=0,
            )
            for row in dataset_result
        }

        sample_result = await self.db.execute(
            select(
                Task.project_id,
                func.count(func.distinct(TaskSample.id)).label("assigned_samples"),
                func.count(
                    func.distinct(
                        case((Annotation.id.is_not(None), TaskSample.id))
                    )
                ).label("annotated_count"),
                func.count(
                    func.distinct(
                        case(
                            (
                                TaskSample.status == TaskSampleStatus.SUBMITTED,
                                TaskSample.id,
                            )
                        )
                    )
                ).label("submitted_count"),
                func.count(
                    func.distinct(
                        case(
                            (
                                TaskSample.status == TaskSampleStatus.APPROVED,
                                TaskSample.id,
                            )
                        )
                    )
                ).label("approved_count"),
            )
            .join(TaskSample, TaskSample.task_id == Task.id)
            .outerjoin(Annotation, Annotation.task_sample_id == TaskSample.id)
            .where(Task.project_id.in_(project_ids))
            .group_by(Task.project_id)
        )

        for row in sample_result:
            stats = stats_map.setdefault(
                row.project_id,
                SimpleNamespace(
                    total_samples=0,
                    assigned_samples=0,
                    annotated_count=0,
                    submitted_count=0,
                    approved_count=0,
                    exported_count=0,
                ),
            )
            stats.assigned_samples = int(row.assigned_samples or 0)
            stats.annotated_count = int(row.annotated_count or 0)
            stats.submitted_count = int(row.submitted_count or 0)
            stats.approved_count = int(row.approved_count or 0)
            if stats.total_samples == 0:
                stats.total_samples = stats.assigned_samples

        export_result = await self.db.execute(
            select(
                Export.project_id,
                Export.dataset_id,
                func.max(Export.total_records).label("exported_count"),
            )
            .where(
                and_(
                    Export.project_id.in_(project_ids),
                    Export.filter_status == ExportFilterStatus.APPROVED_ONLY,
                )
            )
            .group_by(Export.project_id, Export.dataset_id)
        )

        export_counts: dict = {}
        for row in export_result:
            counts = export_counts.setdefault(
                row.project_id,
                {"project_wide": 0, "by_dataset": 0},
            )
            exported_count = int(row.exported_count or 0)
            if row.dataset_id is None:
                counts["project_wide"] = max(counts["project_wide"], exported_count)
            else:
                counts["by_dataset"] += exported_count

        for project_id, counts in export_counts.items():
            stats = stats_map.setdefault(
                project_id,
                SimpleNamespace(
                    total_samples=0,
                    assigned_samples=0,
                    annotated_count=0,
                    submitted_count=0,
                    approved_count=0,
                    exported_count=0,
                ),
            )
            stats.exported_count = max(counts["project_wide"], counts["by_dataset"])

        return stats_map

    @staticmethod
    def _compute_project_status(stats) -> str:
        """Derive display status from sample statistics."""
        if stats is None:
            return "not_started"
        total = stats.total_samples or 0
        annotated = stats.annotated_count or 0
        approved = stats.approved_count or 0
        if total == 0 or annotated == 0:
            return "not_started"
        if approved == total:
            return "completed"
        return "active"

    @staticmethod
    def _get_annotation_progress(stats) -> float:
        if stats is None:
            return 0.0

        total_samples = int(getattr(stats, "total_samples", 0) or 0)
        if total_samples <= 0:
            return 0.0

        annotated_samples = max(0, int(getattr(stats, "annotated_count", 0) or 0))
        return max(
            0.0,
            min(100.0, round((annotated_samples / total_samples) * 100, 1)),
        )

    @classmethod
    def _get_display_annotation_progress_percent(cls, stats) -> int:
        progress = cls._get_annotation_progress(stats)
        return int(math.floor(progress + 0.5))

    def _build_project_response(
        self,
        project: Project,
        computed_status: str = "not_started",
        stats=None,
    ) -> dict:
        total_samples = int(getattr(stats, "total_samples", 0) or 0)
        assigned_samples = int(getattr(stats, "assigned_samples", 0) or 0)
        annotated_samples = int(getattr(stats, "annotated_count", 0) or 0)
        pending_review_samples = int(getattr(stats, "submitted_count", 0) or 0)
        approved_samples = int(getattr(stats, "approved_count", 0) or 0)
        exported_samples = int(getattr(stats, "exported_count", 0) or 0)
        annotation_progress = self._get_annotation_progress(stats)
        review_progress = (
            round((approved_samples / total_samples) * 100, 1)
            if total_samples > 0
            else 0.0
        )
        export_progress = (
            round((min(exported_samples, approved_samples) / total_samples) * 100, 1)
            if total_samples > 0
            else 0.0
        )
        completion_progress = (
            min(annotation_progress, review_progress, export_progress)
        )

        return {
            "id": project.id,
            "code": project.code,
            "name": project.name,
            "description": project.description,
            "objective": project.objective,
            "priority": project.priority.value if project.priority else "normal",
            "status": computed_status,
            "created_by": project.created_by,
            "creator": (
                {
                    "id": project.creator.id,
                    "full_name": project.creator.full_name,
                    "email": project.creator.email,
                }
                if project.creator
                else None
            ),
            "deadline": project.deadline,
            "member_count": len(project.members) if project.members is not None else 0,
            "total_samples": total_samples,
            "assigned_samples": assigned_samples,
            "annotated_samples": annotated_samples,
            "pending_review_samples": pending_review_samples,
            "approved_samples": approved_samples,
            "exported_samples": exported_samples,
            "annotation_progress": annotation_progress,
            "review_progress": review_progress,
            "export_progress": export_progress,
            "completion_progress": completion_progress,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }
