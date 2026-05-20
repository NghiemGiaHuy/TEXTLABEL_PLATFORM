"""
app/schemas/notification.py
Pydantic schemas for Notification module.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class NotificationPrefsSchema(BaseModel):
    task_assigned: bool = True
    task_rejected: bool = True
    project_deadline: bool = True
    review_complete: bool = True
    task_submitted: bool = True
    annotation_milestone: bool = False
    export_ready: bool = True


class NotificationResponse(BaseModel):
    id: UUID
    type: str
    title: str
    message: str
    link: Optional[str] = None
    is_read: bool
    actor_name: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int
    total: int
