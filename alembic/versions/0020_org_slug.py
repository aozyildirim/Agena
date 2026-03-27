"""add slug column to organizations

Revision ID: 0020_org_slug
Revises: 0010_notification_records
Create Date: 2026-03-26 10:00:00
"""

import re

from alembic import op
import sqlalchemy as sa


revision = '0020_org_slug'
down_revision = '0010_notification_records'
branch_labels = None
depends_on = None


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug[:63] or 'org'


def upgrade() -> None:
    # Skip if slug already exists (added to 0001_initial for fresh installs)
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_name='organizations' AND column_name='slug'"
    ))
    if result.scalar():
        return

    # 1. Add nullable slug column
    op.add_column('organizations', sa.Column('slug', sa.String(63), nullable=True))

    # 2. Backfill existing orgs with a slugified version of their name
    orgs = conn.execute(sa.text('SELECT id, name FROM organizations')).fetchall()
    seen: dict[str, int] = {}
    for org_id, org_name in orgs:
        base_slug = _slugify(org_name)
        slug = base_slug
        counter = seen.get(base_slug, 0)
        if counter > 0:
            slug = f'{base_slug}-{counter}'
        seen[base_slug] = counter + 1
        conn.execute(
            sa.text('UPDATE organizations SET slug = :slug WHERE id = :id'),
            {'slug': slug, 'id': org_id},
        )

    # 3. Make slug non-nullable and add unique index
    op.alter_column('organizations', 'slug', nullable=False, existing_type=sa.String(63))
    op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_organizations_slug', table_name='organizations')
    op.drop_column('organizations', 'slug')
