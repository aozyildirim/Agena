"""Sentinel alerts + rules API. Detection runs in the worker; these endpoints
list/triage alerts and manage the rules that raise them."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_api.api.dependencies import CurrentTenant, get_current_tenant
from agena_core.database import get_db_session
from agena_models.models.alert import Alert
from agena_models.models.alert_rule import AlertRule
from agena_services.services.sentinel_service import SentinelService

router = APIRouter(prefix='/alerts', tags=['alerts'])
rules_router = APIRouter(prefix='/alert-rules', tags=['alert-rules'])
deploy_router = APIRouter(prefix='/deploys', tags=['deploys'])


def _alert_dict(a: Alert) -> dict[str, Any]:
    return {
        'id': a.id, 'source': a.source, 'metric_kind': a.metric_kind,
        'entity_ref': a.entity_ref, 'entity_name': a.entity_name, 'scope': a.scope,
        'severity': a.severity, 'title': a.title, 'detail': a.detail or {},
        'status': a.status, 'task_id': a.task_id,
        'suggested_fix': a.suggested_fix, 'deploy_id': a.deploy_id,
        'opened_at': a.opened_at.isoformat() if a.opened_at else None,
        'resolved_at': a.resolved_at.isoformat() if a.resolved_at else None,
        'updated_at': a.updated_at.isoformat() if a.updated_at else None,
    }


@router.get('')
async def list_alerts(
    status: Optional[str] = None,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    stmt = select(Alert).where(Alert.organization_id == tenant.organization_id)
    if status:
        stmt = stmt.where(Alert.status == status)
    stmt = stmt.order_by(desc(Alert.opened_at)).limit(200)
    rows = (await db.execute(stmt)).scalars().all()
    return [_alert_dict(a) for a in rows]


@router.get('/stats')
async def alert_stats(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    rows = (await db.execute(
        select(Alert.status, func.count()).where(
            Alert.organization_id == tenant.organization_id,
        ).group_by(Alert.status)
    )).all()
    by_status = {s: c for s, c in rows}
    sev = (await db.execute(
        select(Alert.severity, func.count()).where(
            Alert.organization_id == tenant.organization_id, Alert.status == 'open',
        ).group_by(Alert.severity)
    )).all()
    return {'by_status': by_status, 'open_by_severity': {s: c for s, c in sev},
            'open': by_status.get('open', 0)}


async def _get_alert(alert_id: int, tenant: CurrentTenant, db: AsyncSession) -> Alert:
    a = (await db.execute(select(Alert).where(
        Alert.id == alert_id, Alert.organization_id == tenant.organization_id,
    ))).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail='Alert not found')
    return a


@router.post('/{alert_id}/ack')
async def acknowledge(
    alert_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    a = await _get_alert(alert_id, tenant, db)
    a.status = 'acknowledged'
    a.acknowledged_by_user_id = tenant.user_id
    a.updated_at = datetime.utcnow()
    await db.commit()
    return _alert_dict(a)


@router.post('/{alert_id}/resolve')
async def resolve(
    alert_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    a = await _get_alert(alert_id, tenant, db)
    a.status = 'resolved'
    a.resolved_at = datetime.utcnow()
    a.updated_at = datetime.utcnow()
    await db.commit()
    return _alert_dict(a)


@router.post('/{alert_id}/suggest')
async def suggest_fix(
    alert_id: int,
    lang: str = 'en',
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    a = await _get_alert(alert_id, tenant, db)
    return await SentinelService(db).suggest_fix(a, lang=lang)


@router.post('/{alert_id}/create-fix')
async def create_fix(
    alert_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    a = await _get_alert(alert_id, tenant, db)
    if a.task_id:
        return {'task_id': a.task_id, 'already': True}
    task_id = await SentinelService(db).create_fix_task(a, tenant.user_id)
    return {'task_id': task_id}


# --- rules -----------------------------------------------------------------

class RuleIn(BaseModel):
    name: str
    source: str = 'newrelic'
    metric_kind: str
    scope_filter: Optional[str] = None
    comparison: str = 'pct_up'
    threshold: float = 30.0
    min_abs: Optional[float] = None
    consecutive: int = 1
    min_samples: int = 5
    baseline_mode: str = 'both'
    severity: str = 'high'
    repo_mapping_id: Optional[int] = None
    auto_fix: str = 'suggest'
    cooldown_min: int = 30
    is_active: bool = True


def _rule_dict(r: AlertRule) -> dict[str, Any]:
    return {
        'id': r.id, 'name': r.name, 'source': r.source, 'metric_kind': r.metric_kind,
        'scope_filter': r.scope_filter, 'comparison': r.comparison, 'threshold': r.threshold,
        'min_abs': r.min_abs, 'consecutive': r.consecutive,
        'min_samples': r.min_samples, 'baseline_mode': r.baseline_mode, 'severity': r.severity,
        'repo_mapping_id': r.repo_mapping_id, 'auto_fix': r.auto_fix,
        'cooldown_min': r.cooldown_min, 'is_active': r.is_active,
    }


# Sensible, noise-suppressed starter rules (name, metric, comparison, threshold,
# severity, min_abs floor, consecutive breaches).
_DEFAULT_RULES = [
    ('Error-rate spike', 'error_rate', 'pct_up', 100.0, 'critical', 1.0, 1),     # >1% AND doubled
    ('p95 latency regression', 'latency_p95', 'pct_up', 30.0, 'high', 200.0, 2),  # >200ms AND +30%, 2x
    ('Throughput drop', 'throughput', 'pct_down', 40.0, 'high', None, 2),         # -40% sustained
    ('DB time regression', 'db_time', 'pct_up', 50.0, 'medium', 50.0, 2),         # >50ms AND +50%, 2x
]


@rules_router.get('')
async def list_rules(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(AlertRule).where(
        AlertRule.organization_id == tenant.organization_id,
    ).order_by(AlertRule.id))).scalars().all()
    return [_rule_dict(r) for r in rows]


@rules_router.post('')
async def create_rule(
    payload: RuleIn,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    r = AlertRule(organization_id=tenant.organization_id, **payload.model_dump())
    db.add(r)
    await db.commit()
    return _rule_dict(r)


@rules_router.post('/seed-defaults')
async def seed_defaults(
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    existing = {r.name for r in (await db.execute(select(AlertRule).where(
        AlertRule.organization_id == tenant.organization_id,
    ))).scalars().all()}
    created = 0
    for name, kind, cmp, thr, sev, min_abs, consec in _DEFAULT_RULES:
        if name in existing:
            continue
        db.add(AlertRule(
            organization_id=tenant.organization_id, name=name, source='newrelic',
            metric_kind=kind, comparison=cmp, threshold=thr, severity=sev,
            min_abs=min_abs, consecutive=consec,
            min_samples=5, baseline_mode='both', auto_fix='suggest',
        ))
        created += 1
    await db.commit()
    return {'created': created}


class DeployIn(BaseModel):
    repo_mapping_id: int
    environment: str = 'production'
    sha: Optional[str] = None
    provider: str = 'github'
    deployed_at: Optional[str] = None  # ISO; defaults to now


@deploy_router.post('')
async def record_deploy(
    payload: DeployIn,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    """Record a deploy marker. Sentinel compares metrics before/after it ~30 min
    later (deploy-anchored regression detection)."""
    from agena_models.models.git_deployment import GitDeployment
    when = datetime.utcnow()
    if payload.deployed_at:
        try:
            when = datetime.fromisoformat(payload.deployed_at.replace('Z', '+00:00')).replace(tzinfo=None)
        except ValueError:
            pass
    dep = GitDeployment(
        organization_id=tenant.organization_id, repo_mapping_id=str(payload.repo_mapping_id),
        provider=payload.provider, environment=payload.environment, sha=payload.sha,
        status='success', deployed_at=when,
    )
    db.add(dep)
    await db.commit()
    return {'id': dep.id, 'deployed_at': when.isoformat()}


@rules_router.delete('/{rule_id}')
async def delete_rule(
    rule_id: int,
    tenant: CurrentTenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db_session),
) -> dict[str, Any]:
    r = (await db.execute(select(AlertRule).where(
        AlertRule.id == rule_id, AlertRule.organization_id == tenant.organization_id,
    ))).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail='Rule not found')
    await db.delete(r)
    await db.commit()
    return {'deleted': rule_id}
