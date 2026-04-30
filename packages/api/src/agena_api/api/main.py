import logging

import agena_core.http  # noqa: F401 – apply SSL patch before any httpx clients are created
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from sqlalchemy import text

from agena_api.api.middleware.auth_rate_limit import AuthRateLimitMiddleware
from agena_api.api.middleware.rate_limit import RateLimitMiddleware
from agena_api.api.middleware.request_id import RequestIDMiddleware
from agena_api.api.middleware.request_logger import RequestLoggerMiddleware
from agena_api.api.middleware.tenant import TenantMiddleware
from agena_api.api.routes import admin, agents, analytics, auth, billing, chatops, datadog, device_auth, flows, github, integration_rules, integrations, memory, modules, newrelic, notifications, org, preferences, public, refinement, repo_mappings, runtimes, saas_tasks, sentry, share, skills, tasks, usage_events, webhooks, ws
from agena_core.database import engine, SessionLocal
from agena_core.logging import configure_logging
from agena_core.observability import init_sentry
from agena_core.settings import get_settings
import agena_models.models  # noqa: F401 -- register all ORM models
from agena_core.db.base import Base

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)
init_sentry('api')

app = FastAPI(title=settings.app_name)

# Middleware stack (outermost first in execution order).
app.add_middleware(TenantMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(AuthRateLimitMiddleware)
app.add_middleware(RequestLoggerMiddleware)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
    expose_headers=['X-Request-ID'],
)

app.include_router(analytics.router)
app.include_router(auth.router)
app.include_router(device_auth.router)
app.include_router(org.router)
app.include_router(billing.router)
app.include_router(integrations.router)
app.include_router(tasks.router)
app.include_router(saas_tasks.router)
app.include_router(agents.router)
app.include_router(flows.router)
app.include_router(github.router)
app.include_router(newrelic.router)
app.include_router(sentry.router)
app.include_router(datadog.router)
app.include_router(modules.router)
app.include_router(preferences.router)
app.include_router(refinement.router)
app.include_router(skills.router)
app.include_router(runtimes.router)
app.include_router(repo_mappings.router)
app.include_router(integration_rules.router)
app.include_router(notifications.router)
app.include_router(usage_events.router)
app.include_router(memory.router)
app.include_router(webhooks.router)
app.include_router(chatops.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(public.router)
app.include_router(share.router)


@app.on_event('startup')
async def startup_event() -> None:
    logger.info('Starting API service')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Reap refinement jobs that were left in-flight by a previous process —
    # the asyncio task running them died with the old uvicorn worker, so the
    # row would otherwise stay 'running' forever and trap the UI in a loop.
    async with SessionLocal() as session:
        from datetime import datetime
        from sqlalchemy import update
        from agena_models.models.refinement_job import RefinementJob
        await session.execute(
            update(RefinementJob)
            .where(RefinementJob.status.in_(('queued', 'running')))
            .values(
                status='failed',
                error_message='Backend restarted before this refinement could finish.',
                completed_at=datetime.utcnow(),
            )
        )
        await session.commit()


@app.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/health/deep')
async def health_deep() -> dict:
    """Deep health check — verifies database, Redis, and Qdrant connectivity."""
    checks: dict[str, dict] = {}

    # Database
    try:
        async with SessionLocal() as session:
            await session.execute(text('SELECT 1'))
        checks['database'] = {'status': 'ok'}
    except Exception as e:
        checks['database'] = {'status': 'error', 'detail': str(e)}

    # Redis
    try:
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        await redis.ping()
        await redis.aclose()
        checks['redis'] = {'status': 'ok'}
    except Exception as e:
        checks['redis'] = {'status': 'error', 'detail': str(e)}

    # Qdrant (optional)
    if settings.qdrant_enabled:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f'{settings.qdrant_url}/healthz')
                if resp.status_code == 200:
                    checks['qdrant'] = {'status': 'ok'}
                else:
                    checks['qdrant'] = {'status': 'error', 'detail': f'HTTP {resp.status_code}'}
        except Exception as e:
            checks['qdrant'] = {'status': 'error', 'detail': str(e)}

    overall = 'ok' if all(c['status'] == 'ok' for c in checks.values()) else 'degraded'
    return {'status': overall, 'checks': checks}
