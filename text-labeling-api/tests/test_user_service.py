from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.exceptions import BadRequestException
from app.models.user import RoleName
from app.services.user_service import UserService


def test_blocks_admin_changing_own_role_set() -> None:
    service = UserService(db=None)
    admin_id = uuid4()
    user = SimpleNamespace(id=admin_id, role_names=[RoleName.ADMIN])

    with pytest.raises(BadRequestException, match="Cannot change your own"):
        service._guard_self_admin_role_change(
            user, admin_id, {RoleName.PROJECT_OWNER.value}
        )


def test_allows_admin_saving_own_unchanged_role_set() -> None:
    service = UserService(db=None)
    admin_id = uuid4()
    user = SimpleNamespace(id=admin_id, role_names=[RoleName.ADMIN])

    service._guard_self_admin_role_change(user, admin_id, {RoleName.ADMIN.value})


def test_allows_admin_changing_another_users_role_set() -> None:
    service = UserService(db=None)
    admin_id = uuid4()
    user = SimpleNamespace(id=uuid4(), role_names=[RoleName.ADMIN])

    service._guard_self_admin_role_change(
        user, admin_id, {RoleName.PROJECT_OWNER.value}
    )
