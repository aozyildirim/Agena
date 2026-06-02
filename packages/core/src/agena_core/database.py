from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from agena_core.settings import get_settings

settings = get_settings()

# Pool sizing + hygiene. The defaults (size=5, overflow=10 → 15 total) are
# too tight for a dashboard that fans out many concurrent reads, several of
# which hold their request-scope session across multi-second external calls
# (Azure/Jira/GitHub). Under that load the pool would drain and requests
# block on pool_timeout, and cancelled requests occasionally leaked a
# connection — eventually deadlocking the whole API. We give generous
# headroom (50 total, well under MySQL's 151 max_connections), fail fast
# instead of hanging forever when starved (pool_timeout), and recycle idle
# connections so stale ones can't accumulate (pool_recycle).
engine = create_async_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=30,
    pool_timeout=20,
    pool_recycle=1800,
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
