from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.integration_config import IntegrationConfig


class IntegrationConfigService:
    SUPPORTED_PROVIDERS = {'jira', 'azure', 'openai', 'gemini', 'github', 'playbook', 'slack', 'teams', 'telegram'}
    DEFAULT_BASE_URLS = {
        'openai': 'https://api.openai.com/v1',
        'gemini': 'https://generativelanguage.googleapis.com',
        'github': 'https://api.github.com',
        'playbook': 'tenant://playbook',
        'slack': 'https://hooks.slack.com/services',
        'teams': 'https://outlook.office.com/webhook',
    }

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_configs(self, organization_id: int) -> list[IntegrationConfig]:
        result = await self.db.execute(
            select(IntegrationConfig)
            .where(IntegrationConfig.organization_id == organization_id)
            .order_by(IntegrationConfig.provider.asc())
        )
        return list(result.scalars().all())

    async def get_config(self, organization_id: int, provider: str) -> IntegrationConfig | None:
        provider = provider.lower()
        self._validate_provider(provider)
        result = await self.db.execute(
            select(IntegrationConfig).where(
                IntegrationConfig.organization_id == organization_id,
                IntegrationConfig.provider == provider,
            )
        )
        return result.scalar_one_or_none()

    async def upsert_config(
        self,
        organization_id: int,
        provider: str,
        base_url: str | None,
        project: str | None,
        username: str | None,
        secret: str | None,
    ) -> IntegrationConfig:
        provider = provider.lower()
        self._validate_provider(provider)
        resolved_base_url = self._resolve_base_url(provider, base_url)

        existing = await self.get_config(organization_id, provider)
        if existing is None:
            if not secret:
                raise ValueError('Secret is required for first-time integration setup')

            existing = IntegrationConfig(
                organization_id=organization_id,
                provider=provider,
                base_url=resolved_base_url,
                project=project.strip() if project else None,
                username=username.strip() if username else None,
                secret=secret.strip(),
            )
            self.db.add(existing)
        else:
            existing.base_url = resolved_base_url
            existing.project = project.strip() if project else None
            existing.username = username.strip() if username else None
            if secret is not None and secret.strip():
                existing.secret = secret.strip()

        await self.db.commit()
        await self.db.refresh(existing)
        return existing

    async def delete_config(self, organization_id: int, provider: str) -> bool:
        provider = provider.lower()
        self._validate_provider(provider)
        existing = await self.get_config(organization_id, provider)
        if existing is None:
            return False
        await self.db.delete(existing)
        await self.db.commit()
        return True

    def to_public_dict(self, config: IntegrationConfig) -> dict[str, str | None | bool]:
        return {
            'provider': config.provider,
            'base_url': config.base_url,
            'project': config.project,
            'username': config.username,
            'has_secret': bool(config.secret),
            'secret_preview': self._mask_secret(config.secret),
            'updated_at': config.updated_at,
        }

    def _validate_provider(self, provider: str) -> None:
        if provider not in self.SUPPORTED_PROVIDERS:
            raise ValueError(f'Unsupported provider: {provider}')

    def _resolve_base_url(self, provider: str, base_url: str | None) -> str:
        value = (base_url or '').strip()
        if value:
            return value
        default = self.DEFAULT_BASE_URLS.get(provider)
        if default:
            return default
        raise ValueError(f'Base URL is required for provider: {provider}')

    def _mask_secret(self, secret: str | None) -> str | None:
        s = (secret or '').strip()
        if not s:
            return None
        if len(s) <= 6:
            head = s[:1]
            tail = s[-1:]
            return f'{head}{"*" * max(2, len(s) - 2)}{tail}'
        return f'{s[:4]}{"*" * max(4, len(s) - 8)}{s[-4:]}'
