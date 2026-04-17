"""add modules and organization_modules tables

Revision ID: e3d213530186
Revises: b6ff3524aaa0
Create Date: 2026-04-17 07:46:35.657817

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e3d213530186'
down_revision = 'b6ff3524aaa0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = [r[0] for r in conn.execute(sa.text("SHOW TABLES")).fetchall()]

    if 'modules' not in tables:
        op.create_table(
            'modules',
            sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
            sa.Column('slug', sa.String(64), nullable=False, unique=True),
            sa.Column('name', sa.String(128), nullable=False),
            sa.Column('description', sa.Text, nullable=True),
            sa.Column('icon', sa.String(8), server_default='📦'),
            sa.Column('is_core', sa.Boolean, nullable=False, server_default='0'),
            sa.Column('default_enabled', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        )

    if 'organization_modules' not in tables:
        op.create_table(
            'organization_modules',
            sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
            sa.Column('organization_id', sa.Integer, sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
            sa.Column('module_slug', sa.String(64), nullable=False),
            sa.Column('enabled', sa.Boolean, nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint('organization_id', 'module_slug', name='uq_org_module'),
        )

    # Seed default modules
    conn.execute(sa.text("""
        INSERT IGNORE INTO modules (slug, name, description, icon, is_core, default_enabled, sort_order) VALUES
        ('core', 'Core', 'Tasks, Office, Agents — always enabled', '🏠', 1, 1, 0),
        ('boss_mode', 'Boss Mode', 'Pixel-art office with visual agent management', '🎮', 0, 1, 1),
        ('sprints', 'Sprints & Team', 'Sprint board, Sprint Performance, Team management', '🗂', 0, 1, 2),
        ('permissions', 'Permissions', 'Role-based access control and custom permission management', '🔒', 0, 1, 3),
        ('refinement', 'Refinement', 'AI-powered task refinement and story analysis', '🔬', 0, 1, 4),
        ('flows', 'Flows & Templates', 'Visual flow builder and automation templates', '🔀', 0, 1, 5),
        ('playbook', 'Tenant Playbook', 'Organization-level coding rules and guidelines', '📖', 0, 1, 6),
        ('prompt_studio', 'Prompt Studio', 'Edit AI prompts at runtime', '✏️', 0, 1, 7),
        ('dora', 'DORA Analytics', 'Deployment frequency, lead time, change failure, MTTR', '📊', 0, 0, 8),
        ('github', 'GitHub', 'GitHub integration, PR creation, repo management', '🐙', 0, 0, 9),
        ('azure', 'Azure DevOps', 'Azure DevOps integration, sprints, work items', '☁️', 0, 0, 10),
        ('jira', 'Jira', 'Jira integration, sprint import, issue sync', '📋', 0, 0, 11),
        ('openai', 'OpenAI', 'OpenAI / GPT model provider', '⚡', 0, 1, 12),
        ('gemini', 'Gemini', 'Google Gemini model provider', '✦', 0, 0, 13),
        ('hal', 'HAL', 'HAL custom AI service integration', '🤖', 0, 0, 14),
        ('cli_agents', 'CLI Agents', 'Claude CLI and Codex CLI local agents', '⌨️', 0, 0, 15),
        ('sentry', 'Sentry', 'Import and auto-fix Sentry production errors', '🚨', 0, 0, 16),
        ('newrelic', 'New Relic', 'Import and auto-fix New Relic APM errors', '📡', 0, 0, 17),
        ('slack', 'Slack', 'Slack notifications and ChatOps commands', '💬', 0, 0, 18),
        ('teams', 'Microsoft Teams', 'Teams bot and notifications', '💜', 0, 0, 19),
        ('telegram', 'Telegram', 'Telegram bot notifications and commands', '✈️', 0, 0, 20),
        ('notifications', 'Notifications', 'Slack, Teams, Telegram integrations', '🔔', 0, 0, 21)
    """))


def downgrade() -> None:
    op.drop_table('organization_modules')
    op.drop_table('modules')
