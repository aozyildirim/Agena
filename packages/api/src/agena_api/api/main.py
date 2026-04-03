import logging

import agena_core.http  # noqa: F401 – apply SSL patch before any httpx clients are created
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agena_api.api.middleware.rate_limit import RateLimitMiddleware
from agena_api.api.middleware.request_logger import RequestLoggerMiddleware
from agena_api.api.middleware.tenant import TenantMiddleware
from agena_api.api.routes import admin, agents, analytics, auth, billing, flows, github, integrations, memory, notifications, org, preferences, public, refinement, saas_tasks, tasks, usage_events, webhooks, ws
from agena_core.database import engine
from agena_core.logging import configure_logging
from agena_core.settings import get_settings
import agena_models.models  # noqa: F401 -- register all ORM models
from agena_core.db.base import Base

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)

app.add_middleware(TenantMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggerMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(analytics.router)
app.include_router(auth.router)
app.include_router(org.router)
app.include_router(billing.router)
app.include_router(integrations.router)
app.include_router(tasks.router)
app.include_router(saas_tasks.router)
app.include_router(agents.router)
app.include_router(flows.router)
app.include_router(github.router)
app.include_router(preferences.router)
app.include_router(refinement.router)
app.include_router(notifications.router)
app.include_router(usage_events.router)
app.include_router(memory.router)
app.include_router(webhooks.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(public.router)


@app.on_event('startup')
async def startup_event() -> None:
    logger.info('Starting API service')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}
