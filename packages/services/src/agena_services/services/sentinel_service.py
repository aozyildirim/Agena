"""Sentinel — proactive production-metric monitoring (the "stage 0" the
correlation/Insights engine never had).

Phase 1a (this file): snapshot New Relic metrics (throughput, p95 latency,
error-rate, DB time, apdex) per mapped APM entity into ``metric_snapshots`` so
the rule engine can later compare them against rolling baselines and deploy
windows. Sentry error-rate snapshots and the rule/alert evaluation come next.
"""
import hashlib
import logging
import statistics
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.alert import Alert
from agena_models.models.alert_rule import AlertRule
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.metric_snapshot import MetricSnapshot
from agena_models.models.newrelic_entity_mapping import NewRelicEntityMapping
from agena_models.models.repo_mapping import RepoMapping
from agena_services.integrations.newrelic_client import NewRelicClient

logger = logging.getLogger(__name__)

NR_METRICS = ('throughput', 'latency_p95', 'error_rate', 'db_time', 'apdex')
# PHP non-fatal levels logged as TransactionError but not shown as error groups
_PHP_NON_ERRORS = {
    'E_WARNING', 'E_NOTICE', 'E_DEPRECATED', 'E_STRICT', 'E_USER_WARNING',
    'E_USER_NOTICE', 'E_USER_DEPRECATED', 'E_CORE_WARNING', 'E_COMPILE_WARNING',
}
_UNIT = {'throughput': 'rpm', 'latency_p95': 'ms', 'error_rate': '%', 'db_time': 'ms', 'apdex': ''}


def _fp(org_id: int, rule_id: int, entity_ref: str, scope: str, metric_kind: str) -> str:
    raw = f'{org_id}|{rule_id}|{entity_ref}|{scope}|{metric_kind}'
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


class SentinelService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.nr = NewRelicClient()

    async def _nr_cfg(self, org_id: int) -> tuple[dict, int] | None:
        """Return (cfg, account_id) for an org's New Relic integration, or None."""
        row = (await self.db.execute(select(IntegrationConfig).where(
            IntegrationConfig.organization_id == org_id,
            IntegrationConfig.provider == 'newrelic',
        ))).scalar_one_or_none()
        if not row or not row.secret:
            return None
        acct = int((row.extra_config or {}).get('account_id') or 0)
        if not acct:
            return None
        return {'base_url': row.base_url, 'api_key': row.secret}, acct

    async def snapshot_org(self, org_id: int, *, since: str = '5 minutes ago') -> int:
        """Sample every NR metric for each active APM entity mapping of an org
        and persist as MetricSnapshot rows. Returns the number of rows written."""
        resolved = await self._nr_cfg(org_id)
        if not resolved:
            return 0
        cfg, default_acct = resolved
        mappings = list((await self.db.execute(select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.organization_id == org_id,
            NewRelicEntityMapping.is_active.is_(True),
        ))).scalars().all())
        if not mappings:
            return 0

        now = datetime.utcnow()
        win_start = now - timedelta(minutes=5)
        written = 0
        for m in mappings:
            app = (m.entity_name or '').strip()
            if not app:
                continue
            acct = m.account_id or default_acct
            for kind in NR_METRICS:
                try:
                    sample = await self.nr.fetch_metric(
                        cfg, account_id=acct, app_name=app, metric_kind=kind, since=since,
                    )
                except Exception:
                    logger.exception('sentinel: fetch_metric failed org=%s kind=%s app=%s', org_id, kind, app)
                    continue
                if not sample:
                    continue
                self.db.add(MetricSnapshot(
                    organization_id=org_id, source='newrelic',
                    entity_ref=m.entity_guid or app, entity_name=app,
                    metric_kind=kind, scope='overall',
                    value=sample['value'], unit=sample.get('unit'),
                    sample_count=sample.get('sample_count'),
                    window_start=win_start, window_end=now,
                ))
                written += 1
        if written:
            await self.db.commit()
        return written

    # -- detection / rule evaluation (rolling baseline) ---------------------

    async def _series(self, org_id: int, entity_ref: str, metric_kind: str,
                      scope: str = 'overall', days: int = 7,
                      same_hour: bool = False) -> list[MetricSnapshot]:
        """Snapshots for one metric, newest first, within the baseline window.
        When same_hour is set, keep only samples from the current hour-of-day
        (seasonal baseline) — falls back to the full series if too few."""
        cutoff = datetime.utcnow() - timedelta(days=days)
        rows = list((await self.db.execute(select(MetricSnapshot).where(
            MetricSnapshot.organization_id == org_id,
            MetricSnapshot.entity_ref == entity_ref,
            MetricSnapshot.metric_kind == metric_kind,
            MetricSnapshot.scope == scope,
            MetricSnapshot.window_end >= cutoff,
        ).order_by(MetricSnapshot.window_end.desc()))).scalars().all())
        if same_hour and rows:
            hr = rows[0].window_end.hour
            seasonal = [rows[0]] + [r for r in rows[1:] if r.window_end.hour == hr]
            if len(seasonal) >= 6:   # enough same-hour history to be meaningful
                return seasonal
        return rows

    @staticmethod
    def _check(rule: AlertRule, cur: float, base: float, std: float) -> tuple[bool, float | None]:
        cmp, thr = rule.comparison, rule.threshold
        if cmp == 'abs_above':
            return cur >= thr, None
        if cmp == 'abs_below':
            return cur <= thr, None
        if base == 0:
            return (cmp == 'pct_up' and cur > 0), None
        pct = (cur - base) / base * 100.0
        if cmp == 'pct_up':
            return pct >= thr, round(pct, 1)
        if cmp == 'pct_down':
            return -pct >= thr, round(pct, 1)
        if cmp == 'anomaly':
            return (std > 0 and abs(cur - base) >= thr * std), round(pct, 1)
        return False, round(pct, 1)

    async def _resolve_repo(self, org_id: int, rule: AlertRule, entity_ref: str) -> tuple[int | None, str | None]:
        """Which repo a fix for this alert targets: the rule's explicit repo, else
        the repo mapped to the New Relic entity. Returns (repo_mapping_id, label)."""
        rmid = rule.repo_mapping_id
        if not rmid:
            m = (await self.db.execute(select(NewRelicEntityMapping).where(
                NewRelicEntityMapping.organization_id == org_id,
                NewRelicEntityMapping.entity_guid == entity_ref,
            ))).scalar_one_or_none()
            if m:
                rmid = m.repo_mapping_id
        if not rmid:
            # last resort: a repo whose name matches the entity (real NR sends a
            # GUID here so this only ever helps name-aligned setups; harmless else)
            rm = (await self.db.execute(select(RepoMapping).where(
                RepoMapping.organization_id == org_id, RepoMapping.repo_name == entity_ref,
            ))).scalar_one_or_none()
            if rm:
                label = f'{rm.owner}/{rm.repo_name}' if rm.owner else rm.repo_name
                return rm.id, label
            return None, None
        rm = (await self.db.execute(select(RepoMapping).where(RepoMapping.id == rmid))).scalar_one_or_none()
        if not rm:
            return rmid, None
        label = f'{rm.owner}/{rm.repo_name}' if rm.owner else rm.repo_name
        return rmid, label

    async def _repo_label(self, rmid: int | None) -> str | None:
        if not rmid:
            return None
        rm = (await self.db.execute(select(RepoMapping).where(RepoMapping.id == rmid))).scalar_one_or_none()
        if not rm:
            return None
        return f'{rm.owner}/{rm.repo_name}' if rm.owner else rm.repo_name

    async def _nr_link(self, org_id: int, source: str, entity_ref: str) -> str | None:
        """Deep link into the New Relic errors inbox for the entity. Real NR
        entity GUIDs are long base64; short demo refs get no link."""
        if source != 'newrelic' or not entity_ref or len(entity_ref) < 20:
            return None
        resolved = await self._nr_cfg(org_id)
        if not resolved:
            return None
        cfg, acct = resolved
        host = 'one.eu.newrelic.com' if 'eu.newrelic' in (cfg.get('base_url') or '') else 'one.newrelic.com'
        return f'https://{host}/nr1-core/errors-inbox/entity-inbox/{entity_ref}?account={acct}'

    async def evaluate_org(self, org_id: int) -> list[Alert]:
        """Evaluate every active alert rule against the rolling baseline and
        raise / update / auto-resolve alerts. Returns newly raised alerts."""
        rules = list((await self.db.execute(select(AlertRule).where(
            AlertRule.organization_id == org_id, AlertRule.is_active.is_(True),
        ))).scalars().all())
        if not rules:
            return []
        now = datetime.utcnow()
        raised: list[Alert] = []
        for rule in rules:
            ents = (await self.db.execute(select(
                MetricSnapshot.entity_ref, MetricSnapshot.entity_name,
            ).where(
                MetricSnapshot.organization_id == org_id,
                MetricSnapshot.metric_kind == rule.metric_kind,
                MetricSnapshot.scope == 'overall',
                MetricSnapshot.window_end >= now - timedelta(hours=2),
            ).distinct())).all()
            for entity_ref, entity_name in ents:
                series = await self._series(org_id, entity_ref, rule.metric_kind)
                n_recent = max(1, rule.consecutive or 1)
                if len(series) < rule.min_samples + n_recent:   # baseline + N recent
                    continue
                recent = [s.value for s in series[:n_recent]]
                base_vals = [s.value for s in series[n_recent:]]
                base = statistics.fmean(base_vals)
                std = statistics.pstdev(base_vals) if len(base_vals) > 1 else 0.0
                current = recent[0]
                # require ALL of the last N samples to breach, and the current to
                # clear the absolute floor — kills single-spike flapping.
                all_breach = all(self._check(rule, v, base, std)[0] for v in recent)
                floor_ok = rule.min_abs is None or current >= rule.min_abs
                triggered = all_breach and floor_ok
                _, pct = self._check(rule, current, base, std)
                fp = _fp(org_id, rule.id, entity_ref, 'overall', rule.metric_kind)
                existing = (await self.db.execute(select(Alert).where(
                    Alert.fingerprint == fp, Alert.status == 'open',
                ))).scalar_one_or_none()
                unit = _UNIT.get(rule.metric_kind, '')
                detail = {
                    'trigger': 'rolling', 'current': round(current, 3),
                    'baseline': round(base, 3), 'stddev': round(std, 3),
                    'pct_change': pct, 'comparison': rule.comparison,
                    'threshold': rule.threshold, 'samples': len(base_vals), 'unit': unit,
                }
                if triggered:
                    repo_mapping_id, repo_label = await self._resolve_repo(org_id, rule, entity_ref)
                    detail['repo'] = repo_label
                    detail['repo_mapping_id'] = repo_mapping_id
                    detail['nr_link'] = await self._nr_link(org_id, rule.source, entity_ref)
                    if existing:
                        existing.detail = detail
                        existing.updated_at = now
                        continue
                    # cooldown: skip if this fingerprint fired within cooldown window
                    recent = (await self.db.execute(select(Alert).where(
                        Alert.fingerprint == fp,
                    ).order_by(Alert.opened_at.desc()).limit(1))).scalar_one_or_none()
                    if recent and recent.opened_at and \
                            (now - recent.opened_at).total_seconds() < rule.cooldown_min * 60:
                        continue
                    verb = {'pct_up': 'up', 'pct_down': 'down', 'abs_above': 'above',
                            'abs_below': 'below', 'anomaly': 'anomalous'}.get(rule.comparison, 'changed')
                    chg = f' ({pct:+.0f}%)' if pct is not None else ''
                    title = (f'{rule.metric_kind.replace("_", " ")} {verb} on '
                             f'{entity_name or entity_ref}: {round(current, 1)}{unit} '
                             f'vs baseline {round(base, 1)}{unit}{chg}')
                    alert = Alert(
                        organization_id=org_id, rule_id=rule.id, source=rule.source,
                        metric_kind=rule.metric_kind, entity_ref=entity_ref,
                        entity_name=entity_name, scope='overall', severity=rule.severity,
                        title=title[:512], detail=detail, status='open', fingerprint=fp,
                    )
                    self.db.add(alert)
                    raised.append(alert)
                elif existing:
                    existing.status = 'resolved'
                    existing.resolved_at = now
                    existing.updated_at = now
        await self.db.commit()
        for a in raised:
            await self.notify_opened(a)
        return raised

    # -- notifications + phase-2 resolution --------------------------------

    async def notify_opened(self, alert: Alert) -> None:
        from agena_models.models.organization_member import OrganizationMember
        from agena_services.services.notification_service import NotificationService
        owner = (await self.db.execute(select(OrganizationMember).where(
            OrganizationMember.organization_id == alert.organization_id,
            OrganizationMember.role == 'owner',
        ))).scalars().first()
        uid = owner.user_id if owner else 0
        sev = {'critical': 'error', 'high': 'error', 'medium': 'warning', 'low': 'info'}.get(alert.severity, 'warning')
        try:
            await NotificationService(self.db).notify_event(
                organization_id=alert.organization_id, user_id=uid,
                event_type='alert_opened', title=f'🛡️ {alert.title}'[:255],
                message=alert.title, severity=sev,
            )
        except Exception:
            logger.exception('sentinel: notify_opened failed for alert %s', alert.id)

    @staticmethod
    def _priority(sev: str) -> str:
        return sev if sev in ('critical', 'high', 'medium', 'low') else 'medium'

    def build_fix_context(self, alert: Alert) -> str:
        """Rich task description the fix agent receives — what regressed, by how
        much, the baseline, the target repo and what to do."""
        d = alert.detail or {}
        u = d.get('unit', '')
        lines = [
            f'# Production alert — {alert.title}',
            '',
            f'Sentinel detected a regression on **{alert.entity_name or alert.entity_ref}** '
            f'({alert.source} · {alert.metric_kind}).',
            '',
            '## Signal',
            f'- Metric: `{alert.metric_kind}`',
            f'- Current: **{d.get("current")}{u}**, baseline: {d.get("baseline")}{u}',
            f'- Change: {d.get("pct_change")}%  (rule: {d.get("comparison")} {d.get("threshold")})',
            f'- Trigger: {d.get("trigger")}, samples: {d.get("samples")}',
        ]
        if d.get('repo'):
            lines.append(f'- Target repo: `{d.get("repo")}`')
        if d.get('nr_link'):
            lines.append(f'- New Relic (drill-down): {d.get("nr_link")}')
        if d.get('top_offenders'):
            lines += ['', '## Slowest transactions'] + [
                f'- {t.get("transaction")}: {t.get("p95_ms")}ms ({t.get("count")} calls)'
                for t in (d.get('top_offenders') or [])[:5]
            ]
        lines += [
            '', '## Task',
            'Find the root cause of this regression and open a minimal PR that fixes it. '
            'Prioritise the most-affected code path, and add or update a test so the '
            'regression cannot recur.',
        ]
        return '\n'.join(lines)

    async def _cli_suggest(self, org_id: int, prompt: str, repo_mapping_id: int | None) -> tuple[str | None, str | None]:
        """Run the suggestion through a host CLI (claude_cli → codex) via the
        bridge, read-only. If repo_mapping_id is known the CLI is opened on that
        repo's checkout so it can grep the real code. No API key needed."""
        import os
        import httpx
        bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
        repo_path = '/tmp'
        if repo_mapping_id:
            row = (await self.db.execute(select(RepoMapping).where(
                RepoMapping.id == repo_mapping_id, RepoMapping.organization_id == org_id,
            ))).scalar_one_or_none()
            if row and (row.local_repo_path or '').strip():
                repo_path = row.local_repo_path.strip()
        for cli in ('claude', 'codex'):
            try:
                async with httpx.AsyncClient(timeout=180) as client:
                    resp = await client.post(f'{bridge_url}/{cli}', json={
                        'repo_path': repo_path, 'prompt': prompt, 'model': '',
                        'timeout': 150, 'read_only': True,
                    })
                    data = resp.json()
                if data.get('status') == 'ok' and (data.get('stdout') or '').strip():
                    return data['stdout'].strip(), f'{cli}_cli'
            except Exception:
                continue  # bridge down / cli missing → try next, then API fallback
        return None, None

    async def _build_llm(self, org_id: int):
        """Resolve an API-native LLM (OpenAI/Gemini) for a one-shot suggestion,
        from the org's Integrations config first, then env. Returns (llm, provider)
        or (None, None) if nothing is configured."""
        from agena_core.settings import get_settings
        from agena_services.services.llm.provider import LLMProvider
        from agena_models.models.integration_config import IntegrationConfig as IC
        settings = get_settings()
        for slug in ('openai', 'gemini'):
            ic = (await self.db.execute(select(IC).where(
                IC.organization_id == org_id, IC.provider == slug,
            ))).scalar_one_or_none()
            key = ((ic.secret if ic else '') or '').strip()
            base = ((ic.base_url if ic else '') or '').strip()
            if slug == 'openai':
                key = key or (settings.openai_api_key or '').strip()
                base = base or (settings.openai_base_url or '').strip()
            if key and not key.startswith('your_'):
                return LLMProvider(provider=slug, api_key=key, base_url=base or None), slug
        return None, None

    _LANG = {'tr': 'Turkish', 'en': 'English', 'es': 'Spanish', 'de': 'German',
             'zh': 'Chinese', 'it': 'Italian', 'ja': 'Japanese'}

    async def suggest_fix(self, alert: Alert, lang: str = 'en') -> dict:
        """Ask the configured CLI (claude_cli/codex) or LLM (OpenAI/Gemini) for a
        likely root cause + concrete fix, and attach it to the alert for human
        review. Responds in the caller's UI language."""
        lang_name = self._LANG.get((lang or 'en').lower(), 'English')
        context = self.build_fix_context(alert)
        ai_text, provider = None, None
        d = alert.detail or {}
        # 1) Prefer a host CLI (claude_cli → codex) via the bridge — uses the
        #    host's auth, no API key, and can read the real repo.
        try:
            cli_prompt = (
                'You are a senior SRE/engineer investigating a production alert.\n\n'
                + context +
                '\n\nRead the repository if available, then answer with short bullets: '
                '(1) most likely root cause, (2) a concrete minimal fix (name files), '
                '(3) what to verify after. Do not modify anything. '
                f'Write your entire answer in {lang_name}.'
            )
            ai_text, provider = await self._cli_suggest(
                alert.organization_id, cli_prompt, d.get('repo_mapping_id'),
            )
        except Exception:
            logger.exception('sentinel: CLI suggest failed for alert %s', alert.id)
        # 2) Fall back to an API-native LLM (OpenAI/Gemini) if no CLI available.
        if not ai_text:
            try:
                llm, provider = await self._build_llm(alert.organization_id)
                if llm:
                    system = (
                        'You are a senior SRE/engineer. Given a production metric alert, '
                        'respond with: (1) the most likely root cause, (2) a concrete, minimal '
                        'fix, (3) what to verify after. Be specific and use short bullets. '
                        f'Write your entire answer in {lang_name}.'
                    )
                    out, _usage, _model, _cached = await llm.generate(
                        system, context, complexity_hint='normal', max_output_tokens=700,
                    )
                    ai_text = (out or '').strip()
            except Exception:
                logger.exception('sentinel: API suggest failed for alert %s', alert.id)
        summary = (ai_text.split('\n', 1)[0].strip().lstrip('#-* ')[:200] if ai_text
                   else f'Investigate {alert.metric_kind} regression on '
                        f'{alert.entity_name or alert.entity_ref}')
        sug = {
            'summary': summary, 'ai': ai_text, 'provider': provider,
            'repo': (alert.detail or {}).get('repo'),
            'nr_link': (alert.detail or {}).get('nr_link'),
            'context': context,
        }
        alert.suggested_fix = sug
        alert.updated_at = datetime.utcnow()
        await self.db.commit()
        return sug

    async def create_fix_task(self, alert: Alert, user_id: int, *, create_pr: bool = True) -> int:
        """Open a fix task from an alert and route it through the normal AI
        pipeline (queue → agent → PR). Links the task back to the alert."""
        from agena_models.models.task_record import TaskRecord
        from agena_services.services.task_service import TaskService
        d = alert.detail or {}
        task = TaskRecord(
            organization_id=alert.organization_id, created_by_user_id=user_id or 0,
            source='sentinel', external_id=f'alert-{alert.id}',
            title=f'[Sentinel] {alert.title}'[:512],
            description=self.build_fix_context(alert), status='queued',
            priority=self._priority(alert.severity), repo_mapping_id=d.get('repo_mapping_id'),
        )
        self.db.add(task)
        await self.db.flush()
        alert.task_id = task.id
        alert.updated_at = datetime.utcnow()
        await self.db.commit()
        try:
            await TaskService(self.db).assign_task_to_ai(
                alert.organization_id, task.id, create_pr=create_pr, mode='flow',
            )
        except Exception:
            logger.exception('sentinel: assign_task_to_ai failed for alert %s', alert.id)
        return task.id

    async def _window_values(self, org_id: int, entity_ref: str, metric_kind: str,
                             lo: datetime, hi: datetime) -> list[float]:
        return list((await self.db.execute(select(MetricSnapshot.value).where(
            MetricSnapshot.organization_id == org_id,
            MetricSnapshot.entity_ref == entity_ref,
            MetricSnapshot.metric_kind == metric_kind,
            MetricSnapshot.scope == 'overall',
            MetricSnapshot.window_end >= lo, MetricSnapshot.window_end <= hi,
        ))).scalars().all())

    async def evaluate_deploy(self, deploy, *, after_minutes: int = 30) -> list[Alert]:
        """Compare metric windows before vs after a deploy and raise
        deploy-anchored alerts for anything that regressed past a rule."""
        org_id = deploy.organization_id
        try:
            rmid = int(deploy.repo_mapping_id) if deploy.repo_mapping_id else None
        except (TypeError, ValueError):
            rmid = None
        if not rmid or not deploy.deployed_at:
            return []
        nm = (await self.db.execute(select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.organization_id == org_id,
            NewRelicEntityMapping.repo_mapping_id == rmid,
            NewRelicEntityMapping.is_active.is_(True),
        ))).scalars().first()
        if not nm:
            return []
        entity_ref, entity_name = nm.entity_guid, nm.entity_name
        dep_at = deploy.deployed_at
        before_lo = dep_at - timedelta(minutes=30)
        after_hi = dep_at + timedelta(minutes=after_minutes)
        rules = list((await self.db.execute(select(AlertRule).where(
            AlertRule.organization_id == org_id, AlertRule.is_active.is_(True),
            AlertRule.baseline_mode.in_(('deploy', 'both')),
        ))).scalars().all())
        now = datetime.utcnow()
        raised: list[Alert] = []
        for rule in rules:
            before = await self._window_values(org_id, entity_ref, rule.metric_kind, before_lo, dep_at)
            after = await self._window_values(org_id, entity_ref, rule.metric_kind, dep_at, after_hi)
            if len(before) < 2 or len(after) < 1:
                continue
            b = statistics.fmean(before)
            cur = statistics.fmean(after)
            std = statistics.pstdev(before) if len(before) > 1 else 0.0
            triggered, pct = self._check(rule, cur, b, std)
            if not triggered:
                continue
            fp = _fp(org_id, rule.id, f'{entity_ref}@deploy{deploy.id}', 'overall', rule.metric_kind)
            if (await self.db.execute(select(Alert).where(Alert.fingerprint == fp))).scalar_one_or_none():
                continue
            unit = _UNIT.get(rule.metric_kind, '')
            repo_mapping_id, repo_label = await self._resolve_repo(org_id, rule, entity_ref)
            detail = {
                'trigger': 'deploy', 'deploy_id': deploy.id, 'sha': deploy.sha,
                'current': round(cur, 3), 'baseline': round(b, 3), 'pct_change': pct,
                'comparison': rule.comparison, 'threshold': rule.threshold,
                'samples': len(before), 'unit': unit, 'repo': repo_label,
                'repo_mapping_id': repo_mapping_id,
                'nr_link': await self._nr_link(org_id, rule.source, entity_ref),
            }
            title = (f'{rule.metric_kind.replace("_", " ")} regressed after deploy on '
                     f'{entity_name or entity_ref}: {round(cur, 1)}{unit} vs '
                     f'{round(b, 1)}{unit} before'
                     + (f' ({pct:+.0f}%)' if pct is not None else ''))
            alert = Alert(
                organization_id=org_id, rule_id=rule.id, source=rule.source,
                metric_kind=rule.metric_kind, entity_ref=entity_ref, entity_name=entity_name,
                scope='overall', severity=rule.severity, title=title[:512], detail=detail,
                status='open', fingerprint=fp, deploy_id=deploy.id,
            )
            self.db.add(alert)
            raised.append(alert)
        if raised:
            await self.db.commit()
            for a in raised:
                await self.notify_opened(a)
        return raised

    async def ingest_nr_deployments(self, org_id: int) -> int:
        """Pull real New Relic deployment markers for each mapped APM entity and
        record them as git_deployments (deduped). evaluate_recent_deploys then
        does the before/after comparison once their after-window matures."""
        from agena_models.models.git_deployment import GitDeployment
        resolved = await self._nr_cfg(org_id)
        if not resolved:
            return 0
        cfg, default_acct = resolved
        mappings = list((await self.db.execute(select(NewRelicEntityMapping).where(
            NewRelicEntityMapping.organization_id == org_id,
            NewRelicEntityMapping.is_active.is_(True),
        ))).scalars().all())
        added = 0
        for m in mappings:
            if not m.repo_mapping_id or not m.entity_guid:
                continue
            try:
                deps = await self.nr.fetch_deployments(
                    cfg, account_id=m.account_id or default_acct,
                    entity_guid=m.entity_guid, since='2 days ago',
                )
            except Exception:
                logger.exception('sentinel: fetch_deployments failed org=%s entity=%s', org_id, m.entity_name)
                continue
            for d in deps:
                ts = d.get('timestamp_ms')
                if not ts:
                    continue
                ext = f'nr-{m.entity_guid[:16]}-{ts}'
                if (await self.db.execute(select(GitDeployment).where(
                    GitDeployment.organization_id == org_id, GitDeployment.external_id == ext,
                ))).scalar_one_or_none():
                    continue
                self.db.add(GitDeployment(
                    organization_id=org_id, repo_mapping_id=str(m.repo_mapping_id),
                    provider='newrelic', external_id=ext, environment='production',
                    status='success', sha=d.get('commit'),
                    deployed_at=datetime.utcfromtimestamp(ts / 1000),
                ))
                added += 1
        if added:
            await self.db.commit()
        return added

    async def evaluate_source_errors(self, org_id: int) -> list[Alert]:
        """Raise/auto-resolve alerts straight from New Relic error groups and
        Sentry issues — lifecycle tied to the source: present & significant →
        open; gone from the source's list → auto-resolved."""
        from agena_models.models.integration_config import IntegrationConfig as IC
        from agena_models.models.sentry_project_mapping import SentryProjectMapping
        now = datetime.utcnow()
        present: set[str] = set()
        raised: list[Alert] = []

        def _sev(n: int) -> str:
            return 'critical' if n >= 100 else ('high' if n >= 30 else 'medium')

        async def _ensure(fp, source, entity_ref, entity_name, title, occ, link, rmid):
            present.add(fp)
            repo = await self._repo_label(rmid)
            detail = {'trigger': 'source', 'current': occ, 'unit': ' errors',
                      'nr_link': link if source == 'newrelic' else None,
                      'sentry_link': link if source == 'sentry' else None,
                      'repo': repo, 'repo_mapping_id': rmid}
            existing = (await self.db.execute(select(Alert).where(
                Alert.fingerprint == fp, Alert.status != 'resolved'))).scalar_one_or_none()
            if existing:
                existing.detail = detail
                existing.severity = _sev(occ)
                existing.updated_at = now
                return
            a = Alert(organization_id=org_id, source=source, metric_kind='error_group',
                      entity_ref=entity_ref, entity_name=entity_name, scope='overall',
                      severity=_sev(occ), title=title[:512], detail=detail,
                      status='open', fingerprint=fp)
            self.db.add(a)
            raised.append(a)

        # New Relic error groups
        nr = await self._nr_cfg(org_id)
        if nr:
            cfg, acct = nr
            for m in list((await self.db.execute(select(NewRelicEntityMapping).where(
                NewRelicEntityMapping.organization_id == org_id,
                NewRelicEntityMapping.is_active.is_(True)))).scalars().all()):
                try:
                    groups = await self.nr.fetch_errors(
                        cfg, account_id=m.account_id or acct,
                        app_name=m.entity_name or '', since='1 hour ago')
                except Exception:
                    continue
                link = await self._nr_link(org_id, 'newrelic', m.entity_guid or '')
                for g in groups:
                    occ = int(g.get('occurrences') or 0)
                    ec = (g.get('error_class') or '')
                    # PHP warnings/notices are logged as TransactionError but the
                    # errors-inbox doesn't surface them as groups — skip so the
                    # alert matches what the New Relic link actually shows.
                    if occ < 10 or ec in _PHP_NON_ERRORS:
                        continue
                    fp = _fp(org_id, 0, m.entity_guid or m.entity_name or '',
                             (g.get('error_class') or '') + '|' + (g.get('error_message') or '')[:40], 'error_group')
                    title = f"{g.get('error_class', 'Error')}: {(g.get('error_message') or '')[:60]} ({occ}× on {m.entity_name})"
                    await _ensure(fp, 'newrelic', m.entity_guid or m.entity_name, m.entity_name, title, occ, link, m.repo_mapping_id)

        # Sentry issues
        sic = (await self.db.execute(select(IC).where(
            IC.organization_id == org_id, IC.provider == 'sentry'))).scalar_one_or_none()
        if sic and sic.secret:
            org_slug = str((sic.extra_config or {}).get('organization_slug') or '').strip()
            scfg = {'base_url': sic.base_url or 'https://sentry.io/api/0', 'api_token': sic.secret}
            if org_slug:
                for sm in list((await self.db.execute(select(SentryProjectMapping).where(
                    SentryProjectMapping.organization_id == org_id,
                    SentryProjectMapping.is_active.is_(True)))).scalars().all()):
                    try:
                        issues = await self.nr_sentry_issues(scfg, org_slug, sm.project_slug)
                    except Exception:
                        continue
                    for it in issues:
                        cnt = int(str(it.get('count') or '0').replace(',', '') or 0)
                        if cnt < 10:
                            continue
                        fp = _fp(org_id, 0, sm.project_slug, str(it.get('id') or it.get('shortId') or ''), 'error_group')
                        title = f"{(it.get('title') or 'Sentry issue')[:70]} ({cnt}× in {sm.project_name})"
                        await _ensure(fp, 'sentry', sm.project_slug, sm.project_name, title,
                                      cnt, it.get('permalink'), sm.repo_mapping_id)

        # auto-resolve source-error alerts the source no longer reports
        open_src = list((await self.db.execute(select(Alert).where(
            Alert.organization_id == org_id, Alert.metric_kind == 'error_group',
            Alert.status == 'open'))).scalars().all())
        for a in open_src:
            if a.fingerprint not in present:
                a.status = 'resolved'
                a.resolved_at = now
                a.updated_at = now
        await self.db.commit()
        for a in raised:
            await self.notify_opened(a)
        return raised

    async def nr_sentry_issues(self, scfg, org_slug, project_slug):
        from agena_services.integrations.sentry_client import SentryClient
        return await SentryClient().list_issues(scfg, organization_slug=org_slug, project_slug=project_slug)

    async def evaluate_recent_deploys(self, org_id: int) -> list[Alert]:
        """Evaluate deploys whose after-window has just matured (~30 min old)."""
        from agena_models.models.git_deployment import GitDeployment
        now = datetime.utcnow()
        lo, hi = now - timedelta(minutes=40), now - timedelta(minutes=28)
        deploys = (await self.db.execute(select(GitDeployment).where(
            GitDeployment.organization_id == org_id,
            GitDeployment.deployed_at >= lo, GitDeployment.deployed_at <= hi,
        ))).scalars().all()
        out: list[Alert] = []
        for d in deploys:
            out += await self.evaluate_deploy(d)
        return out

    @staticmethod
    async def orgs_with_monitoring(db: AsyncSession) -> list[int]:
        """Org ids that have at least one active New Relic APM entity mapping."""
        rows = (await db.execute(select(NewRelicEntityMapping.organization_id).where(
            NewRelicEntityMapping.is_active.is_(True),
        ).distinct())).scalars().all()
        return list(rows)
