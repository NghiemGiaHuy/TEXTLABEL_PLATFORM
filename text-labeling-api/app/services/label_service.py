"""
app/services/label_service.py
Business logic for LabelSet, LabelGroup, and Label (UC-3.2).
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.models.audit_log import AuditLog
from app.models.label import Label, LabelGroup, LabelSet
from app.models.project import Project, ProjectRole
from app.models.user import RoleName, User


class LabelService:
    """Manages project ontology: label sets, groups, labels."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # LABEL SET CRUD
    # ================================================================

    async def list_label_sets(
        self, project_id: UUID, current_user: User
    ) -> List[dict]:
        await self._check_project_access(project_id, current_user)

        result = await self.db.execute(
            select(LabelSet)
            .options(
                selectinload(LabelSet.groups),
                selectinload(LabelSet.labels),
            )
            .where(LabelSet.project_id == project_id)
            .order_by(LabelSet.created_at)
        )
        label_sets = result.scalars().unique().all()
        return [self._build_label_set_response(ls) for ls in label_sets]

    async def create_label_set(
        self, project_id: UUID, current_user: User, name: str
    ) -> dict:
        await self._check_project_owner(project_id, current_user)

        label_set = LabelSet(project_id=project_id, name=name)
        self.db.add(label_set)
        await self.db.flush()

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="CREATE_LABEL_SET",
                entity_type="label_set",
                entity_id=label_set.id,
                details={"project_id": str(project_id), "name": name},
            )
        )
        await self.db.flush()

        return await self._get_label_set_response(label_set.id)

    async def update_label_set(
        self,
        project_id: UUID,
        label_set_id: UUID,
        current_user: User,
        name: Optional[str] = None,
    ) -> dict:
        await self._check_project_owner(project_id, current_user)
        label_set = await self._get_label_set_or_404(label_set_id, project_id)

        if name is not None:
            label_set.name = name

        await self.db.flush()
        return await self._get_label_set_response(label_set.id)

    async def delete_label_set(
        self, project_id: UUID, label_set_id: UUID, current_user: User
    ) -> None:
        await self._check_project_owner(project_id, current_user)
        label_set = await self._get_label_set_or_404(label_set_id, project_id)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="DELETE_LABEL_SET",
                entity_type="label_set",
                entity_id=label_set.id,
            )
        )
        await self.db.delete(label_set)
        await self.db.flush()

    # ================================================================
    # LABEL GROUP CRUD
    # ================================================================

    async def create_group(
        self,
        project_id: UUID,
        label_set_id: UUID,
        current_user: User,
        name: str,
        sort_order: int = 0,
    ) -> dict:
        await self._check_project_owner(project_id, current_user)
        await self._get_label_set_or_404(label_set_id, project_id)

        group = LabelGroup(
            label_set_id=label_set_id,
            name=name,
            sort_order=sort_order,
        )
        self.db.add(group)
        await self.db.flush()
        return self._build_group_response(group)

    async def update_group(
        self,
        project_id: UUID,
        label_set_id: UUID,
        group_id: UUID,
        current_user: User,
        name: Optional[str] = None,
        sort_order: Optional[int] = None,
    ) -> dict:
        await self._check_project_owner(project_id, current_user)
        group = await self._get_group_or_404(group_id, label_set_id)

        if name is not None:
            group.name = name
        if sort_order is not None:
            group.sort_order = sort_order

        await self.db.flush()
        return self._build_group_response(group)

    async def delete_group(
        self,
        project_id: UUID,
        label_set_id: UUID,
        group_id: UUID,
        current_user: User,
    ) -> None:
        await self._check_project_owner(project_id, current_user)
        group = await self._get_group_or_404(group_id, label_set_id)
        await self.db.delete(group)
        await self.db.flush()

    # ================================================================
    # LABEL CRUD
    # ================================================================

    async def create_label(
        self,
        project_id: UUID,
        label_set_id: UUID,
        current_user: User,
        name: str,
        color: str,
        shortcut_key: Optional[str] = None,
        sort_order: int = 0,
        is_required: bool = False,
        label_group_id: Optional[UUID] = None,
    ) -> dict:
        await self._check_project_owner(project_id, current_user)
        await self._get_label_set_or_404(label_set_id, project_id)

        # Validate shortcut key uniqueness within the label set
        if shortcut_key:
            existing = await self.db.execute(
                select(Label).where(
                    and_(
                        Label.label_set_id == label_set_id,
                        Label.shortcut_key == shortcut_key,
                    )
                )
            )
            if existing.scalar_one_or_none():
                raise ConflictException(
                    f"Shortcut key '{shortcut_key}' is already used in this label set"
                )

        # Validate label_group belongs to the same label set
        if label_group_id:
            await self._get_group_or_404(label_group_id, label_set_id)

        label = Label(
            label_set_id=label_set_id,
            label_group_id=label_group_id,
            name=name,
            color=color,
            shortcut_key=shortcut_key,
            sort_order=sort_order,
            is_required=is_required,
        )
        self.db.add(label)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="CREATE_LABEL",
                entity_type="label",
                entity_id=label.id,
                details={"name": name, "label_set_id": str(label_set_id)},
            )
        )

        await self.db.flush()
        return self._build_label_response(label)

    async def update_label(
        self,
        project_id: UUID,
        label_set_id: UUID,
        label_id: UUID,
        current_user: User,
        **kwargs,
    ) -> dict:
        await self._check_project_owner(project_id, current_user)
        label = await self._get_label_or_404(label_id, label_set_id)

        # Handle shortcut key uniqueness
        new_shortcut = kwargs.get("shortcut_key")
        if new_shortcut and new_shortcut != label.shortcut_key:
            existing = await self.db.execute(
                select(Label).where(
                    and_(
                        Label.label_set_id == label_set_id,
                        Label.shortcut_key == new_shortcut,
                        Label.id != label_id,
                    )
                )
            )
            if existing.scalar_one_or_none():
                raise ConflictException(
                    f"Shortcut key '{new_shortcut}' is already used"
                )

        # Validate group if provided
        new_group_id = kwargs.get("label_group_id")
        if new_group_id:
            await self._get_group_or_404(new_group_id, label_set_id)

        for field in (
            "name",
            "color",
            "shortcut_key",
            "sort_order",
            "is_required",
            "label_group_id",
        ):
            if field in kwargs and kwargs[field] is not None:
                setattr(label, field, kwargs[field])

        await self.db.flush()
        return self._build_label_response(label)

    async def delete_label(
        self,
        project_id: UUID,
        label_set_id: UUID,
        label_id: UUID,
        current_user: User,
    ) -> None:
        await self._check_project_owner(project_id, current_user)
        label = await self._get_label_or_404(label_id, label_set_id)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="DELETE_LABEL",
                entity_type="label",
                entity_id=label.id,
                details={"name": label.name},
            )
        )
        await self.db.delete(label)
        await self.db.flush()

    # ================================================================
    # Access Control Helpers
    # ================================================================

    async def _check_project_access(
        self, project_id: UUID, user: User
    ) -> Project:
        """Any project member or admin can view labels."""
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
        """Only project_owner or admin can modify labels."""
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
            "Only project owners or admin can modify labels"
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

    async def _get_label_set_or_404(
        self, label_set_id: UUID, project_id: UUID
    ) -> LabelSet:
        result = await self.db.execute(
            select(LabelSet).where(
                and_(
                    LabelSet.id == label_set_id,
                    LabelSet.project_id == project_id,
                )
            )
        )
        label_set = result.scalar_one_or_none()
        if not label_set:
            raise NotFoundException(
                f"Label set '{label_set_id}' not found in this project"
            )
        return label_set

    async def _get_group_or_404(
        self, group_id: UUID, label_set_id: UUID
    ) -> LabelGroup:
        result = await self.db.execute(
            select(LabelGroup).where(
                and_(
                    LabelGroup.id == group_id,
                    LabelGroup.label_set_id == label_set_id,
                )
            )
        )
        group = result.scalar_one_or_none()
        if not group:
            raise NotFoundException(
                f"Label group '{group_id}' not found in this label set"
            )
        return group

    async def _get_label_or_404(
        self, label_id: UUID, label_set_id: UUID
    ) -> Label:
        result = await self.db.execute(
            select(Label).where(
                and_(Label.id == label_id, Label.label_set_id == label_set_id)
            )
        )
        label = result.scalar_one_or_none()
        if not label:
            raise NotFoundException(
                f"Label '{label_id}' not found in this label set"
            )
        return label

    async def _get_label_set_response(self, label_set_id: UUID) -> dict:
        result = await self.db.execute(
            select(LabelSet)
            .options(
                selectinload(LabelSet.groups),
                selectinload(LabelSet.labels),
            )
            .where(LabelSet.id == label_set_id)
        )
        label_set = result.scalar_one()
        return self._build_label_set_response(label_set)

    # ================================================================
    # Response Builders
    # ================================================================

    def _build_label_set_response(self, ls: LabelSet) -> dict:
        return {
            "id": ls.id,
            "project_id": ls.project_id,
            "name": ls.name,
            "created_at": ls.created_at,
            "updated_at": ls.updated_at,
            "groups": [self._build_group_response(g) for g in ls.groups],
            "labels": [self._build_label_response(label) for label in ls.labels],
        }

    def _build_group_response(self, g: LabelGroup) -> dict:
        return {
            "id": g.id,
            "label_set_id": g.label_set_id,
            "name": g.name,
            "sort_order": g.sort_order,
        }

    def _build_label_response(self, label: Label) -> dict:
        return {
            "id": label.id,
            "label_set_id": label.label_set_id,
            "label_group_id": label.label_group_id,
            "name": label.name,
            "color": label.color,
            "shortcut_key": label.shortcut_key,
            "sort_order": label.sort_order,
            "is_required": label.is_required,
            "created_at": label.created_at,
        }
