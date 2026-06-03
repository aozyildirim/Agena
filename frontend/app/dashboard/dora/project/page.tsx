'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  apiFetch,
  fetchProjectAnalytics,
  fetchSprintDetail,
  type ProjectAnalyticsResponse,
  type SprintDetailResponse,
  type SprintWorkItem,
} from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import BarChart from '@/components/charts/BarChart';
import LineChart from '@/components/charts/LineChart';
import RepoSelector from '@/components/RepoSelector';
import { useRepoIdParam } from '@/lib/useRepoIdParam';
import { useDoraPeriodDays } from '@/lib/useDoraPeriodDays';
import DoraPeriodTabs from '@/components/DoraPeriodTabs';
import NavIcon from '@/components/NavIcon';

const compactBox: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  padding: 12,
  minWidth: 0,
};

const compactH2: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--ink-78)',
  margin: '0 0 8px',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const emptyMini: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: 11,
  padding: 16,
  textAlign: 'center',
};

const box: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  padding: 24,
};

// ── Git activity inline stat (small chip in the activity row) ──────────────

function GitStat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: accent || 'var(--ink)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, suffix = '%', color, hint }: { label: string; value: number; suffix?: string; color: string; hint?: string }) {
  return (
    <div style={{
      borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4,
      position: 'relative', overflow: 'hidden', minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>
          {Number.isFinite(value) ? value.toFixed(suffix === '%' ? 1 : 1) : '—'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{suffix}</span>
      </div>
      {hint && <div style={{ fontSize: 10, color: 'var(--ink-42)', marginTop: 2 }}>{hint}</div>}
      {suffix === '%' && (
        <div style={{ height: 3, borderRadius: 2, background: 'var(--panel-border)', overflow: 'hidden', marginTop: 4 }}>
          <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
        </div>
      )}
    </div>
  );
}

// ── WIP Gauge ───────────────────────────────────────────────────────────────

function WipGauge({ count, label }: { count: number; label: string }) {
  const color = count < 5 ? '#3f9d6a' : count < 10 ? '#c98a2b' : '#cf5b57';
  const levelLabel = count < 5 ? 'Low' : count < 10 ? 'Medium' : 'High';
  const angle = Math.min(count / 15, 1) * 180;

  const r = 60;
  const cx = 70;
  const cy = 70;
  const startAngle = Math.PI;
  const endAngle = Math.PI - (angle * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = angle > 180 ? 1 : 0;

  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>{label}</div>
      <svg width={140} height={80} viewBox="0 0 140 80" style={{ display: 'block' }}>
        {/* background arc */}
        <path
          d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none"
          stroke="var(--panel-border)"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* filled arc */}
        {angle > 0 && (
          <path
            d={`M ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2}`}
            fill="none"
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
          />
        )}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize={26} fontWeight={800} fill={color}>{count}</text>
      </svg>
      <span style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 1,
        padding: '3px 10px',
        borderRadius: 999,
        background: color === '#3f9d6a' ? 'rgba(63,157,106,0.15)' : color === '#c98a2b' ? 'rgba(201,138,43,0.15)' : 'rgba(207,91,87,0.15)',
        border: `1px solid ${color === '#3f9d6a' ? 'rgba(63,157,106,0.4)' : color === '#c98a2b' ? 'rgba(201,138,43,0.4)' : 'rgba(207,91,87,0.4)'}`,
        color,
      }}>
        {levelLabel}
      </span>
    </div>
  );
}

// ── Dual Line Chart (Cycle & Lead Time) ─────────────────────────────────────

function DualLineChart({
  data,
  color1 = '#5b9bd5',
  color2 = '#94a3b8',
  label1,
  label2,
  width = 480,
  height = 200,
}: {
  data: Array<{ label: string; v1: number; v2: number }>;
  color1?: string;
  color2?: string;
  label1: string;
  label2: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;

  const pad = { top: 12, right: 8, bottom: 32, left: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map((d) => Math.max(d.v1, d.v2)), 1);

  const toPoints = (vals: number[]) =>
    vals.map((v, i) => {
      const x = pad.left + (vals.length === 1 ? chartW / 2 : (i / (vals.length - 1)) * chartW);
      const y = pad.top + chartH - (v / maxVal) * chartH;
      return { x, y };
    });

  const pts1 = toPoints(data.map((d) => d.v1));
  const pts2 = toPoints(data.map((d) => d.v2));
  const polyline = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: color1, display: 'inline-block' }} />
          {label1}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: color2, display: 'inline-block' }} />
          {label2}
        </span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
        <polyline points={polyline(pts1)} fill="none" stroke={color1} strokeWidth={2} strokeLinejoin="round" />
        <polyline points={polyline(pts2)} fill="none" stroke={color2} strokeWidth={2} strokeLinejoin="round" />
        {pts1.map((p, i) => (
          <circle key={`a${i}`} cx={p.x} cy={p.y} r={3} fill={color1}>
            <title>{`${data[i].label}: ${data[i].v1.toFixed(1)}h`}</title>
          </circle>
        ))}
        {pts2.map((p, i) => (
          <circle key={`b${i}`} cx={p.x} cy={p.y} r={3} fill={color2}>
            <title>{`${data[i].label}: ${data[i].v2.toFixed(1)}h`}</title>
          </circle>
        ))}
        {data.length <= 14 &&
          pts1.map((p, i) => (
            <text key={i} x={p.x} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--ink-35)" fontFamily="monospace">
              {data[i].label.length > 5 ? data[i].label.slice(-5) : data[i].label}
            </text>
          ))}
        <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="var(--panel-border)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

const statusColors: Record<string, { bg: string; fg: string }> = {
  completed: { bg: 'rgba(63,157,106,0.15)', fg: '#3f9d6a' },
  running: { bg: 'rgba(91,155,213,0.15)', fg: '#5b9bd5' },
  queued: { bg: 'rgba(148,163,184,0.15)', fg: 'var(--muted)' },
  failed: { bg: 'rgba(207,91,87,0.15)', fg: '#cf5b57' },
  cancelled: { bg: 'rgba(207,91,87,0.15)', fg: '#cf5b57' },
};

function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] || { bg: 'rgba(148,163,184,0.15)', fg: 'var(--muted)' };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
      background: c.bg, color: c.fg, textTransform: 'capitalize',
    }}>
      {status}
    </span>
  );
}

// ── Tab Badge ─────────────────────────────────────────────────────────────────

function TabBadge({ count, color }: { count: number; color: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
      background: color, color: '#fff', marginLeft: 6, minWidth: 20, textAlign: 'center',
      display: 'inline-block',
    }}>
      {count}
    </span>
  );
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({ data }: { data: Array<{ label: string; value: number; color: string }> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const r = 50;
  const strokeW = 24;
  let cumAngle = -90;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {data.map((d, i) => {
          const pct = d.value / total;
          const angle = pct * 360;
          const startRad = (cumAngle * Math.PI) / 180;
          const endRad = ((cumAngle + angle) * Math.PI) / 180;
          const largeArc = angle > 180 ? 1 : 0;
          const x1 = cx + r * Math.cos(startRad);
          const y1 = cy + r * Math.sin(startRad);
          const x2 = cx + r * Math.cos(endRad);
          const y2 = cy + r * Math.sin(endRad);
          cumAngle += angle;
          return (
            <path
              key={i}
              d={`M ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2}`}
              fill="none"
              stroke={d.color}
              strokeWidth={strokeW}
            />
          );
        })}
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize={20} fontWeight={800} fill="var(--ink)">
          {total}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.label}: <strong style={{ color: 'var(--ink)' }}>{d.value}</strong></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Work Items Table ──────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)',
  padding: '8px 10px', borderBottom: '1px solid var(--panel-border)', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  fontSize: 12, padding: '7px 10px', borderBottom: '1px solid var(--panel-border-2)',
  color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260,
};

function WorkItemsTable({ items, t }: { items: SprintWorkItem[]; t: (k: TranslationKey) => string }) {
  if (items.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 12, padding: 16, textAlign: 'center' }}>{t('dora.project.noData')}</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ent-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>{t('dora.sprint.workItemKey')}</th>
            <th style={thStyle}>{t('dora.sprint.assignee')}</th>
            <th style={thStyle}>{t('dora.sprint.summary')}</th>
            <th style={thStyle}>{t('dora.sprint.workItemType')}</th>
            <th style={thStyle}>{t('dora.sprint.priority')}</th>
            <th style={thStyle}>{t('dora.sprint.status')}</th>
            <th style={thStyle}>{t('dora.sprint.reopenCount')}</th>
            <th style={thStyle}>{t('dora.sprint.effort')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600, fontSize: 11 }}>{item.key}</td>
              <td style={tdStyle}>{item.assignee}</td>
              <td style={{ ...tdStyle, maxWidth: 300 }} title={item.summary}>{item.summary}</td>
              <td style={tdStyle}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                  background: item.work_item_type === 'Bug' ? 'rgba(207,91,87,0.12)' : 'rgba(91,155,213,0.12)',
                  color: item.work_item_type === 'Bug' ? '#cf5b57' : '#5b9bd5',
                }}>
                  {item.work_item_type}
                </span>
              </td>
              <td style={tdStyle}>{item.priority}</td>
              <td style={tdStyle}><StatusBadge status={item.status} /></td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{item.reopen_count}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{item.effort.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Scope Change Bar Chart ────────────────────────────────────────────────────

function ScopeChangeChart({ data, addedLabel, removedLabel }: {
  data: Array<{ date: string; added: number; removed: number }>;
  addedLabel: string;
  removedLabel: string;
}) {
  if (data.length === 0) return null;
  const width = 480;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 32, left: 8 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map((d) => Math.max(d.added, d.removed)), 1);
  const barW = Math.min(chartW / data.length / 2.5, 16);

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: '#3f9d6a', display: 'inline-block' }} />
          {addedLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: '#cf5b57', display: 'inline-block' }} />
          {removedLabel}
        </span>
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', width: '100%', height: 'auto' }}>
        <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="var(--panel-border)" strokeWidth={1} />
        {data.map((d, i) => {
          const x = pad.left + (i + 0.5) * (chartW / data.length);
          const addedH = (d.added / maxVal) * chartH;
          const removedH = (d.removed / maxVal) * chartH;
          return (
            <g key={i}>
              <rect
                x={x - barW - 1}
                y={pad.top + chartH - addedH}
                width={barW}
                height={addedH}
                fill="#3f9d6a"
                rx={2}
              >
                <title>{`${d.date}: +${d.added}`}</title>
              </rect>
              <rect
                x={x + 1}
                y={pad.top + chartH - removedH}
                width={barW}
                height={removedH}
                fill="#cf5b57"
                rx={2}
              >
                <title>{`${d.date}: -${d.removed}`}</title>
              </rect>
              {data.length <= 14 && (
                <text x={x} y={height - 6} textAnchor="middle" fontSize={9} fill="var(--ink-35)" fontFamily="monospace">
                  {d.date.slice(-5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DoraProjectPage() {
  const { t } = useLocale();
  const [data, setData] = useState<ProjectAnalyticsResponse | null>(null);
  const [sprint, setSprint] = useState<SprintDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useDoraPeriodDays();
  const [repoId, setRepoId] = useRepoIdParam();
  const [workItemTab, setWorkItemTab] = useState<'completed' | 'incomplete' | 'removed'>('completed');
  const [velocityTab, setVelocityTab] = useState<'count' | 'effort'>('count');
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'bug'>('all');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [res, sprintRes] = await Promise.all([
          fetchProjectAnalytics(days, repoId, { source: 'internal' }),
          fetchSprintDetail(days, repoId),
        ]);
        if (active) {
          setData(res as ProjectAnalyticsResponse);
          setSprint((sprintRes as SprintDetailResponse) || null);
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load project analytics');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [days, repoId]);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Link href="/dashboard/dora" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}>DORA</Link>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>/</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>{t('dora.project.pageTitle')}</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>{t('dora.projectDesc')}</p>
          <RepoSelector value={repoId} onSelect={setRepoId} hideSync />
        </div>
        <DoraPeriodTabs value={days} onChange={setDays} />
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...box, borderColor: 'rgba(207,91,87,0.3)', color: '#cf5b57', fontSize: 13, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>
          ...
        </div>
      )}

      {!loading && data && (
        <>
          {/* Data-source banner — only surfaces when something is missing.
              Live WIQL fallback was dropped; this page reads from imported
              Agena task_records only, so an empty banner means a tasks
              import is the next step. */}
          {(data.error || data.totals.planned === 0) && (
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 10,
              background: data.error ? 'rgba(207,91,87,0.08)' : 'rgba(201,138,43,0.08)',
              border: data.error ? '1px solid rgba(207,91,87,0.4)' : '1px solid rgba(201,138,43,0.25)',
              fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{ display: 'inline-flex', color: data.error ? '#cf5b57' : '#c98a2b' }}>
                <NavIcon name="alert" size={16} />
              </span>
              <span style={{ flex: 1, minWidth: 280 }}>
                {data.error
                  ? <>{data.error}</>
                  : <>No Agena task records in the last <strong>{days}d</strong>{repoId ? ' for this repo' : ''}. Import tasks from a sprint to populate this view.</>}
              </span>
              {!data.error && (
                <Link href="/dashboard/tasks" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Import tasks →
                </Link>
              )}
            </div>
          )}

          {/* Git activity for the same period+repo — universal across both sources */}
          {data.git_activity && (
            <div style={{
              marginBottom: 24, padding: '12px 16px', borderRadius: 12,
              background: 'var(--panel)', border: '1px solid var(--panel-border)',
              display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Git activity · {days}d</div>
              <GitStat label="PRs opened" value={data.git_activity.prs_opened} />
              <GitStat label="merged" value={data.git_activity.prs_merged} accent="#3f9d6a" />
              <GitStat label="open" value={data.git_activity.prs_open} accent="#c98a2b" />
              <GitStat label="commits" value={data.git_activity.commits} />
              <GitStat label="contributors" value={data.git_activity.contributors} />
              {data.git_activity.deployments_total > 0 && (
                <GitStat label="deploys" value={`${data.git_activity.deployments_success}/${data.git_activity.deployments_total}`} accent="#5b9bd5" />
              )}
              {data.git_activity.avg_pr_lead_time_hours !== null && (
                <GitStat label="avg PR lead" value={`${data.git_activity.avg_pr_lead_time_hours}h`} />
              )}
            </div>
          )}

          {/* 4 KPI cards — picked so each tells you something the others
              can't: completion %, throughput, average wait time, current
              parallel load. Avoids the previous trap where three of the
              four formulas mathematically collapsed to the same number
              for any healthy data shape. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
            <KpiCard
              label={t('dora.project.predictability')}
              value={data.kpi.predictability}
              color="#3f9d6a"
              hint={`${data.totals.completed}/${data.totals.planned} planned done`}
            />
            <KpiCard
              label={t('dora.project.productivity')}
              value={data.kpi.productivity}
              suffix="/wk"
              color="#5b9bd5"
              hint='completed throughput'
            />
            <KpiCard
              label={t('dora.project.leadTime')}
              value={data.avg_lead_time_hours}
              suffix='h'
              color="var(--muted)"
              hint='avg create → done'
            />
            <KpiCard
              label={t('dora.project.wip')}
              value={data.wip_count}
              suffix=''
              color="#c98a2b"
              hint='currently running'
            />
          </div>

          {/* Totals summary row */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted)' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.planned')}: <strong style={{ color: 'var(--ink)' }}>{data.totals.planned}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3f9d6a' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.completed')}: <strong style={{ color: 'var(--ink)' }}>{data.totals.completed}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#cf5b57' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.failed')}: <strong style={{ color: 'var(--ink)' }}>{data.totals.failed}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.cycleTime')}: <strong style={{ color: 'var(--ink)' }}>{data.avg_cycle_time_hours} {t('dora.project.hours')}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.leadTime')}: <strong style={{ color: 'var(--ink)' }}>{data.avg_lead_time_hours} {t('dora.project.hours')}</strong></span>
            </div>
          </div>

          {/* Three small charts side-by-side. Each was its own full-row
              section with 16px margins and ~280px chart heights — the
              page was twice as tall as it needed to be. Trim to a
              single row, smaller chart heights (160px), denser headers. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 10, marginBottom: 20,
          }}>
            <div style={compactBox}>
              <h2 style={compactH2}>{t('dora.project.velocity')}</h2>
              {data.weekly_trend.length > 0 ? (
                <BarChart
                  data={data.weekly_trend.slice(-8).map((w) => ({ label: w.week, value: w.completed }))}
                  barColor="#5b9bd5"
                  height={160}
                />
              ) : (
                <div style={emptyMini}>{t('dora.project.noData')}</div>
              )}
            </div>
            <div style={compactBox}>
              <h2 style={compactH2}>{t('dora.project.cycleLeadTrend')}</h2>
              {data.time_trend.length > 0 ? (
                <DualLineChart
                  data={data.time_trend.map((item) => ({ label: item.date, v1: item.avg_cycle_time_hours, v2: item.avg_lead_time_hours }))}
                  color1="#5b9bd5"
                  color2="#94a3b8"
                  label1={t('dora.project.cycleTime')}
                  label2={t('dora.project.leadTime')}
                  height={160}
                />
              ) : (
                <div style={emptyMini}>{t('dora.project.noData')}</div>
              )}
            </div>
            <div style={compactBox}>
              <h2 style={compactH2}>{t('dora.project.throughput')}</h2>
              {data.throughput_trend.length > 0 ? (
                <LineChart
                  data={data.throughput_trend.map((item) => ({ label: item.week, value: item.throughput }))}
                  lineColor="#3f9d6a"
                  fillColor="rgba(63,157,106,0.10)"
                  height={160}
                />
              ) : (
                <div style={emptyMini}>{t('dora.project.noData')}</div>
              )}
            </div>
          </div>

          {/* ── Sprint Detail (Oobeya-style) ───────────────────────────── */}
          {sprint && (
            <>
              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--panel-border)', margin: '32px 0 24px' }} />

              {/* Sprint Assignee List */}
              <div style={{ ...box, marginBottom: 24 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', margin: '0 0 16px' }}>{t('dora.sprint.assigneeTitle')}</h2>
                {sprint.assignees.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ent-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t('dora.sprint.teamMember')}</th>
                          <th style={thStyle}>{t('dora.sprint.assignedItems')}</th>
                          <th style={thStyle}>{t('dora.sprint.totalEffort')}</th>
                          <th style={thStyle}>{t('dora.sprint.deliveryRateCount')}</th>
                          <th style={thStyle}>{t('dora.sprint.deliveryRateEffort')}</th>
                          <th style={thStyle}>{t('dora.sprint.deliveredEffort')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sprint.assignees.map((a, i) => (
                          <tr key={i}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>{a.name}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{a.assigned_count}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{a.total_effort.toFixed(1)} {t('dora.sprint.hours')}</td>
                            <td style={tdStyle}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--panel-border)', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(a.delivery_rate_count, 100)}%`, background: '#3f9d6a', borderRadius: 2 }} />
                                </div>
                                <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 40, textAlign: 'right' }}>{a.delivery_rate_count.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--panel-border)', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(a.delivery_rate_effort, 100)}%`, background: 'var(--acc)', borderRadius: 2 }} />
                                </div>
                                <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 40, textAlign: 'right' }}>{a.delivery_rate_effort.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{a.delivered_effort.toFixed(1)} {t('dora.sprint.hours')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 12, padding: 16, textAlign: 'center' }}>{t('dora.project.noData')}</div>
                )}
              </div>

              {/* Work Item Tabs */}
              <div style={{ ...box, marginBottom: 24 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
                  {([
                    { key: 'completed' as const, label: t('dora.sprint.completedItems'), count: sprint.completed_items.length, color: '#3f9d6a' },
                    { key: 'incomplete' as const, label: t('dora.sprint.incompleteItems'), count: sprint.incomplete_items.length, color: '#c98a2b' },
                    { key: 'removed' as const, label: t('dora.sprint.removedItems'), count: sprint.removed_items.length, color: '#cf5b57' },
                  ]).map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setWorkItemTab(tab.key)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 8,
                        border: workItemTab === tab.key ? '1.5px solid var(--accent)' : '1px solid var(--panel-border)',
                        background: workItemTab === tab.key ? 'var(--accent-bg, rgba(99,102,241,0.08))' : 'transparent',
                        color: workItemTab === tab.key ? 'var(--accent)' : 'var(--ink)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.15s',
                      }}
                    >
                      {tab.label}
                      <TabBadge count={tab.count} color={tab.color} />
                    </button>
                  ))}
                </div>

                {workItemTab === 'completed' && <WorkItemsTable items={sprint.completed_items} t={t} />}
                {workItemTab === 'incomplete' && <WorkItemsTable items={sprint.incomplete_items} t={t} />}
                {workItemTab === 'removed' && <WorkItemsTable items={sprint.removed_items} t={t} />}
              </div>

              {/* Work Item Distribution + Scope Change */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
                {/* Donut: Task vs Bug */}
                <div style={box}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', margin: '0 0 16px' }}>{t('dora.sprint.typeDistribution')}</h2>
                  <DonutChart
                    data={sprint.type_distribution.map((d) => ({
                      label: d.type,
                      value: d.count,
                      color: d.type === 'Bug' ? '#cf5b57' : '#5b9bd5',
                    }))}
                  />
                </div>

                {/* Scope Change */}
                <div style={box}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', margin: '0 0 16px' }}>{t('dora.sprint.scopeChange')}</h2>
                  {sprint.scope_change.length > 0 ? (
                    <ScopeChangeChart
                      data={sprint.scope_change}
                      addedLabel={t('dora.sprint.added')}
                      removedLabel={t('dora.sprint.removed')}
                    />
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: 12, padding: 20, textAlign: 'center' }}>{t('dora.project.noData')}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {!loading && !data && !error && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 13 }}>
          {t('dora.project.noData')}
        </div>
      )}
    </div>
  );
}
