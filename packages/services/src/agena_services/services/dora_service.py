from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import case, cast, Date, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.git_commit import GitCommit
from agena_models.models.git_deployment import GitDeployment
from agena_models.models.git_pull_request import GitPullRequest
from agena_models.models.task_record import TaskRecord


class DoraService:
    """Calculates the four DORA metrics from real git data (with task-based fallback)."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ── Check if git data exists for the org/repo ─────────────────────────────

    async def _has_git_data(
        self, organization_id: int, repo_mapping_id: str | None, since: datetime,
    ) -> bool:
        """Return True if there are any merged PRs or deployments for the given scope."""
        q = select(func.count(GitPullRequest.id)).where(
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.merged_at >= since,
        )
        if repo_mapping_id:
            q = q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
        result = await self.db.execute(q)
        pr_count = result.scalar() or 0
        if pr_count > 0:
            return True

        q2 = select(func.count(GitDeployment.id)).where(
            GitDeployment.organization_id == organization_id,
            GitDeployment.deployed_at >= since,
        )
        if repo_mapping_id:
            q2 = q2.where(GitDeployment.repo_mapping_id == repo_mapping_id)
        result2 = await self.db.execute(q2)
        deploy_count = result2.scalar() or 0
        return deploy_count > 0

    # ── Real git-based DORA calculations ──────────────────────────────────────

    async def _git_overview(
        self, organization_id: int, repo_mapping_id: str | None, days: int,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        # ── Lead Time for Changes ─────────────────────────────────────────
        # For each merged PR: merged_at - first_commit_at
        lt_q = select(
            func.avg(
                func.unix_timestamp(GitPullRequest.merged_at) -
                func.unix_timestamp(GitPullRequest.first_commit_at)
            ).label('avg_seconds'),
        ).where(
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.merged_at >= since,
            GitPullRequest.merged_at.isnot(None),
            GitPullRequest.first_commit_at.isnot(None),
        )
        if repo_mapping_id:
            lt_q = lt_q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
        lt_result = await self.db.execute(lt_q)
        lt_row = lt_result.one()
        avg_lt_sec = float(lt_row.avg_seconds) if lt_row.avg_seconds else None
        lead_time_hours = round(avg_lt_sec / 3600, 2) if avg_lt_sec else None

        # ── Deployment Frequency ──────────────────────────────────────────
        # Count of successful deployments per day
        dep_q = select(func.count(GitDeployment.id)).where(
            GitDeployment.organization_id == organization_id,
            GitDeployment.deployed_at >= since,
            GitDeployment.status == 'success',
        )
        if repo_mapping_id:
            dep_q = dep_q.where(GitDeployment.repo_mapping_id == repo_mapping_id)
        dep_result = await self.db.execute(dep_q)
        dep_count = dep_result.scalar() or 0

        if dep_count > 0:
            deploy_frequency = round(dep_count / max(days, 1), 2)
        else:
            # Fallback: merged PRs per day
            pr_q = select(func.count(GitPullRequest.id)).where(
                GitPullRequest.organization_id == organization_id,
                GitPullRequest.merged_at >= since,
                GitPullRequest.merged_at.isnot(None),
            )
            if repo_mapping_id:
                pr_q = pr_q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
            pr_result = await self.db.execute(pr_q)
            pr_count = pr_result.scalar() or 0
            deploy_frequency = round(pr_count / max(days, 1), 2) if pr_count else None

        # ── Change Failure Rate ───────────────────────────────────────────
        # Failed deployments / total deployments x 100
        total_dep_q = select(
            func.count(GitDeployment.id).label('total'),
            func.sum(case((GitDeployment.status == 'failure', 1), else_=0)).label('failed'),
        ).where(
            GitDeployment.organization_id == organization_id,
            GitDeployment.deployed_at >= since,
        )
        if repo_mapping_id:
            total_dep_q = total_dep_q.where(GitDeployment.repo_mapping_id == repo_mapping_id)
        total_dep_result = await self.db.execute(total_dep_q)
        total_dep_row = total_dep_result.one()
        total_deployments = int(total_dep_row.total or 0)
        failed_deployments = int(total_dep_row.failed or 0)

        if total_deployments > 0:
            change_failure_rate = round((failed_deployments / total_deployments) * 100, 2)
        else:
            change_failure_rate = None  # No deployment data

        # ── MTTR ──────────────────────────────────────────────────────────
        # Time between failed deployment and next successful deployment
        mttr_hours = None
        if failed_deployments > 0:
            # Get all deployments ordered by time
            all_dep_q = select(
                GitDeployment.status,
                GitDeployment.deployed_at,
            ).where(
                GitDeployment.organization_id == organization_id,
                GitDeployment.deployed_at >= since,
            ).order_by(GitDeployment.deployed_at)
            if repo_mapping_id:
                all_dep_q = all_dep_q.where(GitDeployment.repo_mapping_id == repo_mapping_id)
            all_dep_result = await self.db.execute(all_dep_q)
            deployments = all_dep_result.all()

            recovery_times: list[float] = []
            i = 0
            while i < len(deployments):
                if deployments[i].status == 'failure':
                    fail_time = deployments[i].deployed_at
                    # Look for next success
                    j = i + 1
                    while j < len(deployments):
                        if deployments[j].status == 'success':
                            recovery_sec = (deployments[j].deployed_at - fail_time).total_seconds()
                            recovery_times.append(recovery_sec)
                            break
                        j += 1
                i += 1

            if recovery_times:
                avg_mttr_sec = sum(recovery_times) / len(recovery_times)
                mttr_hours = round(avg_mttr_sec / 3600, 2)

        # ── Daily breakdown (from merged PRs + deployments) ───────────────
        day_col_pr = cast(GitPullRequest.merged_at, Date).label('day')
        daily_pr_q = select(
            day_col_pr,
            func.count(GitPullRequest.id).label('completed'),
        ).where(
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.merged_at >= since,
            GitPullRequest.merged_at.isnot(None),
        ).group_by(day_col_pr).order_by(day_col_pr)
        if repo_mapping_id:
            daily_pr_q = daily_pr_q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
        daily_pr_result = await self.db.execute(daily_pr_q)
        daily_pr_rows = daily_pr_result.all()

        # Daily lead time from PRs
        daily_lt_q = select(
            day_col_pr,
            func.avg(
                func.unix_timestamp(GitPullRequest.merged_at) -
                func.unix_timestamp(GitPullRequest.first_commit_at)
            ).label('avg_seconds'),
        ).where(
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.merged_at >= since,
            GitPullRequest.merged_at.isnot(None),
            GitPullRequest.first_commit_at.isnot(None),
        ).group_by(day_col_pr).order_by(day_col_pr)
        if repo_mapping_id:
            daily_lt_q = daily_lt_q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
        daily_lt_result = await self.db.execute(daily_lt_q)
        daily_lt_map: dict[str, float | None] = {}
        for row in daily_lt_result.all():
            val = float(row.avg_seconds) / 3600 if row.avg_seconds else None
            daily_lt_map[str(row.day)] = round(val, 2) if val else None

        # Daily failed deployments
        day_col_dep = cast(GitDeployment.deployed_at, Date).label('day')
        daily_fail_q = select(
            day_col_dep,
            func.sum(case((GitDeployment.status == 'failure', 1), else_=0)).label('failed'),
        ).where(
            GitDeployment.organization_id == organization_id,
            GitDeployment.deployed_at >= since,
        ).group_by(day_col_dep).order_by(day_col_dep)
        if repo_mapping_id:
            daily_fail_q = daily_fail_q.where(GitDeployment.repo_mapping_id == repo_mapping_id)
        daily_fail_result = await self.db.execute(daily_fail_q)
        daily_fail_map: dict[str, int] = {}
        for row in daily_fail_result.all():
            daily_fail_map[str(row.day)] = int(row.failed or 0)

        # Merge daily data
        all_days: set[str] = set()
        daily_pr_map: dict[str, int] = {}
        for row in daily_pr_rows:
            d = str(row.day)
            daily_pr_map[d] = int(row.completed or 0)
            all_days.add(d)
        for d in daily_fail_map:
            all_days.add(d)

        daily = []
        for d in sorted(all_days):
            daily.append({
                'date': d,
                'completed': daily_pr_map.get(d, 0),
                'failed': daily_fail_map.get(d, 0),
                'lead_time_hours': daily_lt_map.get(d),
                'mttr_hours': None,
            })

        return {
            'lead_time_hours': lead_time_hours,
            'deploy_frequency': deploy_frequency,
            'change_failure_rate': change_failure_rate,
            'mttr_hours': mttr_hours,
            'data_source': 'git',
            'daily': daily,
        }

    # ── Task-based fallback (original implementation) ─────────────────────────

    async def _task_overview(
        self, organization_id: int, repo_mapping_id: str | None, days: int,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        # ── Daily breakdown ────────────────────────────────────────────────
        day_col = cast(TaskRecord.updated_at, Date).label('day')

        daily_q = (
            select(
                day_col,
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        daily_result = await self.db.execute(daily_q)
        daily_rows = daily_result.all()

        # ── Lead Time ─────────────────────────────────────────────────────
        lt_result = await self.db.execute(
            select(
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at) -
                    func.unix_timestamp(TaskRecord.created_at)
                ).label('avg_seconds'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'completed',
                TaskRecord.updated_at >= since,
            )
        )
        lt_row = lt_result.one()
        avg_lead_time_seconds = float(lt_row.avg_seconds) if lt_row.avg_seconds else None
        lead_time_hours = round(avg_lead_time_seconds / 3600, 2) if avg_lead_time_seconds else None

        # ── Daily lead time for sparkline ──────────────────────────────────
        daily_lt_result = await self.db.execute(
            select(
                day_col,
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at) -
                    func.unix_timestamp(TaskRecord.created_at)
                ).label('avg_seconds'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'completed',
                TaskRecord.updated_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        daily_lt_map: dict[str, float | None] = {}
        for row in daily_lt_result.all():
            val = float(row.avg_seconds) / 3600 if row.avg_seconds else None
            daily_lt_map[str(row.day)] = round(val, 2) if val else None

        # ── Deployment Frequency ──────────────────────────────────────────
        total_completed_result = await self.db.execute(
            select(func.count(TaskRecord.id))
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'completed',
                TaskRecord.updated_at >= since,
            )
        )
        total_completed = total_completed_result.scalar() or 0
        deploy_frequency = round(total_completed / max(days, 1), 2) if total_completed else None

        # ── Change Failure Rate ───────────────────────────────────────────
        total_settled_result = await self.db.execute(
            select(
                func.sum(case((TaskRecord.status == 'completed', 1), else_=0)).label('completed'),
                func.sum(case((TaskRecord.status == 'failed', 1), else_=0)).label('failed'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.updated_at >= since,
                TaskRecord.status.in_(['completed', 'failed']),
            )
        )
        settled = total_settled_result.one()
        completed_count = int(settled.completed or 0)
        failed_count = int(settled.failed or 0)
        total_settled = completed_count + failed_count
        change_failure_rate = round((failed_count / total_settled) * 100, 2) if total_settled > 0 else None

        # ── MTTR ──────────────────────────────────────────────────────────
        mttr_result = await self.db.execute(
            select(
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at) -
                    func.unix_timestamp(TaskRecord.created_at)
                ).label('avg_seconds'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'failed',
                TaskRecord.updated_at >= since,
            )
        )
        mttr_row = mttr_result.one()
        avg_mttr_seconds = float(mttr_row.avg_seconds) if mttr_row.avg_seconds else None
        mttr_hours = round(avg_mttr_seconds / 3600, 2) if avg_mttr_seconds else None

        # ── Daily MTTR for sparkline ──────────────────────────────────────
        daily_mttr_result = await self.db.execute(
            select(
                day_col,
                func.avg(
                    func.unix_timestamp(TaskRecord.updated_at) -
                    func.unix_timestamp(TaskRecord.created_at)
                ).label('avg_seconds'),
            )
            .where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.status == 'failed',
                TaskRecord.updated_at >= since,
            )
            .group_by(day_col)
            .order_by(day_col)
        )
        daily_mttr_map: dict[str, float | None] = {}
        for row in daily_mttr_result.all():
            val = float(row.avg_seconds) / 3600 if row.avg_seconds else None
            daily_mttr_map[str(row.day)] = round(val, 2) if val else None

        # ── Assemble daily array ──────────────────────────────────────────
        daily = []
        for row in daily_rows:
            d = str(row.day)
            daily.append({
                'date': d,
                'completed': int(row.completed or 0),
                'failed': int(row.failed or 0),
                'lead_time_hours': daily_lt_map.get(d),
                'mttr_hours': daily_mttr_map.get(d),
            })

        return {
            'lead_time_hours': lead_time_hours,
            'deploy_frequency': deploy_frequency,
            'change_failure_rate': change_failure_rate,
            'mttr_hours': mttr_hours,
            'data_source': 'tasks',
            'daily': daily,
        }

    # ── Deployments analytics (DORA tab) ────────────────────────────────────

    async def deployments_analytics(
        self,
        organization_id: int,
        days: int = 30,
        repo_mapping_id: str | None = None,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        filters = [
            GitDeployment.organization_id == organization_id,
            GitDeployment.deployed_at >= since,
        ]
        if repo_mapping_id:
            filters.append(GitDeployment.repo_mapping_id == repo_mapping_id)

        # ── KPI: Lead Time for Changes ────────────────────────────────────
        lt_q = select(
            func.avg(
                func.unix_timestamp(GitPullRequest.merged_at) -
                func.unix_timestamp(GitPullRequest.first_commit_at)
            ).label('avg_seconds'),
        ).where(
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.merged_at >= since,
            GitPullRequest.merged_at.isnot(None),
            GitPullRequest.first_commit_at.isnot(None),
        )
        if repo_mapping_id:
            lt_q = lt_q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
        lt_result = await self.db.execute(lt_q)
        lt_row = lt_result.one()
        avg_lt_sec = float(lt_row.avg_seconds) if lt_row.avg_seconds else None
        lead_time_hours = round(avg_lt_sec / 3600, 2) if avg_lt_sec else 0.0

        # ── KPI: Deployment Frequency ─────────────────────────────────────
        dep_count_q = select(func.count(GitDeployment.id)).where(
            *filters,
            GitDeployment.status == 'success',
        )
        dep_count_result = await self.db.execute(dep_count_q)
        success_count = dep_count_result.scalar() or 0
        deploy_frequency = round(success_count / max(days, 1), 2)

        # ── KPI: Change Failure Rate ──────────────────────────────────────
        total_dep_q = select(
            func.count(GitDeployment.id).label('total'),
            func.sum(case((GitDeployment.status == 'failure', 1), else_=0)).label('failed'),
        ).where(*filters)
        total_dep_result = await self.db.execute(total_dep_q)
        total_dep_row = total_dep_result.one()
        total_deployments = int(total_dep_row.total or 0)
        failed_deployments = int(total_dep_row.failed or 0)
        change_failure_rate = round((failed_deployments / total_deployments) * 100, 2) if total_deployments > 0 else 0.0

        # ── KPI: MTTR ────────────────────────────────────────────────────
        mttr_hours = 0.0
        if failed_deployments > 0:
            all_dep_q = select(
                GitDeployment.status,
                GitDeployment.deployed_at,
            ).where(*filters).order_by(GitDeployment.deployed_at)
            all_dep_result = await self.db.execute(all_dep_q)
            deployments = all_dep_result.all()

            recovery_times: list[float] = []
            i = 0
            while i < len(deployments):
                if deployments[i].status == 'failure':
                    fail_time = deployments[i].deployed_at
                    j = i + 1
                    while j < len(deployments):
                        if deployments[j].status == 'success':
                            recovery_sec = (deployments[j].deployed_at - fail_time).total_seconds()
                            recovery_times.append(recovery_sec)
                            break
                        j += 1
                i += 1

            if recovery_times:
                avg_mttr_sec = sum(recovery_times) / len(recovery_times)
                mttr_hours = round(avg_mttr_sec / 3600, 2)

        # ── Daily trends ─────────────────────────────────────────────────
        day_col = cast(GitDeployment.deployed_at, Date).label('day')

        # Lead time daily (from PRs)
        pr_day_col = cast(GitPullRequest.merged_at, Date).label('day')
        daily_lt_q = select(
            pr_day_col,
            func.avg(
                func.unix_timestamp(GitPullRequest.merged_at) -
                func.unix_timestamp(GitPullRequest.first_commit_at)
            ).label('avg_seconds'),
        ).where(
            GitPullRequest.organization_id == organization_id,
            GitPullRequest.merged_at >= since,
            GitPullRequest.merged_at.isnot(None),
            GitPullRequest.first_commit_at.isnot(None),
        ).group_by(pr_day_col).order_by(pr_day_col)
        if repo_mapping_id:
            daily_lt_q = daily_lt_q.where(GitPullRequest.repo_mapping_id == repo_mapping_id)
        daily_lt_result = await self.db.execute(daily_lt_q)
        lead_time_trend = []
        for row in daily_lt_result.all():
            val = float(row.avg_seconds) / 3600 if row.avg_seconds else 0.0
            lead_time_trend.append({
                'date': str(row.day),
                'hours': round(val, 2),
            })

        # Deploy frequency daily
        daily_dep_q = select(
            day_col,
            func.count(GitDeployment.id).label('deploys'),
        ).where(
            *filters,
            GitDeployment.status == 'success',
        ).group_by(day_col).order_by(day_col)
        daily_dep_result = await self.db.execute(daily_dep_q)
        deploy_freq_trend = [
            {'date': str(row.day), 'deploys': int(row.deploys)}
            for row in daily_dep_result.all()
        ]

        # Change failure rate daily
        daily_cfr_q = select(
            day_col,
            func.count(GitDeployment.id).label('total'),
            func.sum(case((GitDeployment.status == 'failure', 1), else_=0)).label('failed'),
        ).where(*filters).group_by(day_col).order_by(day_col)
        daily_cfr_result = await self.db.execute(daily_cfr_q)
        cfr_trend = []
        for row in daily_cfr_result.all():
            t = int(row.total or 0)
            f = int(row.failed or 0)
            rate = round((f / t) * 100, 2) if t > 0 else 0.0
            cfr_trend.append({'date': str(row.day), 'rate': rate})

        # ── Deployment list ──────────────────────────────────────────────
        list_q = select(
            GitDeployment.environment,
            GitDeployment.status,
            GitDeployment.sha,
            GitDeployment.deployed_at,
            GitDeployment.duration_sec,
        ).where(*filters).order_by(GitDeployment.deployed_at.desc()).limit(100)
        list_result = await self.db.execute(list_q)
        deployment_list = []
        for r in list_result.all():
            deployment_list.append({
                'environment': str(r.environment or 'production'),
                'status': str(r.status or 'unknown'),
                'sha': str(r.sha or '')[:8],
                'deployed_at': r.deployed_at.isoformat() if r.deployed_at else '',
                'duration_sec': int(r.duration_sec or 0),
            })

        return {
            'kpi': {
                'lead_time_hours': lead_time_hours,
                'deploy_frequency': deploy_frequency,
                'change_failure_rate': change_failure_rate,
                'mttr_hours': mttr_hours,
            },
            'lead_time_trend': lead_time_trend,
            'deploy_freq_trend': deploy_freq_trend,
            'cfr_trend': cfr_trend,
            'deployments': deployment_list,
        }

    # ── Public entry point ────────────────────────────────────────────────────

    async def overview(
        self,
        organization_id: int,
        days: int = 30,
        repo_mapping_id: str | None = None,
    ) -> dict:
        since = datetime.utcnow() - timedelta(days=days)

        # Try real git data first
        has_git = await self._has_git_data(organization_id, repo_mapping_id, since)
        if has_git:
            return await self._git_overview(organization_id, repo_mapping_id, days)

        # Fallback to task-based calculation
        return await self._task_overview(organization_id, repo_mapping_id, days)
