import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import agents, auth, billing, github, integrations, org, preferences, saas_tasks, tasks
from core.database import engine
from core.logging import configure_logging
from core.settings import get_settings
from db import models  # noqa: F401
from db.base import Base

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth.router)
app.include_router(org.router)
app.include_router(billing.router)
app.include_router(integrations.router)
app.include_router(tasks.router)
app.include_router(saas_tasks.router)
app.include_router(agents.router)
app.include_router(github.router)
app.include_router(preferences.router)


@app.on_event('startup')
async def startup_event() -> None:
    logger.info('Starting API service')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get('/health')
async def health() -> dict[str, str]:
    return {'status': 'ok'}
