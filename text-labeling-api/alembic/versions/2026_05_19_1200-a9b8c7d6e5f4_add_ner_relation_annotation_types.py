"""add_ner_relation_annotation_types

Revision ID: a9b8c7d6e5f4
Revises: f1a2b3c4d5e6
Create Date: 2026-05-19 12:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a9b8c7d6e5f4"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE annotation_type ADD VALUE IF NOT EXISTS 'NER'"
    )
    op.execute(
        "ALTER TYPE annotation_type ADD VALUE IF NOT EXISTS 'RELATION_EXTRACTION'"
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values without recreating the type.
    pass
