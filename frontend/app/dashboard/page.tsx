'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  apiFetch,
  fetchAnalyticsDaily,
  fetchAnalyticsSummary,
  fetchAnalyticsModels,
  loadPrefs,
  type AnalyticsDailyResponse,
  type AnalyticsSummaryResponse,
  type AnalyticsModelResponse,
} from '@/lib/api';
import { TaskItem } from '@/components/TaskTable';
import { useLocale } from '@/lib/i18n';
import { useWS } from '@/lib/useWebSocket';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';

type BillingStatus = {
  plan_name: string;
  status: string;
  tasks_used: number;
  tokens_used: number;
};

type QuotaInfo = {
  plan_name: string;
  plan_display_name: string;
  tasks_used: number;
  tasks_limit: number;
  members_used: number;
  members_limit: number;
  agents_limit: number;
  features: string[];
  tokens_used: number;
};

type MemoryStatus = {
  enabled: boolean;
  backend: string;
  collection: string;
  embedding_mode: string;
  vector_size?: number | null;
  distance?: string | null;
  tenant_filtering?: string | null;
  points_count?: number | null;
  vectors_count?: number | null;
  url?: string | null;
  notes?: string | null;
};

type MemoryKindEntry = {
  kind: string;
  label: string;
  description: string;
  embed_recipe: string;
  written_by: string[];
  read_by: string[];
  payload_keys: string[];
  points_count: number;
};

type MemorySchema = {
  purpose: string;
  what_is_stored: Record<string, string>;
  retrieval_flow: string[];
  constraints: string[];
  privacy_scope: string;
  kinds: MemoryKindEntry[];
};

type IntegrationConfigLite = {
  provider: string;
  has_secret?: boolean;
  base_url?: string | null;
};

type CommandItem = {
  key: string;
  titleKey: string;
  done: boolean;
  href: string;
};

// Enterprise status palette — desaturated, readable on both light and dark
// surfaces. Status is conveyed by a small dot, never by colouring the whole
// number, so the dashboard stays neutral the way Azure DevOps / Linear do.
const C = {
  acc: '#5b9bd5',
  green: '#3f9d6a',
  amber: '#c98a2b',
  red: '#cf5b57',
  slate: 'var(--ink-50)',
};

function hasConfiguredAgent(agents?: Record<string, unknown>[]): boolean {
  if (!Array.isArray(agents)) {
    if (typeof window === 'undefined') return false;
    try {
      const raw = JSON.parse(localStorage.getItem('agena_agent_configs') || '[]');
      if (!Array.isArray(raw)) return false;
      return raw.some((a: Record<string, unknown>) => a.enabled !== false && a.provider && (a.model || a.custom_model));
    } catch { return false; }
  }
  return agents.some((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const agent = raw as Record<string, unknown>;
    const enabled = agent.enabled !== false;
    const provider = typeof agent.provider === 'string' ? agent.provider.trim() : '';
    const model = typeof agent.model === 'string' ? agent.model.trim() : '';
    const customModel = typeof agent.custom_model === 'string' ? agent.custom_model.trim() : '';
    return enabled && provider.length > 0 && (model.length > 0 || customModel.length > 0);
  });
}

export default function DashboardOverview() {
  const { t } = useLocale();
  const { lastEvent } = useWS();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [memory, setMemory] = useState<MemoryStatus | null>(null);
  const [schema, setSchema] = useState<MemorySchema | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);
  const [analyticsDaily, setAnalyticsDaily] = useState<AnalyticsDailyResponse | null>(null);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [analyticsModels, setAnalyticsModels] = useState<AnalyticsModelResponse | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [commandItems, setCommandItems] = useState<CommandItem[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<TaskItem[]>('/tasks'),
      apiFetch<BillingStatus>('/billing/status'),
      apiFetch<MemoryStatus>('/memory/status'),
      apiFetch<QuotaInfo>('/billing/quota'),
    ]).then(([t, b, m, q]) => {
      setTasks(t);
      setBilling(b);
      setMemory(m);
      setQuota(q);
    }).catch(() => {});
    Promise.all([
      fetchAnalyticsDaily(30),
      fetchAnalyticsSummary(),
      fetchAnalyticsModels(30),
    ]).then(([d, s, m]) => {
      setAnalyticsDaily(d);
      setAnalyticsSummary(s);
      setAnalyticsModels(m);
    }).catch(() => {});
    Promise.all([
      loadPrefs(),
      apiFetch<IntegrationConfigLite[]>('/integrations'),
    ]).then(([prefs, integrations]) => {
      const profile = (prefs.profile_settings || {}) as Record<string, unknown>;
      const jiraSprint = typeof profile.jira_sprint_id === 'string' ? profile.jira_sprint_id.trim() : '';
      const hasSecret = (providers: string[]) => integrations.some((i) => providers.includes(i.provider) && i.has_secret === true);
      const defaultRepo = typeof window !== 'undefined' ? localStorage.getItem('agena_default_repo') : null;

      setCommandItems([
        { key: 'integration', titleKey: 'command.integration', done: integrations.some((c) => c.provider !== 'playbook' && c.has_secret === true), href: '/dashboard/integrations' },
        { key: 'aiProvider', titleKey: 'command.aiProvider', done: hasSecret(['openai', 'gemini']), href: '/dashboard/integrations' },
        { key: 'sprint', titleKey: 'command.sprint', done: !!(prefs.azure_sprint_path?.trim() || jiraSprint), href: '/dashboard/sprints' },
        { key: 'repo', titleKey: 'command.repo', done: !!defaultRepo, href: '/dashboard/mappings' },
        { key: 'agent', titleKey: 'command.agent', done: hasConfiguredAgent(prefs.agents), href: '/dashboard/agents' },
        { key: 'team', titleKey: 'command.team', done: (prefs.my_team?.length ?? 0) > 0, href: '/dashboard/team' },
        { key: 'repoMapping', titleKey: 'command.repoMapping', done: (prefs.repo_mappings?.length ?? 0) > 0, href: '/dashboard/mappings' },
        { key: 'notifications', titleKey: 'command.notifications', done: hasSecret(['slack', 'teams', 'telegram']), href: '/dashboard/integrations' },
      ]);
    }).catch(() => {
      setCommandItems([]);
    });
    const iv = setInterval(() => {
      apiFetch<TaskItem[]>('/tasks').then(setTasks).catch(() => {});
      apiFetch<MemoryStatus>('/memory/status').then(setMemory).catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  // Refetch on WebSocket task_status events
  useEffect(() => {
    if (lastEvent?.event === 'task_status') {
      apiFetch<TaskItem[]>('/tasks').then(setTasks).catch(() => {});
    }
  }, [lastEvent]);

  const openMemorySchema = async () => {
    setSchemaOpen(true);
    if (schemaLoading) return;
    setSchemaLoading(true);
    try {
      const data = await apiFetch<MemorySchema>('/memory/schema');
      setSchema(data);
    } catch {
      setSchema(null);
    } finally {
      setSchemaLoading(false);
    }
  };

  const queued = tasks.filter((t) => t.status === 'queued').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const blocked = tasks.filter((t) => (t.blocked_by_task_id ?? null) !== null).length;
  const settled = completed + failed;
  const successRate = settled > 0 ? Math.round((completed / settled) * 100) : 0;
  const avgQueueWait = (() => {
    const waits = tasks
      .map((t) => t.queue_wait_sec)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0);
    if (waits.length === 0) return 0;
    return Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
  })();
  const slaBreached = tasks.filter((t) => {
    if (t.status === 'queued' && (t.queue_wait_sec ?? 0) > 900) return true;
    if (t.status === 'running' && (t.run_duration_sec ?? 0) > 1800) return true;
    return false;
  }).length;
  const activeWithEta = tasks
    .filter((t) => t.status === 'queued' && typeof t.estimated_start_sec === 'number')
    .sort((a, b) => (a.estimated_start_sec ?? 0) - (b.estimated_start_sec ?? 0))
    .slice(0, 4);
  const cmdDoneCount = commandItems.filter((i) => i.done).length;
  const cmdTotal = commandItems.length;
  const cmdPct = cmdTotal > 0 ? Math.round((cmdDoneCount / cmdTotal) * 100) : 0;
  const cmdAllDone = cmdDoneCount === cmdTotal;

  const kpis = [
    { label: t('dashboard.kpi.totalTasks'), value: tasks.length, tone: C.slate },
    { label: t('dashboard.kpi.running'), value: running, tone: C.acc },
    { label: t('dashboard.kpi.completed'), value: completed, tone: C.green },
    { label: t('dashboard.kpi.queued'), value: queued, tone: C.amber },
    { label: t('dashboard.kpi.failed'), value: failed, tone: C.red },
    { label: t('dashboard.kpi.tokensUsed'), value: (billing?.tokens_used ?? 0).toLocaleString(), tone: C.slate },
  ];

  const cardBase: React.CSSProperties = {
    borderRadius: 10,
    border: '1px solid var(--panel-border)',
    background: 'var(--surface)',
  };
  const panelLabel: React.CSSProperties = {
    fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className='section-label'>{t('dashboard.section')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6, letterSpacing: -0.2 }}>
            {t('dashboard.title')}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
            color: 'var(--ink-72)', background: 'var(--panel-alt)',
            border: '1px solid var(--panel-border-2)', borderRadius: 6, padding: '4px 10px',
          }}>
            {quota?.plan_display_name ?? billing?.plan_name ?? '—'}
          </span>
          {quota && quota.plan_name === 'free' && (
            <Link href='/dashboard/integrations' style={{
              fontSize: 11, fontWeight: 600, color: C.amber,
              background: 'rgba(201,138,43,0.12)', border: '1px solid rgba(201,138,43,0.3)',
              borderRadius: 6, padding: '4px 10px', textDecoration: 'none',
            }}>
              {t('dashboard.quota.upgrade')}
            </Link>
          )}
        </div>
      </div>

      {/* Setup checklist — only while incomplete, kept quiet */}
      {commandItems.length > 0 && !cmdAllDone && (
        <div style={{ ...cardBase, padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={panelLabel}>{t('command.title' as Parameters<typeof t>[0])}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-65)', marginTop: 3 }}>
                {t('command.subtitle' as Parameters<typeof t>[0])}
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-78)', whiteSpace: 'nowrap' }}>
              {cmdDoneCount}<span style={{ color: 'var(--ink-35)' }}>/{cmdTotal}</span>
            </span>
          </div>
          <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--panel-border)', overflow: 'hidden' }}>
            <div style={{ width: `${cmdPct}%`, height: '100%', background: C.acc, transition: 'width 0.6s cubic-bezier(.4,0,.2,1)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6 }}>
            {commandItems.map((item) => (
              <Link key={item.key} href={item.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  height: 46, borderRadius: 7, border: '1px solid var(--panel-border)',
                  background: 'var(--panel-alt)', padding: '0 12px',
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  opacity: item.done ? 0.6 : 1,
                }}>
                  <span className='ent-dot' style={{ background: item.done ? C.green : C.amber }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t(item.titleKey as Parameters<typeof t>[0])}
                    </div>
                    <div style={{ fontSize: 10.5, color: item.done ? 'var(--ink-35)' : C.amber }}>
                      {item.done ? t('command.configured' as Parameters<typeof t>[0]) : t('command.notConfigured' as Parameters<typeof t>[0])}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI strip — Azure-style dense cells in one container */}
      <div style={{ ...cardBase, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', overflow: 'hidden' }} className='dash-kpi-strip'>
        {kpis.map((k, i) => (
          <div key={k.label} style={{
            padding: '16px 18px',
            borderLeft: i === 0 ? 'none' : '1px solid var(--panel-border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className='ent-dot' style={{ background: k.tone }} />
              <span style={panelLabel}>{k.label}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, lineHeight: 1, letterSpacing: -0.5 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Quota usage */}
      {quota && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }} className='dash-grid-responsive'>
          {[
            { label: t('dashboard.quota.tasks'), used: quota.tasks_used, limit: quota.tasks_limit },
            { label: t('dashboard.quota.members'), used: quota.members_used, limit: quota.members_limit },
          ].map((q) => {
            const pct = q.limit === -1 ? 5 : Math.min(100, (q.used / q.limit) * 100);
            const hot = q.limit !== -1 && q.used / q.limit > 0.8;
            return (
              <div key={q.label} style={{ ...cardBase, padding: '14px 18px', background: 'var(--panel-alt)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={panelLabel}>{q.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-78)' }}>
                    {q.used} / {q.limit === -1 ? t('dashboard.quota.unlimited') : q.limit}
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: 'var(--panel-border)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: hot ? C.red : C.acc, transition: 'width 0.4s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Operations + side column */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.5fr', gap: 14 }} className='dash-grid-responsive'>
        <div style={{ ...cardBase, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-90)' }}>{t('dashboard.operationsRadar')}</span>
            <Link href='/dashboard/tasks' style={{ fontSize: 12, color: C.acc, textDecoration: 'none' }}>{t('dashboard.openTasks')} →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: t('dashboard.successRate'), value: `${successRate}%`, tone: C.green },
              { label: t('dashboard.avgQueueWait'), value: `${avgQueueWait}${t('dashboard.unit.sec')}`, tone: C.acc },
              { label: t('dashboard.slaBreaches'), value: String(slaBreached), tone: slaBreached > 0 ? C.red : C.slate },
              { label: t('dashboard.repoContention'), value: String(blocked), tone: blocked > 0 ? C.amber : C.slate },
            ].map((item) => (
              <div key={item.label} style={{ border: '1px solid var(--panel-border)', borderRadius: 8, padding: '10px 12px', background: 'var(--panel-alt)' }}>
                <div style={panelLabel}>{item.label}</div>
                <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink-90)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className='ent-dot' style={{ background: item.tone }} />{item.value}
                </div>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid var(--panel-border)', borderRadius: 8, background: 'var(--panel-alt)', overflow: 'hidden' }}>
            <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--panel-border)', ...panelLabel }}>
              {t('dashboard.queueForecast')}
            </div>
            {activeWithEta.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--ink-35)', fontSize: 13 }}>{t('dashboard.noQueuedEta')}</div>
            ) : (
              activeWithEta.map((task) => (
                <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '9px 12px', borderTop: '1px solid var(--panel-border)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink-90)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-42)', marginTop: 2 }}>#{task.queue_position ?? '—'} {t('dashboard.inQueue')}</div>
                  </div>
                  <div style={{ fontSize: 12, color: C.acc, fontWeight: 600 }}>~{Math.max(0, Math.round((task.estimated_start_sec ?? 0) / 60))}{t('dashboard.unit.min')}</div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          {/* Pipeline */}
          <div style={{ ...cardBase, padding: 18 }}>
            <div style={{ ...panelLabel, marginBottom: 14 }}>{t('dashboard.pipelineTitle')}</div>
            {[
              t('dashboard.pipeline.fetch'),
              t('dashboard.pipeline.generate'),
              t('dashboard.pipeline.review'),
              t('dashboard.pipeline.finalize'),
            ].map((stage, i, arr) => (
              <div key={stage} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span className='ent-dot' style={{ background: C.acc, marginTop: 4 }} />
                  {i < arr.length - 1 && <div style={{ width: 1, height: 18, background: 'var(--panel-border-2)' }} />}
                </div>
                <span style={{ fontSize: 12.5, color: 'var(--ink-65)', fontFamily: 'var(--font-mono, monospace)', paddingBottom: i < arr.length - 1 ? 16 : 0 }}>{stage}</span>
              </div>
            ))}
          </div>

          {/* Vector memory */}
          <div style={{ ...cardBase, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={panelLabel}>{t('dashboard.memory.title')}</div>
              <span style={{
                fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5,
                color: memory?.enabled ? C.green : C.red,
              }}>
                <span className='ent-dot' style={{ background: memory?.enabled ? C.green : C.red }} />
                {memory?.enabled ? t('dashboard.memory.online') : t('dashboard.memory.off')}
              </span>
            </div>
            <div style={{ display: 'grid', gap: 5, fontSize: 12.5, color: 'var(--ink-65)' }}>
              <div>{t('dashboard.memory.backend')}: <span style={{ color: 'var(--ink-90)', fontWeight: 600 }}>{memory?.backend ?? 'qdrant'}</span></div>
              <div>{t('dashboard.memory.collection')}: <span style={{ color: 'var(--ink-90)' }}>{memory?.collection ?? '—'}</span></div>
              <div>{t('dashboard.memory.points')}: <span style={{ color: 'var(--ink-90)', fontWeight: 600 }}>{memory?.points_count ?? 0}</span> · {t('dashboard.memory.mode')}: <span style={{ color: 'var(--ink-90)' }}>{memory?.embedding_mode ?? 'deterministic'}</span></div>
            </div>
            <button type='button' onClick={openMemorySchema} style={{
              marginTop: 12, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)',
              color: 'var(--ink-78)', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              {t('dashboard.memory.viewSchema')}
            </button>
          </div>
        </div>
      </div>

      {/* Analytics */}
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink-90)', marginBottom: 12 }}>
          {t('dashboard.analytics.title')}
        </div>

        {analyticsSummary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            {[
              { label: t('dashboard.analytics.totalCost'), value: `$${analyticsSummary.cost_usd.toFixed(2)}` },
              { label: t('dashboard.analytics.totalTokens'), value: analyticsSummary.total_tokens.toLocaleString() },
              { label: t('dashboard.analytics.successRate'), value: `${analyticsSummary.completion_rate}%` },
              { label: t('dashboard.analytics.avgDuration'), value: `${(analyticsSummary.avg_duration_ms / 1000).toFixed(1)}s` },
            ].map((s) => (
              <div key={s.label} style={{ ...cardBase, padding: '14px 16px', background: 'var(--panel-alt)' }}>
                <div style={panelLabel}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6, letterSpacing: -0.3 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className='dash-grid-responsive' style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div style={{ ...cardBase, padding: 16 }}>
            <div style={{ ...panelLabel, marginBottom: 12 }}>{t('dashboard.analytics.costTrend')}</div>
            {analyticsDaily && analyticsDaily.daily_usage.length > 0 ? (
              <LineChart
                data={analyticsDaily.daily_usage.map((d) => ({ label: d.date, value: Math.round(d.cost_usd * 100) / 100 }))}
                lineColor='#5b9bd5'
                fillColor='rgba(91,155,213,0.10)'
              />
            ) : (
              <div style={{ color: 'var(--ink-35)', fontSize: 13, padding: 20, textAlign: 'center' }}>{t('dashboard.analytics.noData')}</div>
            )}
          </div>
          <div style={{ ...cardBase, padding: 16 }}>
            <div style={{ ...panelLabel, marginBottom: 12 }}>{t('dashboard.analytics.taskCompletion')}</div>
            {analyticsDaily && analyticsDaily.task_velocity.length > 0 ? (
              <BarChart
                data={analyticsDaily.task_velocity.slice(-7).map((d) => ({ label: d.date, value: d.completed }))}
                barColor='#3f9d6a'
              />
            ) : (
              <div style={{ color: 'var(--ink-35)', fontSize: 13, padding: 20, textAlign: 'center' }}>{t('dashboard.analytics.noData')}</div>
            )}
          </div>
        </div>

        {analyticsModels && analyticsModels.models.length > 0 && (
          <div style={{ ...cardBase, padding: 16 }}>
            <div style={{ ...panelLabel, marginBottom: 12 }}>{t('dashboard.analytics.modelBreakdown')}</div>
            <table className='ent-table'>
              <thead>
                <tr>
                  <th>{t('dashboard.analytics.model')}</th>
                  <th style={{ textAlign: 'right' }}>{t('dashboard.analytics.calls')}</th>
                  <th style={{ textAlign: 'right' }}>{t('dashboard.analytics.tokens')}</th>
                  <th style={{ textAlign: 'right' }}>{t('dashboard.analytics.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {analyticsModels.models.map((m) => (
                  <tr key={m.model}>
                    <td style={{ color: 'var(--ink-90)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{m.model}</td>
                    <td style={{ textAlign: 'right' }}>{m.count}</td>
                    <td style={{ textAlign: 'right' }}>{m.total_tokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: 'var(--ink-90)', fontWeight: 600 }}>${m.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }} className='dash-grid-responsive'>
        {[
          { href: '/dashboard/tasks', label: t('dashboard.quick.manageTasks'), desc: t('dashboard.quick.manageTasksDesc') },
          { href: '/dashboard/sprints', label: t('dashboard.quick.sprintBoard'), desc: t('dashboard.quick.sprintBoardDesc') },
          { href: '/dashboard/mappings', label: t('dashboard.quick.repoMappings'), desc: t('dashboard.quick.repoMappingsDesc') },
          { href: '/dashboard/agents', label: t('dashboard.quick.aiAgents'), desc: t('dashboard.quick.aiAgentsDesc') },
          { href: '/dashboard/flows', label: t('dashboard.quick.flowTemplates'), desc: t('dashboard.quick.flowTemplatesDesc') },
          { href: '/dashboard/integrations', label: t('dashboard.quick.integrations'), desc: t('dashboard.quick.integrationsDesc') },
        ].map((l) => (
          <Link key={l.href} href={l.href} style={{
            ...cardBase, background: 'var(--panel-alt)', padding: '14px 16px',
            textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            transition: 'border-color 0.15s',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border-4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border)'; }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink-90)', marginBottom: 3 }}>{l.label}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.desc}</div>
            </div>
            <span style={{ color: 'var(--ink-35)', fontSize: 15 }}>→</span>
          </Link>
        ))}
      </div>

      {schemaOpen && portalReady && createPortal(
        <div
          role='dialog'
          aria-modal='true'
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: 20,
          }}
          onClick={() => setSchemaOpen(false)}
        >
          <div
            style={{
              width: 'min(880px, 100%)', maxHeight: '85vh', overflowY: 'auto',
              borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--surface)',
              padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, position: 'sticky', top: -18, paddingTop: 18, marginTop: -18, background: 'var(--surface)', zIndex: 1 }}>
              <div style={{ color: 'var(--ink-90)', fontWeight: 700, fontSize: 15 }}>{t('dashboard.schema.title')}</div>
              <button type='button' onClick={() => setSchemaOpen(false)} style={{
                border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-78)',
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
              }}>
                {t('dashboard.schema.close')}
              </button>
            </div>
            {schemaLoading && <div style={{ color: 'var(--ink-72)', fontSize: 13 }}>{t('dashboard.schema.loading')}</div>}
            {!schemaLoading && !schema && <div style={{ color: C.red, fontSize: 13 }}>{t('dashboard.schema.loadError')}</div>}
            {!schemaLoading && schema && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 8, padding: 12 }}>
                  <div style={panelLabel}>{t('dashboard.schema.purpose')}</div>
                  <div style={{ color: 'var(--ink-90)', marginTop: 6, fontSize: 14 }}>{schema.purpose}</div>
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ ...panelLabel, marginBottom: 8 }}>{t('dashboard.schema.storedFields')}</div>
                  {Object.entries(schema.what_is_stored).map(([k, v]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 8, padding: '6px 0', borderTop: '1px solid var(--panel-border)' }}>
                      <div style={{ color: C.acc, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{k}</div>
                      <div style={{ color: 'var(--ink-90)', fontSize: 13 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {Array.isArray(schema.kinds) && schema.kinds.length > 0 && (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={panelLabel}>{t('dashboard.schema.kinds')}</div>
                    {schema.kinds.map((k) => (
                      <div key={k.kind} style={{ border: '1px solid var(--panel-border-2)', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <code style={{ color: C.acc, fontSize: 12, background: 'var(--acc-soft)', padding: '2px 8px', borderRadius: 4 }}>kind={k.kind}</code>
                            <div style={{ color: 'var(--ink-90)', fontWeight: 600, fontSize: 13 }}>{k.label}</div>
                          </div>
                          <div style={{ color: 'var(--ink-72)', fontWeight: 600, fontSize: 12, background: 'var(--panel-alt)', padding: '2px 8px', borderRadius: 4 }}>
                            {k.points_count.toLocaleString()} {t('dashboard.schema.points')}
                          </div>
                        </div>
                        <div style={{ color: 'var(--ink-72)', fontSize: 12.5, lineHeight: 1.5 }}>{k.description}</div>
                        <div>
                          <div style={{ ...panelLabel, marginBottom: 4 }}>{t('dashboard.schema.embedRecipe')}</div>
                          <pre style={{ color: 'var(--ink-90)', fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--terminal-bg)', padding: 8, borderRadius: 6, margin: 0, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{k.embed_recipe}</pre>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div>
                            <div style={{ ...panelLabel, marginBottom: 4 }}>{t('dashboard.schema.writtenBy')}</div>
                            {k.written_by.map((w, i) => (
                              <div key={`w-${i}`} style={{ color: 'var(--ink-90)', fontSize: 12, padding: '2px 0' }}>· {w}</div>
                            ))}
                          </div>
                          <div>
                            <div style={{ ...panelLabel, marginBottom: 4 }}>{t('dashboard.schema.readBy')}</div>
                            {k.read_by.map((r, i) => (
                              <div key={`r-${i}`} style={{ color: 'var(--ink-90)', fontSize: 12, padding: '2px 0' }}>· {r}</div>
                            ))}
                          </div>
                        </div>
                        {k.payload_keys.length > 0 && (
                          <div>
                            <div style={{ ...panelLabel, marginBottom: 4 }}>{t('dashboard.schema.payloadKeys')}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {k.payload_keys.map((pk) => (
                                <code key={pk} style={{ color: C.acc, fontSize: 11, background: 'var(--acc-soft)', padding: '2px 6px', borderRadius: 4 }}>{pk}</code>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ ...panelLabel, marginBottom: 8 }}>{t('dashboard.schema.retrievalFlow')}</div>
                  {schema.retrieval_flow.map((step, idx) => (
                    <div key={`${idx}-${step}`} style={{ color: 'var(--ink-90)', fontSize: 13, padding: '4px 0' }}>{idx + 1}. {step}</div>
                  ))}
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 8, padding: 12 }}>
                  <div style={{ ...panelLabel, marginBottom: 8 }}>{t('dashboard.schema.constraints')}</div>
                  {schema.constraints.map((item, idx) => (
                    <div key={`${idx}-${item}`} style={{ color: 'var(--ink-90)', fontSize: 13, padding: '4px 0' }}>- {item}</div>
                  ))}
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 8, padding: 12 }}>
                  <div style={panelLabel}>{t('dashboard.schema.privacyScope')}</div>
                  <div style={{ color: 'var(--ink-90)', marginTop: 6, fontSize: 14 }}>{schema.privacy_scope}</div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
