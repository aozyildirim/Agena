'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { TaskItem } from '@/components/TaskTable';

type BillingStatus = {
  plan_name: string;
  status: string;
  tasks_used: number;
  tokens_used: number;
};

export default function DashboardOverview() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<TaskItem[]>('/tasks'),
      apiFetch<BillingStatus>('/billing/status'),
    ]).then(([t, b]) => { setTasks(t); setBilling(b); }).catch(() => {});
    const iv = setInterval(() => {
      apiFetch<TaskItem[]>('/tasks').then(setTasks).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, []);

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
    { label: 'Total Tasks', value: tasks.length, color: '#5eead4', icon: '◈' },
    { label: 'Running', value: running, color: '#38bdf8', icon: '◎' },
    { label: 'Completed', value: completed, color: '#22c55e', icon: '✓' },
    { label: 'Queued', value: queued, color: '#f59e0b', icon: '⏳' },
    { label: 'Failed', value: failed, color: '#f87171', icon: '✕' },
    { label: 'Tokens Used', value: billing?.tokens_used ?? 0, color: '#a78bfa', icon: '⚡' },
  ];

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      {/* Header */}
      <div>
        <div className='section-label'>Dashboard</div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          Command Center
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          Plan: <span style={{ color: '#5eead4', fontWeight: 600 }}>{billing?.plan_name ?? '—'}</span>
          &nbsp;·&nbsp; Tasks used: <span style={{ color: '#5eead4' }}>{billing?.tasks_used ?? 0}</span>
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
            <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>Operations Radar</span>
            <Link href='/dashboard/tasks' style={{ fontSize: 12, color: '#5eead4' }}>Open tasks →</Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
            {[
              { label: 'Success Rate', value: `${successRate}%`, tone: '#22c55e' },
              { label: 'Avg Queue Wait', value: `${avgQueueWait}s`, tone: '#38bdf8' },
              { label: 'SLA Breaches', value: String(slaBreached), tone: slaBreached > 0 ? '#f87171' : '#5eead4' },
              { label: 'Repo Contention', value: String(blocked), tone: blocked > 0 ? '#f59e0b' : '#5eead4' },
            ].map((item) => (
              <div key={item.label} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.015)' }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.7 }}>{item.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: item.tone, marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, background: 'rgba(255,255,255,0.015)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: 700 }}>
              Queue Forecast
            </div>
            {activeWithEta.length === 0 ? (
              <div style={{ padding: '12px', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>No queued tasks with ETA right now.</div>
            ) : (
              activeWithEta.map((t) => (
                <Link key={t.id} href={`/tasks/${t.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', marginTop: 2 }}>#{t.queue_position ?? '—'} in queue</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#5eead4', fontWeight: 700 }}>~{Math.max(0, Math.round((t.estimated_start_sec ?? 0) / 60))}m</div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Pipeline */}
        <div style={{
          borderRadius: 20, border: '1px solid rgba(13,148,136,0.2)',
          background: 'rgba(13,148,136,0.04)', padding: 24,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.6), transparent)' }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: '#5eead4', marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' }}>Agent Pipeline</div>
          {[
            { stage: 'fetch_context', color: '#5eead4' },
            { stage: 'generate_code', color: '#a78bfa' },
            { stage: 'review_code', color: '#38bdf8' },
            { stage: 'finalize → PR', color: '#22c55e' },
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
      </div>

      {/* Quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { href: '/dashboard/tasks', label: 'Manage Tasks', desc: 'View, create, assign tasks to AI', icon: '◈' },
          { href: '/dashboard/sprints', label: 'Sprint Board', desc: 'Browse Azure sprints & import', icon: '◎' },
          { href: '/dashboard/mappings', label: 'Repo Mappings', desc: 'Connect Azure repos to local paths once', icon: '⌘' },
          { href: '/dashboard/agents', label: 'AI Agents', desc: 'Choose model/provider and assignment strategy', icon: '🤖' },
          { href: '/dashboard/flows', label: 'Flow Templates', desc: 'Run reusable automation flows by template', icon: '◧' },
          { href: '/dashboard/integrations', label: 'Integrations', desc: 'Configure Azure, Jira, GitHub', icon: '⬡' },
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
    </div>
  );
}
