from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.integration_config import IntegrationConfig


class IntegrationConfigService:
    SUPPORTED_PROVIDERS = {'jira', 'azure', 'openai'}

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
        base_url: str,
        project: str | None,
        username: str | None,
        secret: str | None,
    ) -> IntegrationConfig:
        provider = provider.lower()
        self._validate_provider(provider)

        existing = await self.get_config(organization_id, provider)
        if existing is None:
            if not secret:
                raise ValueError('Secret is required for first-time integration setup')

            existing = IntegrationConfig(
                organization_id=organization_id,
                provider=provider,
                base_url=base_url.strip(),
                project=project.strip() if project else None,
                username=username.strip() if username else None,
                secret=secret.strip(),
            )
            self.db.add(existing)
        else:
            existing.base_url = base_url.strip()
            existing.project = project.strip() if project else None
            existing.username = username.strip() if username else None
            if secret is not None and secret.strip():
                existing.secret = secret.strip()

        await self.db.commit()
        await self.db.refresh(existing)
        return existing

    def to_public_dict(self, config: IntegrationConfig) -> dict[str, str | None | bool]:
        return {
            'provider': config.provider,
            'base_url': config.base_url,
            'project': config.project,
            'username': config.username,
            'has_secret': bool(config.secret),
            'updated_at': config.updated_at,
        }

    def _validate_provider(self, provider: str) -> None:
        if provider not in self.SUPPORTED_PROVIDERS:
            raise ValueError(f'Unsupported provider: {provider}')
