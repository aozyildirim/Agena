from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import get_db_session
from agena_models.models.contact_submission import ContactSubmission
from agena_models.models.newsletter_subscriber import NewsletterSubscriber

router = APIRouter(prefix='/public', tags=['public'])


class ContactRequest(BaseModel):
    name: str
    email: str
    message: str
    newsletter: bool = False


class NewsletterRequest(BaseModel):
    email: str


@router.post('/contact')
async def submit_contact(
    payload: ContactRequest,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    db.add(ContactSubmission(
        name=payload.name[:200],
        email=payload.email[:200],
        message=payload.message[:2000],
        newsletter=payload.newsletter,
    ))
    if payload.newsletter:
        normalized = payload.email.strip().lower()
        existing = await db.execute(
            select(NewsletterSubscriber).where(NewsletterSubscriber.email == normalized)
        )
        if not existing.scalar_one_or_none():
            db.add(NewsletterSubscriber(email=normalized))
    await db.commit()
    return {'ok': True}


@router.post('/newsletter')
async def subscribe_newsletter(
    payload: NewsletterRequest,
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, bool]:
    normalized = payload.email.strip().lower()
    existing = await db.execute(
        select(NewsletterSubscriber).where(NewsletterSubscriber.email == normalized)
    )
    if not existing.scalar_one_or_none():
        db.add(NewsletterSubscriber(email=normalized))
        await db.commit()
    return {'ok': True}
