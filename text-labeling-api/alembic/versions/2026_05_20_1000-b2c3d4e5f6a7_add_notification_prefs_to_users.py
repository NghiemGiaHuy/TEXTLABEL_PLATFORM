"""add_notification_prefs_to_users

Revision ID: b2c3d4e5f6a7
Revises: a9b8c7d6e5f4
Create Date: 2026-05-20 10:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a9b8c7d6e5f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("notification_prefs", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "notification_prefs")
