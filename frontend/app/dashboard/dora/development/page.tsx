'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  fetchDoraDevelopment,
  fetchGitAnalytics,
  fetchPrAnalytics,
  fetchDeploymentsAnalytics,
  type DoraDevelopmentResponse,
  type GitAnalyticsResponse,
  type PrAnalyticsResponse,
  type DeploymentsAnalyticsResponse,
} from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import RepoSelector from '@/components/RepoSelector';

type Tab = 'team' | 'git' | 'pr' | 'deployments';
type TFn = (k: TranslationKey) => string;

const box: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  padding: 24,
};

export default function DoraDevelopmentPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>('git');
  const [repoId, setRepoId] = useState<string | null>(null);
  const [gitData, setGitData] = useState<GitAnalyticsResponse | null>(null);
  const [devData, setDevData] = useState<DoraDevelopmentResponse | null>(null);
  const [prData, setPrData] = useState<PrAnalyticsResponse | null>(null);
  const [deployData, setDeployData] = useState<DeploymentsAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [git, dev, pr, dep] = await Promise.all([
          fetchGitAnalytics(30, repoId),
          fetchDoraDevelopment(30, repoId),
          fetchPrAnalytics(30, repoId),
          fetchDeploymentsAnalytics(30, repoId),
        ]);
        if (active) {
          setGitData(git);
          setDevData(dev);
          setPrData(pr);
          setDeployData(dep);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [repoId]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'team', label: t('dora.dev.tab.team') },
    { key: 'git', label: t('dora.dev.tab.git') },
    { key: 'pr', label: t('dora.dev.tab.pr') },
    { key: 'deployments', label: t('dora.dev.tab.deployments') },
  ];

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div>
        <Link href="/dashboard/dora" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}>
          DORA &rsaquo;
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: '8px 0 0' }}>
          {t('dora.dev.title')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>
          {t('dora.dev.subtitle')}
        </p>
        <RepoSelector value={repoId} onSelect={setRepoId} />
        <span style={{
          display: 'inline-block', marginTop: 8, fontSize: 11,
          color: 'var(--muted)', background: 'var(--glass)',
          border: '1px solid var(--panel-border)', borderRadius: 999, padding: '3px 10px',
        }}>
          {t('dora.dev.last30days')}
        </span>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '2px solid var(--panel-border-2)',
      }}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: tab === tb.key ? 700 : 500,
              color: tab === tb.key ? 'var(--accent)' : 'var(--muted)',
              background: 'none',
              border: 'none',
              borderBottom: tab === tb.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -2,
              transition: 'all 0.15s',
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...box, borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ ...box, textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 40 }}>
          Loading...
        </div>
      )}

      {!loading && !error && tab === 'git' && gitData && (
        <GitAnalyticsTab data={gitData} t={t} />
      )}

      {!loading && !error && tab === 'team' && devData && (
        <TeamTab data={devData} t={t} />
      )}

      {!loading && !error && tab === 'pr' && prData && (
        <PrTab data={prData} t={t} />
      )}

      {!loading && !error && tab === 'deployments' && deployData && (
        <DeploymentsTab data={deployData} t={t} />
      )}
    </div>
  );
}

/* =========================================================================
   GIT ANALYTICS TAB
   ========================================================================= */

function GitAnalyticsTab({ data, t }: { data: GitAnalyticsResponse; t: TFn }) {
  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiCard
          label={t('dora.git.activeDays')}
          value={String(data.kpi.active_days)}
          sub={`/ 30 ${t('dora.git.date').toLowerCase()}`}
          color="#3b82f6"
        />
        <KpiCard
          label={t('dora.git.totalCommits')}
          value={data.kpi.total_commits.toLocaleString()}
          color="#8b5cf6"
        />
        <KpiCard
          label={t('dora.git.contributors')}
          value={String(data.kpi.contributors)}
          sub={`${data.kpi.contributors} ${t('dora.git.active')}`}
          color="#0d9488"
        />
        <KpiCardWithSparkline
          label={t('dora.git.codingDaysWeek')}
          value={String(data.kpi.coding_days_per_week)}
          color="#f59e0b"
          sparkline={data.coding_days_sparkline}
        />
      </div>

      {/* Active Days Chart */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
          {t('dora.git.activeDaysChart')}
        </h2>
        {data.daily_stats.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.dev.noData')}</div>
        ) : (
          <ActiveDaysChart data={data.daily_stats} t={t} />
        )}
      </div>

      {/* Commits by Day + Commits by Hour */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
            {t('dora.git.commitsByDay')}
          </h2>
          <BarChart
            data={data.commits_by_day.map((d) => ({ label: d.day, value: d.commits }))}
            height={180}
            barColor="#818cf8"
          />
        </div>
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
            {t('dora.git.commitsByHour')}
          </h2>
          <CommitsByHourChart data={data.commits_by_hour} />
        </div>
      </div>

      {/* Contributors Table */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
          {t('dora.git.contributorsTable')}
        </h2>
        {data.contributors.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.dev.noData')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.git.author')}</Th>
                  <Th>{t('dora.git.commits')}</Th>
                  <Th>{t('dora.git.efficiency')}</Th>
                  <Th>{t('dora.git.impact')}</Th>
                  <Th>{t('dora.git.newPct')}</Th>
                  <Th>{t('dora.git.refactorPct')}</Th>
                  <Th>{t('dora.git.helpOthersPct')}</Th>
                  <Th>{t('dora.git.churnPct')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.contributors.map((c) => (
                  <tr key={c.email} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: 'var(--accent)', color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>
                          {c.author.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.author}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{c.email}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>{c.commits}</Td>
                    <Td><PctBadge value={c.efficiency} /></Td>
                    <Td><span style={{ color: c.impact >= 0 ? '#22c55e' : '#ef4444' }}>{c.impact}</span></Td>
                    <Td>{c.new_pct}%</Td>
                    <Td>{c.refactor_pct}%</Td>
                    <Td>{c.help_others_pct}%</Td>
                    <Td>{c.churn_pct}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Commit Activities Table */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
          {t('dora.git.commitActivities')}
        </h2>
        {data.recent_commits.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.dev.noData')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.git.sha')}</Th>
                  <Th>{t('dora.git.date')}</Th>
                  <Th>{t('dora.git.message')}</Th>
                  <Th>{t('dora.git.contributor')}</Th>
                  <Th>{t('dora.git.additions')}</Th>
                  <Th>{t('dora.git.deletions')}</Th>
                  <Th>{t('dora.git.filesChanged')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.recent_commits.map((c, i) => (
                  <tr key={`${c.sha}-${i}`} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td>
                      <code style={{
                        fontSize: 12, fontFamily: 'monospace',
                        background: 'var(--glass)', padding: '2px 6px',
                        borderRadius: 4, color: '#93c5fd',
                      }}>
                        {c.sha}
                      </code>
                    </Td>
                    <Td>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {c.date ? new Date(c.date).toLocaleDateString() : '-'}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ maxWidth: 300, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.message}
                      </span>
                    </Td>
                    <Td>{c.author}</Td>
                    <Td><span style={{ color: '#22c55e' }}>+{c.additions}</span></Td>
                    <Td><span style={{ color: '#ef4444' }}>-{c.deletions}</span></Td>
                    <Td>{c.files_changed}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* =========================================================================
   TEAM TAB (existing dev data)
   ========================================================================= */

function TeamTab({ data, t }: { data: DoraDevelopmentResponse; t: TFn }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiCard
          label={t('dora.dev.codingEfficiency')}
          value={`${data.coding_efficiency}%`}
          color={data.coding_efficiency >= 80 ? '#22c55e' : data.coding_efficiency >= 60 ? '#eab308' : '#ef4444'}
        />
        <KpiCard
          label={t('dora.dev.reworkRate')}
          value={`${data.rework_rate}%`}
          color={data.rework_rate <= 10 ? '#22c55e' : data.rework_rate <= 25 ? '#eab308' : '#ef4444'}
        />
        <KpiCard
          label={t('dora.dev.avgCostPerTask')}
          value={`$${data.avg_cost_per_task.toFixed(4)}`}
          color="#3b82f6"
        />
        <KpiCard
          label={t('dora.dev.avgCompletionTime')}
          value={`${data.avg_completion_minutes} ${t('dora.dev.minutes')}`}
          color="#8b5cf6"
        />
        <KpiCard
          label={t('dora.dev.avgTokensPerTask')}
          value={data.avg_tokens_per_task.toLocaleString()}
          color="#0d9488"
        />
        <KpiCard
          label={t('dora.dev.totalTasks')}
          value={`${data.completed_tasks}/${data.total_tasks}`}
          sub={`${data.failed_tasks} ${t('dora.dev.failedTasks').toLowerCase()}`}
          color="var(--ink-78)"
        />
      </div>

      {/* Agent Performance */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
          {t('dora.dev.agentPerformance')}
        </h2>
        {data.agent_performance.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.dev.noData')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.dev.role')}</Th>
                  <Th>{t('dora.dev.tasks')}</Th>
                  <Th>{t('dora.dev.successRate')}</Th>
                  <Th>{t('dora.dev.avgDuration')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.agent_performance.map((a) => (
                  <tr key={a.role} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td><span style={{ fontFamily: 'monospace', color: '#93c5fd' }}>{a.role}</span></Td>
                    <Td>{a.tasks}</Td>
                    <Td>
                      <span style={{ color: a.success_rate >= 80 ? '#22c55e' : a.success_rate >= 60 ? '#eab308' : '#ef4444' }}>
                        {a.success_rate}%
                      </span>
                    </Td>
                    <Td>{formatMs(a.avg_duration_ms)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Model Performance */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
          {t('dora.dev.modelPerformance')}
        </h2>
        {data.model_performance.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.dev.noData')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.dev.model')}</Th>
                  <Th>{t('dora.dev.tasks')}</Th>
                  <Th>{t('dora.dev.tokens')}</Th>
                  <Th>{t('dora.dev.cost')}</Th>
                  <Th>{t('dora.dev.successRate')}</Th>
                  <Th>{t('dora.dev.avgDuration')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.model_performance.map((m) => (
                  <tr key={m.model} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td><span style={{ fontFamily: 'monospace', color: '#c084fc' }}>{m.model}</span></Td>
                    <Td>{m.tasks}</Td>
                    <Td>{m.total_tokens.toLocaleString()}</Td>
                    <Td>${m.cost_usd.toFixed(4)}</Td>
                    <Td>
                      <span style={{ color: m.success_rate >= 80 ? '#22c55e' : m.success_rate >= 60 ? '#eab308' : '#ef4444' }}>
                        {m.success_rate}%
                      </span>
                    </Td>
                    <Td>{formatMs(m.avg_duration_ms)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* =========================================================================
   PR ANALYTICS TAB
   ========================================================================= */

function PrTab({ data, t }: { data: PrAnalyticsResponse; t: TFn }) {
  const goalHours = data.kpi.merge_goal_hours;
  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KpiCard
          label={t('dora.pr.pctMergedWithinGoal')}
          value={`${data.kpi.pct_merged_within_goal}%`}
          sub={`${t('dora.pr.goalLine')}: ${goalHours}${t('dora.pr.hours')}`}
          color={data.kpi.pct_merged_within_goal >= 80 ? '#22c55e' : data.kpi.pct_merged_within_goal >= 50 ? '#eab308' : '#ef4444'}
        />
        <KpiCard
          label={t('dora.pr.avgTimeToMerge')}
          value={`${data.kpi.avg_merge_hours}${t('dora.pr.hours')}`}
          color={data.kpi.avg_merge_hours <= goalHours ? '#22c55e' : '#ef4444'}
        />
        <KpiCard
          label={t('dora.pr.mergedCount')}
          value={String(data.kpi.merged_count)}
          color="#3b82f6"
        />
      </div>

      {/* Charts: Code Review Cycle Time + Coding Time */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
            {t('dora.pr.mergeTimeTrend')}
          </h2>
          {data.merge_time_trend.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.pr.noData')}</div>
          ) : (
            <ScatterChartWithGoal
              data={data.merge_time_trend.map((d) => ({ label: d.date ? new Date(d.date).toLocaleDateString() : '', value: d.hours, title: d.pr_title }))}
              goalValue={goalHours}
              goalLabel={`${t('dora.pr.goalLine')} ${goalHours}${t('dora.pr.hours')}`}
              dotColor="#6366f1" height={220}
            />
          )}
        </div>
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
            {t('dora.pr.codingTimeTrend')}
          </h2>
          {data.coding_time_trend.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.pr.noData')}</div>
          ) : (
            <ScatterChartWithGoal
              data={data.coding_time_trend.map((d) => ({ label: d.date ? new Date(d.date).toLocaleDateString() : '', value: d.hours, title: d.pr_title }))}
              dotColor="#f59e0b" height={220}
            />
          )}
        </div>
      </div>

      {/* Charts: PR Size + Time to Merge */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
            {t('dora.pr.prSizeTrend')}
          </h2>
          {data.pr_size_trend.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.pr.noData')}</div>
          ) : (
            <BarChart
              data={data.pr_size_trend.map((d) => ({ label: d.date ? new Date(d.date).toLocaleDateString() : '', value: d.lines_changed }))}
              height={220} barColor="#8b5cf6"
            />
          )}
        </div>
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
            {t('dora.pr.timeToMergeTrend')}
          </h2>
          {data.merge_time_trend.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.pr.noData')}</div>
          ) : (
            <LineChart
              data={data.merge_time_trend.map((d) => ({ label: d.date ? new Date(d.date).toLocaleDateString() : '', value: d.hours }))}
              height={220} lineColor="#0d9488" fillColor="rgba(13,148,136,0.12)"
            />
          )}
        </div>
      </div>

      {/* Work in Progress PRs */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.pr.wipTitle')}</h2>
        {data.open_prs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.pr.noData')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.pr.title')}</Th>
                  <Th>{t('dora.pr.risks')}</Th>
                  <Th>{t('dora.pr.author')}</Th>
                  <Th>{t('dora.pr.age')}</Th>
                  <Th>{t('dora.pr.comments')}</Th>
                  <Th>{t('dora.pr.codingTime')}</Th>
                  <Th>{t('dora.pr.sourceBranch')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.open_prs.map((pr) => (
                  <tr key={pr.id} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td><span style={{ maxWidth: 260, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</span></Td>
                    <Td><RiskBadges risks={pr.risks} t={t} /></Td>
                    <Td>{pr.author}</Td>
                    <Td><span style={{ color: pr.age_days > 3 ? '#ef4444' : 'var(--ink)' }}>{pr.age_days}</span></Td>
                    <Td>{pr.comments}</Td>
                    <Td>{pr.coding_time_hours != null ? `${pr.coding_time_hours}${t('dora.pr.hours')}` : '-'}</Td>
                    <Td><code style={{ fontSize: 11, fontFamily: 'monospace', color: '#93c5fd' }}>{pr.source_branch}</code></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reviewer Stats */}
      {data.reviewer_stats.length > 0 && (
        <div style={box}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.pr.reviewerStats')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.pr.reviewer')}</Th>
                  <Th>{t('dora.pr.avgReviewTime')}</Th>
                  <Th>{t('dora.pr.maxReviewTime')}</Th>
                  <Th>{t('dora.pr.reviewedCount')}</Th>
                  <Th>{t('dora.pr.reviewedPct')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.reviewer_stats.map((rs) => (
                  <tr key={rs.reviewer} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td>{rs.reviewer}</Td>
                    <Td>{rs.avg_review_hours}{t('dora.pr.hours')}</Td>
                    <Td>{rs.max_review_hours}{t('dora.pr.hours')}</Td>
                    <Td>{rs.reviewed_count}</Td>
                    <Td>{rs.reviewed_pct}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PR List */}
      <div style={box}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.pr.prList')}</h2>
        {data.pr_list.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.pr.noData')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <Th>{t('dora.pr.title')}</Th>
                  <Th>{t('dora.pr.risks')}</Th>
                  <Th>{t('dora.pr.status')}</Th>
                  <Th>{t('dora.pr.sourceBranch')}</Th>
                  <Th>{t('dora.pr.targetBranch')}</Th>
                  <Th>{t('dora.pr.author')}</Th>
                  <Th>{t('dora.pr.linesChanged')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.pr_list.map((pr) => (
                  <tr key={pr.id} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <Td><span style={{ maxWidth: 260, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</span></Td>
                    <Td><RiskBadges risks={pr.risks} t={t} /></Td>
                    <Td><StatusBadge status={pr.status} t={t} /></Td>
                    <Td><code style={{ fontSize: 11, fontFamily: 'monospace', color: '#93c5fd' }}>{pr.source_branch}</code></Td>
                    <Td><code style={{ fontSize: 11, fontFamily: 'monospace', color: '#c084fc' }}>{pr.target_branch}</code></Td>
                    <Td>{pr.author}</Td>
                    <Td><span style={{ color: pr.lines_changed > 500 ? '#ef4444' : 'var(--ink)' }}>{pr.lines_changed.toLocaleString()}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function RiskBadges({ risks, t }: { risks: string[]; t: TFn }) {
  if (risks.length === 0) return <span style={{ color: 'var(--muted)' }}>-</span>;
  const colors: Record<string, string> = { oversized: '#f97316', overdue: '#ef4444', stale: '#6b7280' };
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {risks.map((r) => (
        <span key={r} style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 999, color: '#fff', background: colors[r] || '#6b7280' }}>
          {t(`dora.pr.${r}` as TranslationKey)}
        </span>
      ))}
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: TFn }) {
  const colors: Record<string, string> = { merged: '#8b5cf6', open: '#22c55e', closed: '#ef4444' };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, color: '#fff', background: colors[status] || '#6b7280' }}>
      {t(`dora.pr.${status}` as TranslationKey)}
    </span>
  );
}

function ScatterChartWithGoal({ data, goalValue, goalLabel, dotColor, height = 200 }: {
  data: { label: string; value: number; title: string }[];
  goalValue?: number; goalLabel?: string; dotColor: string; height?: number;
}) {
  if (data.length === 0) return null;
  const width = 480;
  const pad = { top: 16, right: 12, bottom: 36, left: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map((d) => d.value), goalValue || 0, 1) * 1.1;
  const points = data.map((d, i) => {
    const x = pad.left + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW);
    const y = pad.top + chartH - (d.value / maxVal) * chartH;
    return { x, y, ...d };
  });
  const goalY = goalValue != null ? pad.top + chartH - (goalValue / maxVal) * chartH : null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
      <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="monospace">{Math.round(maxVal)}</text>
      <text x={pad.left - 6} y={pad.top + chartH} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="monospace">0</text>
      {goalY != null && (
        <>
          <line x1={pad.left} y1={goalY} x2={pad.left + chartW} y2={goalY} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6,4" />
          {goalLabel && <text x={pad.left + chartW - 4} y={goalY - 4} textAnchor="end" fontSize={9} fill="#ef4444" fontFamily="monospace">{goalLabel}</text>}
        </>
      )}
      {points.map((p, i) => (
        <circle key={`${p.label}-${i}`} cx={p.x} cy={p.y} r={4} fill={dotColor} opacity={0.8}>
          <title>{`${p.title}\n${p.label}: ${p.value}h`}</title>
        </circle>
      ))}
      {data.length <= 20 ? points.map((p) => (
        <text key={`lbl-${p.label}`} x={p.x} y={height - 6} textAnchor="middle" fontSize={8} fill="var(--muted)" fontFamily="monospace">
          {p.label.length > 5 ? p.label.slice(-5) : p.label}
        </text>
      )) : points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 10)) === 0).map((p) => (
        <text key={`lbl-${p.label}`} x={p.x} y={height - 6} textAnchor="middle" fontSize={8} fill="var(--muted)" fontFamily="monospace">
          {p.label.length > 5 ? p.label.slice(-5) : p.label}
        </text>
      ))}
      <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="var(--panel-border)" strokeWidth={1} />
    </svg>
  );
}

/* =========================================================================
   CHART COMPONENTS
   ========================================================================= */

function ActiveDaysChart({ data, t }: { data: GitAnalyticsResponse['daily_stats']; t: TFn }) {
  const width = 720;
  const height = 260;
  const pad = { top: 20, right: 12, bottom: 40, left: 50 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const maxLines = Math.max(...data.map((d) => d.additions + d.deletions), 1);
  const maxCommits = Math.max(...data.map((d) => d.commits), 1);
  const barGap = 2;
  const barW = Math.max(3, (chartW - barGap * (data.length - 1)) / data.length);

  const linePoints = data.map((d, i) => {
    const x = pad.left + i * (barW + barGap) + barW / 2;
    const y = pad.top + chartH - (d.commits / maxCommits) * chartH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} />
          {t('dora.git.added')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
          {t('dora.git.deleted')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 3, background: '#f59e0b', display: 'inline-block', borderRadius: 2 }} />
          {t('dora.git.commits')}
        </span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
        <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="monospace">
          {maxLines.toLocaleString()}
        </text>
        <text x={pad.left - 6} y={pad.top + chartH} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="monospace">
          0
        </text>
        {data.map((d, i) => {
          const totalH = ((d.additions + d.deletions) / maxLines) * chartH;
          const addH = (d.additions / maxLines) * chartH;
          const delH = (d.deletions / maxLines) * chartH;
          const x = pad.left + i * (barW + barGap);
          return (
            <g key={d.date}>
              <rect x={x} y={pad.top + chartH - totalH} width={barW} height={addH} rx={1} fill="#22c55e" opacity={0.8}>
                <title>{`${d.date}: +${d.additions} / -${d.deletions} | ${d.commits} commits`}</title>
              </rect>
              <rect x={x} y={pad.top + chartH - delH} width={barW} height={delH} rx={1} fill="#ef4444" opacity={0.7}>
                <title>{`${d.date}: -${d.deletions}`}</title>
              </rect>
            </g>
          );
        })}
        <polyline points={linePoints} fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => {
          const x = pad.left + i * (barW + barGap) + barW / 2;
          const y = pad.top + chartH - (d.commits / maxCommits) * chartH;
          return (
            <circle key={`dot-${d.date}`} cx={x} cy={y} r={2.5} fill="#f59e0b">
              <title>{`${d.date}: ${d.commits} commits`}</title>
            </circle>
          );
        })}
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 10)) === 0).map((d) => {
          const origIdx = data.indexOf(d);
          const x = pad.left + origIdx * (barW + barGap) + barW / 2;
          return (
            <text key={`lbl-${d.date}`} x={x} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--muted)" fontFamily="monospace">
              {d.date.slice(-5)}
            </text>
          );
        })}
        <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="var(--panel-border)" strokeWidth={1} />
      </svg>
    </div>
  );
}

function CommitsByHourChart({ data }: { data: GitAnalyticsResponse['commits_by_hour'] }) {
  const width = 480;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 32, left: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map((d) => d.commits), 1);
  const barGap = 2;
  const barW = Math.max(3, (chartW - barGap * 23) / 24);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
      {data.map((d) => {
        const barH = (d.commits / maxVal) * chartH;
        const x = pad.left + d.hour * (barW + barGap);
        const y = pad.top + chartH - barH;
        const intensity = d.commits / maxVal;
        const color = `rgba(99, 102, 241, ${0.3 + intensity * 0.7})`;
        return (
          <g key={d.hour}>
            <rect x={x} y={y} width={barW} height={barH} rx={2} fill={color}>
              <title>{`${String(d.hour).padStart(2, '0')}:00 - ${d.commits} commits`}</title>
            </rect>
            {d.hour % 3 === 0 && (
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--muted)" fontFamily="monospace">
                {String(d.hour).padStart(2, '0')}
              </text>
            )}
          </g>
        );
      })}
      <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="var(--panel-border)" strokeWidth={1} />
    </svg>
  );
}

/* =========================================================================
   SHARED UI COMPONENTS
   ========================================================================= */

function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{
      ...box,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function KpiCardWithSparkline({ label, value, color, sparkline }: {
  label: string;
  value: string;
  color: string;
  sparkline: { week: string; days: number }[];
}) {
  const maxDays = Math.max(...sparkline.map((s) => s.days), 1);
  const barW = Math.max(4, 100 / Math.max(sparkline.length, 1));

  return (
    <div style={{
      ...box,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>
          {value}
        </div>
        <svg width={80} height={24} viewBox="0 0 80 24" style={{ flexShrink: 0 }}>
          {sparkline.slice(-8).map((s, i) => {
            const h = (s.days / maxDays) * 20;
            return (
              <rect
                key={s.week}
                x={i * (barW + 2)}
                y={24 - h}
                width={barW}
                height={h}
                rx={1}
                fill={color}
                opacity={0.7}
              >
                <title>{`${s.week}: ${s.days} days`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function PctBadge({ value }: { value: number }) {
  const color = value >= 70 ? '#22c55e' : value >= 40 ? '#eab308' : '#ef4444';
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 600,
      color,
      background: `${color}18`,
    }}>
      {value}%
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{
      textAlign: 'left', padding: '8px 12px',
      color: 'var(--muted)', fontWeight: 600,
      fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
    }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>
      {children}
    </td>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/* =========================================================================
   DEPLOYMENTS (DORA) TAB
   ========================================================================= */

function DeploymentsTab({ data, t }: { data: DeploymentsAnalyticsResponse; t: TFn }) {
  const kpi = data.kpi;
  const kpis = [
    { label: t('dora.deploy.leadTime'), value: kpi.lead_time_hours < 1 ? `${Math.round(kpi.lead_time_hours * 60)}m` : `${kpi.lead_time_hours.toFixed(1)}h`, color: '#3b82f6' },
    { label: t('dora.deploy.deployFrequency'), value: `${kpi.deploy_frequency}/d`, color: '#22c55e' },
    { label: t('dora.deploy.changeFailureRate'), value: `${kpi.change_failure_rate.toFixed(1)}%`, color: kpi.change_failure_rate > 15 ? '#ef4444' : kpi.change_failure_rate > 5 ? '#eab308' : '#22c55e' },
    { label: t('dora.deploy.mttr'), value: kpi.mttr_hours < 1 ? `${Math.round(kpi.mttr_hours * 60)}m` : `${kpi.mttr_hours.toFixed(1)}h`, color: '#f59e0b' },
  ];

  return (
    <>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...box, padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {data.lead_time_trend.length > 0 && (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>{t('dora.deploy.leadTime')} Trend</div>
            <LineChart data={data.lead_time_trend.map((d) => ({ label: d.date.slice(5), value: d.hours }))} />
          </div>
        )}
        {data.deploy_freq_trend.length > 0 && (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>{t('dora.deploy.deployFrequency')} Trend</div>
            <BarChart data={data.deploy_freq_trend.map((d) => ({ label: d.date.slice(5), value: d.deploys }))} />
          </div>
        )}
        {data.cfr_trend.length > 0 && (
          <div style={box}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>{t('dora.deploy.changeFailureRate')} Trend</div>
            <LineChart data={data.cfr_trend.map((d) => ({ label: d.date.slice(5), value: d.rate }))} />
          </div>
        )}
      </div>

      {/* Deployment list */}
      {data.deployment_list.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>Deployments</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <th style={thStyle}>Environment</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>SHA</th>
                  <th style={thStyle}>Deployed At</th>
                  <th style={thStyle}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.deployment_list.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                    <td style={tdStyle}><span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontSize: 11, fontWeight: 600 }}>{d.environment}</span></td>
                    <td style={tdStyle}><span style={{ padding: '2px 8px', borderRadius: 6, background: d.status === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: d.status === 'success' ? '#22c55e' : '#ef4444', fontSize: 11, fontWeight: 600 }}>{d.status}</span></td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11 }}>{d.sha}</td>
                    <td style={tdStyle}>{new Date(d.deployed_at).toLocaleString()}</td>
                    <td style={tdStyle}>{d.duration_sec ? `${d.duration_sec}s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 };
const tdStyle: React.CSSProperties = { padding: '8px 10px', color: 'var(--ink)' };
