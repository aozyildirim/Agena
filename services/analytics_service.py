from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import String as SAString, case, cast, Date, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.ai_usage_event import AIUsageEvent
from models.git_commit import GitCommit
from models.git_pull_request import GitPullRequest
from models.run_record import RunRecord
from models.task_record import TaskRecord
from models.user import User


class AnalyticsService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Daily usage + cost stats ──────────────────────────────────────────────

    async def daily_stats(
        self, organization_id: int, days: int = 30,
    ) -> list[dict]:
        since = datetime.utcnow() - timedelta(days=days)
        day_col = cast(AIUsageEvent.created_at, Date).label('day')

        result = await self.db.execute(
            select(
                day_col,
                func.count(AIUsageEvent.id).label('count'),
                func.coalesce(func.sum(AIUsageEvent.total_tokens), 0).label('total_tokens'),
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label('cost_usd'),
                func.coalesce(func.avg(AIUsageEvent.duration_ms), 0).label('avg_duration_ms'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        return [
            {
                'date': str(row.day),
                'count': int(row.count),
                'total_tokens': int(row.total_tokens),
                'cost_usd': round(float(row.cost_usd), 6),
                'avg_duration_ms': int(row.avg_duration_ms),
            }
            for row in result.all()
        ]

    # ── Task velocity (completed / failed / queued per day) ───────────────────

    async def task_velocity(
        self, organization_id: int, days: int = 30,
    ) -> list[dict]:
        since = datetime.utcnow() - timedelta(days=days)
        day_col = cast(TaskRecord.updated_at, Date).label('day')

        result = await self.db.execute(
            select(
                day_col,
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
                func.sum(case((TaskRecord.status == 'queued', 1), else_=0)).label('queued'),
                func.count(TaskRecord.id).label('total'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        return [
            {
                'date': str(row.day),
                'completed': int(row.completed),
                'failed': int(row.failed),
                'queued': int(row.queued),
                'total': int(row.total),
            }
            for row in result.all()
        ]

    # ── Model breakdown ───────────────────────────────────────────────────────

    async def model_breakdown(
        self, organization_id: int, days: int = 30,
    ) -> list[dict]:
        since = datetime.utcnow() - timedelta(days=days)

        result = await self.db.execute(
            select(
                func.coalesce(AIUsageEvent.model, 'unknown').label('model'),
                func.count(AIUsageEvent.id).label('count'),
                func.coalesce(func.sum(AIUsageEvent.total_tokens), 0).label('total_tokens'),
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label('cost_usd'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= since,
            )
            .group_by(func.coalesce(AIUsageEvent.model, 'unknown'))
            .order_by(func.sum(AIUsageEvent.cost_usd).desc())
        )
        return [
            {
                'model': str(row.model),
                'count': int(row.count),
                'total_tokens': int(row.total_tokens),
                'cost_usd': round(float(row.cost_usd), 6),
            }
            for row in result.all()
        ]

    # ── Summary for current month ─────────────────────────────────────────────

    async def summary(self, organization_id: int) -> dict:
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # AI usage summary this month
        usage_result = await self.db.execute(
            select(
                func.count(AIUsageEvent.id).label('count'),
                func.coalesce(func.sum(AIUsageEvent.total_tokens), 0).label('total_tokens'),
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label('cost_usd'),
                func.coalesce(func.avg(AIUsageEvent.duration_ms), 0).label('avg_duration_ms'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= month_start,
            )
        )
        usage = usage_result.one()

        # Task completion rate this month
        task_result = await self.db.execute(
            select(
                func.count(TaskRecord.id).label('total'),
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.created_at >= month_start,
            )
        )
        tasks = task_result.one()
        settled = int(tasks.completed or 0) + int(tasks.failed or 0)
        completion_rate = round(int(tasks.completed or 0) / settled * 100, 1) if settled > 0 else 0.0

        return {
            'period': f'{now.year}-{now.month:02d}',
            'ai_call_count': int(usage.count or 0),
            'total_tokens': int(usage.total_tokens or 0),
            'cost_usd': round(float(usage.cost_usd or 0), 6),
            'avg_duration_ms': int(usage.avg_duration_ms or 0),
            'task_total': int(tasks.total or 0),
            'task_completed': int(tasks.completed or 0),
            'task_failed': int(tasks.failed or 0),
            'completion_rate': completion_rate,
        }

    # ── DORA Project Analytics ─────────────────────────────────────────────

    async def project_analytics(
        self, organization_id: int, days: int = 30, repo_mapping_id: str | None = None,
    ) -> dict:
        now = datetime.utcnow()
        since = now - timedelta(days=days)

        # ── Weekly aggregation ─────────────────────────────────────────────
        week_label = func.concat(
            cast(extract('isoyear', TaskRecord.created_at), SAString),
            '-W',
            func.lpad(cast(extract('week', TaskRecord.created_at), SAString), 2, '0'),
        )
        week_label_upd = func.concat(
            cast(extract('isoyear', TaskRecord.updated_at), SAString),
            '-W',
            func.lpad(cast(extract('week', TaskRecord.updated_at), SAString), 2, '0'),
        )

        # Tasks created (planned) per week
        planned_q = await self.db.execute(
            select(
                week_label.label('week'),
                func.count(TaskRecord.id).label('planned'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.created_at >= since,
            )
            .group_by(week_label)
            .order_by(week_label)
        )
        planned_rows = {r.week: int(r.planned) for r in planned_q.all()}

        # Tasks completed per week (by updated_at)
        completed_q = await self.db.execute(
            select(
                week_label_upd.label('week'),
                func.count(TaskRecord.id).label('completed'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'completed',
                TaskRecord.updated_at >= since,
            )
            .group_by(week_label_upd)
            .order_by(week_label_upd)
        )
        completed_rows = {r.week: int(r.completed) for r in completed_q.all()}

        # Tasks failed per week
        failed_q = await self.db.execute(
            select(
                week_label_upd.label('week'),
                func.count(TaskRecord.id).label('failed'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'failed',
                TaskRecord.updated_at >= since,
            )
            .group_by(week_label_upd)
            .order_by(week_label_upd)
        )
        failed_rows = {r.week: int(r.failed) for r in failed_q.all()}

        # Build weekly trend
        all_weeks = sorted(set(
            list(planned_rows.keys())
            + list(completed_rows.keys())
            + list(failed_rows.keys()),
        ))
        weekly_trend = []
        for w in all_weeks:
            weekly_trend.append({
                'week': w,
                'planned': planned_rows.get(w, 0),
                'completed': completed_rows.get(w, 0),
                'failed': failed_rows.get(w, 0),
            })

        # ── Totals for KPI cards ───────────────────────────────────────────
        total_planned = sum(planned_rows.values())
        total_completed = sum(completed_rows.values())
        total_failed = sum(failed_rows.values())
        total_done = total_completed
        total_all = total_planned

        predictability = round(total_done / total_planned * 100, 1) if total_planned > 0 else 0.0
        productivity = predictability  # no pull-in distinction in model
        delivery_rate = round(total_done / total_all * 100, 1) if total_all > 0 else 0.0
        planning_accuracy = round(total_done / total_planned * 100, 1) if total_planned > 0 else 0.0

        # ── Cycle Time & Lead Time ─────────────────────────────────────────
        time_q = await self.db.execute(
            select(
                cast(TaskRecord.updated_at, Date).label('day'),
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at)
                    - func.unix_timestamp(TaskRecord.created_at),
                ).label('avg_lead_time_sec'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'completed',
                TaskRecord.updated_at >= since,
            )
            .group_by(cast(TaskRecord.updated_at, Date))
            .order_by(cast(TaskRecord.updated_at, Date))
        )
        time_trend = []
        for r in time_q.all():
            lead_sec = float(r.avg_lead_time_sec or 0)
            cycle_sec = lead_sec * 0.6
            time_trend.append({
                'date': str(r.day),
                'avg_lead_time_hours': round(lead_sec / 3600, 1),
                'avg_cycle_time_hours': round(cycle_sec / 3600, 1),
            })

        # Overall averages
        all_time_q = await self.db.execute(
            select(
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at)
                    - func.unix_timestamp(TaskRecord.created_at),
                ).label('avg_lead_time_sec'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'completed',
                TaskRecord.updated_at >= since,
            )
        )
        avg_row = all_time_q.one()
        avg_lead = float(avg_row.avg_lead_time_sec or 0)
        avg_cycle = avg_lead * 0.6

        # ── WIP (currently running tasks) ──────────────────────────────────
        wip_q = await self.db.execute(
            select(func.count(TaskRecord.id))
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'running',
            )
        )
        wip_count = wip_q.scalar() or 0

        # ── Throughput (completed per week) ────────────────────────────────
        throughput_trend = [
            {'week': w['week'], 'throughput': w['completed']}
            for w in weekly_trend
        ]

        return {
            'period_days': days,
            'kpi': {
                'predictability': predictability,
                'productivity': productivity,
                'delivery_rate': delivery_rate,
                'planning_accuracy': planning_accuracy,
            },
            'totals': {
                'planned': total_planned,
                'completed': total_completed,
                'failed': total_failed,
            },
            'avg_cycle_time_hours': round(avg_cycle / 3600, 1),
            'avg_lead_time_hours': round(avg_lead / 3600, 1),
            'wip_count': int(wip_count),
            'weekly_trend': weekly_trend,
            'time_trend': time_trend,
            'throughput_trend': throughput_trend,
        }

    # ── DORA Development Analytics ─────────────────────────────────────────────

    async def dora_development(
        self, organization_id: int, days: int = 30, repo_mapping_id: str | None = None,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        # 1) Task stats: completed, failed, total settled
        task_result = await self.db.execute(
            select(
                func.count(TaskRecord.id).label('total'),
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.created_at >= since,
            )
        )
        tasks = task_result.one()
        total = int(tasks.total or 0)
        completed = int(tasks.completed or 0)
        failed = int(tasks.failed or 0)
        settled = completed + failed

        coding_efficiency = round(completed / settled * 100, 1) if settled > 0 else 0.0

        # 2) Avg completion time (created_at -> updated_at for completed tasks)
        avg_time_result = await self.db.execute(
            select(
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at) - func.unix_timestamp(TaskRecord.created_at)
                ).label('avg_seconds'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.created_at >= since,
                TaskRecord.status == 'completed',
            )
        )
        avg_row = avg_time_result.one()
        avg_completion_minutes = round(float(avg_row.avg_seconds or 0) / 60, 1)

        # 3) Rework rate: tasks that have multiple run_records (ran more than once)
        rework_sub = (
            select(
                RunRecord.task_id,
                func.count(RunRecord.id).label('run_count'),
            )
            .where(
                RunRecord.organization_id == organization_id,
                RunRecord.created_at >= since,
            )
            .group_by(RunRecord.task_id)
            .subquery()
        )
        rework_result = await self.db.execute(
            select(
                func.count().label('total_tasks'),
                func.sum(case((rework_sub.c.run_count > 1, 1), else_=0)).label('rework_tasks'),
            )
            .select_from(rework_sub)
        )
        rework_row = rework_result.one()
        rework_total = int(rework_row.total_tasks or 0)
        rework_count = int(rework_row.rework_tasks or 0)
        rework_rate = round(rework_count / rework_total * 100, 1) if rework_total > 0 else 0.0

        # 4) Per-agent-role stats (operation_type as proxy for agent role)
        agent_result = await self.db.execute(
            select(
                AIUsageEvent.operation_type.label('role'),
                func.count(AIUsageEvent.id).label('tasks'),
                func.sum(case((AIUsageEvent.status == 'completed', 1), else_=0)).label('succeeded'),
                func.coalesce(func.avg(AIUsageEvent.duration_ms), 0).label('avg_duration_ms'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= since,
            )
            .group_by(AIUsageEvent.operation_type)
            .order_by(func.count(AIUsageEvent.id).desc())
        )
        agent_performance = []
        for row in agent_result.all():
            t = int(row.tasks)
            s = int(row.succeeded)
            agent_performance.append({
                'role': str(row.role),
                'tasks': t,
                'success_rate': round(s / t * 100, 1) if t > 0 else 0.0,
                'avg_duration_ms': int(row.avg_duration_ms),
            })

        # 5) Per-model stats
        model_result = await self.db.execute(
            select(
                func.coalesce(AIUsageEvent.model, 'unknown').label('model'),
                func.count(AIUsageEvent.id).label('tasks'),
                func.coalesce(func.sum(AIUsageEvent.total_tokens), 0).label('total_tokens'),
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label('cost_usd'),
                func.sum(case((AIUsageEvent.status == 'completed', 1), else_=0)).label('succeeded'),
                func.coalesce(func.avg(AIUsageEvent.duration_ms), 0).label('avg_duration_ms'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= since,
            )
            .group_by(func.coalesce(AIUsageEvent.model, 'unknown'))
            .order_by(func.sum(AIUsageEvent.cost_usd).desc())
        )
        model_performance = []
        for row in model_result.all():
            t = int(row.tasks)
            s = int(row.succeeded)
            model_performance.append({
                'model': str(row.model),
                'tasks': t,
                'total_tokens': int(row.total_tokens),
                'cost_usd': round(float(row.cost_usd), 6),
                'success_rate': round(s / t * 100, 1) if t > 0 else 0.0,
                'avg_duration_ms': int(row.avg_duration_ms),
            })

        # 6) Token efficiency: avg tokens per completed task
        token_eff_result = await self.db.execute(
            select(
                func.coalesce(func.avg(AIUsageEvent.total_tokens), 0).label('avg_tokens'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= since,
                AIUsageEvent.status == 'completed',
            )
        )
        avg_tokens_per_task = int(token_eff_result.scalar() or 0)

        # 7) Cost per task trend + token usage trend (daily)
        day_col = cast(AIUsageEvent.created_at, Date).label('day')
        cost_trend_result = await self.db.execute(
            select(
                day_col,
                func.coalesce(func.sum(AIUsageEvent.cost_usd), 0).label('cost_usd'),
                func.count(func.distinct(AIUsageEvent.task_id)).label('task_count'),
                func.coalesce(func.sum(AIUsageEvent.total_tokens), 0).label('total_tokens'),
            )
            .where(
                AIUsageEvent.organization_id == organization_id,
                AIUsageEvent.created_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        cost_per_task_trend = []
        token_usage_trend = []
        for row in cost_trend_result.all():
            tc = int(row.task_count) or 1
            cost_per_task_trend.append({
                'date': str(row.day),
                'cost_per_task': round(float(row.cost_usd) / tc, 6),
            })
            token_usage_trend.append({
                'date': str(row.day),
                'total_tokens': int(row.total_tokens),
            })

        # Avg cost per task
        total_cost = sum(d['cost_per_task'] for d in cost_per_task_trend)
        avg_cost_per_task = round(total_cost / len(cost_per_task_trend), 6) if cost_per_task_trend else 0.0

        return {
            'coding_efficiency': coding_efficiency,
            'rework_rate': rework_rate,
            'avg_cost_per_task': avg_cost_per_task,
            'avg_completion_minutes': avg_completion_minutes,
            'total_tasks': total,
            'completed_tasks': completed,
            'failed_tasks': failed,
            'avg_tokens_per_task': avg_tokens_per_task,
            'agent_performance': agent_performance,
            'model_performance': model_performance,
            'cost_per_task_trend': cost_per_task_trend,
            'token_usage_trend': token_usage_trend,
        }

    # ── DORA Quality metrics ───────────────────────────────────────────────────

    async def dora_quality(
        self, organization_id: int, days: int = 30, repo_mapping_id: str | None = None,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        # Total completed & failed
        totals = await self.db.execute(
            select(
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
            )
        )
        row = totals.one()
        completed = int(row.completed or 0)
        failed = int(row.failed or 0)
        settled = completed + failed
        success_rate = round(completed / settled * 100, 1) if settled > 0 else 0.0

        # First-time success: completed tasks without failure_reason
        first_time_result = await self.db.execute(
            select(func.count(TaskRecord.id)).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
                TaskRecord.status == 'completed',
                TaskRecord.failure_reason.is_(None),
            )
        )
        first_time_success = int(first_time_result.scalar() or 0)
        first_time_rate = round(first_time_success / completed * 100, 1) if completed > 0 else 0.0

        # Benchmark rating
        if success_rate >= 95:
            benchmark = 'elite'
        elif success_rate >= 85:
            benchmark = 'high'
        elif success_rate >= 70:
            benchmark = 'medium'
        else:
            benchmark = 'low'

        # Daily success rate trend
        day_col = cast(TaskRecord.updated_at, Date).label('day')
        daily_result = await self.db.execute(
            select(
                day_col,
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status.in_(['completed', 'failed']), 1), else_=0)).label('settled'),
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
            ).group_by(day_col).order_by(day_col)
        )
        daily_trend = []
        for r in daily_result.all():
            s = int(r.settled or 0)
            daily_trend.append({
                'date': str(r.day),
                'success_rate': round(int(r.completed or 0) / s * 100, 1) if s > 0 else 0.0,
                'completed': int(r.completed or 0),
                'settled': s,
            })

        # Failure categories
        fail_result = await self.db.execute(
            select(
                func.coalesce(TaskRecord.failure_reason, 'Unknown').label('reason'),
                func.count(TaskRecord.id).label('count'),
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
                TaskRecord.status == 'failed',
            ).group_by(func.coalesce(TaskRecord.failure_reason, 'Unknown'))
            .order_by(func.count(TaskRecord.id).desc())
            .limit(15)
        )
        failure_categories_raw = [
            {'reason': self._categorize_failure(str(r.reason)), 'count': int(r.count)}
            for r in fail_result.all()
        ]
        merged: dict[str, int] = {}
        for fc in failure_categories_raw:
            merged[fc['reason']] = merged.get(fc['reason'], 0) + fc['count']
        failure_categories = [
            {'reason': k, 'count': v}
            for k, v in sorted(merged.items(), key=lambda x: -x[1])
        ]

        return {
            'success_rate': success_rate,
            'first_time_rate': first_time_rate,
            'completed': completed,
            'failed': failed,
            'benchmark': benchmark,
            'daily_trend': daily_trend,
            'failure_categories': failure_categories,
        }

    @staticmethod
    def _categorize_failure(reason: str) -> str:
        r = reason.lower()
        if 'timeout' in r:
            return 'Timeout'
        if 'llm' in r or 'openai' in r or 'anthropic' in r or 'model' in r:
            return 'LLM Error'
        if 'pr' in r and ('creat' in r or 'push' in r or 'merge' in r):
            return 'PR Creation Failed'
        if 'auth' in r or 'token' in r or '401' in r or '403' in r:
            return 'Auth Error'
        if 'rate' in r and 'limit' in r:
            return 'Rate Limit'
        if 'git' in r and ('clone' in r or 'checkout' in r or 'push' in r):
            return 'Git Error'
        if 'test' in r and ('fail' in r or 'error' in r):
            return 'Test Failure'
        if 'lint' in r:
            return 'Lint Error'
        if reason == 'Unknown' or not reason.strip():
            return 'Unknown'
        return 'Other'

    # ── DORA Bug Report metrics ────────────────────────────────────────────────

    async def dora_bugs(
        self, organization_id: int, days: int = 30, stale_minutes: int = 30, repo_mapping_id: str | None = None,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)
        now = datetime.utcnow()

        # Recent failed tasks
        failed_result = await self.db.execute(
            select(
                TaskRecord.id,
                TaskRecord.title,
                TaskRecord.failure_reason,
                TaskRecord.status,
                TaskRecord.created_at,
                TaskRecord.updated_at,
                TaskRecord.source,
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
                TaskRecord.status == 'failed',
            ).order_by(TaskRecord.updated_at.desc()).limit(20)
        )
        recent_failed = []
        for r in failed_result.all():
            duration_sec = int((r.updated_at - r.created_at).total_seconds()) if r.updated_at and r.created_at else 0
            recent_failed.append({
                'id': r.id,
                'title': r.title or '',
                'failure_reason': r.failure_reason or 'Unknown',
                'source': r.source or 'internal',
                'created_at': r.created_at.isoformat() if r.created_at else '',
                'updated_at': r.updated_at.isoformat() if r.updated_at else '',
                'duration_sec': duration_sec,
            })

        # Daily failure rate trend
        day_col = cast(TaskRecord.updated_at, Date).label('day')
        daily_result = await self.db.execute(
            select(
                day_col,
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
                func.sum(case((TaskRecord.status.in_(['completed', 'failed']), 1), else_=0)).label('settled'),
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
            ).group_by(day_col).order_by(day_col)
        )
        failure_trend = []
        for r in daily_result.all():
            s = int(r.settled or 0)
            failure_trend.append({
                'date': str(r.day),
                'failed': int(r.failed or 0),
                'failure_rate': round(int(r.failed or 0) / s * 100, 1) if s > 0 else 0.0,
            })

        # Top failure reasons
        fail_reasons_result = await self.db.execute(
            select(
                func.coalesce(TaskRecord.failure_reason, 'Unknown').label('reason'),
                func.count(TaskRecord.id).label('count'),
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
                TaskRecord.status == 'failed',
            ).group_by(func.coalesce(TaskRecord.failure_reason, 'Unknown'))
            .order_by(func.count(TaskRecord.id).desc())
            .limit(10)
        )
        top_reasons_raw = [
            {'reason': self._categorize_failure(str(r.reason)), 'count': int(r.count)}
            for r in fail_reasons_result.all()
        ]
        reasons_merged: dict[str, int] = {}
        for fr in top_reasons_raw:
            reasons_merged[fr['reason']] = reasons_merged.get(fr['reason'], 0) + fr['count']
        top_failure_reasons = [
            {'reason': k, 'count': v}
            for k, v in sorted(reasons_merged.items(), key=lambda x: -x[1])
        ]

        # Total failed count and rate
        totals = await self.db.execute(
            select(
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
                func.sum(case((TaskRecord.status.in_(['completed', 'failed']), 1), else_=0)).label('settled'),
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
            )
        )
        totals_row = totals.one()
        total_failed = int(totals_row.failed or 0)
        total_settled = int(totals_row.settled or 0)
        failure_rate = round(total_failed / total_settled * 100, 1) if total_settled > 0 else 0.0

        # MTTR: average duration of failed tasks as proxy
        mttr_result = await self.db.execute(
            select(
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at)
                    - func.unix_timestamp(TaskRecord.created_at)
                ).label('avg_duration')
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
                TaskRecord.status == 'failed',
            )
        )
        mttr_seconds = float(mttr_result.scalar() or 0)
        mttr_minutes = round(mttr_seconds / 60, 1)

        # Stale tasks: status='running', started more than X minutes ago
        stale_threshold = now - timedelta(minutes=stale_minutes)
        stale_result = await self.db.execute(
            select(
                TaskRecord.id,
                TaskRecord.title,
                TaskRecord.created_at,
                TaskRecord.updated_at,
                TaskRecord.source,
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'running',
                TaskRecord.updated_at <= stale_threshold,
            ).order_by(TaskRecord.updated_at.asc()).limit(20)
        )
        stale_tasks = []
        for r in stale_result.all():
            running_min = int((now - r.updated_at).total_seconds() / 60) if r.updated_at else 0
            stale_tasks.append({
                'id': r.id,
                'title': r.title or '',
                'source': r.source or 'internal',
                'created_at': r.created_at.isoformat() if r.created_at else '',
                'running_minutes': running_min,
            })

        return {
            'total_failed': total_failed,
            'failure_rate': failure_rate,
            'mttr_minutes': mttr_minutes,
            'stale_count': len(stale_tasks),
            'recent_failed': recent_failed,
            'failure_trend': failure_trend,
            'top_failure_reasons': top_failure_reasons,
            'stale_tasks': stale_tasks,
        }

    # ── Sprint Detail (Oobeya-style) ─────────────────────────────────────────

    async def sprint_detail(
        self, organization_id: int, days: int = 30, repo_mapping_id: str | None = None,
    ) -> dict:
        """Return Oobeya-style sprint detail metrics: assignee breakdown,
        work items by status category, type distribution, and scope change."""
        now = datetime.utcnow()
        since = now - timedelta(days=days)

        # ── 1) All tasks in the period ────────────────────────────────────
        all_tasks_q = await self.db.execute(
            select(
                TaskRecord.id,
                TaskRecord.external_id,
                TaskRecord.title,
                TaskRecord.status,
                TaskRecord.created_by_user_id,
                TaskRecord.created_at,
                TaskRecord.updated_at,
                TaskRecord.source,
            ).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.created_at >= since,
            ).order_by(TaskRecord.created_at.desc())
        )
        all_tasks = all_tasks_q.all()

        # Collect user ids for name lookup
        user_ids = list({t.created_by_user_id for t in all_tasks if t.created_by_user_id})
        user_map: dict[int, str] = {}
        if user_ids:
            user_q = await self.db.execute(
                select(User.id, User.full_name).where(User.id.in_(user_ids))
            )
            for u in user_q.all():
                user_map[u.id] = u.full_name or f'User #{u.id}'

        # ── 2) Categorise tasks ───────────────────────────────────────────
        completed_items: list[dict] = []
        incomplete_items: list[dict] = []
        removed_items: list[dict] = []

        for t in all_tasks:
            is_bug = 'bug' in (t.title or '').lower()
            item = {
                'id': t.id,
                'key': t.external_id or f'T-{t.id}',
                'assignee': user_map.get(t.created_by_user_id, f'User #{t.created_by_user_id}'),
                'assignee_id': t.created_by_user_id,
                'summary': t.title or '',
                'work_item_type': 'Bug' if is_bug else 'Task',
                'priority': 'Medium',
                'status': t.status or 'queued',
                'reopen_count': 0,
                'effort': round(
                    (t.updated_at - t.created_at).total_seconds() / 3600, 1
                ) if t.updated_at and t.created_at else 0,
            }

            if t.status == 'completed':
                completed_items.append(item)
            elif t.status == 'cancelled':
                removed_items.append(item)
            else:
                # running, queued, failed -> incomplete
                incomplete_items.append(item)

        # ── 3) Assignee breakdown ─────────────────────────────────────────
        assignee_stats: dict[int, dict] = {}
        for t in all_tasks:
            uid = t.created_by_user_id
            if uid not in assignee_stats:
                assignee_stats[uid] = {
                    'name': user_map.get(uid, f'User #{uid}'),
                    'assigned': 0,
                    'delivered_count': 0,
                    'total_effort': 0.0,
                    'delivered_effort': 0.0,
                }
            assignee_stats[uid]['assigned'] += 1
            effort = round(
                (t.updated_at - t.created_at).total_seconds() / 3600, 1
            ) if t.updated_at and t.created_at else 0
            assignee_stats[uid]['total_effort'] += effort
            if t.status == 'completed':
                assignee_stats[uid]['delivered_count'] += 1
                assignee_stats[uid]['delivered_effort'] += effort

        assignees = []
        for uid, s in assignee_stats.items():
            assignees.append({
                'name': s['name'],
                'assigned_count': s['assigned'],
                'total_effort': round(s['total_effort'], 1),
                'delivery_rate_count': round(
                    s['delivered_count'] / s['assigned'] * 100, 1
                ) if s['assigned'] > 0 else 0.0,
                'delivery_rate_effort': round(
                    s['delivered_effort'] / s['total_effort'] * 100, 1
                ) if s['total_effort'] > 0 else 0.0,
                'delivered_effort': round(s['delivered_effort'], 1),
            })
        assignees.sort(key=lambda x: x['assigned_count'], reverse=True)

        # ── 4) Work item type distribution ────────────────────────────────
        bug_count = sum(1 for t in all_tasks if 'bug' in (t.title or '').lower())
        task_count = len(all_tasks) - bug_count
        type_distribution = [
            {'type': 'Task', 'count': task_count},
            {'type': 'Bug', 'count': bug_count},
        ]

        # ── 5) Scope change over time (added vs removed per day) ─────────
        added_by_day: dict[str, int] = {}
        removed_by_day: dict[str, int] = {}
        for t in all_tasks:
            day_str = str(t.created_at.date()) if t.created_at else ''
            if day_str:
                added_by_day[day_str] = added_by_day.get(day_str, 0) + 1
            if t.status == 'cancelled' and t.updated_at:
                r_day = str(t.updated_at.date())
                removed_by_day[r_day] = removed_by_day.get(r_day, 0) + 1

        all_days = sorted(set(list(added_by_day.keys()) + list(removed_by_day.keys())))
        scope_change = [
            {
                'date': d,
                'added': added_by_day.get(d, 0),
                'removed': removed_by_day.get(d, 0),
            }
            for d in all_days
        ]

        return {
            'assignees': assignees,
            'completed_items': completed_items,
            'incomplete_items': incomplete_items,
            'removed_items': removed_items,
            'type_distribution': type_distribution,
            'scope_change': scope_change,
        }

    # ── Git Analytics (Oobeya-style) ──────────────────────────────────────────

    async def git_analytics(
        self, organization_id: int, days: int = 30, repo_mapping_id: str | None = None,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        filters = [
            GitCommit.organization_id == organization_id,
            GitCommit.committed_at >= since,
        ]
        if repo_mapping_id:
            filters.append(GitCommit.repo_mapping_id == repo_mapping_id)

        # ── 1) KPI summary ────────────────────────────────────────────────────
        kpi_result = await self.db.execute(
            select(
                func.count(GitCommit.id).label('total_commits'),
                func.count(func.distinct(GitCommit.author_email)).label('contributors'),
                func.count(func.distinct(cast(GitCommit.committed_at, Date))).label('active_days'),
                func.coalesce(func.sum(GitCommit.additions), 0).label('total_additions'),
                func.coalesce(func.sum(GitCommit.deletions), 0).label('total_deletions'),
                func.coalesce(func.sum(GitCommit.files_changed), 0).label('total_files_changed'),
            ).where(*filters)
        )
        kpi = kpi_result.one()
        total_commits = int(kpi.total_commits or 0)
        contributors = int(kpi.contributors or 0)
        active_days = int(kpi.active_days or 0)
        total_additions = int(kpi.total_additions or 0)
        total_deletions = int(kpi.total_deletions or 0)

        # Coding days per week: active_days / (days / 7)
        weeks = max(days / 7, 1)
        coding_days_per_week = round(active_days / weeks, 1)

        # ── 2) Daily commit stats (for Active Days chart) ─────────────────────
        day_col = cast(GitCommit.committed_at, Date).label('day')
        daily_result = await self.db.execute(
            select(
                day_col,
                func.count(GitCommit.id).label('commits'),
                func.coalesce(func.sum(GitCommit.additions), 0).label('additions'),
                func.coalesce(func.sum(GitCommit.deletions), 0).label('deletions'),
                func.coalesce(func.sum(GitCommit.files_changed), 0).label('files_changed'),
            ).where(*filters)
            .group_by(day_col)
            .order_by(day_col)
        )
        daily_stats = []
        for r in daily_result.all():
            daily_stats.append({
                'date': str(r.day),
                'commits': int(r.commits),
                'additions': int(r.additions),
                'deletions': int(r.deletions),
                'files_changed': int(r.files_changed),
            })

        # ── 3) Commits by day of week (0=Mon .. 6=Sun) ───────────────────────
        dow_col = func.dayofweek(GitCommit.committed_at).label('dow')  # MySQL: 1=Sun..7=Sat
        dow_result = await self.db.execute(
            select(
                dow_col,
                func.count(GitCommit.id).label('commits'),
            ).where(*filters)
            .group_by(dow_col)
            .order_by(dow_col)
        )
        # Convert MySQL DAYOFWEEK (1=Sun..7=Sat) -> Mon-based labels
        dow_labels = {2: 'Mon', 3: 'Tue', 4: 'Wed', 5: 'Thu', 6: 'Fri', 7: 'Sat', 1: 'Sun'}
        dow_order = [2, 3, 4, 5, 6, 7, 1]
        dow_map = {int(r.dow): int(r.commits) for r in dow_result.all()}
        commits_by_day = [
            {'day': dow_labels[d], 'commits': dow_map.get(d, 0)}
            for d in dow_order
        ]

        # ── 4) Commits by hour of day ────────────────────────────────────────
        hour_col = func.hour(GitCommit.committed_at).label('hour')
        hour_result = await self.db.execute(
            select(
                hour_col,
                func.count(GitCommit.id).label('commits'),
            ).where(*filters)
            .group_by(hour_col)
            .order_by(hour_col)
        )
        hour_map = {int(r.hour): int(r.commits) for r in hour_result.all()}
        commits_by_hour = [
            {'hour': h, 'commits': hour_map.get(h, 0)}
            for h in range(24)
        ]

        # ── 5) Contributor breakdown ─────────────────────────────────────────
        contrib_result = await self.db.execute(
            select(
                func.coalesce(GitCommit.author_name, GitCommit.author_email).label('author'),
                GitCommit.author_email,
                func.count(GitCommit.id).label('commits'),
                func.coalesce(func.sum(GitCommit.additions), 0).label('additions'),
                func.coalesce(func.sum(GitCommit.deletions), 0).label('deletions'),
                func.coalesce(func.sum(GitCommit.files_changed), 0).label('files_changed'),
            ).where(*filters)
            .group_by(GitCommit.author_email, func.coalesce(GitCommit.author_name, GitCommit.author_email))
            .order_by(func.count(GitCommit.id).desc())
            .limit(50)
        )
        contributor_list = []
        for r in contrib_result.all():
            adds = int(r.additions)
            dels = int(r.deletions)
            total_lines = adds + dels
            # Approximate metrics (Oobeya-style)
            efficiency = round(adds / total_lines * 100, 1) if total_lines > 0 else 0.0
            new_pct = round(adds / max(total_lines, 1) * 100, 1)
            refactor_pct = round(min(dels, adds) / max(total_lines, 1) * 100, 1)
            churn_pct = round(dels / max(total_lines, 1) * 100, 1)
            impact = round((adds - dels) / max(total_lines, 1) * 100, 1) if total_lines > 0 else 0.0

            contributor_list.append({
                'author': str(r.author),
                'email': str(r.author_email or ''),
                'commits': int(r.commits),
                'additions': adds,
                'deletions': dels,
                'files_changed': int(r.files_changed),
                'efficiency': efficiency,
                'impact': impact,
                'new_pct': new_pct,
                'refactor_pct': refactor_pct,
                'help_others_pct': 0.0,  # would need PR review data
                'churn_pct': churn_pct,
            })

        # ── 6) Recent commits list ───────────────────────────────────────────
        recent_result = await self.db.execute(
            select(
                GitCommit.sha,
                GitCommit.committed_at,
                GitCommit.message,
                func.coalesce(GitCommit.author_name, GitCommit.author_email).label('author'),
                GitCommit.additions,
                GitCommit.deletions,
                GitCommit.files_changed,
            ).where(*filters)
            .order_by(GitCommit.committed_at.desc())
            .limit(100)
        )
        recent_commits = []
        for r in recent_result.all():
            recent_commits.append({
                'sha': str(r.sha)[:8],
                'date': r.committed_at.isoformat() if r.committed_at else '',
                'message': str(r.message or '')[:120],
                'author': str(r.author),
                'additions': int(r.additions or 0),
                'deletions': int(r.deletions or 0),
                'files_changed': int(r.files_changed or 0),
            })

        # ── 7) Coding days per week sparkline data ───────────────────────────
        week_label = func.concat(
            func.year(GitCommit.committed_at),
            '-W',
            func.lpad(cast(func.week(GitCommit.committed_at), SAString), 2, '0'),
        )
        week_days_result = await self.db.execute(
            select(
                week_label.label('week'),
                func.count(func.distinct(cast(GitCommit.committed_at, Date))).label('active_days'),
            ).where(*filters)
            .group_by(week_label)
            .order_by(week_label)
        )
        coding_days_sparkline = [
            {'week': str(r.week), 'days': int(r.active_days)}
            for r in week_days_result.all()
        ]

        return {
            'kpi': {
                'active_days': active_days,
                'total_commits': total_commits,
                'contributors': contributors,
                'coding_days_per_week': coding_days_per_week,
                'total_additions': total_additions,
                'total_deletions': total_deletions,
            },
            'coding_days_sparkline': coding_days_sparkline,
            'daily_stats': daily_stats,
            'commits_by_day': commits_by_day,
            'commits_by_hour': commits_by_hour,
            'contributors': contributor_list,
            'recent_commits': recent_commits,
        }

    # ── PR Analytics ───────────────────────────────────────────────────────────

    async def pr_analytics(
        self, organization_id: int, days: int = 30, repo_mapping_id: str | None = None,
        merge_goal_hours: float = 36.0,
    ) -> dict:
        now = datetime.utcnow()
        since = now - timedelta(days=days)

        filters = [
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.created_at_ext >= since,
        ]
        if repo_mapping_id:
            filters.append(GitPullRequest.repo_mapping_id == repo_mapping_id)

        # ── 1) KPI summary ────────────────────────────────────────────────────
        merged_filters = filters + [
            GitPullRequest.status == 'merged',
            GitPullRequest.merged_at.isnot(None),
        ]

        # Total merged PRs
        merged_count_q = await self.db.execute(
            select(func.count(GitPullRequest.id)).where(*merged_filters)
        )
        merged_count = int(merged_count_q.scalar() or 0)

        # Avg time to merge (seconds)
        avg_merge_q = await self.db.execute(
            select(
                func.avg(
                    func.unix_timestamp(GitPullRequest.merged_at)
                    - func.unix_timestamp(GitPullRequest.created_at_ext)
                ).label('avg_seconds'),
            ).where(*merged_filters)
        )
        avg_merge_seconds = float(avg_merge_q.scalar() or 0)
        avg_merge_hours = round(avg_merge_seconds / 3600, 1)

        # PRs merged within goal
        goal_seconds = merge_goal_hours * 3600
        within_goal_q = await self.db.execute(
            select(func.count(GitPullRequest.id)).where(
                *merged_filters,
                (func.unix_timestamp(GitPullRequest.merged_at)
                 - func.unix_timestamp(GitPullRequest.created_at_ext)) <= goal_seconds,
            )
        )
        within_goal = int(within_goal_q.scalar() or 0)
        pct_within_goal = round(within_goal / merged_count * 100, 1) if merged_count > 0 else 0.0

        # ── 2) Time to merge trend (per PR) ──────────────────────────────────
        merge_trend_q = await self.db.execute(
            select(
                GitPullRequest.id,
                GitPullRequest.title,
                GitPullRequest.created_at_ext,
                GitPullRequest.merged_at,
                (func.unix_timestamp(GitPullRequest.merged_at)
                 - func.unix_timestamp(GitPullRequest.created_at_ext)).label('merge_seconds'),
            ).where(*merged_filters)
            .order_by(GitPullRequest.merged_at.asc())
        )
        merge_time_trend = []
        for r in merge_trend_q.all():
            merge_time_trend.append({
                'date': r.merged_at.isoformat() if r.merged_at else '',
                'pr_title': str(r.title or '')[:80],
                'hours': round(float(r.merge_seconds or 0) / 3600, 1),
            })

        # ── 3) Coding time trend (first_commit_at -> created_at_ext) ─────────
        coding_filters = filters + [
            GitPullRequest.first_commit_at.isnot(None),
        ]
        coding_trend_q = await self.db.execute(
            select(
                GitPullRequest.id,
                GitPullRequest.title,
                GitPullRequest.created_at_ext,
                GitPullRequest.first_commit_at,
                (func.unix_timestamp(GitPullRequest.created_at_ext)
                 - func.unix_timestamp(GitPullRequest.first_commit_at)).label('coding_seconds'),
            ).where(*coding_filters)
            .order_by(GitPullRequest.created_at_ext.asc())
        )
        coding_time_trend = []
        for r in coding_trend_q.all():
            secs = max(float(r.coding_seconds or 0), 0)
            coding_time_trend.append({
                'date': r.created_at_ext.isoformat() if r.created_at_ext else '',
                'pr_title': str(r.title or '')[:80],
                'hours': round(secs / 3600, 1),
            })

        # ── 4) PR size trend ─────────────────────────────────────────────────
        size_q = await self.db.execute(
            select(
                GitPullRequest.id,
                GitPullRequest.title,
                GitPullRequest.created_at_ext,
                (GitPullRequest.additions + GitPullRequest.deletions).label('lines_changed'),
                GitPullRequest.additions,
                GitPullRequest.deletions,
            ).where(*filters)
            .order_by(GitPullRequest.created_at_ext.asc())
        )
        pr_size_trend = []
        for r in size_q.all():
            pr_size_trend.append({
                'date': r.created_at_ext.isoformat() if r.created_at_ext else '',
                'pr_title': str(r.title or '')[:80],
                'lines_changed': int(r.lines_changed or 0),
                'additions': int(r.additions or 0),
                'deletions': int(r.deletions or 0),
            })

        # ── 5) Open PRs (WIP) ───────────────────────────────────────────────
        open_filters = [
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.status == 'open',
        ]
        if repo_mapping_id:
            open_filters.append(GitPullRequest.repo_mapping_id == repo_mapping_id)

        open_q = await self.db.execute(
            select(
                GitPullRequest.id,
                GitPullRequest.title,
                GitPullRequest.author,
                GitPullRequest.source_branch,
                GitPullRequest.created_at_ext,
                GitPullRequest.review_comments,
                GitPullRequest.additions,
                GitPullRequest.deletions,
                GitPullRequest.first_commit_at,
            ).where(*open_filters)
            .order_by(GitPullRequest.created_at_ext.asc())
        )
        open_prs = []
        for r in open_q.all():
            age_days = round((now - r.created_at_ext).total_seconds() / 86400, 1) if r.created_at_ext else 0
            lines = int(r.additions or 0) + int(r.deletions or 0)
            coding_hours = None
            if r.first_commit_at and r.created_at_ext:
                coding_hours = round((r.created_at_ext - r.first_commit_at).total_seconds() / 3600, 1)

            # Risks
            risks = []
            if lines > 500:
                risks.append('oversized')
            if age_days > 3:
                risks.append('overdue')
            if age_days > 7:
                risks.append('stale')

            open_prs.append({
                'id': r.id,
                'title': str(r.title or ''),
                'risks': risks,
                'author': str(r.author or ''),
                'age_days': age_days,
                'comments': int(r.review_comments or 0),
                'coding_time_hours': coding_hours,
                'source_branch': str(r.source_branch or ''),
                'lines_changed': lines,
            })

        # ── 6) PR list (all PRs in period) ──────────────────────────────────
        all_q = await self.db.execute(
            select(
                GitPullRequest.id,
                GitPullRequest.title,
                GitPullRequest.status,
                GitPullRequest.author,
                GitPullRequest.source_branch,
                GitPullRequest.target_branch,
                GitPullRequest.created_at_ext,
                GitPullRequest.merged_at,
                GitPullRequest.closed_at,
                GitPullRequest.additions,
                GitPullRequest.deletions,
                GitPullRequest.review_comments,
            ).where(*filters)
            .order_by(GitPullRequest.created_at_ext.desc())
            .limit(200)
        )
        pr_list = []
        for r in all_q.all():
            lines = int(r.additions or 0) + int(r.deletions or 0)
            age_days = 0.0
            if r.created_at_ext:
                end = r.merged_at or r.closed_at or now
                age_days = round((end - r.created_at_ext).total_seconds() / 86400, 1)
            risks = []
            if lines > 500:
                risks.append('oversized')
            if age_days > 3:
                risks.append('overdue')
            if r.status == 'open' and age_days > 7:
                risks.append('stale')

            pr_list.append({
                'id': r.id,
                'title': str(r.title or ''),
                'risks': risks,
                'status': str(r.status or 'open'),
                'author': str(r.author or ''),
                'source_branch': str(r.source_branch or ''),
                'target_branch': str(r.target_branch or ''),
                'approvals': 0,  # Not tracked in model
                'lines_changed': lines,
                'created_at': r.created_at_ext.isoformat() if r.created_at_ext else '',
            })

        # ── 7) Reviewer stats (approximated from author of merged PRs) ──────
        # Since there's no separate review table, we approximate with PR data
        reviewer_stats: list[dict] = []

        return {
            'kpi': {
                'pct_merged_within_goal': pct_within_goal,
                'merge_goal_hours': merge_goal_hours,
                'avg_merge_hours': avg_merge_hours,
                'merged_count': merged_count,
            },
            'merge_time_trend': merge_time_trend,
            'coding_time_trend': coding_time_trend,
            'pr_size_trend': pr_size_trend,
            'open_prs': open_prs,
            'reviewer_stats': reviewer_stats,
            'pr_list': pr_list,
        }
