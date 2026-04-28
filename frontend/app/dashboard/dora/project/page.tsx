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

const box: React.CSSProperties = {
  borderRadius: 14,
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

function KpiCard({ label, value, suffix = '%', color }: { label: string; value: number; suffix?: string; color: string }) {
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1 }}>{value.toFixed(1)}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>{suffix}</span>
      </div>
      {suffix === '%' && (
        <div style={{ height: 4, borderRadius: 2, background: 'var(--panel-border)', overflow: 'hidden', marginTop: 4 }}>
          <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: color, borderRadius: 2, transition: 'width 0.6s ease' }} />
        </div>
      )}
    </div>
  );
}

// ── WIP Gauge ───────────────────────────────────────────────────────────────

function WipGauge({ count, label }: { count: number; label: string }) {
  const color = count < 5 ? '#22c55e' : count < 10 ? '#eab308' : '#ef4444';
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
        background: color === '#22c55e' ? 'rgba(34,197,94,0.15)' : color === '#eab308' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
        border: `1px solid ${color === '#22c55e' ? 'rgba(34,197,94,0.4)' : color === '#eab308' ? 'rgba(234,179,8,0.4)' : 'rgba(239,68,68,0.4)'}`,
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
  color1 = '#38bdf8',
  color2 = '#a78bfa',
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
  completed: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
  running: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6' },
  queued: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  failed: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
  cancelled: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
};

function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] || { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' };
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
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                  background: item.work_item_type === 'Bug' ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)',
                  color: item.work_item_type === 'Bug' ? '#ef4444' : '#3b82f6',
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
          <span style={{ width: 10, height: 3, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} />
          {addedLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />
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
                fill="#22c55e"
                rx={2}
              >
                <title>{`${d.date}: +${d.added}`}</title>
              </rect>
              <rect
                x={x + 1}
                y={pad.top + chartH - removedH}
                width={barW}
                height={removedH}
                fill="#ef4444"
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
  const [days, setDays] = useState(30);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [workItemTab, setWorkItemTab] = useState<'completed' | 'incomplete' | 'removed'>('completed');
  const [velocityTab, setVelocityTab] = useState<'count' | 'effort'>('count');
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'bug'>('all');
  // Source toggle: 'internal' = Agena task_records (the original behaviour),
  // 'external' = Azure WIQL pulled live for the user's project/team. Project
  // and team are only meaningful when source=external.
  const [source, setSource] = useState<'internal' | 'external'>('internal');
  const [azureProject, setAzureProject] = useState<string>('');
  const [azureTeam, setAzureTeam] = useState<string>('');
  const [azureProjects, setAzureProjects] = useState<{ id: string; name: string }[]>([]);
  const [azureTeams, setAzureTeams] = useState<{ id: string; name: string }[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);

  // Lazy-load the org's Azure project list the first time external mode opens.
  useEffect(() => {
    if (source !== 'external' || azureProjects.length > 0 || projectsLoading) return;
    setProjectsLoading(true);
    apiFetch<{ id: string; name: string }[]>('/tasks/azure/projects')
      .then((rows) => setAzureProjects(rows || []))
      .catch(() => setAzureProjects([]))
      .finally(() => setProjectsLoading(false));
  }, [source, azureProjects.length, projectsLoading]);

  // When the picked project changes, refresh the team list.
  useEffect(() => {
    if (source !== 'external' || !azureProject) { setAzureTeams([]); return; }
    setTeamsLoading(true);
    apiFetch<{ id: string; name: string }[]>(`/tasks/azure/teams?project=${encodeURIComponent(azureProject)}`)
      .then((rows) => setAzureTeams(rows || []))
      .catch(() => setAzureTeams([]))
      .finally(() => setTeamsLoading(false));
  }, [source, azureProject]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const opts = source === 'external'
          ? { source: 'external' as const, project: azureProject || undefined, team: azureTeam || undefined }
          : { source: 'internal' as const };
        const tasks: Promise<unknown>[] = [
          fetchProjectAnalytics(days, repoId, opts),
        ];
        if (source === 'internal') tasks.push(fetchSprintDetail(days, repoId));
        const [res, sprintRes] = await Promise.all(tasks);
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
  }, [days, repoId, source, azureProject, azureTeam]);

  const periodOptions = [7, 14, 30, 60, 90];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Link href="/dashboard/dora" style={{ fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}>DORA</Link>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>/</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>{t('dora.project.pageTitle')}</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>{t('dora.projectDesc')}</p>
          <RepoSelector value={repoId} onSelect={setRepoId} />

          {/* Internal / External source toggle */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setSource('internal')}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: source === 'internal' ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border)',
                background: source === 'internal' ? 'rgba(94,234,212,0.12)' : 'var(--panel-alt)',
                color: source === 'internal' ? '#5eead4' : 'var(--muted)',
              }}
            >Agena (internal)</button>
            <button
              onClick={() => setSource('external')}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: source === 'external' ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border)',
                background: source === 'external' ? 'rgba(94,234,212,0.12)' : 'var(--panel-alt)',
                color: source === 'external' ? '#5eead4' : 'var(--muted)',
              }}
            >Azure (live WIQL)</button>
            {source === 'external' && (
              <>
                <select
                  value={azureProject}
                  onChange={(e) => { setAzureProject(e.target.value); setAzureTeam(''); }}
                  disabled={projectsLoading}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 12, minWidth: 180 }}
                >
                  <option value=''>{projectsLoading ? 'Loading projects…' : '— Pick a project —'}</option>
                  {azureProjects.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
                <select
                  value={azureTeam}
                  onChange={(e) => setAzureTeam(e.target.value)}
                  disabled={!azureProject || teamsLoading}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 12, minWidth: 200 }}
                >
                  <option value=''>{!azureProject ? '(pick project first)' : teamsLoading ? 'Loading teams…' : '— All teams —'}</option>
                  {azureTeams.map((tm) => (
                    <option key={tm.id} value={tm.name}>{tm.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {periodOptions.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--panel-border)',
                background: days === d ? 'var(--accent)' : 'var(--glass)',
                color: days === d ? '#fff' : 'var(--ink)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ ...box, borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13, marginBottom: 24 }}>
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
          {/* Data-source banner — makes "what is this measuring?" obvious. */}
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 10,
            background: data.error
              ? 'rgba(239,68,68,0.08)'
              : data.totals.planned === 0 ? 'rgba(239,68,68,0.06)' : 'var(--panel-alt)',
            border: data.error
              ? '1px solid rgba(239,68,68,0.4)'
              : data.totals.planned === 0 ? '1px solid rgba(239,68,68,0.25)' : '1px solid var(--panel-border)',
            fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 14 }}>{data.error ? '⛔' : data.totals.planned === 0 ? '⚠️' : data.source === 'external' ? '🔵' : '📊'}</span>
            <span style={{ flex: 1, minWidth: 280 }}>
              {data.error
                ? <>{data.error}</>
                : data.source === 'external'
                  ? data.totals.planned === 0
                    ? <>Azure returned 0 work items{azureProject ? ` for "${azureProject}"` : ''} in the last <strong>{days}d</strong>. Check the project name + (optionally) team.</>
                    : <>Live from Azure DevOps WIQL: <strong style={{ color: 'var(--ink)' }}>{data.totals.planned}</strong> work items{azureProject ? ` in "${azureProject}"` : ''}{azureTeam ? ` / ${azureTeam}` : ''} changed in the last <strong>{days}d</strong>. {data.totals.completed} done, {data.totals.in_progress ?? 0} in progress, {data.totals.removed ?? 0} removed.</>
                  : data.totals.planned === 0
                    ? <>No Agena task records in the last <strong>{days}d</strong>{repoId ? ' for this repo' : ''}. Switch to <strong>Azure (live WIQL)</strong> above to pull real sprint data, or import tasks first.</>
                    : <>Based on <strong style={{ color: 'var(--ink)' }}>{data.totals.planned}</strong> Agena task records in the last <strong>{days}d</strong>{repoId ? ' for the selected repo' : ' across all repos'}. Source: <code style={{ fontSize: 11, padding: '1px 5px', borderRadius: 4, background: 'var(--panel)' }}>task_records</code>. For raw sprint data, switch to <strong>Azure (live WIQL)</strong>.</>}
            </span>
            {!data.error && data.source === 'internal' && data.totals.planned === 0 && (
              <Link href="/dashboard/tasks" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Import tasks →
              </Link>
            )}
          </div>

          {/* Git activity for the same period+repo — universal across both sources */}
          {data.git_activity && (
            <div style={{
              marginBottom: 24, padding: '12px 16px', borderRadius: 12,
              background: 'var(--panel)', border: '1px solid var(--panel-border)',
              display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Git activity · {days}d</div>
              <GitStat label="PRs opened" value={data.git_activity.prs_opened} />
              <GitStat label="merged" value={data.git_activity.prs_merged} accent="#22c55e" />
              <GitStat label="open" value={data.git_activity.prs_open} accent="#f59e0b" />
              <GitStat label="commits" value={data.git_activity.commits} />
              <GitStat label="contributors" value={data.git_activity.contributors} />
              {data.git_activity.deployments_total > 0 && (
                <GitStat label="deploys" value={`${data.git_activity.deployments_success}/${data.git_activity.deployments_total}`} accent="#3b82f6" />
              )}
              {data.git_activity.avg_pr_lead_time_hours !== null && (
                <GitStat label="avg PR lead" value={`${data.git_activity.avg_pr_lead_time_hours}h`} />
              )}
            </div>
          )}

          {/* 4 KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
            <KpiCard label={t('dora.project.predictability')} value={data.kpi.predictability} color="#22c55e" />
            <KpiCard label={t('dora.project.productivity')} value={data.kpi.productivity} color="#3b82f6" />
            <KpiCard label={t('dora.project.deliveryRate')} value={data.kpi.delivery_rate} color="#8b5cf6" />
            <KpiCard label={t('dora.project.planningAccuracy')} value={data.kpi.planning_accuracy} color="#f59e0b" />
          </div>

          {/* Totals summary row */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#64748b' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.planned')}: <strong style={{ color: 'var(--ink)' }}>{data.totals.planned}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.completed')}: <strong style={{ color: 'var(--ink)' }}>{data.totals.completed}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.failed')}: <strong style={{ color: 'var(--ink)' }}>{data.totals.failed}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.cycleTime')}: <strong style={{ color: 'var(--ink)' }}>{data.avg_cycle_time_hours} {t('dora.project.hours')}</strong></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('dora.project.leadTime')}: <strong style={{ color: 'var(--ink)' }}>{data.avg_lead_time_hours} {t('dora.project.hours')}</strong></span>
            </div>
          </div>

          {/* Charts row 1: Velocity + WIP */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={box}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.project.velocity')}</h2>
              {data.weekly_trend.length > 0 ? (
                <BarChart
                  data={data.weekly_trend.slice(-8).map((w) => ({ label: w.week, value: w.completed }))}
                  barColor="#5eead4"
                />
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 12, padding: 20, textAlign: 'center' }}>{t('dora.project.noData')}</div>
              )}
            </div>
            <WipGauge count={data.wip_count} label={t('dora.project.wip')} />
          </div>

          {/* Charts row 2: Cycle & Lead Time Trend */}
          <div style={{ ...box, marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.project.cycleLeadTrend')}</h2>
            {data.time_trend.length > 0 ? (
              <DualLineChart
                data={data.time_trend.map((item) => ({ label: item.date, v1: item.avg_cycle_time_hours, v2: item.avg_lead_time_hours }))}
                color1="#38bdf8"
                color2="#a78bfa"
                label1={t('dora.project.cycleTime')}
                label2={t('dora.project.leadTime')}
              />
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 12, padding: 20, textAlign: 'center' }}>{t('dora.project.noData')}</div>
            )}
          </div>

          {/* Charts row 3: Throughput */}
          <div style={{ ...box, marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.project.throughput')}</h2>
            {data.throughput_trend.length > 0 ? (
              <LineChart
                data={data.throughput_trend.map((item) => ({ label: item.week, value: item.throughput }))}
                lineColor="#22c55e"
                fillColor="rgba(34,197,94,0.12)"
              />
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 12, padding: 20, textAlign: 'center' }}>{t('dora.project.noData')}</div>
            )}
          </div>

          {/* ── Sprint Detail (Oobeya-style) ───────────────────────────── */}
          {sprint && (
            <>
              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--panel-border)', margin: '32px 0 24px' }} />

              {/* Sprint Assignee List */}
              <div style={{ ...box, marginBottom: 24 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.sprint.assigneeTitle')}</h2>
                {sprint.assignees.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                                  <div style={{ height: '100%', width: `${Math.min(a.delivery_rate_count, 100)}%`, background: '#22c55e', borderRadius: 2 }} />
                                </div>
                                <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 40, textAlign: 'right' }}>{a.delivery_rate_count.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--panel-border)', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(a.delivery_rate_effort, 100)}%`, background: '#8b5cf6', borderRadius: 2 }} />
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
                    { key: 'completed' as const, label: t('dora.sprint.completedItems'), count: sprint.completed_items.length, color: '#22c55e' },
                    { key: 'incomplete' as const, label: t('dora.sprint.incompleteItems'), count: sprint.incomplete_items.length, color: '#f59e0b' },
                    { key: 'removed' as const, label: t('dora.sprint.removedItems'), count: sprint.removed_items.length, color: '#ef4444' },
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
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.sprint.typeDistribution')}</h2>
                  <DonutChart
                    data={sprint.type_distribution.map((d) => ({
                      label: d.type,
                      value: d.count,
                      color: d.type === 'Bug' ? '#ef4444' : '#3b82f6',
                    }))}
                  />
                </div>

                {/* Scope Change */}
                <div style={box}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.sprint.scopeChange')}</h2>
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
