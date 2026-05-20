"""
app/services/export_service.py
Business logic for exporting labeled data (UC-6.1).
"""

import csv
import io
import json
import os
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    BadRequestException,
    ForbiddenException,
    NotFoundException,
)
from app.models.annotation import Annotation
from app.models.audit_log import AuditLog
from app.models.dataset import DataSample, Dataset
from app.models.export import Export, ExportFilterStatus, ExportFormat
from app.models.notification import NotificationType
from app.models.project import Project, ProjectMember, ProjectRole
from app.models.review import Review
from app.models.task import Task, TaskSample, TaskSampleStatus
from app.models.user import RoleName, User
from app.services.notification_service import create_notification


class ExportService:
    """Handles data export in JSON/JSONL/CSV formats."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ================================================================
    # CREATE EXPORT (UC-6.1 — main flow)
    # ================================================================

    async def create_export(
        self,
        project_id: UUID,
        current_user: User,
        format: str,
        filter_status: str = "approved_only",
        dataset_id: Optional[UUID] = None,
        include_metadata: bool = False,
    ) -> dict:
        await self._check_project_owner(project_id, current_user)

        # Validate enums
        try:
            fmt = ExportFormat(format)
        except ValueError:
            raise BadRequestException(
                f"Invalid format: '{format}'. Must be json, jsonl, or csv."
            )
        try:
            flt = ExportFilterStatus(filter_status)
        except ValueError:
            raise BadRequestException(
                f"Invalid filter_status: '{filter_status}'. "
                f"Must be approved_only or all."
            )

        # Reject re-export when nothing changed
        await self._check_duplicate_export(project_id, current_user.id, fmt, flt)

        # Build query for exportable data
        data = await self._collect_export_data(
            project_id=project_id,
            dataset_id=dataset_id,
            filter_status=flt,
            include_metadata=include_metadata,
        )

        if not data:
            raise BadRequestException(
                "No data matches the export criteria"
            )

        # Generate file
        file_url = await self._generate_file(
            data=data,
            fmt=fmt,
            project_id=project_id,
        )

        # Create export record
        export = Export(
            project_id=project_id,
            dataset_id=dataset_id,
            exported_by=current_user.id,
            format=fmt,
            filter_status=flt,
            file_url=file_url,
            total_records=len(data),
        )
        self.db.add(export)

        self.db.add(
            AuditLog(
                user_id=current_user.id,
                action="CREATE_EXPORT",
                entity_type="export",
                entity_id=export.id,
                details={
                    "format": format,
                    "filter": filter_status,
                    "records": len(data),
                },
            )
        )
        await self.db.flush()

        await create_notification(
            self.db,
            user_id=current_user.id,
            type=NotificationType.EXPORT_READY,
            title="Export hoàn tất",
            message=(
                f"File {fmt.value.upper()} đã sẵn sàng với "
                f"{len(data)} bản ghi."
            ),
            link=f"/projects/{project_id}",
            actor_name=current_user.full_name or current_user.email,
        )

        return self._build_export_response(export)

    # ================================================================
    # LIST EXPORTS
    # ================================================================

    async def list_exports(
        self, project_id: UUID, current_user: User
    ) -> List[dict]:
        await self._check_project_owner(project_id, current_user)

        result = await self.db.execute(
            select(Export)
            .where(Export.project_id == project_id)
            .order_by(Export.created_at.desc())
        )
        exports = result.scalars().all()
        return [self._build_export_response(e) for e in exports]

    # ================================================================
    # GET EXPORT DETAIL
    # ================================================================

    async def get_export(
        self, project_id: UUID, export_id: UUID, current_user: User
    ) -> dict:
        await self._check_project_owner(project_id, current_user)
        export = await self._get_export_or_404(export_id, project_id)
        return self._build_export_response(export)

    # ================================================================
    # DOWNLOAD EXPORT DATA
    # ================================================================

    async def get_export_data(
        self, project_id: UUID, export_id: UUID, current_user: User
    ) -> dict:
        """
        Return export metadata and the raw data for download.
        Frontend receives JSON and handles file generation client-side,
        or reads from file_url if stored on disk.
        """
        await self._check_project_owner(project_id, current_user)
        export = await self._get_export_or_404(export_id, project_id)

        # Re-collect data to serve fresh
        data = await self._collect_export_data(
            project_id=project_id,
            dataset_id=export.dataset_id,
            filter_status=export.filter_status,
            include_metadata=True,
        )

        return {
            "export_info": self._build_export_response(export),
            "data": data,
        }

    # ================================================================
    # DELETE EXPORT
    # ================================================================

    async def delete_export(
        self, project_id: UUID, export_id: UUID, current_user: User
    ) -> None:
        await self._check_project_owner(project_id, current_user)
        export = await self._get_export_or_404(export_id, project_id)

        if export.file_url and os.path.exists(export.file_url):
            try:
                os.remove(export.file_url)
            except OSError:
                pass

        await self.db.delete(export)

    # ================================================================
    # Data Collection
    # ================================================================

    async def _collect_export_data(
        self,
        project_id: UUID,
        dataset_id: Optional[UUID],
        filter_status: ExportFilterStatus,
        include_metadata: bool = False,
    ) -> List[dict]:
        """
        Collect annotated data for export.
        Joins TaskSample → DataSample → Annotations.
        """
        # Base query: task_samples in this project
        query = (
            select(TaskSample)
            .join(Task, TaskSample.task_id == Task.id)
            .options(
                selectinload(TaskSample.data_sample),
                selectinload(TaskSample.task).selectinload(Task.assignee),
            )
            .where(Task.project_id == project_id)
        )

        if dataset_id:
            query = query.where(Task.dataset_id == dataset_id)

        if filter_status == ExportFilterStatus.APPROVED_ONLY:
            query = query.where(
                TaskSample.status == TaskSampleStatus.APPROVED
            )

        result = await self.db.execute(query.order_by(TaskSample.sample_order))
        task_samples = result.scalars().unique().all()

        export_data = []
        for ts in task_samples:
            # Get annotations for this sample
            ann_result = await self.db.execute(
                select(Annotation)
                .options(selectinload(Annotation.label))
                .where(Annotation.task_sample_id == ts.id)
                .order_by(Annotation.start_offset)
            )
            annotations = ann_result.scalars().all()

            item = {
                "sample_id": str(ts.data_sample_id),
                "content": ts.data_sample.content,
                "annotations": [
                    {
                        "label": a.label.name if a.label else str(a.label_id),
                        "start": a.start_offset,
                        "end": a.end_offset,
                        "text": a.selected_text,
                    }
                    for a in annotations
                ],
                "annotator": (
                    ts.task.assignee.full_name
                    if ts.task and ts.task.assignee
                    else None
                ),
                "review_status": ts.status.value,
            }

            if include_metadata and ts.data_sample.metadata_:
                item["metadata"] = ts.data_sample.metadata_

            export_data.append(item)

        return export_data

    # ================================================================
    # File Generation
    # ================================================================

    async def _generate_file(
        self, data: List[dict], fmt: ExportFormat, project_id: UUID
    ) -> str:
        """Generate export file and return file path."""
        export_dir = "/tmp/exports"
        os.makedirs(export_dir, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        base_name = f"export_{project_id}_{timestamp}"

        if fmt == ExportFormat.JSON:
            path = os.path.join(export_dir, f"{base_name}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)

        elif fmt == ExportFormat.JSONL:
            path = os.path.join(export_dir, f"{base_name}.jsonl")
            with open(path, "w", encoding="utf-8") as f:
                for item in data:
                    f.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")

        elif fmt == ExportFormat.CSV:
            path = os.path.join(export_dir, f"{base_name}.csv")
            with open(path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow([
                    "sample_id", "content", "annotations",
                    "annotator", "review_status",
                ])
                for item in data:
                    writer.writerow([
                        item["sample_id"],
                        item["content"],
                        json.dumps(item["annotations"], ensure_ascii=False),
                        item.get("annotator", ""),
                        item.get("review_status", ""),
                    ])

        return path

    # ================================================================
    # Duplicate-export check
    # ================================================================

    async def _check_duplicate_export(
        self,
        project_id: UUID,
        user_id: UUID,
        fmt: ExportFormat,
        flt: ExportFilterStatus,
    ) -> None:
        """Raise BadRequestException if the same user already exported
        the same (format, filter) combo for this project and nothing
        has changed in the annotations or review statuses since then."""
        result = await self.db.execute(
            select(Export)
            .where(
                and_(
                    Export.project_id == project_id,
                    Export.exported_by == user_id,
                    Export.format == fmt,
                    Export.filter_status == flt,
                )
            )
            .order_by(Export.created_at.desc())
            .limit(1)
        )
        last_export = result.scalar_one_or_none()
        if not last_export:
            return

        # Any annotation created/updated after last export?
        ann_check = await self.db.execute(
            select(Annotation.id)
            .join(TaskSample, Annotation.task_sample_id == TaskSample.id)
            .join(Task, TaskSample.task_id == Task.id)
            .where(
                and_(
                    Task.project_id == project_id,
                    Annotation.updated_at > last_export.created_at,
                )
            )
            .limit(1)
        )
        if ann_check.scalar_one_or_none():
            return

        # For approved_only: also check if any review happened since
        if flt == ExportFilterStatus.APPROVED_ONLY:
            rev_check = await self.db.execute(
                select(Review.id)
                .join(TaskSample, Review.task_sample_id == TaskSample.id)
                .join(Task, TaskSample.task_id == Task.id)
                .where(
                    and_(
                        Task.project_id == project_id,
                        Review.reviewed_at > last_export.created_at,
                    )
                )
                .limit(1)
            )
            if rev_check.scalar_one_or_none():
                return

        raise BadRequestException(
            "Dữ liệu không thay đổi kể từ lần export cuối cùng với cùng định dạng và bộ lọc này."
        )

    # ================================================================
    # Access Control
    # ================================================================

    async def _check_project_owner(
        self, project_id: UUID, user: User
    ) -> None:
        project_result = await self.db.execute(
            select(Project)
            .options(selectinload(Project.members))
            .where(Project.id == project_id)
        )
        project = project_result.scalar_one_or_none()
        if not project:
            raise NotFoundException(f"Project '{project_id}' not found")

        if RoleName.ADMIN.value in user.role_names:
            return

        for m in project.members:
            if (
                m.user_id == user.id
                and m.role_in_project == ProjectRole.PROJECT_OWNER
            ):
                return
        raise ForbiddenException("Only project owners or admin can export")

    async def _get_export_or_404(
        self, export_id: UUID, project_id: UUID
    ) -> Export:
        result = await self.db.execute(
            select(Export).where(
                and_(
                    Export.id == export_id,
                    Export.project_id == project_id,
                )
            )
        )
        export = result.scalar_one_or_none()
        if not export:
            raise NotFoundException(
                f"Export '{export_id}' not found in this project"
            )
        return export

    def _build_export_response(self, e: Export) -> dict:
        return {
            "id": e.id,
            "project_id": e.project_id,
            "dataset_id": e.dataset_id,
            "exported_by": e.exported_by,
            "format": e.format.value,
            "filter_status": e.filter_status.value,
            "file_url": e.file_url,
            "total_records": e.total_records,
            "created_at": e.created_at,
        }
