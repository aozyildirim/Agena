'use client';

import { useEffect, useState } from 'react';
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

type MemorySchema = {
  purpose: string;
  what_is_stored: Record<string, string>;
  retrieval_flow: string[];
  constraints: string[];
  privacy_scope: string;
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
        { key: 'repo', titleKey: 'command.repo', done: !!defaultRepo, href: '/dashboard/onboarding' },
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
    if (schema || schemaLoading) return;
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
    { label: t('dashboard.kpi.totalTasks'), value: tasks.length, color: '#5eead4', icon: '◈' },
    { label: t('dashboard.kpi.running'), value: running, color: '#38bdf8', icon: '◎' },
    { label: t('dashboard.kpi.completed'), value: completed, color: '#22c55e', icon: '✓' },
    { label: t('dashboard.kpi.queued'), value: queued, color: '#f59e0b', icon: '⏳' },
    { label: t('dashboard.kpi.failed'), value: failed, color: '#f87171', icon: '✕' },
    { label: t('dashboard.kpi.tokensUsed'), value: billing?.tokens_used ?? 0, color: '#a78bfa', icon: '⚡' },
  ];

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      {/* Header */}
      <div>
        <div className='section-label'>{t('dashboard.section')}</div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
          {t('dashboard.title')}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <span style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: quota?.plan_name === 'enterprise' ? '#a78bfa' : quota?.plan_name === 'pro' ? '#38bdf8' : '#5eead4',
            background: quota?.plan_name === 'enterprise' ? 'rgba(167,139,250,0.14)' : quota?.plan_name === 'pro' ? 'rgba(56,189,248,0.14)' : 'rgba(94,234,212,0.14)',
            border: `1px solid ${quota?.plan_name === 'enterprise' ? 'rgba(167,139,250,0.35)' : quota?.plan_name === 'pro' ? 'rgba(56,189,248,0.35)' : 'rgba(94,234,212,0.35)'}`,
            borderRadius: 999,
            padding: '3px 10px',
          }}>
            {quota?.plan_display_name ?? billing?.plan_name ?? '—'}
          </span>
          {quota && quota.plan_name === 'free' && (
            <Link href='/dashboard/integrations' style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#f59e0b',
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.35)',
              borderRadius: 999,
              padding: '3px 10px',
              textDecoration: 'none',
            }}>
              {t('dashboard.quota.upgrade')}
            </Link>
          )}
        </div>
      </div>

      {/* Komuta Merkezi — Setup Progress */}
      {commandItems.length > 0 && (
        <div style={{
          borderRadius: 16,
          border: cmdAllDone ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(245,158,11,0.35)',
          background: cmdAllDone
            ? 'linear-gradient(180deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))'
            : 'linear-gradient(180deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02))',
          padding: 16,
          display: 'grid',
          gap: 14,
        }}>
          {/* Header + Progress */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.7, textTransform: 'uppercase', color: cmdAllDone ? '#22c55e' : '#fbbf24' }}>
                {t('command.title' as Parameters<typeof t>[0])}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-78)', marginTop: 4 }}>
                {t('command.subtitle' as Parameters<typeof t>[0])}
              </div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 800,
              color: cmdAllDone ? '#22c55e' : '#f59e0b',
              background: cmdAllDone ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.18)',
              border: cmdAllDone ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(245,158,11,0.4)',
              borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap',
            }}>
              {cmdDoneCount}/{cmdTotal}
            </span>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{
              width: `${cmdPct}%`, height: '100%', borderRadius: 3,
              background: cmdAllDone ? 'linear-gradient(90deg, #22c55e, #34d399)' : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              transition: 'width 0.6s cubic-bezier(.4,0,.2,1)',
            }} />
          </div>

          {/* Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {commandItems.map((item) => (
              <Link key={item.key} href={item.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  height: 56, borderRadius: 10,
                  border: item.done ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(245,158,11,0.3)',
                  background: 'var(--panel)',
                  padding: '0 12px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
                  opacity: item.done ? 0.65 : 1,
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: item.done ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                  }}>
                    {item.done ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="#fbbf24" strokeWidth="1.5" /><circle cx="8" cy="8" r="1.5" fill="#fbbf24" /></svg>
                    )}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t(item.titleKey as Parameters<typeof t>[0])}
                    </div>
                    <div style={{ fontSize: 10, color: item.done ? 'var(--ink-30)' : '#fbbf24' }}>
                      {item.done ? t('command.configured' as Parameters<typeof t>[0]) : t('command.notConfigured' as Parameters<typeof t>[0])}
                    </div>
                  </div>
                  {!item.done && <span style={{ fontSize: 12, color: '#fbbf24', flexShrink: 0 }}>→</span>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quota Usage Bars */}
      {quota && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }} className="dash-grid-responsive">
          {/* Tasks quota */}
          <div style={{
            borderRadius: 16, border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)', padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                {t('dashboard.quota.tasks')}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-78)' }}>
                {quota.tasks_used} / {quota.tasks_limit === -1 ? t('dashboard.quota.unlimited') : quota.tasks_limit}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                borderRadius: 3,
                width: quota.tasks_limit === -1 ? '5%' : `${Math.min(100, (quota.tasks_used / quota.tasks_limit) * 100)}%`,
                background: quota.tasks_limit !== -1 && quota.tasks_used / quota.tasks_limit > 0.8 ? '#f87171' : '#5eead4',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>

          {/* Members quota */}
          <div style={{
            borderRadius: 16, border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)', padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                {t('dashboard.quota.members')}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-78)' }}>
                {quota.members_used} / {quota.members_limit === -1 ? t('dashboard.quota.unlimited') : quota.members_limit}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                borderRadius: 3,
                width: quota.members_limit === -1 ? '5%' : `${Math.min(100, (quota.members_used / quota.members_limit) * 100)}%`,
                background: quota.members_limit !== -1 && quota.members_used / quota.members_limit > 0.8 ? '#f87171' : '#38bdf8',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        </div>
      )}

      {/* KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }} className="dash-grid-responsive">
        {kpis.map((k) => (
          <div key={k.label} style={{
            borderRadius: 18,
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)',
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            transition: 'border-color 0.2s',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: `${k.color}18`,
              border: `1px solid ${k.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: k.color, flexShrink: 0,
            }}>{k.icon}</div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 4 }}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Operations Radar + Pipeline */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr', gap: 20 }} className="dash-grid-responsive">
        {/* Operations Radar */}
        <div style={{
          borderRadius: 20, border: '1px solid var(--panel-border)',
          background: 'var(--panel-alt)', overflow: 'hidden', padding: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontWeight: 700, color: 'var(--ink-90)' }}>{t('dashboard.operationsRadar')}</span>
            <Link href='/dashboard/tasks' style={{ fontSize: 12, color: '#5eead4' }}>{t('dashboard.openTasks')} →</Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: t('dashboard.successRate'), value: `${successRate}%`, tone: '#22c55e' },
              { label: t('dashboard.avgQueueWait'), value: `${avgQueueWait}${t('dashboard.unit.sec')}`, tone: '#38bdf8' },
              { label: t('dashboard.slaBreaches'), value: String(slaBreached), tone: slaBreached > 0 ? '#f87171' : '#5eead4' },
              { label: t('dashboard.repoContention'), value: String(blocked), tone: blocked > 0 ? '#f59e0b' : '#5eead4' },
            ].map((item) => (
              <div key={item.label} style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: '10px 12px', background: 'var(--panel)' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7 }}>{item.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: item.tone, marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, background: 'var(--panel)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-border)', fontSize: 12, color: 'var(--ink-78)', fontWeight: 700 }}>
              {t('dashboard.queueForecast')}
            </div>
            {activeWithEta.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--ink-35)', fontSize: 13 }}>{t('dashboard.noQueuedEta')}</div>
            ) : (
              activeWithEta.map((task) => (
                <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 12px', borderTop: '1px solid var(--panel-alt)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink-90)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-42)', marginTop: 2 }}>#{task.queue_position ?? '—'} {t('dashboard.inQueue')}</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#5eead4', fontWeight: 700 }}>~{Math.max(0, Math.round((task.estimated_start_sec ?? 0) / 60))}{t('dashboard.unit.min')}</div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {/* Pipeline */}
          <div style={{
            borderRadius: 20, border: '1px solid rgba(13,148,136,0.2)',
            background: 'rgba(13,148,136,0.04)', padding: 24,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.6), transparent)' }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#5eead4', marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' }}>{t('dashboard.pipelineTitle')}</div>
            {[
              { stage: t('dashboard.pipeline.fetch'), color: '#5eead4' },
              { stage: t('dashboard.pipeline.generate'), color: '#a78bfa' },
              { stage: t('dashboard.pipeline.review'), color: '#38bdf8' },
              { stage: t('dashboard.pipeline.finalize'), color: '#22c55e' },
            ].map((s, i) => (
              <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < 3 ? 0 : 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                  {i < 3 && <div style={{ width: 1, height: 20, background: 'var(--panel-border-2)' }} />}
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-50)', fontFamily: 'monospace', paddingBottom: i < 3 ? 20 : 0 }}>{s.stage}</span>
              </div>
            ))}
          </div>

          {/* Vector Memory */}
          <div style={{
            borderRadius: 16,
            border: '1px solid rgba(56,189,248,0.2)',
            background: 'rgba(56,189,248,0.06)',
            padding: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#7dd3fc' }}>
                {t('dashboard.memory.title')}
              </div>
              <span style={{
                fontSize: 11,
                fontWeight: 700,
                color: memory?.enabled ? '#22c55e' : '#f87171',
                background: memory?.enabled ? 'rgba(34,197,94,0.16)' : 'rgba(248,113,113,0.16)',
                border: `1px solid ${memory?.enabled ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.35)'}`,
                borderRadius: 999,
                padding: '3px 8px',
              }}>
                {memory?.enabled ? t('dashboard.memory.online') : t('dashboard.memory.off')}
              </span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-78)' }}>
                {t('dashboard.memory.backend')}: <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{memory?.backend ?? 'qdrant'}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-78)' }}>
                {t('dashboard.memory.collection')}: <span style={{ color: 'var(--ink-90)' }}>{memory?.collection ?? '—'}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-78)' }}>
                {t('dashboard.memory.points')}: <span style={{ color: '#5eead4', fontWeight: 700 }}>{memory?.points_count ?? 0}</span>
                &nbsp;·&nbsp; {t('dashboard.memory.mode')}: <span style={{ color: 'var(--ink-90)' }}>{memory?.embedding_mode ?? 'deterministic'}</span>
              </div>
            </div>
            <button
              type='button'
              onClick={openMemorySchema}
              style={{
                marginTop: 12,
                border: '1px solid rgba(125,211,252,0.4)',
                background: 'rgba(125,211,252,0.12)',
                color: '#bae6fd',
                borderRadius: 10,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('dashboard.memory.viewSchema')}
            </button>
          </div>
        </div>
      </div>

      {/* Analytics Section */}
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--ink-90)', marginBottom: 16 }}>
          {t('dashboard.analytics.title')}
        </div>

        {/* Summary numbers */}
        {analyticsSummary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: t('dashboard.analytics.totalCost'), value: `$${analyticsSummary.cost_usd.toFixed(2)}`, color: '#5eead4' },
              { label: t('dashboard.analytics.totalTokens'), value: analyticsSummary.total_tokens.toLocaleString(), color: '#a78bfa' },
              { label: t('dashboard.analytics.successRate'), value: `${analyticsSummary.completion_rate}%`, color: '#22c55e' },
              { label: t('dashboard.analytics.avgDuration'), value: `${(analyticsSummary.avg_duration_ms / 1000).toFixed(1)}s`, color: '#38bdf8' },
            ].map((s) => (
              <div key={s.label} style={{
                borderRadius: 14,
                border: '1px solid var(--panel-border)',
                background: 'var(--panel-alt)',
                padding: '16px 18px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 6 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Charts row */}
        <div className="dash-grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* Cost trend line chart */}
          <div style={{
            borderRadius: 16,
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)',
            padding: 18,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 12 }}>
              {t('dashboard.analytics.costTrend')}
            </div>
            {analyticsDaily && analyticsDaily.daily_usage.length > 0 ? (
              <LineChart
                data={analyticsDaily.daily_usage.map((d) => ({ label: d.date, value: Math.round(d.cost_usd * 100) / 100 }))}
                lineColor="#5eead4"
                fillColor="rgba(94,234,212,0.10)"
              />
            ) : (
              <div style={{ color: 'var(--ink-35)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                {t('dashboard.analytics.noData')}
              </div>
            )}
          </div>

          {/* Task completion bar chart (last 7 days) */}
          <div style={{
            borderRadius: 16,
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)',
            padding: 18,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 12 }}>
              {t('dashboard.analytics.taskCompletion')}
            </div>
            {analyticsDaily && analyticsDaily.task_velocity.length > 0 ? (
              <BarChart
                data={analyticsDaily.task_velocity.slice(-7).map((d) => ({ label: d.date, value: d.completed }))}
                barColor="#22c55e"
              />
            ) : (
              <div style={{ color: 'var(--ink-35)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                {t('dashboard.analytics.noData')}
              </div>
            )}
          </div>
        </div>

        {/* Model breakdown table */}
        {analyticsModels && analyticsModels.models.length > 0 && (
          <div style={{
            borderRadius: 16,
            border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)',
            padding: 18,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 12 }}>
              {t('dashboard.analytics.modelBreakdown')}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--ink-35)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                    {t('dashboard.analytics.model')}
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--ink-35)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                    {t('dashboard.analytics.calls')}
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--ink-35)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                    {t('dashboard.analytics.tokens')}
                  </th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--ink-35)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                    {t('dashboard.analytics.cost')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {analyticsModels.models.map((m) => (
                  <tr key={m.model} style={{ borderBottom: '1px solid var(--panel-alt)' }}>
                    <td style={{ padding: '8px 10px', color: '#5eead4', fontFamily: 'monospace', fontWeight: 600 }}>{m.model}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--ink-78)' }}>{m.count}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--ink-78)' }}>{m.total_tokens.toLocaleString()}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#a78bfa', fontWeight: 700 }}>${m.cost_usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }} className="dash-grid-responsive">
        {[
          { href: '/dashboard/tasks', label: t('dashboard.quick.manageTasks'), desc: t('dashboard.quick.manageTasksDesc'), icon: '◈' },
          { href: '/dashboard/sprints', label: t('dashboard.quick.sprintBoard'), desc: t('dashboard.quick.sprintBoardDesc'), icon: '◎' },
          { href: '/dashboard/mappings', label: t('dashboard.quick.repoMappings'), desc: t('dashboard.quick.repoMappingsDesc'), icon: '⌘' },
          { href: '/dashboard/agents', label: t('dashboard.quick.aiAgents'), desc: t('dashboard.quick.aiAgentsDesc'), icon: '🤖' },
          { href: '/dashboard/flows', label: t('dashboard.quick.flowTemplates'), desc: t('dashboard.quick.flowTemplatesDesc'), icon: '◧' },
          { href: '/dashboard/integrations', label: t('dashboard.quick.integrations'), desc: t('dashboard.quick.integrationsDesc'), icon: '⬡' },
        ].map((l) => (
          <Link key={l.href} href={l.href} style={{
            borderRadius: 18, border: '1px solid var(--panel-border)',
            background: 'var(--panel-alt)', padding: '20px 22px',
            transition: 'all 0.2s', textDecoration: 'none', display: 'block',
          }}>
            <div style={{ fontSize: 22, marginBottom: 10, color: '#5eead4' }}>{l.icon}</div>
            <div style={{ fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{l.label}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>{l.desc}</div>
          </Link>
        ))}
      </div>

      {schemaOpen && (
        <div
          role='dialog'
          aria-modal='true'
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 20,
          }}
          onClick={() => setSchemaOpen(false)}
        >
          <div
            style={{
              width: 'min(760px, 100%)',
              maxHeight: '80vh',
              overflowY: 'auto',
              borderRadius: 16,
              border: '1px solid rgba(125,211,252,0.35)',
              background: 'linear-gradient(180deg, var(--surface), var(--surface))',
              padding: 18,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ color: '#bae6fd', fontWeight: 800, fontSize: 16 }}>{t('dashboard.schema.title')}</div>
              <button
                type='button'
                onClick={() => setSchemaOpen(false)}
                style={{
                  border: '1px solid var(--panel-border-3)',
                  background: 'var(--panel-border)',
                  color: 'var(--ink-90)',
                  borderRadius: 8,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                {t('dashboard.schema.close')}
              </button>
            </div>
            {schemaLoading && <div style={{ color: 'var(--ink-72)', fontSize: 13 }}>{t('dashboard.schema.loading')}</div>}
            {!schemaLoading && !schema && (
              <div style={{ color: '#fca5a5', fontSize: 13 }}>{t('dashboard.schema.loadError')}</div>
            )}
            {!schemaLoading && schema && (
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase' }}>{t('dashboard.schema.purpose')}</div>
                  <div style={{ color: 'var(--ink-90)', marginTop: 6, fontSize: 14 }}>{schema.purpose}</div>
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>{t('dashboard.schema.storedFields')}</div>
                  {Object.entries(schema.what_is_stored).map(([k, v]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 8, padding: '6px 0', borderTop: '1px solid var(--panel-alt)' }}>
                      <div style={{ color: '#5eead4', fontFamily: 'monospace', fontSize: 12 }}>{k}</div>
                      <div style={{ color: 'var(--ink-90)', fontSize: 13 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>{t('dashboard.schema.retrievalFlow')}</div>
                  {schema.retrieval_flow.map((step, idx) => (
                    <div key={`${idx}-${step}`} style={{ color: 'var(--ink-90)', fontSize: 13, padding: '4px 0' }}>
                      {idx + 1}. {step}
                    </div>
                  ))}
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>{t('dashboard.schema.constraints')}</div>
                  {schema.constraints.map((item, idx) => (
                    <div key={`${idx}-${item}`} style={{ color: 'var(--ink-90)', fontSize: 13, padding: '4px 0' }}>
                      - {item}
                    </div>
                  ))}
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase' }}>{t('dashboard.schema.privacyScope')}</div>
                  <div style={{ color: 'var(--ink-90)', marginTop: 6, fontSize: 14 }}>{schema.privacy_scope}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
