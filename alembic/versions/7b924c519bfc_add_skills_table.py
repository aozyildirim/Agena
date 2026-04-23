"""add skills table

Revision ID: 7b924c519bfc
Revises: b7c8d9e0f1a2
Create Date: 2026-04-23 20:51:33.344404

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7b924c519bfc'
down_revision = 'b7c8d9e0f1a2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'skills',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), nullable=False),
        sa.Column('source_task_id', sa.Integer(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(256), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('pattern_type', sa.String(48), nullable=False, server_default='other'),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('touched_files', sa.JSON(), nullable=True),
        sa.Column('approach_summary', sa.Text(), nullable=True),
        sa.Column('prompt_fragment', sa.Text(), nullable=True),
        sa.Column('qdrant_key', sa.String(128), nullable=True),
        sa.Column('usage_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['source_task_id'], ['task_records.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_skills_organization_id', 'skills', ['organization_id'])
    op.create_index('ix_skills_source_task_id', 'skills', ['source_task_id'])
    op.create_index('ix_skills_name', 'skills', ['name'])
    op.create_index('ix_skills_pattern_type', 'skills', ['pattern_type'])
    op.create_index('ix_skills_qdrant_key', 'skills', ['qdrant_key'])
    op.create_index('ix_skills_created_at', 'skills', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_skills_created_at', table_name='skills')
    op.drop_index('ix_skills_qdrant_key', table_name='skills')
    op.drop_index('ix_skills_pattern_type', table_name='skills')
    op.drop_index('ix_skills_name', table_name='skills')
    op.drop_index('ix_skills_source_task_id', table_name='skills')
    op.drop_index('ix_skills_organization_id', table_name='skills')
    op.drop_table('skills')
