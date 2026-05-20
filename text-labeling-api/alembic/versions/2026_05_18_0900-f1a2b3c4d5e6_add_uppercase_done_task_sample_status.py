"""add_uppercase_done_task_sample_status

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2, c4d5e6f7a8b9
Create Date: 2026-05-18 09:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = (
    'e7f8a9b0c1d2',
    'c4d5e6f7a8b9',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE task_sample_status ADD VALUE IF NOT EXISTS 'DONE' AFTER 'ANNOTATED'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; manual cleanup required.
    pass
