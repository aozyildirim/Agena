from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class BusinessRequestIntakeAttachment(Base):
    """A file the requester attached while describing their request.

    Business people explain a request with a screenshot far more readily than
    with prose, so the intake accepts images (and small documents) alongside
    the conversation. Files live on disk like task attachments; on submit they
    are uploaded to the Azure work item so the engineering team sees them
    where they already work.
    """

    __tablename__ = 'business_request_intake_attachments'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    intake_id: Mapped[int] = mapped_column(
        ForeignKey('business_request_intakes.id', ondelete='CASCADE'), index=True
    )
    organization_id: Mapped[int] = mapped_column(
        ForeignKey('organizations.id', ondelete='CASCADE'), index=True
    )
    uploaded_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    filename: Mapped[str] = mapped_column(String(512))
    content_type: Mapped[str] = mapped_column(String(128), default='application/octet-stream')
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    storage_path: Mapped[str] = mapped_column(String(1024))
    # Set once the file has been copied onto the Azure work item.
    azure_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
