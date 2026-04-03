#!/usr/bin/env python3
"""Create a platform admin user.

Usage (inside backend container):
    python -m scripts.create_admin --email admin@agena.dev --password 'YourStr0ng!Pass' --name 'Platform Admin'

Usage (via docker):
    docker exec ai_agent_api python /app/scripts/create_admin.py --email admin@agena.dev --password 'YourStr0ng!Pass'
"""
import argparse
import asyncio
import re
import sys

from sqlalchemy import select

from agena_core.database import SessionLocal
from agena_core.security.passwords import hash_password
from agena_models.models.organization import Organization, slugify
from agena_models.models.organization_member import OrganizationMember
from agena_models.models.subscription import Subscription
from agena_models.models.user import User


PASSWORD_PATTERN = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};:,.<>?]).{12,}$'
)

ADMIN_ORG_NAME = 'AGENA Platform'
ADMIN_ORG_SLUG = 'agena-platform'


async def create_admin(email: str, password: str, name: str) -> None:
    if not PASSWORD_PATTERN.match(password):
        print('ERROR: Password must be at least 12 characters with uppercase, lowercase, digit, and special character.')
        sys.exit(1)

    async with SessionLocal() as db:
        # Check if user already exists
        existing = await db.execute(select(User).where(User.email == email))
        user = existing.scalar_one_or_none()

        if user:
            # Promote existing user to platform admin
            user.is_platform_admin = True
            await db.commit()
            print(f'Existing user {email} promoted to platform admin.')
            return

        # Get or create platform admin org
        org_result = await db.execute(select(Organization).where(Organization.slug == ADMIN_ORG_SLUG))
        org = org_result.scalar_one_or_none()
        if not org:
            org = Organization(name=ADMIN_ORG_NAME, slug=ADMIN_ORG_SLUG)
            db.add(org)
            await db.flush()
            db.add(Subscription(organization_id=org.id, plan_name='enterprise', status='active'))

        # Create admin user
        user = User(
            email=email,
            full_name=name,
            hashed_password=hash_password(password),
            is_platform_admin=True,
        )
        db.add(user)
        await db.flush()

        # Add to admin org as owner
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role='owner'))
        await db.commit()

        print(f'Platform admin created: {email} (org: {ADMIN_ORG_NAME})')
        print(f'Login at: https://agena.dev/signin')


def main() -> None:
    parser = argparse.ArgumentParser(description='Create a platform admin user')
    parser.add_argument('--email', required=True, help='Admin email')
    parser.add_argument('--password', required=True, help='Strong password (12+ chars, upper/lower/digit/special)')
    parser.add_argument('--name', default='Platform Admin', help='Full name')
    args = parser.parse_args()

    asyncio.run(create_admin(args.email, args.password, args.name))


if __name__ == '__main__':
    main()
