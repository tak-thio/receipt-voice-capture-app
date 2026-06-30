from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

# Runtime connects as the restricted (RLS-bound) role, never the owner/superuser.
engine = create_async_engine(settings.runtime_database_url, pool_pre_ping=True, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

# Owner (RLS-bypass) connection for trusted, cross-tenant system flows that have no
# tenant principal (e.g. the Play RTDN webhook). Always scope queries by explicit id.
owner_engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)
OwnerSessionLocal = async_sessionmaker(owner_engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        async with session.begin():
            yield session


async def set_rls_context(session: AsyncSession, user_id: UUID | None) -> None:
    """Bind the current user for Row Level Security.

    Uses a transaction-local setting (`set_config(..., is_local=true)`) so RLS
    policies can evaluate `current_setting('app.current_user_id')`. Tenant
    isolation is then enforced by the database, not by application WHERE clauses.
    """
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id) if user_id else ""},
    )
