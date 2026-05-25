"""
app/middleware/auth_dependencies.py
FastAPI dependencies for authentication and RBAC authorization.

Usage in endpoints:
    # Any authenticated user
    current_user: User = Depends(get_current_user)

    # Only admin
    current_user: User = Depends(require_roles(RoleName.ADMIN))

    # Admin or Project Owner
    current_user: User = Depends(require_roles(RoleName.ADMIN, RoleName.PROJECT_OWNER))
"""

from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.core.security import decode_token
from app.models.user import RoleName, User, UserRole

# --- Bearer Token Extractor ---
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Dependency: Extract and validate JWT from Authorization header.
    Returns the authenticated User with roles loaded.

    Raises:
        UnauthorizedException: If token missing, invalid, or expired.
        UnauthorizedException: If user not found or locked.
    """
    if not credentials:
        raise UnauthorizedException("Missing authentication token")

    token = credentials.credentials

    # 1. Decode JWT
    payload = decode_token(token)
    if not payload:
        raise UnauthorizedException("Invalid or expired token")

    # 2. Verify token type
    if payload.get("type") != "access":
        raise UnauthorizedException("Invalid token type")

    # 3. Extract user ID
    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedException("Invalid token payload")

    # 4. Fetch user with roles
    result = await db.execute(
        select(User)
        .options(selectinload(User.user_roles).selectinload(UserRole.role))
        .where(User.id == UUID(user_id))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise UnauthorizedException("User not found")

    if user.is_locked:
        raise UnauthorizedException("Account is locked")

    # 5. Attach user to request state (for audit logging)
    request.state.current_user = user

    return user


def require_roles(*allowed_roles: RoleName):
    """
    Dependency factory: Creates a dependency that checks if the
    current user has at least one of the specified roles.

    Usage:
        @router.get("/admin/users")
        async def list_users(
            user: User = Depends(require_roles(RoleName.ADMIN))
        ):
            ...

        @router.post("/projects")
        async def create_project(
            user: User = Depends(require_roles(
                RoleName.ADMIN, RoleName.PROJECT_OWNER
            ))
        ):
            ...
    """

    async def role_checker(
        current_user: User = Depends(get_current_user),
    ) -> User:
        user_role_names = set(current_user.role_names)
        allowed_role_names = {role.value for role in allowed_roles}

        if not user_role_names.intersection(allowed_role_names):
            raise ForbiddenException(
                f"This action requires one of these roles: "
                f"{', '.join(allowed_role_names)}"
            )

        return current_user

    return role_checker


def require_any_role():
    """
    Dependency: Any authenticated user with any role.
    Equivalent to just get_current_user but more explicit in router.
    """

    async def any_role_checker(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if not current_user.role_names:
            raise ForbiddenException("User has no assigned roles")
        return current_user

    return any_role_checker