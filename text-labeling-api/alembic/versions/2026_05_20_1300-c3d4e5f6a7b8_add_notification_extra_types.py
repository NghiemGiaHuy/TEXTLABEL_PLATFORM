"""add_notification_extra_types

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-20 13:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE notification_type "
        "ADD VALUE IF NOT EXISTS 'ANNOTATION_MILESTONE'"
    )
    op.execute(
        "ALTER TYPE notification_type "
        "ADD VALUE IF NOT EXISTS 'EXPORT_READY'"
    )


def downgrade() -> None:
    # PostgreSQL does not support removing enum values safely in-place.
    pass
