"""register runtimes module

Revision ID: 7c771ad7939f
Revises: 3bb4644bdfa2
Create Date: 2026-04-23 21:48:53.892342

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7c771ad7939f'
down_revision = '3bb4644bdfa2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "INSERT IGNORE INTO modules (slug, name, description, icon, is_core, default_enabled, sort_order) VALUES "
        "('runtimes', 'Runtimes', 'Compute environments (local CLI bridges, cloud daemons) that execute agent tasks. Auto-register via the bridge or add manually.', '💻', 0, 1, 6)"
    )


def downgrade() -> None:
    op.execute("DELETE FROM modules WHERE slug = 'runtimes'")
