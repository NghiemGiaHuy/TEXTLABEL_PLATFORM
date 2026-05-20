"""add_annotation_type_to_tasks

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-05-12 10:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

annotation_type_enum = sa.Enum(
    'TEXT_CLASSIFICATION',
    'SEQUENCE_LABELING',
    name='annotation_type',
    create_constraint=True,
)


def upgrade() -> None:
    annotation_type_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'tasks',
        sa.Column(
            'annotation_type',
            annotation_type_enum,
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column('tasks', 'annotation_type')
    annotation_type_enum.drop(op.get_bind(), checkfirst=True)
