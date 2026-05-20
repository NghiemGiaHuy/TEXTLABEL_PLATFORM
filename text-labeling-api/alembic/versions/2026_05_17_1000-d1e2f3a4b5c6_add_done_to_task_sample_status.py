"""add_done_to_task_sample_status

Revision ID: d1e2f3a4b5c6
Revises: b3c4d5e6f7a8
Create Date: 2026-05-17 10:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE task_sample_status ADD VALUE IF NOT EXISTS 'DONE' AFTER 'ANNOTATED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; manual cleanup required
    pass
