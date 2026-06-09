"""add_task_name

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-09 10:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE tasks "
        "ADD COLUMN IF NOT EXISTS task_name VARCHAR(255)"
    )
    op.execute(
        """
        UPDATE tasks
        SET task_name = datasets.name
        FROM datasets
        WHERE tasks.dataset_id = datasets.id
          AND (tasks.task_name IS NULL OR BTRIM(tasks.task_name) = '')
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS task_name")
