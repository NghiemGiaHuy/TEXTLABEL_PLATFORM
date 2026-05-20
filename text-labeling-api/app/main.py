"""
app/main.py
FastAPI application entry point.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import AsyncSessionLocal, engine, Base
from app.core.seed import run_seed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ================================================================
# Lifespan: startup / shutdown
# ================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create tables + seed. Shutdown: dispose engine."""
    logger.info(f"🚀 Starting {settings.APP_NAME} ({settings.APP_ENV})")

    # Create tables (dev only — use Alembic in production)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("📦 Database tables ensured")

    # Seed roles & admin
    async with AsyncSessionLocal() as session:
        await run_seed(session)

    yield

    # Shutdown
    await engine.dispose()
    logger.info("👋 Application shutdown complete")


# ================================================================
# App Factory
# ================================================================
app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Text Labeling Platform API — Phase 1",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Global Exception Handler ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "message": "Internal server error",
            "detail": str(exc) if settings.DEBUG else None,
        },
    )


# --- Routers ---
app.include_router(api_router)


# --- Health Check ---
@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy", "app": settings.APP_NAME, "env": settings.APP_ENV}


# ================================================================
# Run with: uvicorn app.main:app --reload
# ================================================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )