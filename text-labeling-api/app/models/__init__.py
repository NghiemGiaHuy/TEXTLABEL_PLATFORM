"""
app/models/__init__.py
Import all models here so Alembic autogenerate can discover them.
"""

from app.models.user import (
    User,
    Role,
    UserRole,
    RefreshToken,
    PasswordReset,
    UserStatus,
    RoleName,
)
from app.models.audit_log import AuditLog
from app.models.project import (
    Project,
    ProjectMember,
    ProjectStatus,
    ProjectRole,
    ProjectPriority,
)
from app.models.label import (
    LabelSet,
    LabelGroup,
    Label,
)
from app.models.dataset import (
    Dataset,
    DataSample,
    SourceFormat,
    DatasetStatus,
)
from app.models.task import (
    Task,
    TaskSample,
    TaskStatus,
    AssignmentMethod,
    TaskSampleStatus,
)
from app.models.annotation import (
    Annotation,
    AnnotationDraft,
)
from app.models.review import (
    Review,
    ReviewResult,
)
from app.models.export import (
    Export,
    ExportFormat,
    ExportFilterStatus,
)

__all__ = [
    # User
    "User",
    "Role",
    "UserRole",
    "RefreshToken",
    "PasswordReset",
    "UserStatus",
    "RoleName",
    # Audit
    "AuditLog",
    # Project
    "Project",
    "ProjectMember",
    "ProjectStatus",
    "ProjectRole",
    "ProjectPriority",
    # Label
    "LabelSet",
    "LabelGroup",
    "Label",
    # Dataset
    "Dataset",
    "DataSample",
    "SourceFormat",
    "DatasetStatus",
    # Task
    "Task",
    "TaskSample",
    "TaskStatus",
    "AssignmentMethod",
    "TaskSampleStatus",
    # Annotation
    "Annotation",
    "AnnotationDraft",
    # Review
    "Review",
    "ReviewResult",
    # Export
    "Export",
    "ExportFormat",
    "ExportFilterStatus",
]
