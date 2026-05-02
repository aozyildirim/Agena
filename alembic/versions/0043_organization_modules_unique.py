"""add unique constraint on (organization_id, module_slug)

Revision ID: 0043_organization_modules_unique
Revises: 0042_seed_reviews_module
Create Date: 2026-05-02 02:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '0043_organization_modules_unique'
down_revision = '0042_seed_reviews_module'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # Defensive dedupe — keeps the highest id row per (org, slug).
    conn.execute(sa.text(
        "DELETE om1 FROM organization_modules om1 "
        "INNER JOIN organization_modules om2 "
        "WHERE om1.id < om2.id "
        "  AND om1.organization_id = om2.organization_id "
        "  AND om1.module_slug = om2.module_slug"
    ))
    # Skip if the constraint already exists (e.g. dev DB with prior manual fix)
    has_constraint = conn.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.table_constraints "
        "WHERE table_name='organization_modules' "
        "  AND constraint_name='uq_org_modules_slug'"
    )).scalar()
    if not has_constraint:
        op.create_unique_constraint(
            'uq_org_modules_slug',
            'organization_modules',
            ['organization_id', 'module_slug'],
        )


def downgrade() -> None:
    op.drop_constraint('uq_org_modules_slug', 'organization_modules', type_='unique')
