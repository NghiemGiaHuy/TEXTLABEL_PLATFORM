"""add_project_priority_objective

Revision ID: a1b2c3d4e5f6
Revises: d42a541ee3e9
Create Date: 2026-05-09 12:00:00.000000+00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'd42a541ee3e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

project_priority = sa.Enum('immediate', 'high', 'normal', name='project_priority', create_constraint=True)


def upgrade() -> None:
    project_priority.create(op.get_bind(), checkfirst=True)
    op.add_column(
        'projects',
        sa.Column(
            'priority',
            project_priority,
            nullable=False,
            server_default='normal',
        ),
    )
    op.add_column(
        'projects',
        sa.Column('objective', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('projects', 'objective')
    op.drop_column('projects', 'priority')
    project_priority.drop(op.get_bind(), checkfirst=True)
