"""
app/core/database.py
Async SQLAlchemy engine, session factory, and Base model.
"""

from typing import AsyncGenerator
from uuid import uuid4

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


# --- Async Engine ---
engine_options = dict(
    echo=settings.DEBUG,
    pool_pre_ping=True,
    connect_args={
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
    },
)

if "pooler.supabase.com" in settings.DATABASE_URL:
    engine_options["connect_args"]["prepared_statement_name_func"] = (
        lambda: f"__asyncpg_{uuid4()}__"
    )
    engine_options["pool_pre_ping"] = False
    engine_options["pool_size"] = 5
    engine_options["max_overflow"] = 0
else:
    engine_options["pool_size"] = 20
    engine_options["max_overflow"] = 10

engine = create_async_engine(settings.DATABASE_URL, **engine_options)

# --- Session Factory ---
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# --- Base Model ---
class Base(DeclarativeBase):
    pass


# --- Dependency for FastAPI ---
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields a database session.
    Usage: db: AsyncSession = Depends(get_db)
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
