"""register skills module

Revision ID: 3528e72ff789
Revises: 7b924c519bfc
Create Date: 2026-04-23 21:04:33.190162

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3528e72ff789'
down_revision = '7b924c519bfc'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "INSERT IGNORE INTO modules (slug, name, description, icon, is_core, default_enabled, sort_order) VALUES "
        "('skills', 'Skills', 'Reusable patterns extracted from completed tasks — auto-injected into agent prompts.', '🧠', 0, 1, 5)"
    )


def downgrade() -> None:
    op.execute("DELETE FROM modules WHERE slug = 'skills'")
