"""
app/api/v1/endpoints/auth.py
Auth endpoints: login, logout, refresh, forgot/reset password, profile.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    RefreshTokenRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateProfileRequest,
    UserResponse,
)
from app.services.auth_service import AuthService
from app.utils.email import send_password_reset_email

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ================================================================
# POST /auth/login (UC-1.1)
# ================================================================
@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate with email and password.
    Returns JWT access token, refresh token, and user info.
    """
    service = AuthService(db)
    ip = request.client.host if request.client else None
    result = await service.login(
        email=body.email,
        password=body.password,
        ip_address=ip,
    )
    return result


# ================================================================
# POST /auth/logout (UC-1.2)
# ================================================================
@router.post("/logout", response_model=MessageResponse)
async def logout(
    body: RefreshTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Logout: revoke the refresh token.
    Requires valid access token in Authorization header.
    """
    service = AuthService(db)
    await service.logout(
        refresh_token=body.refresh_token,
        user_id=current_user.id,
    )
    return MessageResponse(message="Logged out successfully")


# ================================================================
# POST /auth/refresh
# ================================================================
@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    body: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Refresh access token using a valid refresh token.
    Implements token rotation (old refresh token is revoked).
    """
    service = AuthService(db)
    result = await service.refresh_access_token(body.refresh_token)
    return result


# ================================================================
# POST /auth/forgot-password (UC-1.3)
# ================================================================
@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Request password reset. Sends email with reset link.
    Always returns 200 regardless of whether email exists (security).
    """
    service = AuthService(db)
    reset_token = await service.forgot_password(email=body.email)

    if reset_token:
        await send_password_reset_email(
            to_email=body.email,
            reset_token=reset_token,
        )

    return MessageResponse(
        message="If your email is registered, you will receive a password reset link."
    )


# ================================================================
# POST /auth/reset-password (UC-1.3)
# ================================================================
@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Reset password using token from email.
    Revokes all existing refresh tokens (forces re-login).
    """
    service = AuthService(db)
    await service.reset_password(
        token=body.token,
        new_password=body.new_password,
    )
    return MessageResponse(message="Password has been reset successfully. Please log in.")


# ================================================================
# GET /auth/me (UC-1.4)
# ================================================================
@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """Get current authenticated user's profile."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        avatar_url=current_user.avatar_url,
        roles=current_user.role_names,
        status=current_user.status.value,
        created_at=current_user.created_at,
    )


# ================================================================
# PUT /auth/me (UC-1.4)
# ================================================================
@router.put("/me", response_model=UserResponse)
async def update_me(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user's profile (name, avatar)."""
    service = AuthService(db)
    user = await service.update_profile(
        user_id=current_user.id,
        full_name=body.full_name,
        avatar_url=body.avatar_url,
    )
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        avatar_url=user.avatar_url,
        roles=user.role_names,
        status=user.status.value,
        created_at=user.created_at,
    )


# ================================================================
# PUT /auth/me/password (UC-1.4)
# ================================================================
@router.put("/me/password", response_model=MessageResponse)
async def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Change password. Requires current password for verification.
    Revokes all refresh tokens (forces re-login on other devices).
    """
    service = AuthService(db)
    await service.change_password(
        user_id=current_user.id,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    return MessageResponse(message="Password changed successfully")