"""
app/services/review_service.py
Business logic for Review & QA (UC-5.1).
"""

import math
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import case
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    BadRequestException,
    ForbiddenException,
    NotFoundException,
)
from app.models.annotation import Annotation, AnnotationDraft
from app.models.audit_log import AuditLog
from app.models.label import Label
from app.models.notification import NotificationType
from app.models.project import Guideline, Project, ProjectMember, ProjectRole
from app.models.review import Review, ReviewResult
from app.models.task import (
    AnnotationType,
    Task,
    TaskSample,
    TaskSampleStatus,
    TaskStatus,
)
from app.models.user import RoleName, User
from app.services.notification_service import create_notification


class ReviewService:
    """Handles review queue, approve/reject, status propagation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # REVIEW QUEUE (UC-5.1 — step 1)
    # ================================================================

    async def get_queue(
        self,
        current_user: User,
        project_id: Optional[UUID] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """Get review queue: submitted task_samples in reviewer's projects."""
        # Get projects where user is a reviewer
        reviewer_projects = await self.db.execute(
            select(ProjectMember.project_id, ProjectMember.role_in_project).where(
                and_(
                    ProjectMember.user_id == current_user.id,
                    ProjectMember.role_in_project.in_(
                        [ProjectRole.REVIEWER, ProjectRole.PROJECT_OWNER]
                    ),
                )
            )
        )
        reviewer_project_ids = set()
        owner_project_ids = set()
        for project_member in reviewer_projects.all():
            project_id_value = project_member[0]
            role_value = project_member[1]
            if role_value == ProjectRole.PROJECT_OWNER:
                owner_project_ids.add(project_id_value)
            else:
                reviewer_project_ids.add(project_id_value)
        project_ids = reviewer_project_ids | owner_project_ids

        if RoleName.ADMIN.value in current_user.role_names:
            # Admin can review any project
            if project_id:
                project_ids = {project_id}
            else:
                all_projects = await self.db.execute(select(Project.id))
                project_ids = {row[0] for row in all_projects.all()}
        elif project_id:
            if project_id not in project_ids:
                raise ForbiddenException(
                    "You are not a reviewer in this project"
                )
            project_ids = {project_id}
            reviewer_project_ids &= project_ids
            owner_project_ids &= project_ids

        if not project_ids:
            return {
                "queue": [], "total": 0,
                "page": page, "page_size": page_size, "total_pages": 1,
            }

        scope_filters = [Task.project_id.in_(project_ids)]
        if RoleName.ADMIN.value not in current_user.role_names:
            assignment_filters = []
            if reviewer_project_ids:
                assignment_filters.append(
                    and_(
                        Task.project_id.in_(reviewer_project_ids),
                        or_(
                            Task.reviewer_id.is_(None),
                            Task.reviewer_id == current_user.id,
                        ),
                    )
                )
            if owner_project_ids:
                assignment_filters.append(Task.project_id.in_(owner_project_ids))
            if assignment_filters:
                scope_filters.append(or_(*assignment_filters))

        # Query submitted task_samples
        query = (
            select(TaskSample)
            .join(Task, TaskSample.task_id == Task.id)
            .options(
                selectinload(TaskSample.task).selectinload(Task.project),
                selectinload(TaskSample.task).selectinload(Task.assignee),
                selectinload(TaskSample.data_sample),
            )
            .where(
                and_(
                    *scope_filters,
                    TaskSample.status == TaskSampleStatus.SUBMITTED,
                )
            )
        )
        count_query = (
            select(func.count(TaskSample.id))
            .join(Task, TaskSample.task_id == Task.id)
            .where(
                and_(
                    *scope_filters,
                    TaskSample.status == TaskSampleStatus.SUBMITTED,
                )
            )
        )

        total = (await self.db.execute(count_query)).scalar() or 0
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        query = (
            query.order_by(Task.submitted_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        samples = result.scalars().unique().all()

        return {
            "queue": [
                {
                    "task_sample_id": ts.id,
                    "task_id": ts.task_id,
                    "project_id": ts.task.project_id,
                    "project_name": (
                        ts.task.project.name if ts.task.project else None
                    ),
                    "annotator_name": (
                        ts.task.assignee.full_name
                        if ts.task.assignee
                        else None
                    ),
                    "content_preview": (
                        ts.data_sample.content[:200]
                        if ts.data_sample
                        else None
                    ),
                    "submitted_at": ts.task.submitted_at,
                }
                for ts in samples
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    # ================================================================
    # GET SAMPLE FOR REVIEW (UC-5.1 — step 2-3)
    # ================================================================

    async def get_review_sample(
        self, task_id: UUID, task_sample_id: UUID, current_user: User
    ) -> dict:
        await self._check_reviewer_access(task_id, current_user)

        ts_result = await self.db.execute(
            select(TaskSample)
            .options(selectinload(TaskSample.data_sample))
            .where(
                and_(
                    TaskSample.id == task_sample_id,
                    TaskSample.task_id == task_id,
                )
            )
        )
        ts = ts_result.scalar_one_or_none()
        if not ts:
            raise NotFoundException("TaskSample not found in this task")

        # Load annotations
        ann_result = await self.db.execute(
            select(Annotation)
            .options(selectinload(Annotation.label).selectinload(Label.group))
            .where(Annotation.task_sample_id == ts.id)
            .order_by(Annotation.start_offset)
        )
        annotations = ann_result.scalars().all()

        draft_result = await self.db.execute(
            select(AnnotationDraft).where(AnnotationDraft.task_sample_id == ts.id)
        )
        draft = draft_result.scalar_one_or_none()

        # Load review history
        rev_result = await self.db.execute(
            select(Review)
            .options(selectinload(Review.reviewer))
            .where(Review.task_sample_id == ts.id)
            .order_by(Review.reviewed_at.desc())
        )
        reviews = rev_result.scalars().all()

        # Task info for annotator name
        task = await self.db.execute(
            select(Task)
            .options(selectinload(Task.assignee))
            .where(Task.id == task_id)
        )
        task_obj = task.scalar_one()

        # Guideline version
        gv = await self.db.execute(
            select(func.max(Guideline.version)).where(
                Guideline.project_id == task_obj.project_id
            )
        )

        related_entities = []
        if task_obj.annotation_type == AnnotationType.RELATION_EXTRACTION:
            entity_result = await self.db.execute(
                select(Annotation)
                .join(TaskSample, Annotation.task_sample_id == TaskSample.id)
                .join(Task, TaskSample.task_id == Task.id)
                .options(selectinload(Annotation.label).selectinload(Label.group))
                .where(
                    and_(
                        Task.project_id == task_obj.project_id,
                        TaskSample.data_sample_id == ts.data_sample_id,
                        or_(
                            Task.annotation_type.in_(
                                [
                                    AnnotationType.NER,
                                    AnnotationType.SEQUENCE_LABELING,
                                ]
                            ),
                            Task.annotation_type.is_(None),
                        ),
                        Annotation.start_offset < Annotation.end_offset,
                    )
                )
                .order_by(Annotation.start_offset, Annotation.end_offset)
            )

            seen_entities: set[tuple[int, int, UUID]] = set()
            for entity in entity_result.scalars().unique().all():
                key = (entity.start_offset, entity.end_offset, entity.label_id)
                if key in seen_entities:
                    continue
                seen_entities.add(key)
                related_entities.append(self._build_review_annotation(entity))

        return {
            "task_sample_id": ts.id,
            "task_id": task_id,
            "content": ts.data_sample.content,
            "metadata": ts.data_sample.metadata_,
            "annotations": [self._build_review_annotation(a) for a in annotations],
            "related_entities": related_entities,
            "draft": (
                {
                    "id": draft.id,
                    "task_sample_id": draft.task_sample_id,
                    "draft_data": draft.draft_data,
                    "auto_saved_at": draft.auto_saved_at,
                }
                if draft
                else None
            ),
            "annotator_name": (
                task_obj.assignee.full_name if task_obj.assignee else None
            ),
            "guideline_version": gv.scalar(),
            "review_history": [
                {
                    "id": r.id,
                    "task_sample_id": r.task_sample_id,
                    "reviewer_id": r.reviewer_id,
                    "reviewer_name": (
                        r.reviewer.full_name if r.reviewer else None
                    ),
                    "result": r.result.value,
                    "feedback": r.feedback,
                    "reviewed_at": r.reviewed_at,
                }
                for r in reviews
            ],
        }

    # ================================================================
    # APPROVE (UC-5.1 — step 6a)
    # ================================================================

    async def approve(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        current_user: User,
        feedback: Optional[str] = None,
    ) -> dict:
        task = await self._check_reviewer_access(task_id, current_user)
        if task.status != TaskStatus.SUBMITTED:
            raise BadRequestException(
                f"Can only review samples while task is submitted "
                f"(current: {task.status.value})"
            )
        ts = await self._get_submitted_sample(task_sample_id, task_id)

        # Create review record
        review = Review(
            task_sample_id=ts.id,
            reviewer_id=current_user.id,
            result=ReviewResult.APPROVED,
            feedback=feedback,
        )
        self.db.add(review)

        # Update sample status
        ts.status = TaskSampleStatus.APPROVED

        # Check if all samples in task are approved → task approved
        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="APPROVE_SAMPLE",
                entity_type="task_sample",
                entity_id=ts.id,
            )
        )
        await self.db.flush()

        return self._build_review_response(review)

    # ================================================================
    # REJECT (UC-5.1 — step 6b)
    # ================================================================

    async def reject(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        current_user: User,
        feedback: str,
    ) -> dict:
        task = await self._check_reviewer_access(task_id, current_user)
        if task.status != TaskStatus.SUBMITTED:
            raise BadRequestException(
                f"Can only review samples while task is submitted "
                f"(current: {task.status.value})"
            )
        ts = await self._get_submitted_sample(task_sample_id, task_id)

        review = Review(
            task_sample_id=ts.id,
            reviewer_id=current_user.id,
            result=ReviewResult.REJECTED,
            feedback=feedback,
        )
        self.db.add(review)

        # Record the sample decision. The task is finalized when the reviewer
        # submits the full review.
        ts.status = TaskSampleStatus.REJECTED

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="REJECT_SAMPLE",
                entity_type="task_sample",
                entity_id=ts.id,
                details={"feedback": feedback},
            )
        )
        await self.db.flush()

        return self._build_review_response(review)

    # ================================================================
    # REVIEWER STATS (UC-5.1)
    # ================================================================

    async def submit_review(
        self,
        task_id: UUID,
        current_user: User,
    ) -> dict:
        task = await self._check_reviewer_access(task_id, current_user)

        if task.status != TaskStatus.SUBMITTED:
            raise BadRequestException(
                f"Can only submit review for submitted tasks "
                f"(current: {task.status.value})"
            )

        result = await self.db.execute(
            select(TaskSample.status).where(TaskSample.task_id == task.id)
        )
        statuses = [row[0] for row in result.all()]

        if not statuses:
            raise BadRequestException("Task has no samples to review")

        pending_count = sum(
            1 for status in statuses if status == TaskSampleStatus.SUBMITTED
        )
        if pending_count:
            raise BadRequestException(
                f"Still have {pending_count} sample(s) waiting for review"
            )

        approved_count = sum(
            1 for status in statuses if status == TaskSampleStatus.APPROVED
        )
        rejected_count = sum(
            1 for status in statuses if status == TaskSampleStatus.REJECTED
        )
        unexpected_statuses = {
            status.value
            for status in statuses
            if status not in (TaskSampleStatus.APPROVED, TaskSampleStatus.REJECTED)
        }
        if unexpected_statuses:
            raise BadRequestException(
                "All samples must be approved or rejected before submitting review"
            )

        if rejected_count:
            task.status = TaskStatus.REWORK
            message = "Đã chuyển task lại cho annotator"
        else:
            task.status = TaskStatus.APPROVED
            task.completed_at = datetime.now(timezone.utc)
            message = "Hoàn thành task"

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="SUBMIT_REVIEW",
                entity_type="task",
                entity_id=task.id,
                details={
                    "status": task.status.value,
                    "approved_count": approved_count,
                    "rejected_count": rejected_count,
                },
            )
        )
        await self.db.flush()

        await self._notify_annotator_review_finished(
            task=task,
            actor=current_user,
            approved_count=approved_count,
            rejected_count=rejected_count,
        )

        return {
            "status": task.status.value,
            "message": message,
            "approved_count": approved_count,
            "rejected_count": rejected_count,
        }

    async def my_stats(self, current_user: User) -> dict:
        result = await self.db.execute(
            select(
                func.count(Review.id).label("total"),
                func.count(
                    case((Review.result == ReviewResult.APPROVED, 1))
                ).label("approved"),
                func.count(
                    case((Review.result == ReviewResult.REJECTED, 1))
                ).label("rejected"),
            ).where(Review.reviewer_id == current_user.id)
        )
        row = result.one()
        return {
            "total_reviewed": row.total or 0,
            "approved_count": row.approved or 0,
            "rejected_count": row.rejected or 0,
            "avg_review_time": None,
        }

    # ================================================================
    # Private Helpers
    # ================================================================

    async def _notify_annotator_review_finished(
        self,
        *,
        task: Task,
        actor: User,
        approved_count: int,
        rejected_count: int,
    ) -> None:
        project_result = await self.db.execute(
            select(Project.name, Project.created_by).where(Project.id == task.project_id)
        )
        project_row = project_result.one_or_none()
        project_name = project_row[0] if project_row else "dự án"
        project_owner_id = project_row[1] if project_row else None
        actor_name = actor.full_name or actor.email

        if rejected_count:
            await create_notification(
                self.db,
                user_id=task.assignee_id,
                type=NotificationType.TASK_REJECTED,
                title="Task bị từ chối",
                message=(
                    f"{actor_name} đã yêu cầu sửa lại task trong {project_name} "
                    f"({rejected_count} mẫu cần xử lý)."
                ),
                link=f"/workspace/{task.id}",
                actor_name=actor_name,
            )
            return

        await create_notification(
            self.db,
            user_id=task.assignee_id,
            type=NotificationType.REVIEW_COMPLETE,
            title="Review hoàn tất",
            message=(
                f"{actor_name} đã duyệt task trong {project_name} "
                f"({approved_count} mẫu được chấp nhận)."
            ),
            link=f"/workspace/{task.id}",
            actor_name=actor_name,
        )

        if project_owner_id and project_owner_id != task.assignee_id:
            await create_notification(
                self.db,
                user_id=project_owner_id,
                type=NotificationType.EXPORT_READY,
                title="Task sẵn sàng export",
                message=(
                    f"Task trong {project_name} đã được duyệt xong bởi {actor_name} "
                    f"({approved_count} mẫu). Bạn có thể export dữ liệu."
                ),
                link=f"/projects/{task.project_id}?tab=completed_tasks",
                actor_name=actor_name,
            )

    async def _check_reviewer_access(
        self, task_id: UUID, user: User
    ) -> Task:
        result = await self.db.execute(
            select(Task)
            .options(
                selectinload(Task.task_samples).selectinload(
                    TaskSample.data_sample
                )
            )
            .where(Task.id == task_id)
        )
        task = result.scalar_one_or_none()
        if not task:
            raise NotFoundException(f"Task '{task_id}' not found")

        if RoleName.ADMIN.value in user.role_names:
            return task

        # Check reviewer membership
        member_result = await self.db.execute(
            select(ProjectMember).where(
                and_(
                    ProjectMember.project_id == task.project_id,
                    ProjectMember.user_id == user.id,
                    ProjectMember.role_in_project.in_(
                        [ProjectRole.REVIEWER, ProjectRole.PROJECT_OWNER]
                    ),
                )
            )
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise ForbiddenException(
                "You must be a reviewer or PO in this project"
            )
        if (
            task.reviewer_id
            and task.reviewer_id != user.id
            and member.role_in_project != ProjectRole.PROJECT_OWNER
        ):
            raise ForbiddenException(
                "This task is assigned to a different reviewer"
            )
        return task

    async def _get_submitted_sample(
        self, task_sample_id: UUID, task_id: UUID
    ) -> TaskSample:
        result = await self.db.execute(
            select(TaskSample).where(
                and_(
                    TaskSample.id == task_sample_id,
                    TaskSample.task_id == task_id,
                )
            )
        )
        ts = result.scalar_one_or_none()
        if not ts:
            raise NotFoundException("TaskSample not found in this task")
        if ts.status not in (
            TaskSampleStatus.SUBMITTED,
            TaskSampleStatus.REJECTED,
        ):
            raise BadRequestException(
                f"Sample must be in 'submitted' or 'rejected' status "
                f"to review (current: {ts.status.value})"
            )
        return ts

    async def _propagate_task_status(self, task: Task) -> None:
        """
        If ALL samples in a task are approved, mark the task approved.
        UC-5.1: approve last sample → task → approved.
        """
        # Re-fetch fresh sample statuses
        result = await self.db.execute(
            select(TaskSample.status).where(TaskSample.task_id == task.id)
        )
        statuses = {row[0] for row in result.all()}

        if statuses == {TaskSampleStatus.APPROVED}:
            task.status = TaskStatus.APPROVED
            task.completed_at = datetime.now(timezone.utc)

    def _build_review_response(self, r: Review) -> dict:
        return {
            "id": r.id,
            "task_sample_id": r.task_sample_id,
            "reviewer_id": r.reviewer_id,
            "reviewer_name": r.reviewer.full_name if r.reviewer else None,
            "result": r.result.value,
            "feedback": r.feedback,
            "reviewed_at": r.reviewed_at,
        }

    def _build_review_annotation(self, annotation: Annotation) -> dict:
        return {
            "id": annotation.id,
            "label_id": annotation.label_id,
            "label_name": annotation.label.name if annotation.label else None,
            "label_color": annotation.label.color if annotation.label else None,
            "label_group_id": (
                annotation.label.label_group_id if annotation.label else None
            ),
            "label_group_name": (
                annotation.label.group.name
                if annotation.label and annotation.label.group
                else None
            ),
            "start_offset": annotation.start_offset,
            "end_offset": annotation.end_offset,
            "selected_text": annotation.selected_text,
        }
