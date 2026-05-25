"""
app/services/auth_service.py
Business logic for authentication: login, logout, token refresh, password reset.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.exceptions import (
    AccountLockedException,
    BadRequestException,
    NotFoundException,
    UnauthorizedException,
)
from app.core.security import (
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import (
    PasswordReset,
    RefreshToken,
    User,
    UserRole,
    UserStatus,
)
from app.models.audit_log import AuditLog


def _hash_token(token: str) -> str:
    """Hash a token for secure storage (SHA-256)."""
    return hashlib.sha256(token.encode()).hexdigest()


class AuthService:
    """Handles all authentication business logic."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # LOGIN (UC-1.1)
    # ================================================================

    async def login(self, email: str, password: str, ip_address: str = None) -> dict:
        """
        Authenticate user with email and password.
        Returns tokens and user info.

        Business Rules:
        - E1: Wrong credentials → generic error message
        - E2: Locked account → 423 with remaining lockout time
        - E3: 5 consecutive failures → auto-lock 15 minutes
        """
        # 1. Find user by email
        user = await self._get_user_by_email(email)

        if not user:
            # Don't reveal whether email exists
            raise UnauthorizedException("Invalid email or password")

        # 2. Check if account is locked (by admin or auto-lock)
        if user.status == UserStatus.LOCKED:
            raise AccountLockedException(minutes_remaining=0)

        if user.locked_until and user.locked_until > datetime.now(timezone.utc):
            remaining = (user.locked_until - datetime.now(timezone.utc)).seconds // 60
            raise AccountLockedException(minutes_remaining=remaining + 1)

        # Clear expired auto-lock
        if user.locked_until and user.locked_until <= datetime.now(timezone.utc):
            user.locked_until = None
            user.failed_login_count = 0

        # 3. Verify password
        if not verify_password(password, user.password_hash):
            user.failed_login_count += 1

            # Auto-lock after MAX_LOGIN_ATTEMPTS
            if user.failed_login_count >= settings.MAX_LOGIN_ATTEMPTS:
                user.locked_until = datetime.now(timezone.utc) + timedelta(
                    minutes=settings.LOCKOUT_DURATION_MINUTES
                )
                await self.db.flush()
                raise AccountLockedException(
                    minutes_remaining=settings.LOCKOUT_DURATION_MINUTES
                )

            await self.db.flush()
            raise UnauthorizedException("Invalid email or password")

        # 4. Successful login → reset failed count
        user.failed_login_count = 0
        user.locked_until = None

        # 5. Generate tokens
        token_data = {"sub": str(user.id)}
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        # 6. Store refresh token hash in DB
        rt = RefreshToken(
            user_id=user.id,
            token_hash=_hash_token(refresh_token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
        self.db.add(rt)

        # 7. Audit log
        self.db.add(
            AuditLog(
                user_id=user.id,
                action="LOGIN",
                entity_type="user",
                entity_id=user.id,
                ip_address=ip_address,
            )
        )

        await self.db.flush()

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            "user": self._build_user_response(user),
        }

    # ================================================================
    # LOGOUT (UC-1.2)
    # ================================================================

    async def logout(self, refresh_token: str, user_id: UUID) -> None:
        """
        Revoke refresh token on logout.
        """
        token_hash = _hash_token(refresh_token)
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.user_id == user_id,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        rt = result.scalar_one_or_none()
        if rt:
            rt.is_revoked = True
            await self.db.flush()

    # ================================================================
    # REFRESH TOKEN
    # ================================================================

    async def refresh_access_token(self, refresh_token: str) -> dict:
        """
        Validate refresh token and issue new access + refresh tokens.
        Implements token rotation: old refresh token is revoked.
        """
        # 1. Decode token
        payload = decode_token(refresh_token)
        if not payload or payload.get("type") != "refresh":
            raise UnauthorizedException("Invalid refresh token")

        user_id = payload.get("sub")
        if not user_id:
            raise UnauthorizedException("Invalid refresh token")

        # 2. Check token exists and not revoked in DB
        token_hash = _hash_token(refresh_token)
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        stored_token = result.scalar_one_or_none()
        if not stored_token:
            raise UnauthorizedException("Refresh token revoked or not found")

        # 3. Check token not expired (DB-level check)
        if stored_token.expires_at < datetime.now(timezone.utc):
            stored_token.is_revoked = True
            await self.db.flush()
            raise UnauthorizedException("Refresh token expired")

        # 4. Revoke old refresh token (rotation)
        stored_token.is_revoked = True

        # 5. Get user
        user = await self._get_user_by_id(UUID(user_id))
        if not user or user.is_locked:
            raise UnauthorizedException("Account not available")

        # 6. Issue new tokens
        token_data = {"sub": str(user.id)}
        new_access = create_access_token(token_data)
        new_refresh = create_refresh_token(token_data)

        # 7. Store new refresh token
        new_rt = RefreshToken(
            user_id=user.id,
            token_hash=_hash_token(new_refresh),
            expires_at=datetime.now(timezone.utc)
            + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
        self.db.add(new_rt)
        await self.db.flush()

        return {
            "access_token": new_access,
            "refresh_token": new_refresh,
            "token_type": "bearer",
            "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    # ================================================================
    # FORGOT PASSWORD (UC-1.3)
    # ================================================================

    async def forgot_password(self, email: str) -> Optional[str]:
        """
        Generate password reset token and return it.
        Returns token string (caller sends email) or None if email not found.
        Always returns success to client (don't reveal email existence).
        """
        user = await self._get_user_by_email(email)
        if not user:
            return None  # Caller still returns 200

        # Invalidate any existing reset tokens for this user
        result = await self.db.execute(
            select(PasswordReset).where(
                and_(
                    PasswordReset.user_id == user.id,
                    PasswordReset.is_used.is_(False),
                )
            )
        )
        for old_token in result.scalars().all():
            old_token.is_used = True

        # Create new reset token
        reset_token = create_password_reset_token(str(user.id))
        pr = PasswordReset(
            user_id=user.id,
            token_hash=_hash_token(reset_token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
        )
        self.db.add(pr)
        await self.db.flush()

        return reset_token

    # ================================================================
    # RESET PASSWORD (UC-1.3)
    # ================================================================

    async def reset_password(self, token: str, new_password: str) -> None:
        """
        Validate reset token and update user password.
        """
        # 1. Decode JWT token
        payload = decode_token(token)
        if not payload or payload.get("type") != "password_reset":
            raise BadRequestException("Invalid or expired reset token")

        user_id = payload.get("sub")
        if not user_id:
            raise BadRequestException("Invalid reset token")

        # 2. Verify token in DB (not used, not expired)
        token_hash = _hash_token(token)
        result = await self.db.execute(
            select(PasswordReset).where(
                and_(
                    PasswordReset.token_hash == token_hash,
                    PasswordReset.is_used.is_(False),
                )
            )
        )
        stored_reset = result.scalar_one_or_none()
        if not stored_reset:
            raise BadRequestException("Reset token already used or not found")

        if stored_reset.expires_at < datetime.now(timezone.utc):
            raise BadRequestException("Reset token has expired. Please request a new one.")

        # 3. Update password
        user = await self._get_user_by_id(UUID(user_id))
        if not user:
            raise BadRequestException("User not found")

        user.password_hash = hash_password(new_password)

        # 4. Mark token as used
        stored_reset.is_used = True

        # 5. Revoke all refresh tokens (force re-login)
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.user_id == user.id,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        for rt in result.scalars().all():
            rt.is_revoked = True

        # 6. Audit log
        self.db.add(
            AuditLog(
                user_id=user.id,
                action="PASSWORD_RESET",
                entity_type="user",
                entity_id=user.id,
            )
        )

        await self.db.flush()

    # ================================================================
    # PROFILE (UC-1.4)
    # ================================================================

    async def get_current_user(self, user_id: UUID) -> User:
        user = await self._get_user_by_id(user_id)
        if not user:
            raise NotFoundException("User not found")
        return user

    async def update_profile(
        self, user_id: UUID, full_name: str = None, avatar_url: str = None
    ) -> User:
        user = await self._get_user_by_id(user_id)
        if not user:
            raise NotFoundException("User not found")

        if full_name is not None:
            user.full_name = full_name
        if avatar_url is not None:
            user.avatar_url = avatar_url

        await self.db.flush()
        return user

    async def change_password(
        self, user_id: UUID, current_password: str, new_password: str
    ) -> None:
        user = await self._get_user_by_id(user_id)
        if not user:
            raise NotFoundException("User not found")

        if not verify_password(current_password, user.password_hash):
            raise BadRequestException("Current password is incorrect")

        user.password_hash = hash_password(new_password)

        # Revoke all refresh tokens except current session
        result = await self.db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.user_id == user.id,
                    RefreshToken.is_revoked.is_(False),
                )
            )
        )
        for rt in result.scalars().all():
            rt.is_revoked = True

        self.db.add(
            AuditLog(
                user_id=user.id,
                action="PASSWORD_CHANGED",
                entity_type="user",
                entity_id=user.id,
            )
        )

        await self.db.flush()

    # ================================================================
    # Private Helpers
    # ================================================================

    async def _get_user_by_email(self, email: str) -> Optional[User]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.user_roles).selectinload(UserRole.role))
            .where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def _get_user_by_id(self, user_id: UUID) -> Optional[User]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.user_roles).selectinload(UserRole.role))
            .where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    def _build_user_response(self, user: User) -> dict:
        return {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "avatar_url": user.avatar_url,
            "roles": user.role_names,
            "status": user.status.value,
            "created_at": user.created_at,
        }
