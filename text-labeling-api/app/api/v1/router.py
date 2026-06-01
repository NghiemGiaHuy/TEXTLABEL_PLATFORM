"""
app/api/v1/router.py
Aggregates all v1 endpoint routers.
"""

from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth,
    users,
    projects,
    label_sets,
    datasets,
    tasks,
    annotations,
    reviews,
    exports,
    dashboard,
    notifications,
)

api_router = APIRouter(prefix="/api/v1")

# --- Module routers ---
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(users.public_router)
api_router.include_router(projects.router)
api_router.include_router(label_sets.router)
api_router.include_router(datasets.router)
api_router.include_router(tasks.router)
api_router.include_router(annotations.router)
api_router.include_router(reviews.router)
api_router.include_router(exports.router)
api_router.include_router(dashboard.router)
api_router.include_router(notifications.router)
