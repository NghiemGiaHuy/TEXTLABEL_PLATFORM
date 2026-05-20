"""
app/models/user.py
User, Role, UserRole, RefreshToken, PasswordReset models.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin

import enum


# ============================================================
# Enums
# ============================================================

class UserStatus(str, enum.Enum):
    ACTIVE = "active"
    LOCKED = "locked"


class RoleName(str, enum.Enum):
    ADMIN = "admin"
    PROJECT_OWNER = "project_owner"
    ANNOTATOR = "annotator"
    REVIEWER = "reviewer"


# ============================================================
# Models
# ============================================================

class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[UserStatus] = mapped_column(
        SAEnum(UserStatus, name="user_status", create_constraint=True),
        default=UserStatus.ACTIVE,
        nullable=False,
    )
    failed_login_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    locked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notification_prefs: Mapped[Optional[dict]] = mapped_column(
        JSON, nullable=True, default=None
    )

    # --- Relationships ---
    user_roles: Mapped[List["UserRole"]] = relationship(
        back_populates="user", lazy="selectin", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[List["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    password_resets: Mapped[List["PasswordReset"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def roles(self) -> List["Role"]:
        """Convenience property to get role objects."""
        return [ur.role for ur in self.user_roles]

    @property
    def role_names(self) -> List[str]:
        """Get list of role name strings."""
        return [ur.role.name for ur in self.user_roles]

    @property
    def is_locked(self) -> bool:
        """Check if account is currently locked."""
        if self.status == UserStatus.LOCKED:
            return True
        if self.locked_until and self.locked_until > datetime.now(timezone.utc):
            return True
        return False

    def __repr__(self) -> str:
        return f"<User {self.email}>"


class Role(Base, UUIDMixin):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(
        SAEnum(RoleName, name="role_name", create_constraint=True),
        unique=True,
        nullable=False,
    )
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # --- Relationships ---
    user_roles: Mapped[List["UserRole"]] = relationship(
        back_populates="role", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<Role {self.name}>"


class UserRole(Base, UUIDMixin):
    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", name="uq_user_role"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    # --- Relationships ---
    user: Mapped["User"] = relationship(back_populates="user_roles")
    role: Mapped["Role"] = relationship(back_populates="user_roles", lazy="joined")


class RefreshToken(Base, UUIDMixin):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(
        String(500), unique=True, index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    # --- Relationships ---
    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


class PasswordReset(Base, UUIDMixin):
    __tablename__ = "password_resets"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(
        String(500), unique=True, index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    is_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )

    # --- Relationships ---
    user: Mapped["User"] = relationship(back_populates="password_resets")
