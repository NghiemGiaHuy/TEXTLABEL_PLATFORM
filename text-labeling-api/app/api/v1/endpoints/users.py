"""
app/api/v1/endpoints/users.py
Admin User Management endpoints (UC-2.1, UC-2.2).
The list endpoint is readable by authenticated users; mutations require Admin role.

Endpoints:
    GET    /admin/users                       — List users (paginated, filterable)
    POST   /admin/users                       — Create user
    GET    /admin/users/{user_id}              — Get user detail
    PUT    /admin/users/{user_id}              — Update user (profile + roles)
    DELETE /admin/users/{user_id}              — Delete user
    POST   /admin/users/{user_id}/lock         — Lock account
    POST   /admin/users/{user_id}/unlock       — Unlock account
    POST   /admin/users/{user_id}/reset-password — Admin triggers password reset
    GET    /admin/roles                        — List all available roles
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user, require_roles
from app.models.user import RoleName, User, UserStatus
from app.schemas.auth import MessageResponse
from app.schemas.user import (
    AdminResetPasswordRequest,
    CreateUserRequest,
    RoleListResponse,
    RoleResponse,
    UpdateUserRequest,
    UserDetailResponse,
    UserListResponse,
)
from app.services.user_service import UserService
from app.utils.email import send_password_reset_email
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/admin", tags=["Admin — User Management"])


# ================================================================
# GET /users/search — any authenticated user can list active users
# (used for Add Member dropdowns in project management)
# ================================================================
class UserBasic(BaseModel):
    id: str
    full_name: str
    email: str

    class Config:
        from_attributes = True

class UserBasicList(BaseModel):
    users: List[UserBasic]
    total: int

public_router = APIRouter(prefix="/users", tags=["Users — Public"])

@public_router.get("/search", response_model=UserBasicList)
async def search_users(
    search: str = Query(None, max_length=100),
    page_size: int = Query(200, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List active users — accessible to any authenticated user (for member selection)."""
    from sqlalchemy import select, or_
    from sqlalchemy.future import select as fselect
    query = fselect(User).where(User.status == UserStatus.ACTIVE)
    if search:
        like = f"%{search}%"
        query = query.where(or_(User.full_name.ilike(like), User.email.ilike(like)))
    query = query.order_by(User.full_name).limit(page_size)
    result = await db.execute(query)
    users = result.scalars().all()
    return {"users": [{"id": str(u.id), "full_name": u.full_name, "email": u.email} for u in users], "total": len(users)}

# --- Shared dependency: only Admin can perform account management actions ---
AdminUser = Depends(require_roles(RoleName.ADMIN))


# ================================================================
# GET /admin/users (UC-2.1 — Main flow step 2)
# ================================================================
@router.get("/users", response_model=UserListResponse)
async def list_users(
    search: str = Query(None, max_length=100, description="Search by name or email"),
    role: str = Query(None, description="Filter: admin, project_owner, annotator, reviewer"),
    status: str = Query(None, description="Filter: active, locked"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("created_at", description="Sort: created_at, email, full_name, status"),
    sort_order: str = Query("desc", description="asc or desc"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List all users with search, filtering, pagination, and sorting.
    Any authenticated user can view the list; account actions remain Admin-only.
    """
    service = UserService(db)
    result = await service.list_users(
        search=search,
        role=role,
        status=status,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    return result


# ================================================================
# POST /admin/users (UC-2.1 — Main flow step 3a: Thêm mới)
# ================================================================
@router.post("/users", response_model=UserDetailResponse, status_code=201)
async def create_user(
    body: CreateUserRequest,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new user account with specified roles.
    Validates email uniqueness and role IDs.
    """
    service = UserService(db)
    result = await service.create_user(
        email=body.email,
        full_name=body.full_name,
        password=body.password,
        role_ids=body.role_ids,
        admin_id=current_user.id,
    )
    return result


# ================================================================
# GET /admin/users/{user_id} (UC-2.1 — view detail)
# ================================================================
@router.get("/users/{user_id}", response_model=UserDetailResponse)
async def get_user(
    user_id: UUID,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a specific user.
    Includes roles, login status, lock info, and timestamps.
    """
    service = UserService(db)
    return await service.get_user(user_id)


# ================================================================
# PUT /admin/users/{user_id} (UC-2.1 — Main flow step 3b: Sửa)
# ================================================================
@router.put("/users/{user_id}", response_model=UserDetailResponse)
async def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Update user profile and/or roles.
    When role_ids is provided, it replaces ALL existing roles (full replacement).
    Cannot remove Admin role from the last admin (UC-2.2 E1).
    """
    service = UserService(db)
    return await service.update_user(
        user_id=user_id,
        admin_id=current_user.id,
        full_name=body.full_name,
        role_ids=body.role_ids,
    )


# ================================================================
# DELETE /admin/users/{user_id} (UC-2.1 — E1)
# ================================================================
@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: UUID,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a user account.
    Blocked if user is a member of any project (409 Conflict).
    Cannot delete yourself or the last admin.
    """
    service = UserService(db)
    await service.delete_user(user_id=user_id, admin_id=current_user.id)
    return MessageResponse(message="User deleted successfully")


# ================================================================
# POST /admin/users/{user_id}/lock (UC-2.1 — Khoá)
# ================================================================
@router.post("/users/{user_id}/lock", response_model=UserDetailResponse)
async def lock_user(
    user_id: UUID,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Lock a user account. Immediately revokes all their refresh tokens.
    Cannot lock yourself or the last admin.
    """
    service = UserService(db)
    return await service.lock_user(user_id=user_id, admin_id=current_user.id)


# ================================================================
# POST /admin/users/{user_id}/unlock (UC-2.1 — Mở khoá)
# ================================================================
@router.post("/users/{user_id}/unlock", response_model=UserDetailResponse)
async def unlock_user(
    user_id: UUID,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Unlock a user account and reset failed login counter.
    """
    service = UserService(db)
    return await service.unlock_user(user_id=user_id, admin_id=current_user.id)


# ================================================================
# POST /admin/users/{user_id}/reset-password (UC-2.1 — A1)
# ================================================================
@router.post("/users/{user_id}/reset-password", response_model=MessageResponse)
async def admin_reset_password(
    user_id: UUID,
    body: AdminResetPasswordRequest | None = None,
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Admin resets password for a user.
    If new_password is provided, set it directly. Otherwise, send reset email.
    """
    service = UserService(db)
    user_detail = await service.get_user(user_id)

    if body and body.new_password:
        await service.admin_set_password(
            user_id=user_id,
            admin_id=current_user.id,
            new_password=body.new_password,
        )
        return MessageResponse(
            message=f"Password has been reset for {user_detail['email']}"
        )

    reset_token = await service.admin_reset_password(
        user_id=user_id,
        admin_id=current_user.id,
    )

    # Send email
    await send_password_reset_email(
        to_email=user_detail["email"],
        reset_token=reset_token,
    )

    return MessageResponse(
        message=f"Password reset email sent to {user_detail['email']}"
    )


# ================================================================
# GET /admin/roles (UC-2.2)
# ================================================================
@router.get("/roles", response_model=RoleListResponse)
async def list_roles(
    current_user: User = AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    List all 4 fixed system roles.
    Used by frontend to populate role selection dropdowns.
    """
    service = UserService(db)
    roles = await service.list_roles()
    return {"roles": roles}
