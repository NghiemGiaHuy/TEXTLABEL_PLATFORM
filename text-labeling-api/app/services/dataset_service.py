"""
app/services/dataset_service.py
Business logic for Dataset import and management (UC-3.3).
"""

import math
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.models.audit_log import AuditLog
from app.models.dataset import DataSample, Dataset, DatasetStatus, SourceFormat
from app.models.project import Project, ProjectMember, ProjectRole
from app.models.task import TaskSample, TaskSampleStatus
from app.models.user import RoleName, User


class DatasetService:
    """Handles dataset import and management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # IMPORT DATASET (UC-3.3 — main flow)
    # ================================================================

    async def import_dataset(
        self,
        project_id: UUID,
        current_user: User,
        name: str,
        source_format: str,
        samples: List[Dict[str, Any]],
        field_mapping: Optional[Dict[str, Any]] = None,
    ) -> dict:
        """
        Create a dataset and bulk-insert data samples.

        Steps:
        1. Validate project access (PO only).
        2. Validate source_format enum.
        3. Create Dataset record with status=importing.
        4. Bulk-insert DataSample records.
        5. Update dataset total_samples and status=ready.
        6. Return import result with counts.
        """
        await self._check_project_owner(project_id, current_user)

        # Validate source format
        try:
            fmt = SourceFormat(source_format)
        except ValueError:
            raise BadRequestException(
                f"Invalid source_format: '{source_format}'. "
                f"Must be one of: csv, json, jsonl."
            )

        # Create dataset
        dataset = Dataset(
            project_id=project_id,
            name=name,
            source_format=fmt,
            status=DatasetStatus.IMPORTING,
            field_mapping=field_mapping,
            imported_by=current_user.id,
            total_samples=0,
        )
        self.db.add(dataset)
        await self.db.flush()

        # Bulk insert samples
        errors = []
        imported_count = 0
        for idx, sample_data in enumerate(samples):
            content = sample_data.get("content", "")
            if not content or not content.strip():
                errors.append(f"Sample #{idx}: empty content, skipped")
                continue

            sample = DataSample(
                dataset_id=dataset.id,
                content=content.strip(),
                metadata_=sample_data.get("metadata_") or sample_data.get("metadata"),
                sample_index=idx,
            )
            self.db.add(sample)
            imported_count += 1

        # Update dataset stats
        if imported_count == 0:
            dataset.status = DatasetStatus.ERROR
            dataset.total_samples = 0
            await self.db.flush()
            raise BadRequestException(
                "No valid samples found. All samples had empty content."
            )

        dataset.total_samples = imported_count
        dataset.status = DatasetStatus.READY

        # Audit
        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="IMPORT_DATASET",
                entity_type="dataset",
                entity_id=dataset.id,
                details={
                    "project_id": str(project_id),
                    "name": name,
                    "total_imported": imported_count,
                    "errors_count": len(errors),
                },
            )
        )
        await self.db.flush()

        return {
            "dataset": self._build_dataset_response(dataset),
            "total_imported": imported_count,
            "errors_count": len(errors),
            "errors": errors,
        }

    # ================================================================
    # LIST DATASETS
    # ================================================================

    async def list_datasets(
        self, project_id: UUID, current_user: User
    ) -> List[dict]:
        await self._check_project_access(project_id, current_user)

        result = await self.db.execute(
            select(Dataset)
            .where(Dataset.project_id == project_id)
            .order_by(Dataset.created_at.desc())
        )
        datasets = result.scalars().all()
        progress_map = await self._get_dataset_progress_map(
            [ds.id for ds in datasets]
        )
        return [
            self._build_dataset_response(ds, progress_map.get(ds.id))
            for ds in datasets
        ]

    # ================================================================
    # GET DATASET DETAIL
    # ================================================================

    async def get_dataset(
        self, project_id: UUID, dataset_id: UUID, current_user: User
    ) -> dict:
        await self._check_project_access(project_id, current_user)
        dataset = await self._get_dataset_or_404(dataset_id, project_id)
        progress_map = await self._get_dataset_progress_map([dataset.id])
        return self._build_dataset_response(
            dataset, progress_map.get(dataset.id)
        )

    # ================================================================
    # LIST SAMPLES (paginated)
    # ================================================================

    async def list_samples(
        self,
        project_id: UUID,
        dataset_id: UUID,
        current_user: User,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        await self._check_project_access(project_id, current_user)
        await self._get_dataset_or_404(dataset_id, project_id)

        count_query = select(func.count(DataSample.id)).where(
            DataSample.dataset_id == dataset_id
        )
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        result = await self.db.execute(
            select(DataSample)
            .where(DataSample.dataset_id == dataset_id)
            .order_by(DataSample.sample_index)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        samples = result.scalars().all()

        return {
            "samples": [self._build_sample_response(s) for s in samples],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    # ================================================================
    # DELETE DATASET
    # ================================================================

    async def delete_dataset(
        self, project_id: UUID, dataset_id: UUID, current_user: User
    ) -> None:
        """
        Delete a dataset.
        E1: Block if dataset has tasks assigned (409 Conflict).
        """
        await self._check_project_owner(project_id, current_user)
        dataset = await self._get_dataset_or_404(dataset_id, project_id)

        # Check for existing tasks
        from app.models.task import Task

        task_count_result = await self.db.execute(
            select(func.count(Task.id)).where(Task.dataset_id == dataset_id)
        )
        task_count = task_count_result.scalar() or 0
        if task_count > 0:
            raise ConflictException(
                f"Cannot delete dataset: it has {task_count} task(s) assigned. "
                f"Delete the tasks first."
            )

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="DELETE_DATASET",
                entity_type="dataset",
                entity_id=dataset.id,
                details={"name": dataset.name},
            )
        )
        await self.db.delete(dataset)
        await self.db.flush()

    # ================================================================
    # Access Control Helpers
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
            "Only project owners or admin can manage datasets"
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

    # ================================================================
    # Response Builders
    # ================================================================

    async def _get_dataset_progress_map(
        self, dataset_ids: List[UUID]
    ) -> Dict[UUID, dict]:
        if not dataset_ids:
            return {}

        completed_statuses = (
            TaskSampleStatus.DONE,
            TaskSampleStatus.SUBMITTED,
            TaskSampleStatus.APPROVED,
        )
        result = await self.db.execute(
            select(
                DataSample.dataset_id.label("dataset_id"),
                func.count(
                    func.distinct(
                        case(
                            (TaskSample.id.is_not(None), DataSample.id),
                            else_=None,
                        )
                    )
                ).label("assigned_samples"),
                func.count(
                    func.distinct(
                        case(
                            (
                                TaskSample.status.in_(completed_statuses),
                                DataSample.id,
                            ),
                            else_=None,
                        )
                    )
                ).label("completed_samples"),
                func.count(
                    func.distinct(
                        case(
                            (
                                TaskSample.status == TaskSampleStatus.SUBMITTED,
                                DataSample.id,
                            ),
                            else_=None,
                        )
                    )
                ).label("submitted_samples"),
                func.count(
                    func.distinct(
                        case(
                            (
                                TaskSample.status == TaskSampleStatus.APPROVED,
                                DataSample.id,
                            ),
                            else_=None,
                        )
                    )
                ).label("approved_samples"),
                func.count(
                    func.distinct(
                        case(
                            (
                                TaskSample.status.in_(
                                    (
                                        TaskSampleStatus.REJECTED,
                                        TaskSampleStatus.REWORK,
                                    )
                                ),
                                DataSample.id,
                            ),
                            else_=None,
                        )
                    )
                ).label("rejected_samples"),
            )
            .outerjoin(TaskSample, TaskSample.data_sample_id == DataSample.id)
            .where(DataSample.dataset_id.in_(dataset_ids))
            .group_by(DataSample.dataset_id)
        )

        return {
            row.dataset_id: {
                "assigned_samples": int(row.assigned_samples or 0),
                "completed_samples": int(row.completed_samples or 0),
                "submitted_samples": int(row.submitted_samples or 0),
                "approved_samples": int(row.approved_samples or 0),
                "rejected_samples": int(row.rejected_samples or 0),
            }
            for row in result
        }

    def _build_dataset_response(
        self, ds: Dataset, progress: Optional[dict] = None
    ) -> dict:
        progress = progress or {}
        completed_samples = int(progress.get("completed_samples", 0) or 0)
        progress_percent = (
            round((completed_samples / ds.total_samples) * 100, 1)
            if ds.total_samples > 0
            else 0.0
        )

        return {
            "id": ds.id,
            "project_id": ds.project_id,
            "name": ds.name,
            "source_format": ds.source_format.value,
            "file_url": ds.file_url,
            "total_samples": ds.total_samples,
            "assigned_samples": int(progress.get("assigned_samples", 0) or 0),
            "completed_samples": completed_samples,
            "submitted_samples": int(progress.get("submitted_samples", 0) or 0),
            "approved_samples": int(progress.get("approved_samples", 0) or 0),
            "rejected_samples": int(progress.get("rejected_samples", 0) or 0),
            "progress_percent": progress_percent,
            "status": ds.status.value,
            "field_mapping": ds.field_mapping,
            "imported_by": ds.imported_by,
            "created_at": ds.created_at,
        }

    def _build_sample_response(self, s: DataSample) -> dict:
        return {
            "id": s.id,
            "dataset_id": s.dataset_id,
            "content": s.content,
            "metadata": s.metadata_,
            "sample_index": s.sample_index,
            "created_at": s.created_at,
        }
