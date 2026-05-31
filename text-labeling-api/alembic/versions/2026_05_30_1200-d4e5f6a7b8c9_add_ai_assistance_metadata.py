"""add_ai_assistance_metadata

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-30 12:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "annotations",
        sa.Column(
            "is_ai_assisted",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "annotations",
        sa.Column("ai_model_name", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annotations", "ai_model_name")
    op.drop_column("annotations", "is_ai_assisted")
