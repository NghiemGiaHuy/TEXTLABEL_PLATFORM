"""
app/api/v1/endpoints/dashboard.py
Dashboard summary: recent projects (with progress) + recent activity.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, cast, func, or_, select
from sqlalchemy import Date as SADate
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.middleware.auth_dependencies import get_current_user
from app.models.annotation import Annotation
from app.models.audit_log import AuditLog
from app.models.dataset import Dataset
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskSample, TaskSampleStatus
from app.models.user import RoleName, User

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


# ─── Schemas ──────────────────────────────────────────────────

class RecentProject(BaseModel):
    id: UUID
    name: str
    code: str
    deadline: Optional[str]
    status: str
    progress: float  # 0.0 – 1.0
    total_samples: int
    pending_review: int


class ActivityItem(BaseModel):
    id: UUID
    action: str
    entity_type: str
    user_id: Optional[UUID]
    user_full_name: Optional[str]
    created_at: datetime


class DashboardResponse(BaseModel):
    recent_projects: List[RecentProject]
    recent_activity: List[ActivityItem]


class DailyProgress(BaseModel):
    date: str
    count: int


class StatsResponse(BaseModel):
    total_samples: int
    annotated_count: int
    pending_review: int
    approved_count: int
    completion_rate: float
    daily_progress: List[DailyProgress]


# ─── Endpoint ─────────────────────────────────────────────────

@router.get("", response_model=DashboardResponse)
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_admin = RoleName.ADMIN.value in current_user.role_names

    # ── Recent projects (last 5, scoped by role) ──────────────
    # Correlated subqueries for per-project sample statistics
    total_samples_sub = (
        select(func.coalesce(func.sum(Dataset.total_samples), 0))
        .where(Dataset.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )

    annotated_samples_sub = (
        select(func.count(func.distinct(TaskSample.id)))
        .join(Task, TaskSample.task_id == Task.id)
        .join(Annotation, Annotation.task_sample_id == TaskSample.id)
        .where(Task.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )

    approved_samples_sub = (
        select(func.count(func.distinct(TaskSample.id)))
        .join(Task, TaskSample.task_id == Task.id)
        .where(Task.project_id == Project.id)
        .where(TaskSample.status == TaskSampleStatus.APPROVED)
        .correlate(Project)
        .scalar_subquery()
    )

    pending_review_sub = (
        select(func.count(func.distinct(TaskSample.id)))
        .join(Task, TaskSample.task_id == Task.id)
        .where(Task.project_id == Project.id)
        .where(TaskSample.status == TaskSampleStatus.SUBMITTED)
        .correlate(Project)
        .scalar_subquery()
    )

    proj_q = (
        select(
            Project.id,
            Project.name,
            Project.code,
            Project.deadline,
            total_samples_sub.label("total_samples"),
            annotated_samples_sub.label("annotated_samples"),
            approved_samples_sub.label("approved_samples"),
            pending_review_sub.label("pending_review"),
        )
        .order_by(Project.updated_at.desc())
        .limit(5)
    )

    if not is_admin:
        member_sub = select(ProjectMember.project_id).where(
            ProjectMember.user_id == current_user.id
        )
        proj_q = proj_q.where(
            or_(
                Project.created_by == current_user.id,
                Project.id.in_(member_sub),
            )
        )

    proj_rows = (await db.execute(proj_q)).all()

    recent_projects = []
    for row in proj_rows:
        total = int(row.total_samples or 0)
        annotated = int(row.annotated_samples or 0)
        approved = int(row.approved_samples or 0)

        # Compute status from sample data
        if total == 0 or annotated == 0:
            computed_status = "not_started"
        elif approved == total:
            computed_status = "completed"
        else:
            computed_status = "active"

        progress = round(annotated / total, 4) if total > 0 else 0.0
        deadline_str = row.deadline.isoformat() if row.deadline else None
        recent_projects.append(
            RecentProject(
                id=row.id,
                name=row.name,
                code=row.code,
                deadline=deadline_str,
                status=computed_status,
                progress=progress,
                total_samples=total,
                pending_review=int(row.pending_review or 0),
            )
        )

    # ── Recent activity (last 10, scoped by role) ─────────────
    act_q = (
        select(
            AuditLog.id,
            AuditLog.action,
            AuditLog.entity_type,
            AuditLog.user_id,
            AuditLog.created_at,
            User.full_name.label("user_full_name"),
        )
        .outerjoin(User, User.id == AuditLog.user_id)
        .order_by(AuditLog.created_at.desc())
        .limit(10)
    )

    if not is_admin:
        act_q = act_q.where(AuditLog.user_id == current_user.id)

    act_rows = (await db.execute(act_q)).all()

    recent_activity = [
        ActivityItem(
            id=row.id,
            action=row.action,
            entity_type=row.entity_type,
            user_id=row.user_id,
            user_full_name=row.user_full_name,
            created_at=row.created_at,
        )
        for row in act_rows
    ]

    return DashboardResponse(
        recent_projects=recent_projects,
        recent_activity=recent_activity,
    )


# ─── Stats Endpoint ───────────────────────────────────────────

@router.get("/stats", response_model=StatsResponse)
async def get_dashboard_stats(
    days: Optional[int] = Query(None, description="7, 30, or None for all-time"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    is_admin = RoleName.ADMIN.value in current_user.role_names

    # Resolve accessible project IDs for non-admin
    project_ids: Optional[list] = None
    if not is_admin:
        member_sub = select(ProjectMember.project_id).where(
            ProjectMember.user_id == current_user.id
        )
        proj_q = select(Project.id).where(
            or_(
                Project.created_by == current_user.id,
                Project.id.in_(member_sub),
            )
        )
        project_ids = (await db.execute(proj_q)).scalars().all()

    since = datetime.now(timezone.utc) - timedelta(days=days) if days else None

    def _scope_task(q):
        if project_ids is not None:
            q = q.where(Task.project_id.in_(project_ids))
        return q

    # ── total_samples ────────────────────────────────────────
    ds_q = select(func.coalesce(func.sum(Dataset.total_samples), 0))
    if project_ids is not None:
        ds_q = ds_q.where(Dataset.project_id.in_(project_ids))
    total_samples = int((await db.execute(ds_q)).scalar() or 0)

    # ── annotated_count: TaskSamples labeled in period ───────
    ann_q = (
        select(func.count(func.distinct(TaskSample.id)))
        .join(Task, TaskSample.task_id == Task.id)
        .join(Annotation, Annotation.task_sample_id == TaskSample.id)
    )
    ann_q = _scope_task(ann_q)
    if since:
        ann_q = ann_q.where(Annotation.created_at >= since)
    annotated_count = int((await db.execute(ann_q)).scalar() or 0)

    # ── pending_review: samples in submitted tasks ────────────
    pending_q = (
        select(func.count(func.distinct(TaskSample.id)))
        .join(Task, TaskSample.task_id == Task.id)
        .where(TaskSample.status == TaskSampleStatus.SUBMITTED)
    )
    pending_q = _scope_task(pending_q)
    pending_review = int((await db.execute(pending_q)).scalar() or 0)

    # ── approved_count ────────────────────────────────────────
    approved_q = (
        select(func.count(func.distinct(TaskSample.id)))
        .join(Task, TaskSample.task_id == Task.id)
        .where(TaskSample.status == TaskSampleStatus.APPROVED)
    )
    approved_q = _scope_task(approved_q)
    approved_count = int((await db.execute(approved_q)).scalar() or 0)

    completion_rate = round(approved_count / total_samples * 100, 1) if total_samples > 0 else 0.0

    # ── daily_progress: samples submitted per day ─────────────
    daily_q = (
        select(
            cast(Annotation.created_at, SADate).label("day"),
            func.count(func.distinct(TaskSample.id)).label("count"),
        )
        .select_from(Annotation)
        .join(TaskSample, TaskSample.id == Annotation.task_sample_id)
        .join(Task, TaskSample.task_id == Task.id)
        .group_by(cast(Annotation.created_at, SADate))
        .order_by(cast(Annotation.created_at, SADate))
    )
    daily_q = _scope_task(daily_q)
    if since:
        daily_q = daily_q.where(Annotation.created_at >= since)

    daily_rows = (await db.execute(daily_q)).all()
    daily_progress = [
        DailyProgress(date=str(row.day), count=int(row.count))
        for row in daily_rows
    ]

    return StatsResponse(
        total_samples=total_samples,
        annotated_count=annotated_count,
        pending_review=pending_review,
        approved_count=approved_count,
        completion_rate=completion_rate,
        daily_progress=daily_progress,
    )
