"""
app/core/seed.py
Database seeder: creates the 4 fixed roles and a default admin user.
Run once after migrations.
"""

import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.user import Role, RoleName, User, UserRole, UserStatus

logger = logging.getLogger(__name__)

ROLES = [
    {"name": RoleName.ADMIN, "description": "System administrator"},
    {"name": RoleName.PROJECT_OWNER, "description": "Project owner / manager"},
    {"name": RoleName.ANNOTATOR, "description": "Data annotator"},
    {"name": RoleName.REVIEWER, "description": "Annotation reviewer / QA"},
]

DEFAULT_ADMIN = {
    "email": "admin@textlabeling.com",
    "password": "Admin@123456",
    "full_name": "System Administrator",
}


async def seed_roles(db: AsyncSession) -> dict:
    """Create the 4 fixed roles if they don't exist."""
    role_map = {}
    for role_data in ROLES:
        result = await db.execute(
            select(Role).where(Role.name == role_data["name"])
        )
        role = result.scalar_one_or_none()
        if not role:
            role = Role(**role_data)
            db.add(role)
            logger.info(f"  Created role: {role_data['name'].value}")
        role_map[role_data["name"]] = role

    await db.flush()
    return role_map


async def seed_admin(db: AsyncSession, role_map: dict) -> None:
    """Create default admin user if not exists."""
    result = await db.execute(
        select(User).where(User.email == DEFAULT_ADMIN["email"])
    )
    admin = result.scalar_one_or_none()

    if not admin:
        admin = User(
            email=DEFAULT_ADMIN["email"],
            password_hash=hash_password(DEFAULT_ADMIN["password"]),
            full_name=DEFAULT_ADMIN["full_name"],
            status=UserStatus.ACTIVE,
        )
        db.add(admin)
        await db.flush()

        # Assign admin role
        admin_role = role_map[RoleName.ADMIN]
        user_role = UserRole(user_id=admin.id, role_id=admin_role.id)
        db.add(user_role)
        await db.flush()

        logger.info(
            f"  Created admin user: {DEFAULT_ADMIN['email']} "
            f"(password: {DEFAULT_ADMIN['password']})"
        )


async def run_seed(db: AsyncSession) -> None:
    """Run all seeders."""
    logger.info("🌱 Seeding database...")
    role_map = await seed_roles(db)
    await seed_admin(db, role_map)
    await db.commit()
    logger.info("✅ Seeding complete!")