"""
app/services/task_service.py
Business logic for Task Assignment (UC-3.5).
Supports manual and round-robin assignment methods.
"""

import math
from datetime import datetime, timezone
from typing import Awaitable, Callable, List, Optional
from uuid import UUID

from sqlalchemy.orm import selectinload
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.models.audit_log import AuditLog
from app.models.dataset import DataSample, Dataset, DatasetStatus
from app.models.label import LabelSet
from app.models.notification import NotificationType
from app.models.project import Project, ProjectMember, ProjectRole
from app.models.task import (
    AnnotationType,
    AssignmentMethod,
    Task,
    TaskSample,
    TaskSampleStatus,
    TaskStatus,
)
from app.models.user import RoleName, User, UserRole
from app.services.notification_service import create_notification


class TaskService:
    """Handles task creation, assignment, and management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # ASSIGN TASKS (UC-3.5 — main flow)
    # ================================================================

    async def assign_tasks(
        self,
        project_id: UUID,
        current_user: User,
        dataset_id: UUID,
        method: str,
        assignments: Optional[List[dict]] = None,
        annotation_type: Optional[str] = None,
        label_set_id: Optional[str] = None,
        reviewer_ids: Optional[List[str]] = None,
        annotator_ids: Optional[List[str]] = None,
    ) -> dict:
        """
        Create tasks and assign DataSamples to annotators.

        Manual: caller specifies annotator_id + sample_count for each.
        Round-robin: system splits all unassigned samples evenly.

        Steps:
        1. Validate project owner access.
        2. Validate dataset belongs to project and is ready.
        3. Collect unassigned samples from this dataset.
        4. Create Task + TaskSample records per annotator.
        """
        project = await self._check_project_owner(project_id, current_user)

        method_enum = self._parse_assignment_method(method)

        # Validate dataset
        dataset = await self._get_dataset_or_404(dataset_id, project_id)
        if dataset.status != DatasetStatus.READY:
            raise BadRequestException(
                f"Dataset is not ready for assignment (status: {dataset.status.value})"
            )

        annotation_type_enum = self._parse_annotation_type(annotation_type)

        assigned_task_filters = [Task.dataset_id == dataset_id]
        if annotation_type_enum in (
            AnnotationType.TEXT_CLASSIFICATION,
            AnnotationType.NER,
            AnnotationType.RELATION_EXTRACTION,
        ):
            assigned_task_filters.append(Task.annotation_type == annotation_type_enum)
        elif annotation_type_enum == AnnotationType.SEQUENCE_LABELING:
            assigned_task_filters.append(
                or_(
                    Task.annotation_type == annotation_type_enum,
                    Task.annotation_type.is_(None),
                )
            )

        # Get unassigned sample IDs (not in any TaskSample)
        assigned_subquery = select(TaskSample.data_sample_id).join(
            Task, TaskSample.task_id == Task.id
        ).where(and_(*assigned_task_filters))

        result = await self.db.execute(
            select(DataSample)
            .where(
                and_(
                    DataSample.dataset_id == dataset_id,
                    DataSample.id.notin_(assigned_subquery),
                )
            )
            .order_by(DataSample.sample_index)
        )
        unassigned_samples = list(result.scalars().all())

        if not unassigned_samples:
            raise BadRequestException(
                "No unassigned samples left in this dataset"
            )

        # Parse label_set_id
        from uuid import UUID as _UUID
        try:
            label_set_uuid = _UUID(str(label_set_id)) if label_set_id else None
        except ValueError:
            raise BadRequestException(f"Invalid label_set_id: '{label_set_id}'")
        if label_set_uuid:
            await self._validate_label_set(project_id, label_set_uuid)

        # Route to assignment method
        if method_enum == AssignmentMethod.MANUAL:
            tasks = await self._assign_manual(
                project_id=project_id,
                current_user=current_user,
                unassigned_samples=unassigned_samples,
                assignments=assignments or [],
                annotation_type=annotation_type_enum,
                label_set_id=label_set_uuid,
            )
        else:
            tasks = await self._assign_round_robin(
                project=project,
                current_user=current_user,
                dataset_id=dataset_id,
                unassigned_samples=unassigned_samples,
                annotation_type=annotation_type_enum,
                label_set_id=label_set_uuid,
                annotator_ids=self._parse_uuid_list(
                    annotator_ids, "annotator_ids"
                ) if annotator_ids else None,
            )

        # Assign reviewers round-robin across created tasks
        if reviewer_ids and tasks:
            parsed_reviewer_ids = self._parse_uuid_list(
                reviewer_ids, "reviewer_ids"
            )
            for reviewer_id in parsed_reviewer_ids:
                await self._validate_reviewer(project_id, reviewer_id)
            for idx, task in enumerate(tasks):
                task.reviewer_id = parsed_reviewer_ids[idx % len(parsed_reviewer_ids)]
            await self.db.flush()

        # Audit
        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="ASSIGN_TASKS",
                entity_type="task",
                entity_id=project_id,
                details={
                    "dataset_id": str(dataset_id),
                    "method": method,
                    "annotation_type": (
                        annotation_type_enum.value
                        if annotation_type_enum
                        else None
                    ),
                    "label_set_id": str(label_set_uuid) if label_set_uuid else None,
                    "tasks_created": len(tasks),
                    "reviewer_ids": reviewer_ids or [],
                },
            )
        )
        await self.db.flush()

        if not tasks:
            return {"tasks_created": 0, "assignments": []}

        task_ids = [t.id for t in tasks]

        # Fetch assignee names
        assignee_ids = list({t.assignee_id for t in tasks})
        assignee_result = await self.db.execute(
            select(User.id, User.full_name).where(User.id.in_(assignee_ids))
        )
        assignee_name_map: dict = {row[0]: row[1] for row in assignee_result}

        # Fetch reviewer names (tasks may have reviewer_id set above)
        reviewer_id_set = {t.reviewer_id for t in tasks if t.reviewer_id}
        reviewer_name_map: dict = {}
        if reviewer_id_set:
            reviewer_result = await self.db.execute(
                select(User.id, User.full_name).where(User.id.in_(reviewer_id_set))
            )
            reviewer_name_map = {row[0]: row[1] for row in reviewer_result}

        # Fetch sample counts
        sample_count_result = await self.db.execute(
            select(TaskSample.task_id, func.count(TaskSample.id))
            .where(TaskSample.task_id.in_(task_ids))
            .group_by(TaskSample.task_id)
        )
        sample_count_map: dict = {row[0]: row[1] for row in sample_count_result}

        await self._notify_assignees_tasks_created(
            project=project,
            tasks=tasks,
            actor=current_user,
            sample_count_map=sample_count_map,
        )

        return {
            "tasks_created": len(tasks),
            "assignments": [
                self._build_task_response_raw(
                    task=t,
                    assignee_name=assignee_name_map.get(t.assignee_id),
                    reviewer_name=reviewer_name_map.get(t.reviewer_id) if t.reviewer_id else None,
                    sample_count=sample_count_map.get(t.id, 0),
                )
                for t in tasks
            ],
        }

    # ================================================================
    # LIST TASKS (by project)
    # ================================================================

    async def list_tasks(
        self,
        project_id: UUID,
        current_user: User,
        status: Optional[str] = None,
        assignee_id: Optional[UUID] = None,
        dataset_id: Optional[UUID] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        await self._check_project_access(project_id, current_user)

        query = select(Task).where(Task.project_id == project_id)
        count_query = select(func.count(Task.id)).where(
            Task.project_id == project_id
        )
        filters = []

        if status:
            normalized_status = (
                status.strip().lower().replace("-", "_").replace(" ", "_")
            )
            if normalized_status in {
                "not_started",
                "notstarted",
                "todo",
                "chua_lam",
                "chưa_làm",
                "cho_lam",
                "chờ_làm",
            }:
                filters.append(Task.status == TaskStatus.TODO)
            elif normalized_status in {
                "in_progress",
                "inprogress",
                "active",
                "dang_lam",
                "đang_làm",
            }:
                filters.append(
                    Task.status.in_(
                        [
                            TaskStatus.IN_PROGRESS,
                            TaskStatus.SUBMITTED,
                            TaskStatus.REWORK,
                        ]
                    )
                )
            else:
                try:
                    filters.append(Task.status == TaskStatus(normalized_status))
                except ValueError:
                    raise BadRequestException(f"Invalid status: '{status}'")

        if assignee_id:
            filters.append(Task.assignee_id == assignee_id)

        if dataset_id:
            filters.append(Task.dataset_id == dataset_id)

        if filters:
            query = query.where(and_(*filters))
            count_query = count_query.where(and_(*filters))

        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        query = (
            query.order_by(Task.assigned_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(query)
        tasks = result.scalars().unique().all()
        assignment_status_map = await self._assignment_status_overrides_for_tasks(tasks)

        return {
            "tasks": [
                self._build_task_response(
                    t,
                    assignment_status_override=assignment_status_map.get(t.id),
                )
                for t in tasks
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    # ================================================================
    # GET TASK DETAIL
    # ================================================================

    async def get_task(
        self, project_id: UUID, task_id: UUID, current_user: User
    ) -> dict:
        await self._check_project_access(project_id, current_user)
        task = await self._get_task_or_404(task_id, project_id)

        response = self._build_task_response(task)

        # Add task samples with content
        response["task_samples"] = []
        for ts in task.task_samples:
            response["task_samples"].append(
                {
                    "id": ts.id,
                    "data_sample_id": ts.data_sample_id,
                    "status": ts.status.value,
                    "sample_order": ts.sample_order,
                    "content": (
                        ts.data_sample.content if ts.data_sample else None
                    ),
                }
            )

        # Progress stats
        total_samples = len(task.task_samples)
        completed = sum(
            1
            for ts in task.task_samples
            if ts.status
            in (TaskSampleStatus.APPROVED, TaskSampleStatus.SUBMITTED)
        )
        response["progress"] = {
            "total": total_samples,
            "completed": completed,
            "remaining": total_samples - completed,
        }

        return response

    # ================================================================
    # REASSIGN TASK (UC-3.5 — A1)
    # ================================================================

    async def update_assignment(
        self,
        project_id: UUID,
        current_user: User,
        task_ids: Optional[List[UUID]] = None,
        source_task_id: Optional[UUID] = None,
        assignment_status: Optional[str] = None,
        dataset_id: Optional[UUID] = None,
        method: Optional[str] = None,
        assignments: Optional[List[dict]] = None,
        annotation_type: Optional[str] = None,
        label_set_id: Optional[str] = None,
        reviewer_ids: Optional[List[str]] = None,
        annotator_ids: Optional[List[str]] = None,
        provided_fields: Optional[set[str]] = None,
    ) -> dict:
        """
        Edit an assignment group.

        If assignment_status is 'not_started', the old tasks are replaced by a
        newly generated assignment using the submitted configuration.
        If assignment_status is 'in_progress', only annotator/reviewer
        replacement is allowed and task samples remain on their current tasks.
        """
        await self._check_project_owner(project_id, current_user)
        provided_fields = provided_fields or set()

        tasks = await self._resolve_assignment_tasks(
            project_id=project_id,
            task_ids=task_ids,
            source_task_id=source_task_id,
        )
        self._assert_same_assignment_context(tasks)

        computed_status = self._compute_assignment_status(tasks)
        requested_status = None
        if "assignment_status" in provided_fields and assignment_status:
            requested_status = self._parse_assignment_status(assignment_status)
            if requested_status != computed_status:
                raise BadRequestException(
                    "Assignment status does not match current tasks. "
                    f"Requested '{requested_status}', current '{computed_status}'."
                )

        effective_status = requested_status or computed_status
        if effective_status == "not_started":
            return await self._replace_todo_assignment(
                project_id=project_id,
                current_user=current_user,
                tasks=tasks,
                dataset_id=dataset_id,
                method=method,
                assignments=assignments,
                annotation_type=annotation_type,
                label_set_id=label_set_id,
                reviewer_ids=reviewer_ids,
                annotator_ids=annotator_ids,
                provided_fields=provided_fields,
            )

        if effective_status == "in_progress":
            return await self._update_in_progress_assignment(
                project_id=project_id,
                current_user=current_user,
                tasks=tasks,
                dataset_id=dataset_id,
                method=method,
                assignments=assignments,
                annotation_type=annotation_type,
                label_set_id=label_set_id,
                reviewer_ids=reviewer_ids,
                annotator_ids=annotator_ids,
                provided_fields=provided_fields,
            )

        raise BadRequestException(
            "Can only edit assignment groups with status 'not_started' or "
            f"'in_progress'. Current status: {computed_status}."
        )

    async def reassign_task(
        self,
        project_id: UUID,
        task_id: UUID,
        current_user: User,
        new_assignee_id: UUID,
    ) -> dict:
        """
        Re-assign task to a different annotator.
        Allowed for tasks in 'todo' or 'in_progress' status.
        """
        project = await self._check_project_owner(project_id, current_user)
        task = await self._get_task_or_404(task_id, project_id)

        if task.status not in (TaskStatus.TODO, TaskStatus.IN_PROGRESS):
            raise BadRequestException(
                f"Can only reassign tasks with 'todo' or 'in_progress' status. "
                f"Current status: '{task.status.value}'."
            )

        if task.status == TaskStatus.IN_PROGRESS:
            tasks = await self._resolve_assignment_tasks(
                project_id=project_id,
                task_ids=None,
                source_task_id=task.id,
            )
            old_annotator_ids = self._ordered_unique_ids(
                item.assignee_id
                for item in self._sort_tasks_for_assignment(tasks)
            )
            next_annotator_ids = [
                new_assignee_id if user_id == task.assignee_id else user_id
                for user_id in old_annotator_ids
            ]
            mapping = await self._replace_task_participants(
                project_id=project_id,
                tasks=tasks,
                attr="assignee_id",
                new_ids=next_annotator_ids,
                validator=self._validate_annotator,
                participant_name="annotators",
            )
            self.db.add(
                AuditLog(
                    user_id=current_user.id,
                    action="REASSIGN_TASK",
                    entity_type="task",
                    entity_id=task.id,
                    details={
                        "status": task.status.value,
                        "task_ids": [str(item.id) for item in tasks],
                        "annotator_mapping": mapping,
                    },
                )
            )
            await self.db.flush()
            response = await self._build_task_group_response([task])
            return response["assignments"][0]

        await self._validate_annotator(project_id, new_assignee_id)

        old_assignee = task.assignee_id
        task.assignee_id = new_assignee_id

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="REASSIGN_TASK",
                entity_type="task",
                entity_id=task.id,
                details={
                    "from": str(old_assignee),
                    "to": str(new_assignee_id),
                },
            )
        )
        await self.db.flush()

        if old_assignee != new_assignee_id:
            await self._notify_assignees_tasks_created(
                project=project,
                tasks=[task],
                actor=current_user,
                sample_count_map={task.id: len(task.task_samples)},
            )

        return self._build_task_response(task)

    # ================================================================
    # UPDATE REVIEWER
    # ================================================================

    async def update_reviewer(
        self,
        project_id: UUID,
        task_id: UUID,
        current_user: User,
        new_reviewer_id: Optional[UUID],
    ) -> dict:
        """
        Update the reviewer of a task.
        new_reviewer_id=None means any reviewer in the project can review.
        Not allowed for tasks in APPROVED or REJECTED status.
        """
        await self._check_project_owner(project_id, current_user)
        task = await self._get_task_or_404(task_id, project_id)

        final_statuses = {TaskStatus.APPROVED, TaskStatus.REJECTED}
        if task.status in final_statuses:
            raise BadRequestException(
                f"Cannot change reviewer for a task with status '{task.status.value}'."
            )

        if task.status == TaskStatus.IN_PROGRESS:
            if new_reviewer_id is None:
                if task.reviewer_id is not None:
                    raise BadRequestException(
                        "In_progress assignment must keep the original number of reviewers."
                    )
                response = await self._build_task_group_response([task])
                return response["assignments"][0]

            tasks = await self._resolve_assignment_tasks(
                project_id=project_id,
                task_ids=None,
                source_task_id=task.id,
            )
            old_reviewer_ids = self._ordered_unique_ids(
                item.reviewer_id
                for item in self._sort_tasks_for_assignment(tasks)
            )
            next_reviewer_ids = [
                new_reviewer_id if user_id == task.reviewer_id else user_id
                for user_id in old_reviewer_ids
            ]
            if task.reviewer_id is None:
                next_reviewer_ids = [new_reviewer_id]

            mapping = await self._replace_task_participants(
                project_id=project_id,
                tasks=tasks,
                attr="reviewer_id",
                new_ids=next_reviewer_ids,
                validator=self._validate_reviewer,
                participant_name="reviewers",
            )
            self.db.add(
                AuditLog(
                    user_id=current_user.id,
                    action="UPDATE_REVIEWER",
                    entity_type="task",
                    entity_id=task.id,
                    details={
                        "status": task.status.value,
                        "task_ids": [str(item.id) for item in tasks],
                        "reviewer_mapping": mapping,
                    },
                )
            )
            await self.db.flush()
            response = await self._build_task_group_response([task])
            return response["assignments"][0]

        if new_reviewer_id:
            await self._validate_reviewer(project_id, new_reviewer_id)

        old_reviewer = task.reviewer_id
        task.reviewer_id = new_reviewer_id

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="UPDATE_REVIEWER",
                entity_type="task",
                entity_id=task.id,
                details={
                    "from": str(old_reviewer) if old_reviewer else None,
                    "to": str(new_reviewer_id) if new_reviewer_id else None,
                },
            )
        )
        await self.db.flush()

        return self._build_task_response(task)

    # ================================================================
    # DELETE TASK
    # ================================================================

    async def delete_task(
        self,
        project_id: UUID,
        task_id: UUID,
        current_user: User,
    ) -> None:
        """
        Delete an assignment task.
        Only allowed while the task is still in 'todo' status.
        """
        await self._check_project_owner(project_id, current_user)
        task = await self._get_task_or_404(task_id, project_id)

        if task.status != TaskStatus.TODO:
            raise BadRequestException(
                f"Can only delete tasks with 'todo' status. "
                f"Current status: '{task.status.value}'."
            )

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="DELETE_TASK",
                entity_type="task",
                entity_id=task.id,
                details={
                    "dataset_id": str(task.dataset_id),
                    "assignee_id": str(task.assignee_id),
                    "annotation_type": (
                        task.annotation_type.value if task.annotation_type else None
                    ),
                    "sample_count": len(task.task_samples),
                },
            )
        )
        await self.db.delete(task)
        await self.db.flush()

    # ================================================================
    # Assignment Update Helpers
    # ================================================================

    async def _replace_todo_assignment(
        self,
        project_id: UUID,
        current_user: User,
        tasks: List[Task],
        dataset_id: Optional[UUID],
        method: Optional[str],
        assignments: Optional[List[dict]],
        annotation_type: Optional[str],
        label_set_id: Optional[str],
        reviewer_ids: Optional[List[str]],
        annotator_ids: Optional[List[str]],
        provided_fields: set[str],
    ) -> dict:
        current_dataset_id = self._single_task_value(tasks, "dataset_id")
        current_method = self._single_task_value(tasks, "assignment_method")
        current_annotation_type = self._single_task_value(tasks, "annotation_type")
        current_label_set_id = self._single_task_value(tasks, "label_set_id")

        next_dataset_id = dataset_id or current_dataset_id
        if "method" in provided_fields:
            if not method:
                raise BadRequestException("method is required for assignment update.")
            next_method = self._parse_assignment_method(method)
        else:
            next_method = current_method
        next_annotation_type = (
            annotation_type
            if "annotation_type" in provided_fields
            else (
                current_annotation_type.value
                if current_annotation_type
                else None
            )
        )
        next_label_set_id = (
            label_set_id
            if "label_set_id" in provided_fields
            else (str(current_label_set_id) if current_label_set_id else None)
        )

        old_annotator_ids = self._ordered_unique_ids(
            task.assignee_id for task in self._sort_tasks_for_assignment(tasks)
        )
        next_annotator_ids = annotator_ids
        if (
            next_method == AssignmentMethod.ROUND_ROBIN
            and next_annotator_ids is None
            and current_method == AssignmentMethod.ROUND_ROBIN
        ):
            next_annotator_ids = [str(user_id) for user_id in old_annotator_ids]

        next_assignments = assignments
        if next_method == AssignmentMethod.MANUAL and next_assignments is None:
            if next_annotator_ids is not None:
                parsed_annotator_ids = self._parse_uuid_list(
                    next_annotator_ids, "annotator_ids"
                )
                next_assignments = self._manual_assignments_from_existing_tasks(
                    tasks, parsed_annotator_ids
                )
            elif current_method == AssignmentMethod.MANUAL:
                next_assignments = self._manual_assignments_from_existing_tasks(
                    tasks
                )
            else:
                raise BadRequestException(
                    "Manual assignment update requires assignments or annotator_ids."
                )

        old_reviewer_ids = self._ordered_unique_ids(
            task.reviewer_id for task in self._sort_tasks_for_assignment(tasks)
        )
        next_reviewer_ids = reviewer_ids
        if next_reviewer_ids is None:
            next_reviewer_ids = [str(user_id) for user_id in old_reviewer_ids]

        old_task_ids = [task.id for task in tasks]
        for task in tasks:
            await self.db.delete(task)
        await self.db.flush()

        result = await self.assign_tasks(
            project_id=project_id,
            current_user=current_user,
            dataset_id=next_dataset_id,
            method=next_method.value,
            assignments=next_assignments,
            annotation_type=next_annotation_type,
            label_set_id=next_label_set_id,
            reviewer_ids=next_reviewer_ids,
            annotator_ids=next_annotator_ids,
        )

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="UPDATE_ASSIGNMENT_TODO",
                entity_type="task",
                entity_id=project_id,
                details={
                    "old_task_ids": [str(task_id) for task_id in old_task_ids],
                    "new_task_ids": [
                        str(task["id"]) for task in result["assignments"]
                    ],
                    "dataset_id": str(next_dataset_id),
                    "method": next_method.value,
                    "annotation_type": next_annotation_type,
                    "label_set_id": next_label_set_id,
                },
            )
        )
        await self.db.flush()

        return {
            "tasks_updated": result["tasks_created"],
            "assignments": result["assignments"],
        }

    async def _update_in_progress_assignment(
        self,
        project_id: UUID,
        current_user: User,
        tasks: List[Task],
        dataset_id: Optional[UUID],
        method: Optional[str],
        assignments: Optional[List[dict]],
        annotation_type: Optional[str],
        label_set_id: Optional[str],
        reviewer_ids: Optional[List[str]],
        annotator_ids: Optional[List[str]],
        provided_fields: set[str],
    ) -> dict:
        current_dataset_id = self._single_task_value(tasks, "dataset_id")
        current_method = self._single_task_value(tasks, "assignment_method")
        current_annotation_type = self._single_task_value(tasks, "annotation_type")
        current_label_set_id = self._single_task_value(tasks, "label_set_id")

        if "dataset_id" in provided_fields and dataset_id != current_dataset_id:
            raise BadRequestException(
                "Cannot change dataset after an assignment is in_progress."
            )

        if "method" in provided_fields:
            requested_method = (
                self._parse_assignment_method(method) if method else None
            )
            if requested_method != current_method:
                raise BadRequestException(
                    "Cannot change method after an assignment is in_progress."
                )

        if "annotation_type" in provided_fields:
            requested_annotation_type = self._parse_annotation_type(annotation_type)
            if requested_annotation_type != current_annotation_type:
                raise BadRequestException(
                    "Cannot change annotation_type after an assignment is in_progress."
                )

        if "label_set_id" in provided_fields:
            requested_label_set_id = self._parse_optional_uuid(
                label_set_id, "label_set_id"
            )
            if requested_label_set_id != current_label_set_id:
                raise BadRequestException(
                    "Cannot change label_set after an assignment is in_progress."
                )

        next_annotator_ids = None
        if annotator_ids is not None:
            next_annotator_ids = self._parse_uuid_list(
                annotator_ids, "annotator_ids"
            )
        elif assignments is not None:
            next_annotator_ids = self._extract_assignment_annotator_ids(assignments)

        next_reviewer_ids = None
        if reviewer_ids is not None:
            next_reviewer_ids = self._parse_uuid_list(
                reviewer_ids, "reviewer_ids"
            )

        annotator_mapping = {}
        reviewer_mapping = {}
        if next_annotator_ids is not None:
            annotator_mapping = await self._replace_task_participants(
                project_id=project_id,
                tasks=tasks,
                attr="assignee_id",
                new_ids=next_annotator_ids,
                validator=self._validate_annotator,
                participant_name="annotators",
            )

        if next_reviewer_ids is not None:
            reviewer_mapping = await self._replace_task_participants(
                project_id=project_id,
                tasks=tasks,
                attr="reviewer_id",
                new_ids=next_reviewer_ids,
                validator=self._validate_reviewer,
                participant_name="reviewers",
            )

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="UPDATE_ASSIGNMENT_IN_PROGRESS",
                entity_type="task",
                entity_id=project_id,
                details={
                    "task_ids": [str(task.id) for task in tasks],
                    "method": current_method.value,
                    "annotator_mapping": annotator_mapping,
                    "reviewer_mapping": reviewer_mapping,
                },
            )
        )
        await self.db.flush()

        return await self._build_task_group_response(tasks)

    async def _resolve_assignment_tasks(
        self,
        project_id: UUID,
        task_ids: Optional[List[UUID]],
        source_task_id: Optional[UUID],
    ) -> List[Task]:
        if task_ids:
            return await self._get_tasks_by_ids_or_404(project_id, task_ids)

        if not source_task_id:
            raise BadRequestException(
                "Update assignment requires task_ids or a task-scoped endpoint."
            )

        source_task = await self._get_task_or_404(source_task_id, project_id)
        filters = [
            Task.project_id == project_id,
            Task.dataset_id == source_task.dataset_id,
            Task.assignment_method == source_task.assignment_method,
            Task.assigned_by == source_task.assigned_by,
        ]
        if source_task.annotation_type is None:
            filters.append(Task.annotation_type.is_(None))
        else:
            filters.append(Task.annotation_type == source_task.annotation_type)
        if source_task.label_set_id is None:
            filters.append(Task.label_set_id.is_(None))
        else:
            filters.append(Task.label_set_id == source_task.label_set_id)

        result = await self.db.execute(
            select(Task)
            .options(
                selectinload(Task.task_samples).selectinload(
                    TaskSample.data_sample
                )
            )
            .where(and_(*filters))
        )
        tasks = result.scalars().unique().all()
        return self._sort_tasks_for_assignment(tasks)

    async def _notify_assignees_tasks_created(
        self,
        *,
        project: Project,
        tasks: List[Task],
        actor: User,
        sample_count_map: dict,
    ) -> None:
        actor_name = actor.full_name or actor.email
        for task in tasks:
            sample_count = sample_count_map.get(task.id, 0)
            await create_notification(
                self.db,
                user_id=task.assignee_id,
                type=NotificationType.TASK_ASSIGNED,
                title="Bạn được phân công task mới",
                message=(
                    f"{actor_name} đã giao cho bạn {sample_count} mẫu "
                    f"trong dự án {project.name}."
                ),
                link=f"/workspace/{task.id}",
                actor_name=actor_name,
            )

    async def _get_tasks_by_ids_or_404(
        self, project_id: UUID, task_ids: List[UUID]
    ) -> List[Task]:
        normalized_task_ids = self._parse_uuid_list(task_ids, "task_ids")
        if not normalized_task_ids:
            raise BadRequestException("task_ids must not be empty.")

        result = await self.db.execute(
            select(Task)
            .options(
                selectinload(Task.task_samples).selectinload(
                    TaskSample.data_sample
                )
            )
            .where(
                and_(
                    Task.project_id == project_id,
                    Task.id.in_(normalized_task_ids),
                )
            )
        )
        tasks = result.scalars().unique().all()
        found_ids = {task.id for task in tasks}
        missing_ids = [
            task_id for task_id in normalized_task_ids if task_id not in found_ids
        ]
        if missing_ids:
            missing = ", ".join(str(task_id) for task_id in missing_ids)
            raise NotFoundException(f"Tasks not found in this project: {missing}")
        return self._sort_tasks_for_assignment(tasks)

    def _assert_same_assignment_context(self, tasks: List[Task]) -> None:
        if not tasks:
            raise BadRequestException("No tasks found for assignment update.")

        for attr in (
            "dataset_id",
            "assignment_method",
            "annotation_type",
            "label_set_id",
        ):
            values = {getattr(task, attr) for task in tasks}
            if len(values) > 1:
                raise BadRequestException(
                    "Selected tasks must belong to the same assignment "
                    f"configuration. Field differs: {attr}."
                )

    def _compute_assignment_status(self, tasks: List[Task]) -> str:
        return self._compute_assignment_status_from_statuses(
            {task.status for task in tasks}
        )

    def _compute_assignment_status_from_statuses(
        self, statuses: set[TaskStatus], allow_final: bool = False
    ) -> str:
        if statuses == {TaskStatus.TODO}:
            return "not_started"

        final_statuses = {TaskStatus.APPROVED, TaskStatus.REJECTED}
        if statuses & final_statuses:
            if allow_final:
                if statuses == {TaskStatus.APPROVED}:
                    return "completed"
                if statuses == {TaskStatus.REJECTED}:
                    return "rejected"
                return "in_progress"
            status_values = ", ".join(sorted(status.value for status in statuses))
            raise BadRequestException(
                "Cannot edit assignments that contain final tasks. "
                f"Current task statuses: {status_values}."
            )

        return "in_progress"

    def _parse_assignment_status(self, status_value: str) -> str:
        normalized = str(status_value).strip().lower().replace("-", "_").replace(" ", "_")
        aliases = {
            "todo": "not_started",
            "notstarted": "not_started",
            "not_started": "not_started",
            "chua_lam": "not_started",
            "chưa_làm": "not_started",
            "inprogress": "in_progress",
            "in_progress": "in_progress",
            "dang_lam": "in_progress",
            "đang_làm": "in_progress",
            "active": "in_progress",
        }
        parsed = aliases.get(normalized, normalized)
        if parsed not in {"not_started", "in_progress"}:
            raise BadRequestException(
                "Invalid assignment_status. Must be 'not_started' or 'in_progress'."
            )
        return parsed

    async def _assignment_status_overrides_for_tasks(
        self, tasks: List[Task]
    ) -> dict[UUID, str]:
        grouped_tasks: dict[tuple, List[Task]] = {}
        for task in tasks:
            grouped_tasks.setdefault(self._assignment_context_key(task), []).append(task)

        status_map: dict[UUID, str] = {}
        for group_tasks in grouped_tasks.values():
            sample_task = group_tasks[0]
            filters = [
                Task.project_id == sample_task.project_id,
                Task.dataset_id == sample_task.dataset_id,
                Task.assignment_method == sample_task.assignment_method,
                Task.assigned_by == sample_task.assigned_by,
            ]
            if sample_task.annotation_type is None:
                filters.append(Task.annotation_type.is_(None))
            else:
                filters.append(Task.annotation_type == sample_task.annotation_type)
            if sample_task.label_set_id is None:
                filters.append(Task.label_set_id.is_(None))
            else:
                filters.append(Task.label_set_id == sample_task.label_set_id)

            result = await self.db.execute(
                select(Task.status).where(and_(*filters))
            )
            statuses = {row[0] for row in result.all()}
            assignment_status = self._compute_assignment_status_from_statuses(
                statuses, allow_final=True
            )
            for task in group_tasks:
                status_map[task.id] = assignment_status
        return status_map

    def _assignment_context_key(self, task: Task) -> tuple:
        return (
            task.project_id,
            task.dataset_id,
            task.assignment_method,
            task.assigned_by,
            task.annotation_type,
            task.label_set_id,
        )

    async def _replace_task_participants(
        self,
        project_id: UUID,
        tasks: List[Task],
        attr: str,
        new_ids: List[UUID],
        validator: Callable[[UUID, UUID], Awaitable[None]],
        participant_name: str,
    ) -> dict:
        old_ids = self._ordered_unique_ids(
            getattr(task, attr)
            for task in self._sort_tasks_for_assignment(tasks)
        )

        if not old_ids:
            if new_ids:
                raise BadRequestException(
                    f"Cannot add {participant_name} to an in_progress "
                    "assignment that had none originally."
                )
            return {}

        if len(set(new_ids)) != len(new_ids):
            raise BadRequestException(
                f"In_progress assignment cannot contain duplicate {participant_name}."
            )

        if len(new_ids) != len(old_ids):
            raise BadRequestException(
                "In_progress assignment must keep the original number of "
                f"{participant_name}: {len(old_ids)}."
            )

        for user_id in new_ids:
            await validator(project_id, user_id)

        kept_ids = set(old_ids) & set(new_ids)
        old_replaced_ids = [user_id for user_id in old_ids if user_id not in kept_ids]
        new_replacement_ids = [
            user_id for user_id in new_ids if user_id not in kept_ids
        ]

        replacements = {
            old_id: new_id
            for old_id, new_id in zip(old_replaced_ids, new_replacement_ids)
        }
        mapping = {user_id: user_id for user_id in kept_ids}
        mapping.update(replacements)

        for task in tasks:
            old_id = getattr(task, attr)
            new_id = mapping.get(old_id)
            if new_id and new_id != old_id:
                setattr(task, attr, new_id)

        return {
            str(old_id): str(new_id)
            for old_id, new_id in replacements.items()
        }

    def _manual_assignments_from_existing_tasks(
        self,
        tasks: List[Task],
        annotator_ids: Optional[List[UUID]] = None,
    ) -> List[dict]:
        ordered_tasks = self._sort_tasks_for_assignment(tasks)
        if annotator_ids is not None and len(annotator_ids) != len(ordered_tasks):
            raise BadRequestException(
                "annotator_ids must match the existing number of task chunks "
                f"for manual assignment: {len(ordered_tasks)}."
            )

        return [
            {
                "annotator_id": (
                    annotator_ids[idx]
                    if annotator_ids is not None
                    else task.assignee_id
                ),
                "sample_count": len(task.task_samples),
            }
            for idx, task in enumerate(ordered_tasks)
        ]

    def _extract_assignment_annotator_ids(
        self, assignments: List[dict]
    ) -> List[UUID]:
        annotator_ids = []
        for idx, assignment in enumerate(assignments, start=1):
            annotator_id = (
                assignment.get("annotator_id")
                or assignment.get("assignee_id")
                or assignment.get("user_id")
                or assignment.get("annotatorId")
                or assignment.get("assigneeId")
                or assignment.get("userId")
            )
            if not annotator_id:
                raise BadRequestException(
                    f"Manual assignment #{idx} requires annotator_id"
                )

            sample_count = None
            for key in ("sample_count", "sampleCount", "count", "samples"):
                if key in assignment:
                    sample_count = assignment[key]
                    break
            if sample_count == "":
                sample_count = 0
            if sample_count is not None:
                if isinstance(sample_count, bool):
                    raise BadRequestException(
                        f"Manual assignment #{idx} has invalid sample_count"
                    )
                try:
                    sample_count = int(sample_count)
                except (TypeError, ValueError):
                    raise BadRequestException(
                        f"Manual assignment #{idx} has invalid sample_count"
                    )
                if sample_count <= 0:
                    continue

            try:
                annotator_ids.append(UUID(str(annotator_id)))
            except (TypeError, ValueError):
                raise BadRequestException(
                    f"Manual assignment #{idx} has invalid annotator_id"
                )

        if len(set(annotator_ids)) != len(annotator_ids):
            raise BadRequestException("assignments cannot contain duplicate annotators.")
        return annotator_ids

    # ================================================================
    # Manual Assignment
    # ================================================================

    async def _assign_manual(
        self,
        project_id: UUID,
        current_user: User,
        unassigned_samples: List[DataSample],
        assignments: List[dict],
        annotation_type: Optional[AnnotationType] = None,
        label_set_id: Optional[UUID] = None,
    ) -> List[Task]:
        """
        Manual assignment: each entry specifies annotator + sample_count.
        Samples are assigned in order (by sample_index).
        """
        if not assignments:
            raise BadRequestException(
                "Manual assignment requires 'assignments' list"
            )

        # Validate total requested ≤ available
        normalized_assignments = []
        for idx, assignment in enumerate(assignments, start=1):
            annotator_id = (
                assignment.get("annotator_id")
                or assignment.get("assignee_id")
                or assignment.get("user_id")
                or assignment.get("annotatorId")
                or assignment.get("assigneeId")
                or assignment.get("userId")
            )
            if not annotator_id:
                raise BadRequestException(
                    f"Manual assignment #{idx} requires annotator_id"
                )

            try:
                annotator_id = UUID(str(annotator_id))
            except (TypeError, ValueError):
                raise BadRequestException(
                    f"Manual assignment #{idx} has invalid annotator_id"
                )

            sample_count = None
            for key in ("sample_count", "sampleCount", "count", "samples"):
                if key in assignment:
                    sample_count = assignment[key]
                    break

            if sample_count is None:
                raise BadRequestException(
                    f"Manual assignment #{idx} requires sample_count"
                )
            if sample_count == "":
                sample_count = 0
            if isinstance(sample_count, bool):
                raise BadRequestException(
                    f"Manual assignment #{idx} has invalid sample_count"
                )
            try:
                sample_count = int(sample_count)
            except (TypeError, ValueError):
                raise BadRequestException(
                    f"Manual assignment #{idx} has invalid sample_count"
                )
            if sample_count < 0:
                raise BadRequestException(
                    f"Manual assignment #{idx} sample_count must be >= 0"
                )
            if sample_count == 0:
                continue

            normalized_assignments.append(
                {
                    "annotator_id": annotator_id,
                    "sample_count": sample_count,
                }
            )

        if not normalized_assignments:
            raise BadRequestException(
                "Manual assignment requires at least one annotator with sample_count > 0"
            )

        annotator_id_set = {a["annotator_id"] for a in normalized_assignments}
        if len(annotator_id_set) != len(normalized_assignments):
            raise BadRequestException(
                "Manual assignment cannot contain duplicate annotators."
            )

        # Validate total requested <= available
        total_requested = sum(a["sample_count"] for a in normalized_assignments)
        if total_requested > len(unassigned_samples):
            raise BadRequestException(
                f"Requested {total_requested} samples but only "
                f"{len(unassigned_samples)} are available."
            )

        tasks = []
        sample_cursor = 0

        for assignment in normalized_assignments:
            annotator_id = assignment["annotator_id"]
            sample_count = assignment["sample_count"]

            # Validate annotator is a project member with annotator role
            await self._validate_annotator(project_id, annotator_id)

            # Slice samples for this annotator
            batch = unassigned_samples[sample_cursor: sample_cursor + sample_count]
            sample_cursor += sample_count

            # Create task
            task = Task(
                project_id=project_id,
                dataset_id=batch[0].dataset_id,
                assignee_id=annotator_id,
                assigned_by=current_user.id,
                status=TaskStatus.TODO,
                assignment_method=AssignmentMethod.MANUAL,
                annotation_type=annotation_type,
                label_set_id=label_set_id,
            )
            self.db.add(task)
            await self.db.flush()

            # Create task_samples
            for order, sample in enumerate(batch):
                self.db.add(
                    TaskSample(
                        task_id=task.id,
                        data_sample_id=sample.id,
                        status=TaskSampleStatus.PENDING,
                        sample_order=order,
                    )
                )

            await self.db.flush()
            tasks.append(task)

        return tasks

    # ================================================================
    # Round-Robin Assignment
    # ================================================================

    async def _assign_round_robin(
        self,
        project: Project,
        current_user: User,
        dataset_id: UUID,
        unassigned_samples: List[DataSample],
        annotation_type: Optional[AnnotationType] = None,
        label_set_id: Optional[UUID] = None,
        annotator_ids: Optional[List[UUID]] = None,
    ) -> List[Task]:
        """
        Round-robin: split unassigned samples evenly across all
        selected annotators, or all annotators in the project if omitted.
        """
        if annotator_ids is None:
            annotator_ids = [
                m.user_id
                for m in project.members
                if m.role_in_project == ProjectRole.ANNOTATOR
            ]
        else:
            annotator_ids = self._ordered_unique_ids(annotator_ids)
            for annotator_id in annotator_ids:
                await self._validate_annotator(project.id, annotator_id)

        if not annotator_ids:
            raise BadRequestException(
                "No annotators found in this project. "
                "Add annotator members first."
            )

        # Distribute samples round-robin
        # Each annotator gets roughly len(samples) / len(annotators) samples
        chunks: dict[UUID, List[DataSample]] = {
            aid: [] for aid in annotator_ids
        }
        for idx, sample in enumerate(unassigned_samples):
            target = annotator_ids[idx % len(annotator_ids)]
            chunks[target].append(sample)

        tasks = []
        for annotator_id, batch in chunks.items():
            if not batch:
                continue

            task = Task(
                project_id=project.id,
                dataset_id=dataset_id,
                assignee_id=annotator_id,
                assigned_by=current_user.id,
                status=TaskStatus.TODO,
                assignment_method=AssignmentMethod.ROUND_ROBIN,
                annotation_type=annotation_type,
                label_set_id=label_set_id,
            )
            self.db.add(task)
            await self.db.flush()

            for order, sample in enumerate(batch):
                self.db.add(
                    TaskSample(
                        task_id=task.id,
                        data_sample_id=sample.id,
                        status=TaskSampleStatus.PENDING,
                        sample_order=order,
                    )
                )

            await self.db.flush()
            tasks.append(task)

        return tasks

    # ================================================================
    # Access Control + Validation Helpers
    # ================================================================

    async def _check_project_access(
        self, project_id: UUID, user: User
    ) -> Project:
        project = await self._get_project_or_404(project_id)
        if RoleName.ADMIN.value in user.role_names:
            return project
        member_ids = {m.user_id for m in project.members}
        if user.id not in member_ids:
            raise ForbiddenException("You don't have access to this project")
        return project

    async def _check_project_owner(
        self, project_id: UUID, user: User
    ) -> Project:
        project = await self._get_project_or_404(project_id)
        if RoleName.ADMIN.value in user.role_names:
            return project
        for m in project.members:
            if (
                m.user_id == user.id
                and m.role_in_project == ProjectRole.PROJECT_OWNER
            ):
                return project
        raise ForbiddenException(
            "Only project owners or admin can assign tasks"
        )

    async def _get_project_or_404(self, project_id: UUID) -> Project:
        result = await self.db.execute(
            select(Project)
            .options(selectinload(Project.members))
            .where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise NotFoundException(f"Project '{project_id}' not found")
        return project

    async def _get_dataset_or_404(
        self, dataset_id: UUID, project_id: UUID
    ) -> Dataset:
        result = await self.db.execute(
            select(Dataset).where(
                and_(
                    Dataset.id == dataset_id,
                    Dataset.project_id == project_id,
                )
            )
        )
        dataset = result.scalar_one_or_none()
        if not dataset:
            raise NotFoundException(
                f"Dataset '{dataset_id}' not found in this project"
            )
        return dataset

    async def _get_task_or_404(
        self, task_id: UUID, project_id: UUID
    ) -> Task:
        result = await self.db.execute(
            select(Task)
            .options(
                selectinload(Task.task_samples).selectinload(
                    TaskSample.data_sample
                )
            )
            .where(
                and_(Task.id == task_id, Task.project_id == project_id)
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            raise NotFoundException(
                f"Task '{task_id}' not found in this project"
            )
        return task

    async def _validate_annotator(
        self, project_id: UUID, user_id: UUID
    ) -> None:
        """
        Validate that user_id can be assigned annotation tasks.
        System admins bypass the annotator-role check (they can annotate in any project).
        For regular users: must have ANNOTATOR role in this project.
        """
        user_result = await self.db.execute(
            select(User)
            .options(selectinload(User.user_roles).selectinload(UserRole.role))
            .where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise BadRequestException(f"User '{user_id}' not found")

        if user.is_locked:
            raise BadRequestException(
                f"Cannot assign to locked user '{user_id}'"
            )

        # Admin bypass: system admin can be assigned as annotator
        if RoleName.ADMIN.value in user.role_names:
            return

        # Non-admin: must have ANNOTATOR role in the project
        result = await self.db.execute(
            select(ProjectMember).where(
                and_(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                    ProjectMember.role_in_project == ProjectRole.ANNOTATOR,
                )
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise BadRequestException(
                f"User '{user_id}' is not an annotator in this project"
            )

    async def _validate_reviewer(
        self, project_id: UUID, user_id: UUID
    ) -> None:
        user_result = await self.db.execute(
            select(User)
            .options(selectinload(User.user_roles).selectinload(UserRole.role))
            .where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        if not user:
            raise BadRequestException(f"User '{user_id}' not found")

        if user.is_locked:
            raise BadRequestException(
                f"Cannot assign locked user '{user_id}' as reviewer"
            )

        if RoleName.ADMIN.value in user.role_names:
            return

        result = await self.db.execute(
            select(ProjectMember).where(
                and_(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                    ProjectMember.role_in_project == ProjectRole.REVIEWER,
                )
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise BadRequestException(
                f"User '{user_id}' is not a reviewer in this project"
            )

    async def _validate_label_set(
        self, project_id: UUID, label_set_id: UUID
    ) -> None:
        result = await self.db.execute(
            select(LabelSet.id).where(
                and_(
                    LabelSet.id == label_set_id,
                    LabelSet.project_id == project_id,
                )
            )
        )
        if not result.scalar_one_or_none():
            raise BadRequestException(
                f"Label set '{label_set_id}' does not belong to this project"
            )

    def _parse_assignment_method(self, method: str) -> AssignmentMethod:
        normalized_method = (
            str(method).strip().lower().replace("-", "_").replace(" ", "_")
        )
        aliases = {
            "roundrobin": AssignmentMethod.ROUND_ROBIN.value,
            "round_robin": AssignmentMethod.ROUND_ROBIN.value,
            "manual": AssignmentMethod.MANUAL.value,
            "thu_cong": AssignmentMethod.MANUAL.value,
            "thủ_công": AssignmentMethod.MANUAL.value,
        }
        normalized_method = aliases.get(normalized_method, normalized_method)
        try:
            return AssignmentMethod(normalized_method)
        except ValueError:
            raise BadRequestException(
                f"Invalid method: '{method}'. Must be 'manual' or 'round_robin'."
            )

    def _parse_uuid_list(self, values: List[UUID], field_name: str) -> List[UUID]:
        parsed_values = []
        for idx, value in enumerate(values, start=1):
            try:
                parsed_values.append(UUID(str(value)))
            except (TypeError, ValueError):
                raise BadRequestException(
                    f"{field_name} #{idx} has invalid UUID: '{value}'"
                )

        if len(set(parsed_values)) != len(parsed_values):
            raise BadRequestException(f"{field_name} cannot contain duplicates.")
        return parsed_values

    def _parse_optional_uuid(
        self, value: Optional[str], field_name: str
    ) -> Optional[UUID]:
        if value is None:
            return None
        try:
            return UUID(str(value))
        except (TypeError, ValueError):
            raise BadRequestException(f"Invalid {field_name}: '{value}'")

    def _ordered_unique_ids(self, values) -> List[UUID]:
        unique_ids = []
        seen_ids = set()
        for value in values:
            if value is None or value in seen_ids:
                continue
            unique_ids.append(value)
            seen_ids.add(value)
        return unique_ids

    def _single_task_value(self, tasks: List[Task], attr: str):
        values = {getattr(task, attr) for task in tasks}
        if len(values) != 1:
            raise BadRequestException(
                "Selected tasks must belong to the same assignment "
                f"configuration. Field differs: {attr}."
            )
        return next(iter(values))

    def _sort_tasks_for_assignment(self, tasks: List[Task]) -> List[Task]:
        return sorted(
            tasks,
            key=lambda task: (
                task.assigned_at.isoformat() if task.assigned_at else "",
                str(task.id),
            ),
        )

    def _parse_annotation_type(
        self, annotation_type: Optional[str]
    ) -> Optional[AnnotationType]:
        if not annotation_type:
            return None

        normalized = (
            annotation_type.strip().lower().replace("-", "_").replace(" ", "_")
        )
        aliases = {
            "classification": AnnotationType.TEXT_CLASSIFICATION.value,
            "text": AnnotationType.TEXT_CLASSIFICATION.value,
            "text_classification": AnnotationType.TEXT_CLASSIFICATION.value,
            "ner": AnnotationType.NER.value,
            "named_entity_recognition": AnnotationType.NER.value,
            "relation": AnnotationType.RELATION_EXTRACTION.value,
            "relation_extraction": AnnotationType.RELATION_EXTRACTION.value,
            "sequence": AnnotationType.SEQUENCE_LABELING.value,
            "span": AnnotationType.SEQUENCE_LABELING.value,
        }
        normalized = aliases.get(normalized, normalized)

        try:
            return AnnotationType(normalized)
        except ValueError:
            valid = ", ".join(item.value for item in AnnotationType)
            raise BadRequestException(
                f"Invalid annotation_type: '{annotation_type}'. Must be one of: {valid}."
            )

    # ================================================================
    # Response Builder
    # ================================================================

    async def _build_task_group_response(self, tasks: List[Task]) -> dict:
        ordered_tasks = self._sort_tasks_for_assignment(tasks)
        task_ids = [task.id for task in ordered_tasks]
        assignment_status = self._compute_assignment_status(ordered_tasks)

        user_ids = {task.assignee_id for task in ordered_tasks}
        user_ids.update(
            task.reviewer_id for task in ordered_tasks if task.reviewer_id
        )
        user_name_map = {}
        if user_ids:
            user_result = await self.db.execute(
                select(User.id, User.full_name).where(User.id.in_(user_ids))
            )
            user_name_map = {row[0]: row[1] for row in user_result}

        sample_count_result = await self.db.execute(
            select(TaskSample.task_id, func.count(TaskSample.id))
            .where(TaskSample.task_id.in_(task_ids))
            .group_by(TaskSample.task_id)
        )
        sample_count_map = {
            row[0]: row[1] for row in sample_count_result
        }

        return {
            "tasks_updated": len(ordered_tasks),
            "assignments": [
                self._build_task_response_raw(
                    task=task,
                    assignee_name=user_name_map.get(task.assignee_id),
                    reviewer_name=(
                        user_name_map.get(task.reviewer_id)
                        if task.reviewer_id
                        else None
                    ),
                    sample_count=sample_count_map.get(task.id, 0),
                    assignment_status_override=assignment_status,
                )
                for task in ordered_tasks
            ],
        }

    def _build_task_response(
        self,
        task: Task,
        assignment_status_override: Optional[str] = None,
    ) -> dict:
        """Build response dict from an ORM Task object with eagerly loaded relationships."""
        try:
            assignee_name = task.assignee.full_name if task.assignee else None
        except Exception:
            assignee_name = None
        try:
            reviewer_name = task.reviewer.full_name if task.reviewer else None
        except Exception:
            reviewer_name = None
        try:
            sample_count = len(task.task_samples)
        except Exception:
            sample_count = 0
        try:
            dataset_name = task.dataset.name if task.dataset else None
        except Exception:
            dataset_name = None
        return self._build_task_response_raw(
            task=task,
            assignee_name=assignee_name,
            reviewer_name=reviewer_name,
            sample_count=sample_count,
            dataset_name=dataset_name,
            assignment_status_override=assignment_status_override,
        )

    def _build_task_response_raw(
        self,
        task: Task,
        assignee_name: Optional[str],
        reviewer_name: Optional[str],
        sample_count: int,
        dataset_name: Optional[str] = None,
        assignment_status_override: Optional[str] = None,
    ) -> dict:
        """Build response dict without accessing ORM relationships."""
        status_val = task.status.value if hasattr(task.status, "value") else str(task.status)
        method_val = task.assignment_method.value if hasattr(task.assignment_method, "value") else str(task.assignment_method)
        annotation_val = task.annotation_type.value if task.annotation_type and hasattr(task.annotation_type, "value") else (str(task.annotation_type) if task.annotation_type else None)
        assignment_status = assignment_status_override or (
            "not_started"
            if task.status == TaskStatus.TODO
            else "in_progress"
            if task.status not in (TaskStatus.APPROVED, TaskStatus.REJECTED)
            else task.status.value
        )
        return {
            "id": task.id,
            "project_id": task.project_id,
            "dataset_id": task.dataset_id,
            "assignee_id": task.assignee_id,
            "assignee_name": assignee_name,
            "assigned_by": task.assigned_by,
            "status": assignment_status,
            "assignment_status": assignment_status,
            "task_status": status_val,
            "assignment_method": method_val,
            "annotation_type": annotation_val,
            "task_type": annotation_val,
            "label_set_id": task.label_set_id,
            "reviewer_id": task.reviewer_id,
            "reviewer_name": reviewer_name,
            "dataset_name": dataset_name,
            "assigned_at": task.assigned_at,
            "started_at": task.started_at,
            "submitted_at": task.submitted_at,
            "completed_at": task.completed_at,
            "updated_at": task.updated_at,
            "sample_count": sample_count,
        }
