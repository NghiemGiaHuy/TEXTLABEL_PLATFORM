"""
app/services/user_service.py
Business logic for Admin User Management (UC-2.1, UC-2.2).

Operations: list, create, get detail, update, delete, lock, unlock,
            admin-reset password, list roles.
"""

import math
from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
)
from app.core.security import hash_password
from app.models.audit_log import AuditLog
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskStatus
from app.models.user import (
    RefreshToken,
    Role,
    RoleName,
    User,
    UserRole,
    UserStatus,
)


class UserService:
    """Handles admin-level user management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # LIST USERS (UC-2.1 — Main flow step 2)
    # ================================================================

    async def list_users(
        self,
        search: Optional[str] = None,
        role: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "created_at",
        sort_order: str = "desc",
    ) -> dict:
        """
        Paginated user list with search, role filter, status filter, sorting.

        Returns dict with users[], total, page, page_size, total_pages.
        """
        # --- Base query with roles eagerly loaded ---
        query = (
            select(User)
            .options(selectinload(User.user_roles).selectinload(UserRole.role))
        )
        count_query = select(func.count(User.id))

        # --- Filters ---
        filters = []

        if search:
            search_term = f"%{search}%"
            filters.append(
                or_(
                    User.full_name.ilike(search_term),
                    User.email.ilike(search_term),
                )
            )

        if status:
            try:
                status_enum = UserStatus(status)
                filters.append(User.status == status_enum)
            except ValueError:
                raise BadRequestException(
                    f"Invalid status: '{status}'. Must be 'active' or 'locked'."
                )

        if role:
            # Subquery: find user IDs that have the specified role
            try:
                role_enum = RoleName(role)
            except ValueError:
                raise BadRequestException(
                    f"Invalid role: '{role}'. Must be one of: "
                    f"admin, project_owner, annotator, reviewer."
                )
            role_subquery = (
                select(UserRole.user_id)
                .join(Role, UserRole.role_id == Role.id)
                .where(Role.name == role_enum)
            )
            filters.append(User.id.in_(role_subquery))

        if filters:
            query = query.where(and_(*filters))
            count_query = count_query.where(and_(*filters))

        # --- Total count ---
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        # --- Sorting ---
        sort_column = getattr(User, sort_by, User.created_at)
        if sort_order == "asc":
            query = query.order_by(sort_column.asc())
        else:
            query = query.order_by(sort_column.desc())

        # --- Pagination ---
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        # --- Execute ---
        result = await self.db.execute(query)
        users = result.scalars().unique().all()
        metadata = await self._get_user_list_metadata([u.id for u in users])

        return {
            "users": [self._build_user_detail(u, metadata.get(u.id)) for u in users],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "role_counts": await self._get_role_counts(),
        }

    # ================================================================
    # CREATE USER (UC-2.1 — Main flow step 3a)
    # ================================================================

    async def create_user(
        self,
        email: str,
        full_name: str,
        password: str,
        role_ids: List[UUID],
        admin_id: UUID,
    ) -> dict:
        """
        Create a new user with specified roles.

        Business Rules:
        - E2: Email must be unique
        - All role_ids must reference valid roles
        - At least one role required
        """
        # 1. Check email uniqueness
        existing = await self.db.execute(
            select(User).where(User.email == email)
        )
        if existing.scalar_one_or_none():
            raise ConflictException(f"Email '{email}' is already registered")

        # 2. Validate all role_ids exist
        roles = await self._validate_role_ids(role_ids)

        # 3. Create user
        user = User(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            status=UserStatus.ACTIVE,
        )
        self.db.add(user)
        await self.db.flush()  # Get user.id

        # 4. Assign roles
        for role in roles:
            self.db.add(UserRole(user_id=user.id, role_id=role.id))
        await self.db.flush()

        # 5. Audit log
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="CREATE_USER",
                entity_type="user",
                entity_id=user.id,
                details={
                    "email": email,
                    "roles": [r.name.value if hasattr(r.name, 'value') else r.name for r in roles],
                },
            )
        )
        await self.db.flush()

        # 6. Re-fetch with roles loaded
        return await self.get_user(user.id)

    # ================================================================
    # GET USER DETAIL (UC-2.1 — Main flow step 3)
    # ================================================================

    async def get_user(self, user_id: UUID) -> dict:
        """Get single user with full detail."""
        user = await self._get_user_or_404(user_id)
        metadata = await self._get_user_list_metadata([user.id])
        return self._build_user_detail(user, metadata.get(user.id))

    # ================================================================
    # UPDATE USER (UC-2.1 — Main flow step 3b)
    # ================================================================

    async def update_user(
        self,
        user_id: UUID,
        admin_id: UUID,
        full_name: Optional[str] = None,
        role_ids: Optional[List[UUID]] = None,
    ) -> dict:
        """
        Update user profile and/or roles.

        Business Rules:
        - E1: Cannot remove the last Admin role from the system
        - role_ids replaces ALL existing roles (full replacement)
        """
        user = await self._get_user_or_404(user_id)

        # --- Update name ---
        if full_name is not None:
            user.full_name = full_name

        # --- Update roles (full replacement) ---
        changes = {}
        if role_ids is not None:
            new_roles = await self._validate_role_ids(role_ids)
            new_role_names = {r.name for r in new_roles}

            # Guard: cannot remove the last admin
            await self._guard_last_admin(user, new_role_names)

            # Remove old roles
            old_role_names = set(user.role_names)
            for ur in list(user.user_roles):
                await self.db.delete(ur)
            await self.db.flush()

            # Add new roles
            for role in new_roles:
                self.db.add(UserRole(user_id=user.id, role_id=role.id))

            changes["roles_before"] = [
                r.value if hasattr(r, 'value') else r for r in old_role_names
            ]
            changes["roles_after"] = [
                r.name.value if hasattr(r.name, 'value') else r.name for r in new_roles
            ]

        await self.db.flush()

        # Audit log
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="UPDATE_USER",
                entity_type="user",
                entity_id=user.id,
                details=changes if changes else {"full_name": full_name},
            )
        )
        await self.db.flush()

        # Re-fetch to get fresh role data
        return await self.get_user(user.id)

    # ================================================================
    # DELETE USER (UC-2.1 — E1)
    # ================================================================

    async def delete_user(self, user_id: UUID, admin_id: UUID) -> None:
        """
        Delete a user account.

        Business Rules:
        - E1: Cannot delete user who is a member of any project
        - Cannot delete yourself
        - Cannot delete the last admin
        """
        if user_id == admin_id:
            raise BadRequestException("Cannot delete your own account")

        user = await self._get_user_or_404(user_id)

        # Guard: cannot delete the last admin
        if RoleName.ADMIN.value in user.role_names:
            admin_count = await self.db.execute(
                select(func.count(UserRole.id))
                .join(Role, UserRole.role_id == Role.id)
                .where(Role.name == RoleName.ADMIN)
            )
            if (admin_count.scalar() or 0) <= 1:
                raise BadRequestException(
                    "Cannot delete the last admin account"
                )

        # Guard: check if user is in any project
        # Import here to avoid circular imports — ProjectMember model
        # will exist when project module is built
        try:
            from app.models.project import ProjectMember

            member_count = await self.db.execute(
                select(func.count(ProjectMember.id)).where(
                    ProjectMember.user_id == user_id
                )
            )
            if (member_count.scalar() or 0) > 0:
                raise ConflictException(
                    "Cannot delete user who is a member of projects. "
                    "Remove them from all projects first."
                )
        except ImportError:
            # ProjectMember model not yet created — skip check
            pass

        # Audit log before deletion
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="DELETE_USER",
                entity_type="user",
                entity_id=user.id,
                details={"email": user.email, "full_name": user.full_name},
            )
        )

        await self.db.delete(user)
        await self.db.flush()

    # ================================================================
    # LOCK USER (UC-2.1 — step 3c)
    # ================================================================

    async def lock_user(self, user_id: UUID, admin_id: UUID) -> dict:
        """
        Lock user account. Revokes all active refresh tokens.

        Business Rules:
        - Cannot lock yourself
        - Cannot lock the last admin
        """
        if user_id == admin_id:
            raise BadRequestException("Cannot lock your own account")

        user = await self._get_user_or_404(user_id)

        if user.status == UserStatus.LOCKED:
            raise BadRequestException("User is already locked")

        # Guard: cannot lock the last admin
        if RoleName.ADMIN.value in user.role_names:
            admin_count = await self.db.execute(
                select(func.count(UserRole.id))
                .join(Role, UserRole.role_id == Role.id)
                .where(
                    and_(
                        Role.name == RoleName.ADMIN,
                        UserRole.user_id != user_id,
                    )
                )
            )
            other_admins = admin_count.scalar() or 0
            if other_admins == 0:
                raise BadRequestException("Cannot lock the last admin account")

        # Lock user
        user.status = UserStatus.LOCKED

        # Revoke all refresh tokens
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.user_id == user_id,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        for rt in result.scalars().all():
            rt.is_revoked = True

        # Audit log
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="LOCK_USER",
                entity_type="user",
                entity_id=user.id,
                details={"email": user.email},
            )
        )
        await self.db.flush()

        return await self.get_user(user.id)

    # ================================================================
    # UNLOCK USER (UC-2.1 — step 3c)
    # ================================================================

    async def unlock_user(self, user_id: UUID, admin_id: UUID) -> dict:
        """
        Unlock user account and reset failed login counter.
        """
        user = await self._get_user_or_404(user_id)

        if user.status != UserStatus.LOCKED and user.locked_until is None:
            raise BadRequestException("User is not locked")

        user.status = UserStatus.ACTIVE
        user.failed_login_count = 0
        user.locked_until = None

        # Audit log
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="UNLOCK_USER",
                entity_type="user",
                entity_id=user.id,
                details={"email": user.email},
            )
        )
        await self.db.flush()

        return await self.get_user(user.id)

    # ================================================================
    # ADMIN RESET PASSWORD (UC-2.1 — A1)
    # ================================================================

    async def admin_set_password(
        self, user_id: UUID, admin_id: UUID, new_password: str
    ) -> dict:
        """
        Admin directly sets a new password for a user.

        Revokes all user's refresh tokens to force re-login.
        """
        user = await self._get_user_or_404(user_id)
        user.password_hash = hash_password(new_password)
        user.failed_login_count = 0

        # Revoke all refresh tokens
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.user_id == user_id,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        for rt in result.scalars().all():
            rt.is_revoked = True

        # Audit log
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="ADMIN_SET_PASSWORD",
                entity_type="user",
                entity_id=user.id,
                details={"email": user.email},
            )
        )
        await self.db.flush()

        return await self.get_user(user.id)

    async def admin_reset_password(
        self, user_id: UUID, admin_id: UUID
    ) -> str:
        """
        Admin triggers password reset for a user.
        Returns the reset token (caller sends email).

        Revokes all user's refresh tokens to force re-login.
        """
        from app.core.security import create_password_reset_token

        user = await self._get_user_or_404(user_id)

        # Generate reset token
        reset_token = create_password_reset_token(str(user.id))

        # Revoke all refresh tokens
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.user_id == user_id,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        for rt in result.scalars().all():
            rt.is_revoked = True

        # Audit log
        self.db.add(
            AuditLog(
                user_id=admin_id,
                action="ADMIN_RESET_PASSWORD",
                entity_type="user",
                entity_id=user.id,
                details={"email": user.email},
            )
        )
        await self.db.flush()

        return reset_token

    # ================================================================
    # LIST ROLES (UC-2.2)
    # ================================================================

    async def list_roles(self) -> list:
        """Return all 4 fixed roles."""
        result = await self.db.execute(select(Role).order_by(Role.name))
        roles = result.scalars().all()
        return [
            {
                "id": r.id,
                "name": r.name.value if hasattr(r.name, "value") else r.name,
                "description": r.description,
            }
            for r in roles
        ]

    # ================================================================
    # Private Helpers
    # ================================================================

    async def _get_user_or_404(self, user_id: UUID) -> User:
        """Fetch user with roles loaded, raise 404 if not found."""
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.user_roles).selectinload(UserRole.role))
            .where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            raise NotFoundException(f"User with id '{user_id}' not found")
        return user

    async def _validate_role_ids(self, role_ids: List[UUID]) -> List[Role]:
        """
        Validate that all role_ids exist in the database.
        Returns list of Role objects.
        Raises BadRequestException if any ID is invalid.
        """
        result = await self.db.execute(
            select(Role).where(Role.id.in_(role_ids))
        )
        found_roles = result.scalars().all()
        found_ids = {r.id for r in found_roles}
        missing = set(role_ids) - found_ids

        if missing:
            raise BadRequestException(
                f"Invalid role IDs: {', '.join(str(m) for m in missing)}"
            )

        return list(found_roles)

    async def _guard_last_admin(self, user: User, new_role_names: set) -> None:
        """
        Prevent removing Admin role if this is the last admin in the system.

        UC-2.2 E1: "Không thể bỏ vai trò Admin cuối cùng: hệ thống chặn."
        """
        current_is_admin = RoleName.ADMIN.value in user.role_names
        new_has_admin = RoleName.ADMIN in new_role_names

        if current_is_admin and not new_has_admin:
            # Count other admins (excluding this user)
            admin_count = await self.db.execute(
                select(func.count(UserRole.id))
                .join(Role, UserRole.role_id == Role.id)
                .where(
                    and_(
                        Role.name == RoleName.ADMIN,
                        UserRole.user_id != user.id,
                    )
                )
            )
            other_admins = admin_count.scalar() or 0
            if other_admins == 0:
                raise BadRequestException(
                    "Cannot remove Admin role: this is the last admin in the system. "
                    "Assign Admin role to another user first."
                )

    async def _get_role_counts(self) -> dict:
        """Count users assigned to each system role for summary cards."""
        counts = {
            RoleName.ADMIN.value: 0,
            RoleName.PROJECT_OWNER.value: 0,
            RoleName.ANNOTATOR.value: 0,
            RoleName.REVIEWER.value: 0,
        }
        result = await self.db.execute(
            select(Role.name, func.count(func.distinct(UserRole.user_id)))
            .join(UserRole, UserRole.role_id == Role.id)
            .group_by(Role.name)
        )
        for role_name, count in result.all():
            key = role_name.value if hasattr(role_name, "value") else role_name
            counts[key] = count or 0
        return counts

    async def _get_user_list_metadata(self, user_ids: List[UUID]) -> Dict[UUID, dict]:
        """Fetch project, completed-task, and recent-login metadata in batches."""
        metadata: Dict[UUID, dict] = {
            user_id: {
                "project_count": 0,
                "projects": [],
                "task_done_count": 0,
                "last_login_at": None,
            }
            for user_id in user_ids
        }
        if not user_ids:
            return metadata

        project_rows = await self.db.execute(
            select(
                ProjectMember.user_id,
                Project.id.label("project_id"),
                Project.code,
                Project.name,
                ProjectMember.role_in_project,
            )
            .join(Project, Project.id == ProjectMember.project_id)
            .where(ProjectMember.user_id.in_(user_ids))
            .order_by(Project.name.asc())
        )
        for row in project_rows.all():
            entry = metadata[row.user_id]
            entry["projects"].append(
                {
                    "id": row.project_id,
                    "code": row.code,
                    "name": row.name,
                    "role_in_project": (
                        row.role_in_project.value
                        if hasattr(row.role_in_project, "value")
                        else row.role_in_project
                    ),
                }
            )
        for entry in metadata.values():
            entry["project_count"] = len(entry["projects"])

        assignee_task_rows = await self.db.execute(
            select(Task.assignee_id, func.count(Task.id).label("task_done_count"))
            .where(
                and_(
                    Task.assignee_id.in_(user_ids),
                    Task.status == TaskStatus.APPROVED,
                )
            )
            .group_by(Task.assignee_id)
        )
        for assignee_id, task_done_count in assignee_task_rows.all():
            metadata[assignee_id]["task_done_count"] = task_done_count or 0

        reviewer_task_rows = await self.db.execute(
            select(Task.reviewer_id, func.count(Task.id).label("task_done_count"))
            .where(
                and_(
                    Task.reviewer_id.in_(user_ids),
                    Task.status == TaskStatus.APPROVED,
                )
            )
            .group_by(Task.reviewer_id)
        )
        for reviewer_id, task_done_count in reviewer_task_rows.all():
            metadata[reviewer_id]["task_done_count"] += task_done_count or 0

        login_rows = await self.db.execute(
            select(
                AuditLog.user_id,
                func.max(AuditLog.created_at).label("last_login_at"),
            )
            .where(
                and_(
                    AuditLog.user_id.in_(user_ids),
                    AuditLog.action == "LOGIN",
                )
            )
            .group_by(AuditLog.user_id)
        )
        for user_id, last_login_at in login_rows.all():
            metadata[user_id]["last_login_at"] = last_login_at

        return metadata

    def _build_user_detail(self, user: User, metadata: Optional[dict] = None) -> dict:
        """Build full user detail dict for admin responses."""
        metadata = metadata or {}
        return {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "avatar_url": user.avatar_url,
            "status": user.status.value if hasattr(user.status, "value") else user.status,
            "roles": [
                {
                    "id": ur.role.id,
                    "name": (
                        ur.role.name.value
                        if hasattr(ur.role.name, "value")
                        else ur.role.name
                    ),
                    "description": ur.role.description,
                }
                for ur in user.user_roles
            ],
            "project_count": metadata.get("project_count", 0),
            "projects": metadata.get("projects", []),
            "task_done_count": metadata.get("task_done_count", 0),
            "last_login_at": metadata.get("last_login_at"),
            "failed_login_count": user.failed_login_count,
            "locked_until": user.locked_until,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }
