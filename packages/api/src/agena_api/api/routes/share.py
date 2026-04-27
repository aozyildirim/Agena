"""Public task-share endpoints.

Anyone holding a valid token can:
  - GET  /share/tasks/{token}                  — read the task (title, description, comments-as-text, attachment list)
  - GET  /share/tasks/{token}/image?url=...    — proxy an Azure/Jira inline image with the *sharing org's* PAT
  - GET  /share/tasks/{token}/attachment/{id}  — download an existing TaskAttachment by id

The recipient calls a separate, authenticated endpoint to actually copy the
task into their own organization (POST /share/tasks/{token}/import in
saas_tasks.py — kept there because it needs the recipient's tenant).
"""
from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_core.database import get_db_session
from agena_models.models.task_attachment import TaskAttachment
from agena_models.models.task_record import TaskRecord
from agena_services.services.integration_config_service import IntegrationConfigService
from agena_services.services.task_share_service import TaskShareService


router = APIRouter(prefix='/share', tags=['share'])


class SharedAttachment(BaseModel):
    id: int
    filename: str
    content_type: str
    size_bytes: int


class SharedTaskResponse(BaseModel):
    title: str
    description: str
    source: str | None = None
    external_id: str | None = None
    repo_mapping_name: str | None = None
    attachments: list[SharedAttachment]
    expires_at: str | None = None
    uses_left: int


async def _resolve_or_404(token: str, db: AsyncSession):
    service = TaskShareService(db)
    row = await service.resolve(token)
    if row is None:
        raise HTTPException(status_code=404, detail='Share link is invalid, expired, or used up')
    return row


@router.get('/tasks/{token}', response_model=SharedTaskResponse)
async def read_shared_task(
    token: str,
    db: AsyncSession = Depends(get_db_session),
) -> SharedTaskResponse:
    share = await _resolve_or_404(token, db)
    task = await db.get(TaskRecord, share.task_id)
    if task is None or task.organization_id != share.organization_id:
        raise HTTPException(status_code=404, detail='Underlying task no longer exists')

    repo_mapping_name: str | None = None
    if getattr(task, 'repo_mapping_id', None):
        from agena_models.models.repo_mapping import RepoMapping
        rm = await db.get(RepoMapping, task.repo_mapping_id)
        if rm is not None:
            repo_mapping_name = rm.name or f'{rm.azure_project or ""}/{rm.azure_repo_name or rm.name or ""}'.strip('/')

    atts = (await db.execute(
        select(TaskAttachment)
        .where(
            TaskAttachment.task_id == task.id,
            TaskAttachment.organization_id == task.organization_id,
        )
        .order_by(TaskAttachment.id)
    )).scalars().all()

    return SharedTaskResponse(
        title=task.title or '',
        description=task.description or '',
        source=getattr(task, 'source', None),
        external_id=getattr(task, 'external_id', None),
        repo_mapping_name=repo_mapping_name,
        attachments=[
            SharedAttachment(
                id=a.id, filename=a.filename, content_type=a.content_type, size_bytes=a.size_bytes,
            )
            for a in atts
        ],
        expires_at=share.expires_at.isoformat() if share.expires_at else None,
        uses_left=max(0, (share.max_uses or 0) - (share.use_count or 0)),
    )


@router.get('/tasks/{token}/image')
async def shared_task_image(
    token: str,
    url: str = Query(...),
    db: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    """Proxy an Azure DevOps / Jira attachment URL using the sharing
    organization's stored PAT. Same logic as /tasks/proxy-image but the
    auth comes from the share token instead of the recipient's session,
    so a recipient without their own integration can still see the
    images embedded in the description."""
    share = await _resolve_or_404(token, db)
    target = (url or '').strip()
    if not target.startswith('https://'):
        raise HTTPException(status_code=400, detail='URL must start with https://')
    parsed_host = urlparse(target).netloc.lower()
    if not parsed_host:
        raise HTTPException(status_code=400, detail='Bad URL host')

    cfg_service = IntegrationConfigService(db)
    azure_cfg = await cfg_service.get_config(share.organization_id, 'azure')
    jira_cfg = await cfg_service.get_config(share.organization_id, 'jira')

    auth_header: str | None = None
    matched = False
    if azure_cfg and azure_cfg.secret:
        try:
            az_host = urlparse((azure_cfg.base_url or '').rstrip('/')).netloc.lower()
        except Exception:
            az_host = ''
        if (az_host and az_host in parsed_host) or 'dev.azure.com' in parsed_host:
            tok = base64.b64encode(f':{azure_cfg.secret}'.encode()).decode()
            auth_header = f'Basic {tok}'
            matched = True
    if not matched and jira_cfg and jira_cfg.secret:
        try:
            jira_host = urlparse((jira_cfg.base_url or '').rstrip('/')).netloc.lower()
        except Exception:
            jira_host = ''
        if (jira_host and jira_host in parsed_host) or 'atlassian.net' in parsed_host:
            email = (jira_cfg.username or '').strip()
            pw = (jira_cfg.secret or '').strip()
            if email and pw:
                creds = base64.b64encode(f'{email}:{pw}'.encode()).decode()
                auth_header = f'Basic {creds}'
                matched = True
    if not matched:
        raise HTTPException(status_code=403, detail='URL does not match the sharing org integration')

    headers = {'Authorization': auth_header} if auth_header else {}
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(target, headers=headers)
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f'Upstream returned {exc.response.status_code}') from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f'Upstream fetch failed: {exc}') from exc

    content_type = resp.headers.get('content-type', 'application/octet-stream').split(';', 1)[0].strip()
    if not content_type.startswith('image/'):
        raise HTTPException(status_code=415, detail=f'Upstream is not an image (got {content_type})')
    body = resp.content

    async def _stream():
        yield body

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={'Cache-Control': 'private, max-age=300'},
    )


@router.get('/tasks/{token}/attachment/{attachment_id}')
async def shared_task_attachment(
    token: str,
    attachment_id: int,
    db: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    share = await _resolve_or_404(token, db)
    att = await db.get(TaskAttachment, attachment_id)
    if att is None or att.task_id != share.task_id or att.organization_id != share.organization_id:
        raise HTTPException(status_code=404, detail='Attachment not found for this share')
    p = Path(att.storage_path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail='Attachment file is missing')
    return FileResponse(str(p), media_type=att.content_type, filename=att.filename)
