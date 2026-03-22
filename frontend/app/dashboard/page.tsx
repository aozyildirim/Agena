'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { TaskItem } from '@/components/TaskTable';
import { useLocale } from '@/lib/i18n';

type BillingStatus = {
  plan_name: string;
  status: string;
  tasks_used: number;
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

export default function DashboardOverview() {
  const { t } = useLocale();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [memory, setMemory] = useState<MemoryStatus | null>(null);
  const [schema, setSchema] = useState<MemorySchema | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch<TaskItem[]>('/tasks'),
      apiFetch<BillingStatus>('/billing/status'),
      apiFetch<MemoryStatus>('/memory/status'),
    ]).then(([t, b, m]) => {
      setTasks(t);
      setBilling(b);
      setMemory(m);
    }).catch(() => {});
    const iv = setInterval(() => {
      apiFetch<TaskItem[]>('/tasks').then(setTasks).catch(() => {});
      apiFetch<MemoryStatus>('/memory/status').then(setMemory).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, []);

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
        <h1 style={{ fontSize: 32, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          {t('dashboard.title')}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          {t('dashboard.plan')}: <span style={{ color: '#5eead4', fontWeight: 600 }}>{billing?.plan_name ?? '—'}</span>
          &nbsp;·&nbsp; {t('dashboard.tasksUsed')}: <span style={{ color: '#5eead4' }}>{billing?.tasks_used ?? 0}</span>
        </p>
      </div>

      {/* KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{
            borderRadius: 18,
            border: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.03)',
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
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Operations Radar + Pipeline */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr', gap: 20 }}>
        {/* Operations Radar */}
        <div style={{
          borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.03)', overflow: 'hidden', padding: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{t('dashboard.operationsRadar')}</span>
            <Link href='/dashboard/tasks' style={{ fontSize: 12, color: '#5eead4' }}>{t('dashboard.openTasks')} →</Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: t('dashboard.successRate'), value: `${successRate}%`, tone: '#22c55e' },
              { label: t('dashboard.avgQueueWait'), value: `${avgQueueWait}${t('dashboard.unit.sec')}`, tone: '#38bdf8' },
              { label: t('dashboard.slaBreaches'), value: String(slaBreached), tone: slaBreached > 0 ? '#f87171' : '#5eead4' },
              { label: t('dashboard.repoContention'), value: String(blocked), tone: blocked > 0 ? '#f59e0b' : '#5eead4' },
            ].map((item) => (
              <div key={item.label} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.015)' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.7 }}>{item.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: item.tone, marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: 700 }}>
              {t('dashboard.queueForecast')}
            </div>
            {activeWithEta.length === 0 ? (
              <div style={{ padding: '12px', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{t('dashboard.noQueuedEta')}</div>
            ) : (
              activeWithEta.map((task) => (
                <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', marginTop: 2 }}>#{task.queue_position ?? '—'} {t('dashboard.inQueue')}</div>
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
                  {i < 3 && <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />}
                </div>
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace', paddingBottom: i < 3 ? 20 : 0 }}>{s.stage}</span>
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
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                {t('dashboard.memory.backend')}: <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{memory?.backend ?? 'qdrant'}</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                {t('dashboard.memory.collection')}: <span style={{ color: 'rgba(255,255,255,0.92)' }}>{memory?.collection ?? '—'}</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                {t('dashboard.memory.points')}: <span style={{ color: '#5eead4', fontWeight: 700 }}>{memory?.points_count ?? 0}</span>
                &nbsp;·&nbsp; {t('dashboard.memory.mode')}: <span style={{ color: 'rgba(255,255,255,0.92)' }}>{memory?.embedding_mode ?? 'deterministic'}</span>
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

      {/* Quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { href: '/dashboard/tasks', label: t('dashboard.quick.manageTasks'), desc: t('dashboard.quick.manageTasksDesc'), icon: '◈' },
          { href: '/dashboard/sprints', label: t('dashboard.quick.sprintBoard'), desc: t('dashboard.quick.sprintBoardDesc'), icon: '◎' },
          { href: '/dashboard/mappings', label: t('dashboard.quick.repoMappings'), desc: t('dashboard.quick.repoMappingsDesc'), icon: '⌘' },
          { href: '/dashboard/agents', label: t('dashboard.quick.aiAgents'), desc: t('dashboard.quick.aiAgentsDesc'), icon: '🤖' },
          { href: '/dashboard/flows', label: t('dashboard.quick.flowTemplates'), desc: t('dashboard.quick.flowTemplatesDesc'), icon: '◧' },
          { href: '/dashboard/integrations', label: t('dashboard.quick.integrations'), desc: t('dashboard.quick.integrationsDesc'), icon: '⬡' },
        ].map((l) => (
          <Link key={l.href} href={l.href} style={{
            borderRadius: 18, border: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.03)', padding: '20px 22px',
            transition: 'all 0.2s', textDecoration: 'none', display: 'block',
          }}>
            <div style={{ fontSize: 22, marginBottom: 10, color: '#5eead4' }}>{l.icon}</div>
            <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>{l.label}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>{l.desc}</div>
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
            background: 'rgba(2,6,23,0.78)',
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
              background: 'linear-gradient(180deg, rgba(15,23,42,0.96), rgba(2,6,23,0.96))',
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
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: 'rgba(255,255,255,0.9)',
                  borderRadius: 8,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                {t('dashboard.schema.close')}
              </button>
            </div>
            {schemaLoading && <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{t('dashboard.schema.loading')}</div>}
            {!schemaLoading && !schema && (
              <div style={{ color: '#fca5a5', fontSize: 13 }}>{t('dashboard.schema.loadError')}</div>
            )}
            {!schemaLoading && schema && (
              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase' }}>{t('dashboard.schema.purpose')}</div>
                  <div style={{ color: 'rgba(255,255,255,0.88)', marginTop: 6, fontSize: 14 }}>{schema.purpose}</div>
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>{t('dashboard.schema.storedFields')}</div>
                  {Object.entries(schema.what_is_stored).map(([k, v]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ color: '#5eead4', fontFamily: 'monospace', fontSize: 12 }}>{k}</div>
                      <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13 }}>{v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>{t('dashboard.schema.retrievalFlow')}</div>
                  {schema.retrieval_flow.map((step, idx) => (
                    <div key={`${idx}-${step}`} style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, padding: '4px 0' }}>
                      {idx + 1}. {step}
                    </div>
                  ))}
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }}>{t('dashboard.schema.constraints')}</div>
                  {schema.constraints.map((item, idx) => (
                    <div key={`${idx}-${item}`} style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, padding: '4px 0' }}>
                      - {item}
                    </div>
                  ))}
                </div>

                <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12 }}>
                  <div style={{ color: '#7dd3fc', fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase' }}>{t('dashboard.schema.privacyScope')}</div>
                  <div style={{ color: 'rgba(255,255,255,0.88)', marginTop: 6, fontSize: 14 }}>{schema.privacy_scope}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
