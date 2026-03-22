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
    my_team: list[dict[str, Any]] | None = None
    agents: list[dict[str, Any]] | None = None
    flows: list[dict[str, Any]] | None = None
    repo_mappings: list[dict[str, Any]] | None = None
    profile_settings: dict[str, Any] | None = None


class PreferenceResponse(BaseModel):
    azure_project: str | None
    azure_team: str | None
    azure_sprint_path: str | None
    my_team: list[dict[str, Any]]
    agents: list[dict[str, Any]]
    flows: list[dict[str, Any]]
    repo_mappings: list[dict[str, Any]]
    profile_settings: dict[str, Any]


def _parse_json(val: str | None) -> list[dict[str, Any]]:
    if not val:
        return []


def _parse_json_obj(val: str | None) -> dict[str, Any]:
    if not val:
        return {}
    try:
        parsed = json.loads(val)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}
    try:
        return json.loads(val)  # type: ignore[return-value]
    except Exception:
        return []


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
        return PreferenceResponse(
            azure_project=None, azure_team=None, azure_sprint_path=None,
            my_team=[], agents=[], flows=[], repo_mappings=[], profile_settings={},
        )
    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=_parse_json(pref.my_team_json),
        agents=_parse_json(pref.agents_json),
        flows=_parse_json(pref.flows_json),
        repo_mappings=_parse_json(pref.repo_mappings_json),
        profile_settings=_parse_json_obj(pref.profile_settings_json),
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
    if payload.agents is not None:
        pref.agents_json = json.dumps(payload.agents, ensure_ascii=False)
    if payload.flows is not None:
        pref.flows_json = json.dumps(payload.flows, ensure_ascii=False)
    if payload.repo_mappings is not None:
        pref.repo_mappings_json = json.dumps(payload.repo_mappings, ensure_ascii=False)
    if payload.profile_settings is not None:
        pref.profile_settings_json = json.dumps(payload.profile_settings, ensure_ascii=False)

    await db.commit()
    await db.refresh(pref)

    return PreferenceResponse(
        azure_project=pref.azure_project,
        azure_team=pref.azure_team,
        azure_sprint_path=pref.azure_sprint_path,
        my_team=_parse_json(pref.my_team_json),
        agents=_parse_json(pref.agents_json),
        flows=_parse_json(pref.flows_json),
        repo_mappings=_parse_json(pref.repo_mappings_json),
        profile_settings=_parse_json_obj(pref.profile_settings_json),
    )
