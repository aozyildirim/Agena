'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchDoraBugs, type DoraBugsResponse } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import RepoSelector from '@/components/RepoSelector';
import { useRepoIdParam } from '@/lib/useRepoIdParam';
import { useDoraPeriodDays } from '@/lib/useDoraPeriodDays';
import DoraPeriodTabs from '@/components/DoraPeriodTabs';

const box: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  padding: 24,
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export default function DoraBugsPage() {
  const { t } = useLocale();
  const [data, setData] = useState<DoraBugsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [repoId, setRepoId] = useRepoIdParam();
  const [periodDays, setPeriodDays] = useDoraPeriodDays();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetchDoraBugs(periodDays, repoId);
        if (active) setData(res);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [repoId, periodDays]);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div>
        <Link href="/dashboard/dora" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}>
          DORA &rsaquo;
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: '8px 0 0' }}>
          {t('dora.bugs.title')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>
          {t('dora.bugs.subtitle')}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <RepoSelector value={repoId} onSelect={setRepoId} />
          <DoraPeriodTabs value={periodDays} onChange={setPeriodDays} />
        </div>
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

      {!loading && data && (
        <>
          {/* Summary KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <KpiCard
              label={t('dora.bugs.totalFailed')}
              value={String(data.total_failed)}
              color={data.total_failed > 0 ? '#ef4444' : '#22c55e'}
              sub={t('dora.bugs.last30days')}
            />
            <KpiCard
              label={t('dora.bugs.failureRate')}
              value={`${data.failure_rate}%`}
              color={data.failure_rate <= 5 ? '#22c55e' : data.failure_rate <= 15 ? '#eab308' : '#ef4444'}
            />
            <KpiCard
              label={t('dora.bugs.mttr')}
              value={`${data.mttr_minutes} ${t('dora.bugs.minutes')}`}
              color={data.mttr_minutes <= 10 ? '#22c55e' : data.mttr_minutes <= 30 ? '#eab308' : '#ef4444'}
            />
            <KpiCard
              label={t('dora.bugs.staleCount')}
              value={String(data.stale_count)}
              color={data.stale_count === 0 ? '#22c55e' : '#f97316'}
            />
          </div>

          {/* Failed Tasks Table */}
          <div style={box}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
              {t('dora.bugs.recentFailed')}
            </h2>
            {data.recent_failed.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.bugs.noFailed')}</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                      <Th>{t('dora.bugs.task')}</Th>
                      <Th>{t('dora.bugs.error')}</Th>
                      <Th>{t('dora.bugs.duration')}</Th>
                      <Th>{t('dora.bugs.source')}</Th>
                      <Th>{t('dora.bugs.date')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_failed.map((task) => (
                      <tr key={task.id} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                        <Td>
                          <div style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Link href={`/dashboard/tasks`} style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 600 }}>
                              {task.title || `#${task.id}`}
                            </Link>
                          </div>
                        </Td>
                        <Td>
                          <span style={{
                            display: 'inline-block', maxWidth: 220,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            color: '#ef4444', fontFamily: 'monospace', fontSize: 11,
                            background: 'rgba(239,68,68,0.08)', padding: '2px 8px',
                            borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)',
                          }}>
                            {task.failure_reason}
                          </span>
                        </Td>
                        <Td>{formatDuration(task.duration_sec)}</Td>
                        <Td>
                          <span style={{
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: 0.8, color: 'var(--muted)',
                          }}>
                            {task.source}
                          </span>
                        </Td>
                        <Td>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {task.updated_at ? new Date(task.updated_at).toLocaleDateString() : '-'}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Charts: Failure Rate Trend + Top Failure Reasons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
            {/* Failure Rate Trend */}
            <div style={box}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
                {t('dora.bugs.failureTrend')}
              </h2>
              {data.failure_trend.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.bugs.noData')}</div>
              ) : (
                <LineChart
                  data={data.failure_trend.map((d) => ({
                    label: d.date,
                    value: d.failure_rate,
                  }))}
                  height={220}
                  lineColor="#ef4444"
                  fillColor="rgba(239,68,68,0.10)"
                />
              )}
            </div>

            {/* Top Failure Reasons */}
            <div style={box}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
                {t('dora.bugs.topReasons')}
              </h2>
              {data.top_failure_reasons.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.bugs.noData')}</div>
              ) : (
                <BarChart
                  data={data.top_failure_reasons.map((r) => ({
                    label: r.reason,
                    value: r.count,
                  }))}
                  height={220}
                  barColor="#f97316"
                />
              )}
            </div>
          </div>

          {/* Stale Tasks */}
          <div style={box}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
              {t('dora.bugs.staleTasks')}
            </h2>
            {data.stale_tasks.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dora.bugs.noStale')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {data.stale_tasks.map((task) => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 10,
                      border: '1px solid rgba(249,115,22,0.25)',
                      background: 'rgba(249,115,22,0.06)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                        {task.title || `#${task.id}`}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {task.source} &bull; {task.created_at ? new Date(task.created_at).toLocaleDateString() : '-'}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: '#f97316',
                      background: 'rgba(249,115,22,0.12)',
                      padding: '4px 10px', borderRadius: 999,
                      border: '1px solid rgba(249,115,22,0.3)',
                      whiteSpace: 'nowrap',
                    }}>
                      {t('dora.bugs.runningFor', { min: String(task.running_minutes) })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

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
