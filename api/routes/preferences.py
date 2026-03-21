import json
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import CurrentTenant, get_current_tenant
from core.database import get_db_session
from models.user_preference import UserPreference

router = APIRouter(prefix='/preferences', tags=['preferences'])


class PreferencePayload(BaseModel):
    azure_project: str | None = None
    azure_team: str | None = None
    azure_sprint_path: str | None = None
    my_team: list[dict[str, Any]] | None = None  # [{id, displayName, uniqueName}]


class PreferenceResponse(BaseModel):
    azure_project: str | None
    azure_team: str | None
    azure_sprint_path: str | None
    my_team: list[dict[str, Any]]


@router.get('', response_model=PreferenceResponse)
async def get_preferences(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PreferenceResponse:
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == tenant.user_id)
    )
    pref = result.scalar_one_or_none()
    if pref is None:
        return PreferenceResponse(azure_project=None, azure_team=None, azure_sprint_path=None, my_team=[])
    my_team: list[dict[str, Any]] = []
    if pref.my_team_json:
        try:
            my_team = json.loads(pref.my_team_json)
        except Exception:
            my_team = []
    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=my_team,
    )


@router.put('', response_model=PreferenceResponse)
async def save_preferences(
    payload: PreferencePayload,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> PreferenceResponse:
    result = await db.execute(
        select(UserPreference).where(UserPreference.user_id == tenant.user_id)
    )
    pref = result.scalar_one_or_none()
    if pref is None:
        pref = UserPreference(user_id=tenant.user_id)
        db.add(pref)

    if payload.azure_project is not None:
        pref.azure_project = payload.azure_project
    if payload.azure_team is not None:
        pref.azure_team = payload.azure_team
    if payload.azure_sprint_path is not None:
        pref.azure_sprint_path = payload.azure_sprint_path
    if payload.my_team is not None:
        pref.my_team_json = json.dumps(payload.my_team, ensure_ascii=False)

    await db.commit()
    await db.refresh(pref)

    my_team_out: list[dict[str, Any]] = []
    if pref.my_team_json:
        try:
            my_team_out = json.loads(pref.my_team_json)
        except Exception:
            my_team_out = []

    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=my_team_out,
    )
