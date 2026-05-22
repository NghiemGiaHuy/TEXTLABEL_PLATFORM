"""
app/services/annotation_service.py
Business logic for Annotation CRUD, Drafts, Task lifecycle (UC-4.x).
"""

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    BadRequestException,
    ForbiddenException,
    NotFoundException,
)
from app.models.annotation import Annotation, AnnotationDraft
from app.models.dataset import DataSample
from app.models.label import Label, LabelSet
from app.models.notification import NotificationType
from app.models.project import Guideline, Project, ProjectMember, ProjectRole
from app.models.task import (
    AnnotationType,
    Task,
    TaskSample,
    TaskSampleStatus,
    TaskStatus,
)
from app.models.user import RoleName, User
from app.services.notification_service import create_notification


class AnnotationService:
    """Handles annotation CRUD, drafts, and annotator task lifecycle."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # MY TASKS (UC-4.1)
    # ================================================================

    async def my_tasks(
        self,
        current_user: User,
        project_id: Optional[UUID] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        query = select(Task).where(Task.assignee_id == current_user.id)
        count_query = select(func.count(Task.id)).where(
            Task.assignee_id == current_user.id
        )
        filters = []

        if project_id:
            filters.append(Task.project_id == project_id)
        if status:
            try:
                filters.append(Task.status == TaskStatus(status))
            except ValueError:
                raise BadRequestException(f"Invalid status: '{status}'")

        if filters:
            query = query.where(and_(*filters))
            count_query = count_query.where(and_(*filters))

        total = (await self.db.execute(count_query)).scalar() or 0
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        query = (
            query.order_by(Task.assigned_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        tasks = result.scalars().unique().all()

        return {
            "tasks": [
                {
                    "id": t.id,
                    "project_id": t.project_id,
                    "project_name": t.project.name if t.project else None,
                    "sample_count": len(t.task_samples),
                    "status": t.status.value,
                    "deadline": t.project.deadline if t.project else None,
                    "assigned_at": t.assigned_at,
                }
                for t in tasks
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    # ================================================================
    # START TASK (UC-4.1 — step 5)
    # ================================================================

    async def start_task(self, task_id: UUID, current_user: User) -> dict:
        task = await self._get_my_task(task_id, current_user)
        if task.status != TaskStatus.TODO:
            raise BadRequestException(
                f"Can only start tasks with 'todo' status (current: {task.status.value})"
            )
        task.status = TaskStatus.IN_PROGRESS
        task.started_at = datetime.now(timezone.utc)
        await self.db.flush()
        return {"status": "in_progress", "started_at": task.started_at}

    # ================================================================
    # GET SAMPLE FOR ANNOTATION (UC-4.2 — step 1)
    # ================================================================

    async def get_sample(
        self, task_id: UUID, task_sample_id: UUID, current_user: User
    ) -> dict:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        # Load annotations
        ann_result = await self.db.execute(
            select(Annotation)
            .options(selectinload(Annotation.label))
            .where(Annotation.task_sample_id == ts.id)
            .order_by(Annotation.start_offset)
        )
        annotations = ann_result.scalars().all()

        if annotations and ts.status == TaskSampleStatus.PENDING:
            ts.status = TaskSampleStatus.ANNOTATED
            await self.db.flush()
        elif not annotations and ts.status == TaskSampleStatus.ANNOTATED:
            ts.status = TaskSampleStatus.PENDING
            await self.db.flush()

        # Load draft
        draft_result = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_sample_id == ts.id
            )
        )
        draft = draft_result.scalar_one_or_none()

        # Load only the label set selected when this task was assigned.
        labels = await self._get_project_labels(
            task.project_id,
            task.label_set_id,
        )

        # Get guideline version
        gv_result = await self.db.execute(
            select(func.max(Guideline.version)).where(
                Guideline.project_id == task.project_id
            )
        )
        guideline_version = gv_result.scalar()

        return {
            "task_sample_id": ts.id,
            "data_sample_id": ts.data_sample_id,
            "content": ts.data_sample.content,
            "metadata": ts.data_sample.metadata_,
            "status": ts.status.value,
            "annotations": [
                self._build_annotation_response(a) for a in annotations
            ],
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
            "labels": labels,
            "guideline_version": guideline_version,
        }

    async def get_sample_entities(
        self, task_id: UUID, task_sample_id: UUID, current_user: User
    ) -> List[dict]:
        """Load NER entities for the same underlying data sample."""
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        result = await self.db.execute(
            select(Annotation)
            .join(TaskSample, Annotation.task_sample_id == TaskSample.id)
            .join(Task, TaskSample.task_id == Task.id)
            .options(selectinload(Annotation.label))
            .where(
                and_(
                    Task.project_id == task.project_id,
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

        seen: set[tuple[int, int, UUID]] = set()
        entities = []
        for ann in result.scalars().unique().all():
            key = (ann.start_offset, ann.end_offset, ann.label_id)
            if key in seen:
                continue
            seen.add(key)
            entities.append(self._build_annotation_response(ann))
        return entities

    # ================================================================
    # CREATE ANNOTATION (UC-4.2 — step 3)
    # ================================================================

    async def create_annotation(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        current_user: User,
        label_id: UUID,
        start_offset: int,
        end_offset: int,
        selected_text: str,
    ) -> dict:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        # Validate offsets
        if start_offset >= end_offset:
            raise BadRequestException("start_offset must be less than end_offset")
        if end_offset > len(ts.data_sample.content):
            raise BadRequestException("end_offset exceeds text length")

        # Validate label belongs to the task's assigned label set.
        await self._validate_label(
            label_id,
            task.project_id,
            task.label_set_id,
        )

        annotation = Annotation(
            task_sample_id=ts.id,
            label_id=label_id,
            start_offset=start_offset,
            end_offset=end_offset,
            selected_text=selected_text,
            created_by=current_user.id,
        )
        self.db.add(annotation)

        # Any label edit means the sample is back in progress until marked done.
        ts.status = TaskSampleStatus.ANNOTATED

        await self.db.flush()
        await self.db.refresh(annotation, ["label"])
        return self._build_annotation_response(annotation)

    # ================================================================
    # UPDATE ANNOTATION (UC-4.2 — step 5)
    # ================================================================

    async def update_annotation(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        annotation_id: UUID,
        current_user: User,
        **kwargs,
    ) -> dict:
        task = await self._get_my_task(task_id, current_user)
        await self._get_task_sample(task_sample_id, task.id)
        annotation = await self._get_annotation_or_404(
            annotation_id, task_sample_id
        )

        if "label_id" in kwargs and kwargs["label_id"] is not None:
            await self._validate_label(
                kwargs["label_id"],
                task.project_id,
                task.label_set_id,
            )
            annotation.label_id = kwargs["label_id"]
        if "start_offset" in kwargs and kwargs["start_offset"] is not None:
            annotation.start_offset = kwargs["start_offset"]
        if "end_offset" in kwargs and kwargs["end_offset"] is not None:
            annotation.end_offset = kwargs["end_offset"]
        if "selected_text" in kwargs and kwargs["selected_text"] is not None:
            annotation.selected_text = kwargs["selected_text"]

        ts = await self._get_task_sample(task_sample_id, task.id)
        ts.status = TaskSampleStatus.ANNOTATED

        await self.db.flush()
        await self.db.refresh(annotation, ["label"])
        return self._build_annotation_response(annotation)

    # ================================================================
    # DELETE ANNOTATION (UC-4.2 — step 5)
    # ================================================================

    async def delete_annotation(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        annotation_id: UUID,
        current_user: User,
    ) -> None:
        task = await self._get_my_task(task_id, current_user)
        await self._get_task_sample(task_sample_id, task.id)
        annotation = await self._get_annotation_or_404(
            annotation_id, task_sample_id
        )
        await self.db.delete(annotation)
        await self.db.flush()

        remaining_result = await self.db.execute(
            select(Annotation.id)
            .where(Annotation.task_sample_id == task_sample_id)
            .limit(1)
        )
        ts = await self._get_task_sample(task_sample_id, task.id)
        if remaining_result.scalar_one_or_none() is None:
            ts.status = TaskSampleStatus.PENDING
        else:
            ts.status = TaskSampleStatus.ANNOTATED
        await self.db.flush()

    # ================================================================
    # BULK UPDATE ANNOTATIONS (UC-4.2 — A1 undo/redo)
    # ================================================================

    async def bulk_update_annotations(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        current_user: User,
        annotations_data: List[dict],
    ) -> List[dict]:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        # Delete existing annotations
        old_result = await self.db.execute(
            select(Annotation).where(
                Annotation.task_sample_id == ts.id
            )
        )
        for old_ann in old_result.scalars().all():
            await self.db.delete(old_ann)
        await self.db.flush()

        # Create new annotations
        new_annotations = []
        for data in annotations_data:
            await self._validate_label(
                data["label_id"],
                task.project_id,
                task.label_set_id,
            )
            ann = Annotation(
                task_sample_id=ts.id,
                label_id=data["label_id"],
                start_offset=data["start_offset"],
                end_offset=data["end_offset"],
                selected_text=data["selected_text"],
                created_by=current_user.id,
            )
            self.db.add(ann)
            new_annotations.append(ann)

        if new_annotations:
            ts.status = TaskSampleStatus.ANNOTATED
        else:
            ts.status = TaskSampleStatus.PENDING

        await self.db.flush()
        for ann in new_annotations:
            await self.db.refresh(ann, ["label"])

        return [self._build_annotation_response(a) for a in new_annotations]

    # ================================================================
    # MARK SAMPLE STATUS (annotator toggle done/undone)
    # ================================================================

    async def mark_sample_status(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        current_user: User,
        status: str,
    ) -> dict:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        allowed = {TaskSampleStatus.ANNOTATED, TaskSampleStatus.DONE}
        try:
            new_status = TaskSampleStatus(status)
        except ValueError:
            raise BadRequestException("Invalid status transition")
        if new_status not in allowed:
            raise BadRequestException("Invalid status transition")

        ts.status = new_status
        await self.db.flush()
        return {"task_sample_id": str(ts.id), "status": ts.status.value}

    # ================================================================
    # DRAFT (UC-4.2 — step 6, NF-09)
    # ================================================================

    async def save_draft(
        self,
        task_id: UUID,
        task_sample_id: UUID,
        current_user: User,
        draft_data: Dict[str, Any],
    ) -> dict:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        # Upsert draft
        result = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_sample_id == ts.id
            )
        )
        draft = result.scalar_one_or_none()

        if draft:
            draft.draft_data = draft_data
            draft.auto_saved_at = datetime.now(timezone.utc)
        else:
            draft = AnnotationDraft(
                task_sample_id=ts.id,
                draft_data=draft_data,
                auto_saved_at=datetime.now(timezone.utc),
            )
            self.db.add(draft)

        await self.db.flush()
        return {
            "id": draft.id,
            "task_sample_id": draft.task_sample_id,
            "draft_data": draft.draft_data,
            "auto_saved_at": draft.auto_saved_at,
        }

    async def get_draft(
        self, task_id: UUID, task_sample_id: UUID, current_user: User
    ) -> Optional[dict]:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        result = await self.db.execute(
            select(AnnotationDraft).where(
                AnnotationDraft.task_sample_id == ts.id
            )
        )
        draft = result.scalar_one_or_none()
        if not draft:
            return None
        return {
            "id": draft.id,
            "task_sample_id": draft.task_sample_id,
            "draft_data": draft.draft_data,
            "auto_saved_at": draft.auto_saved_at,
        }

    # ================================================================
    # SUBMIT TASK (UC-4.2 — step 7)
    # ================================================================

    async def submit_task(self, task_id: UUID, current_user: User) -> dict:
        task = await self._get_my_task(task_id, current_user)
        if task.status not in (TaskStatus.IN_PROGRESS, TaskStatus.REWORK):
            raise BadRequestException(
                f"Can only submit tasks in 'in_progress' or 'rework' status "
                f"(current: {task.status.value})"
            )

        complete_statuses = {TaskSampleStatus.DONE}
        if task.status == TaskStatus.REWORK:
            complete_statuses.update(
                {TaskSampleStatus.APPROVED, TaskSampleStatus.SUBMITTED}
            )

        if any(ts.status not in complete_statuses for ts in task.task_samples):
            raise BadRequestException(
                "Còn sample chưa hoàn thành, hãy gán nhãn rồi bấm nút 'Xong'"
            )

        # Update statuses so completed samples become reviewable.
        for ts in task.task_samples:
            if ts.status == TaskSampleStatus.DONE:
                ts.status = TaskSampleStatus.SUBMITTED

        task.status = TaskStatus.SUBMITTED
        task.submitted_at = datetime.now(timezone.utc)
        await self.db.flush()

        await self._notify_reviewers_task_submitted(task, current_user)

        return {"status": "submitted", "submitted_at": task.submitted_at}

    # ================================================================
    # REJECTION FEEDBACK (for annotator rework view)
    # ================================================================

    async def get_rejection_feedback(
        self, task_id: UUID, current_user: User
    ) -> dict:
        """Return latest rejection feedback per sample for the annotator's task."""
        from app.models.review import Review, ReviewResult  # avoid circular import

        task = await self._get_my_task(task_id, current_user)

        result = await self.db.execute(
            select(Review)
            .join(TaskSample, Review.task_sample_id == TaskSample.id)
            .where(
                TaskSample.task_id == task.id,
                Review.result == ReviewResult.REJECTED,
            )
            .order_by(Review.reviewed_at.desc())
        )
        reviews = result.scalars().all()

        feedback: dict = {}
        for review in reviews:
            sid = str(review.task_sample_id)
            if sid not in feedback:
                reviewer_name = None
                if review.reviewer:
                    reviewer_name = review.reviewer.full_name
                feedback[sid] = {
                    "feedback": review.feedback,
                    "reviewer_name": reviewer_name,
                    "reviewed_at": review.reviewed_at.isoformat(),
                }

        return {"feedback": feedback}

    # ================================================================
    # NAVIGATE (UC-4.2 — A2)
    # ================================================================

    async def get_adjacent(
        self, task_id: UUID, task_sample_id: UUID, current_user: User
    ) -> dict:
        task = await self._get_my_task(task_id, current_user)
        ts = await self._get_task_sample(task_sample_id, task.id)

        sorted_samples = sorted(task.task_samples, key=lambda s: s.sample_order)
        current_idx = next(
            (i for i, s in enumerate(sorted_samples) if s.id == ts.id), 0
        )

        return {
            "prev_sample_id": (
                sorted_samples[current_idx - 1].id
                if current_idx > 0
                else None
            ),
            "next_sample_id": (
                sorted_samples[current_idx + 1].id
                if current_idx < len(sorted_samples) - 1
                else None
            ),
            "current_index": current_idx,
            "total_samples": len(sorted_samples),
        }

    # ================================================================
    # MY STATS (UC-4.3)
    # ================================================================

    async def my_stats(
        self,
        current_user: User,
        project_id: Optional[UUID] = None,
    ) -> dict:
        base_filter = Task.assignee_id == current_user.id
        if project_id:
            base_filter = and_(base_filter, Task.project_id == project_id)

        result = await self.db.execute(
            select(
                func.count(Task.id).label("total"),
                func.count(case((Task.status == TaskStatus.APPROVED, 1))).label(
                    "completed"
                ),
                func.count(
                    case((Task.status == TaskStatus.IN_PROGRESS, 1))
                ).label("in_progress"),
                func.count(case((Task.status == TaskStatus.REWORK, 1))).label(
                    "rework"
                ),
            ).where(base_filter)
        )
        row = result.one()
        total = row.total or 0
        completed = row.completed or 0

        return {
            "total_tasks": total,
            "completed": completed,
            "in_progress": row.in_progress or 0,
            "rework": row.rework or 0,
            "approval_rate": round(completed / total, 4) if total > 0 else 0.0,
            "avg_time_per_sample": None,
            "daily_progress": [],
        }

    # ================================================================
    # Private Helpers
    # ================================================================

    async def _notify_reviewers_task_submitted(
        self,
        task: Task,
        actor: User,
    ) -> None:
        if task.reviewer_id:
            recipient_ids = [task.reviewer_id]
        else:
            result = await self.db.execute(
                select(ProjectMember.user_id).where(
                    and_(
                        ProjectMember.project_id == task.project_id,
                        ProjectMember.role_in_project.in_(
                            [ProjectRole.REVIEWER, ProjectRole.PROJECT_OWNER]
                        ),
                    )
                )
            )
            recipient_ids = [row[0] for row in result.all()]

        project_result = await self.db.execute(
            select(Project.name).where(Project.id == task.project_id)
        )
        project_name = project_result.scalar_one_or_none() or "dự án"
        actor_name = actor.full_name or actor.email

        seen = set()
        for recipient_id in recipient_ids:
            if recipient_id == actor.id or recipient_id in seen:
                continue
            seen.add(recipient_id)
            await create_notification(
                self.db,
                user_id=recipient_id,
                type=NotificationType.TASK_SUBMITTED,
                title="Task được nộp để review",
                message=f"{actor_name} đã nộp task trong {project_name}.",
                link=f"/review/{task.project_id}/{task.id}",
                actor_name=actor_name,
            )

    async def _get_my_task(self, task_id: UUID, user: User) -> Task:
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

        # Allow assignee, reviewer (for viewing), or admin
        if (
            task.assignee_id != user.id
            and RoleName.ADMIN.value not in user.role_names
        ):
            # Check if user is a reviewer in this project
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
            if not member_result.scalar_one_or_none():
                raise ForbiddenException("You don't have access to this task")

        return task

    async def _get_task_sample(
        self, task_sample_id: UUID, task_id: UUID
    ) -> TaskSample:
        result = await self.db.execute(
            select(TaskSample)
            .options(selectinload(TaskSample.data_sample))
            .where(
                and_(
                    TaskSample.id == task_sample_id,
                    TaskSample.task_id == task_id,
                )
            )
        )
        ts = result.scalar_one_or_none()
        if not ts:
            raise NotFoundException(
                f"TaskSample '{task_sample_id}' not found in this task"
            )
        return ts

    async def _get_annotation_or_404(
        self, annotation_id: UUID, task_sample_id: UUID
    ) -> Annotation:
        result = await self.db.execute(
            select(Annotation).where(
                and_(
                    Annotation.id == annotation_id,
                    Annotation.task_sample_id == task_sample_id,
                )
            )
        )
        ann = result.scalar_one_or_none()
        if not ann:
            raise NotFoundException(f"Annotation '{annotation_id}' not found")
        return ann

    async def _validate_label(
        self,
        label_id: UUID,
        project_id: UUID,
        label_set_id: Optional[UUID] = None,
    ) -> None:
        filters = [Label.id == label_id, LabelSet.project_id == project_id]
        if label_set_id:
            filters.append(Label.label_set_id == label_set_id)

        result = await self.db.execute(
            select(Label)
            .join(LabelSet, Label.label_set_id == LabelSet.id)
            .where(and_(*filters))
        )
        if not result.scalar_one_or_none():
            if label_set_id:
                raise BadRequestException(
                    f"Label '{label_id}' does not belong to this task's label set"
                )
            raise BadRequestException(
                f"Label '{label_id}' does not belong to this project"
            )

    async def _get_project_labels(
        self,
        project_id: UUID,
        label_set_id: Optional[UUID] = None,
    ) -> List[dict]:
        filters = [LabelSet.project_id == project_id]
        if label_set_id:
            filters.append(Label.label_set_id == label_set_id)

        result = await self.db.execute(
            select(Label)
            .join(LabelSet, Label.label_set_id == LabelSet.id)
            .where(and_(*filters))
            .order_by(Label.sort_order)
        )
        return [
            {
                "id": l.id,
                "name": l.name,
                "color": l.color,
                "shortcut_key": l.shortcut_key,
                "is_required": l.is_required,
            }
            for l in result.scalars().all()
        ]

    async def _get_required_label_ids(self, project_id: UUID) -> set:
        result = await self.db.execute(
            select(Label.id)
            .join(LabelSet, Label.label_set_id == LabelSet.id)
            .where(
                and_(
                    LabelSet.project_id == project_id,
                    Label.is_required == True,
                )
            )
        )
        return {row[0] for row in result.all()}

    def _build_annotation_response(self, a: Annotation) -> dict:
        return {
            "id": a.id,
            "task_sample_id": a.task_sample_id,
            "label_id": a.label_id,
            "label_name": a.label.name if a.label else None,
            "label_color": a.label.color if a.label else None,
            "start_offset": a.start_offset,
            "end_offset": a.end_offset,
            "selected_text": a.selected_text,
            "created_by": a.created_by,
            "is_ai_generated": a.is_ai_generated,
            "ai_confidence": a.ai_confidence,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
        }
