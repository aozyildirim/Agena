'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, loadPrefs, type BackendRepoMapping } from '@/lib/api';
import { TaskItem, type RepoAssignment } from '@/components/TaskTable';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import RemoteRepoSelector from '@/components/RemoteRepoSelector';

const STATUS_FILTERS = ['all', 'new', 'queued', 'running', 'completed', 'failed'];
const SOURCE_FILTERS = ['all', 'internal', 'azure', 'jira'];

function statusColor(s: string) {
  const m: Record<string, string> = { new: '#94a3b8', queued: '#f59e0b', running: '#38bdf8', completed: '#22c55e', failed: '#f87171' };
  return m[s] ?? '#6b7280';
}

function fmtDuration(sec?: number | null): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function statusLabel(s: string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  return t(`tasks.status.${s}` as TranslationKey);
}

function sourceLabel(s: string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const normalized = (s || '').toLowerCase();
  const key = `tasks.source.${normalized}` as TranslationKey;
  const translated = t(key);
  return translated === key ? s : translated;
}

export default function DashboardTasksPage() {
  const { t } = useLocale();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [queueItems, setQueueItems] = useState<{
    task_id: number;
    title: string;
    status: string;
    position: number;
    create_pr: boolean;
    source: string;
    created_at: string;
  }[]>([]);
  const [filter, setFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 12;
  const [defaultCreatePr, setDefaultCreatePr] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [storyContext, setStoryContext] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [edgeCases, setEdgeCases] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [remoteRepoMeta, setRemoteRepoMeta] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [agentConfigs, setAgentConfigs] = useState<{ role: string; model: string; provider: string; enabled: boolean }[]>([]);
  const [savedFlows, setSavedFlows] = useState<{ id: string; name: string }[]>([]);
  const [aiPopupTaskId, setAiPopupTaskId] = useState<number | null>(null);
  const [flowPopupTaskId, setFlowPopupTaskId] = useState<number | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskItem | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      qs.set('status', filter);
      qs.set('source', sourceFilter);
      qs.set('q', search);
      qs.set('page', String(page));
      qs.set('page_size', String(pageSize));
      if (dateFrom) qs.set('created_from', dateFrom);
      if (dateTo) qs.set('created_to', dateTo);

      const queuePromise = apiFetch<{
        task_id: number;
        title: string;
        status: string;
        position: number;
        create_pr: boolean;
        source: string;
        created_at: string;
      }[]>('/tasks/queue');

      try {
        const [data, queueData] = await Promise.all([
          apiFetch<{ items: TaskItem[]; total: number; page: number; page_size: number }>(`/tasks/search?${qs.toString()}`),
          queuePromise,
        ]);
        setTasks(data.items);
        setTotal(data.total);
        setQueueItems(queueData);
      } catch {
        // Backward compatibility: if /tasks/search is unavailable, use legacy /tasks.
        const [legacyData, queueData] = await Promise.all([
          apiFetch<TaskItem[]>('/tasks'),
          apiFetch<{
            task_id: number;
            title: string;
            status: string;
            position: number;
            create_pr: boolean;
            source: string;
            created_at: string;
          }[]>('/tasks/queue').catch(() => []),
        ]);
        const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
        const toTs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
        const filteredLegacy = legacyData.filter((t) => {
          const matchStatus = filter === 'all' || t.status === filter;
          const matchSource = sourceFilter === 'all' || (t.source || '').toLowerCase() === sourceFilter;
          const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase());
          const created = new Date((t as TaskItem & { created_at?: string }).created_at ?? '').getTime();
          const matchFrom = fromTs === null || created >= fromTs;
          const matchTo = toTs === null || created <= toTs;
          return matchStatus && matchSource && matchSearch && matchFrom && matchTo;
        });
        const pagedLegacy = filteredLegacy.slice((page - 1) * pageSize, page * pageSize);
        setTasks(pagedLegacy);
        setTotal(filteredLegacy.length);
        setQueueItems(queueData);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.loadFailed'));
    }
  }, [dateFrom, dateTo, filter, sourceFilter, page, search, t]);

  useEffect(() => {
    loadPrefs().then((prefs) => {
      const raw = (prefs.profile_settings || {}) as Record<string, unknown>;
      if (typeof raw.default_create_pr === 'boolean') setDefaultCreatePr(raw.default_create_pr);
      let agentsRaw = prefs.agents as { role: string; model: string; custom_model?: string; provider: string; enabled: boolean }[] | undefined;
      if (!agentsRaw?.length) {
        try {
          const ls = JSON.parse(localStorage.getItem('agena_agent_configs') || '[]');
          if (Array.isArray(ls) && ls.length) agentsRaw = ls;
        } catch {}
      }
      if (agentsRaw?.length) {
        setAgentConfigs(
          agentsRaw
            .filter((a) => a.enabled !== false)
            .map((a) => ({ role: a.role, model: a.custom_model || a.model || '', provider: a.provider || '', enabled: a.enabled }))
        );
      }
      if (prefs.flows?.length) {
        setSavedFlows((prefs.flows as { id: string; name: string }[]).map((f) => ({ id: f.id, name: f.name })));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 5000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const fullDesc = remoteRepoMeta
        ? description + '\n\n---\nRemote Repo: ' + remoteRepoMeta
        : description;
      await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: fullDesc,
          story_context: storyContext || undefined,
          acceptance_criteria: acceptanceCriteria || undefined,
          edge_cases: edgeCases || undefined,
          max_tokens: maxTokens ? Number(maxTokens) : undefined,
          max_cost_usd: maxCostUsd ? Number(maxCostUsd) : undefined,
        }),
      });
      setTitle('');
      setDescription('');
      setStoryContext('');
      setAcceptanceCriteria('');
      setEdgeCases('');
      setMaxTokens('');
      setMaxCostUsd('');
      setShowCreate(false);
      setMsg(t('tasks.created')); await load();
    } catch (e) { setError(e instanceof Error ? e.message : t('tasks.createFailed')); }
  }

  function onAssignAI(id: number) {
    setAiPopupTaskId(id);
  }

  function onAssignFlow(id: number) {
    setFlowPopupTaskId(id);
  }

  async function doAssignAI(id: number, agent: { role: string; model: string; provider: string }, extraDesc?: string, repoMappingIds?: number[]) {
    setAiPopupTaskId(null);
    try {
      await apiFetch('/tasks/' + id + '/assign', {
        method: 'POST',
        body: JSON.stringify({
          create_pr: defaultCreatePr,
          mode: 'ai',
          agent_role: agent.role,
          agent_model: agent.model,
          agent_provider: agent.provider,
          extra_description: extraDesc || undefined,
          repo_mapping_ids: repoMappingIds || undefined,
        }),
      });
      setMsg(`${t('tasks.assignedAi')} (${agent.role} / ${agent.provider}:${agent.model})`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : t('tasks.assignFailed')); }
  }

  async function doAssignFlow(id: number, flowId: string, flowName: string, extraDesc?: string, repoMappingIds?: number[]) {
    setFlowPopupTaskId(null);
    try {
      await apiFetch('/tasks/' + id + '/assign', { method: 'POST', body: JSON.stringify({ create_pr: defaultCreatePr, mode: 'flow', extra_description: extraDesc || undefined, repo_mapping_ids: repoMappingIds || undefined }) });
      setMsg(`${t('tasks.assignedFlow')} (${flowName})`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : t('tasks.assignFailed')); }
  }

  async function onRemoveFromQueue(id: number) {
    try {
      await apiFetch('/tasks/' + id + '/cancel', { method: 'POST' });
      setMsg(t('tasks.removedFromQueue'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.removeFailed'));
    }
  }

  async function onDeleteTask(id: number) {
    try {
      await apiFetch('/tasks/' + id, { method: 'DELETE' });
      setMsg(t('tasks.deleted'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.deleteFailed'));
    }
  }

  const currentPage = Math.min(page, totalPages);

  function applyRange(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
    setPage(1);
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className='section-label'>{t('nav.tasks')}</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
            {t('tasks.title')}
          </h1>
          <p style={{ color: 'var(--ink-35)', fontSize: 14 }}>{t('tasks.total', { n: total.toLocaleString() })}</p>
        </div>
        <button
          className='button button-primary'
          onClick={() => setShowCreate(!showCreate)}
          style={{ alignSelf: 'flex-start' }}
        >
          + {t('tasks.new')}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{
          borderRadius: 20, border: '1px solid rgba(13,148,136,0.3)',
          background: 'rgba(13,148,136,0.06)', padding: 24,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.6), transparent)' }} />
          <h3 style={{ color: 'var(--ink-90)', marginTop: 0, marginBottom: 16 }}>{t('tasks.createTitle')}</h3>
          <form onSubmit={onCreate} style={{ display: 'grid', gap: 12 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.titlePlaceholder')} required />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('tasks.descriptionPlaceholder')} rows={3} required />
            <textarea
              value={storyContext}
              onChange={(e) => setStoryContext(e.target.value)}
              placeholder={t('tasks.storyContextPlaceholder')}
              rows={2}
            />
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder={t('tasks.acceptancePlaceholder')}
              rows={2}
            />
            <textarea
              value={edgeCases}
              onChange={(e) => setEdgeCases(e.target.value)}
              placeholder={t('tasks.edgeCasesPlaceholder')}
              rows={2}
            />
            {/* Remote Repo Selector */}
            <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '10px 12px', background: 'var(--panel)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Target Repo</div>
              <RemoteRepoSelector compact onChange={(sel) => setRemoteRepoMeta(sel?.meta || '')} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input
                type='number'
                min='1'
                step='1'
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder={t('tasks.maxTokensPlaceholder')}
              />
              <input
                type='number'
                min='0'
                step='0.0001'
                value={maxCostUsd}
                onChange={(e) => setMaxCostUsd(e.target.value)}
                placeholder={t('tasks.maxCostPlaceholder')}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type='submit' className='button button-primary'>{t('tasks.create')}</button>
              <button type='button' className='button button-outline' onClick={() => setShowCreate(false)}>{t('tasks.cancel')}</button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 10, background: 'var(--panel)' }}>
        <input
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
          placeholder={t('tasks.searchPlaceholder')}
          style={{ width: 220, padding: '8px 14px', fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setFilter(s); setPage(1); }}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                border: filter === s ? `1px solid ${s === 'all' ? '#5eead4' : statusColor(s)}` : '1px solid var(--panel-border-2)',
                background: filter === s ? (s === 'all' ? 'rgba(94,234,212,0.12)' : `${statusColor(s)}18`) : 'transparent',
                color: filter === s ? (s === 'all' ? '#5eead4' : statusColor(s)) : 'var(--ink-42)',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {statusLabel(s, t)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SOURCE_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setSourceFilter(s); setPage(1); }}
              style={{
                padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                border: sourceFilter === s ? '1px solid rgba(129,140,248,0.5)' : '1px solid var(--panel-border-2)',
                background: sourceFilter === s ? 'rgba(129,140,248,0.16)' : 'transparent',
                color: sourceFilter === s ? '#c4b5fd' : 'var(--ink-45)',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t(`tasks.source.${s}` as TranslationKey)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30].map((d) => (
            <button
              key={d}
              className='button button-outline'
              onClick={() => applyRange(d)}
              style={{ padding: '5px 8px', fontSize: 11 }}
            >
              {t('tasks.lastDays', { d })}
            </button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 10, border: '1px solid var(--panel-border-2)' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-45)' }}>{t('tasks.from')}</span>
        <input
          type='date'
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            style={{ padding: '4px 6px', fontSize: 11, minWidth: 130 }}
        />
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 10, border: '1px solid var(--panel-border-2)' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-45)' }}>{t('tasks.to')}</span>
        <input
          type='date'
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            style={{ padding: '4px 6px', fontSize: 11, minWidth: 130 }}
        />
        </div>
        <button
          className='button button-outline'
          onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); setFilter('all'); setSourceFilter('all'); setPage(1); }}
          style={{ padding: '6px 10px', fontSize: 11 }}
        >
          {t('tasks.reset')}
        </button>
      </div>

      {/* Notification */}
      {(msg || error) && (
        <div style={{
          padding: '12px 16px', borderRadius: 12, fontSize: 13,
          background: error ? 'rgba(248,113,113,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${error ? 'rgba(248,113,113,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: error ? '#f87171' : '#22c55e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {error || msg}
          <button onClick={() => { setError(''); setMsg(''); }} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      {/* Queue panel */}
      <div style={{ borderRadius: 16, border: '1px solid rgba(245,158,11,0.28)', background: 'rgba(245,158,11,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(245,158,11,0.22)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#f59e0b' }}>
            {t('tasks.col.queue')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-58)' }}>{t('tasks.waiting', { n: queueItems.length })}</div>
        </div>
        {queueItems.length === 0 ? (
          <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--ink-42)' }}>{t('tasks.noQueued')}</div>
        ) : (
          queueItems.map((q) => (
            <div key={q.task_id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto auto', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 800 }}>#{q.position}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-90)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>
                  {t('tasks.taskWithId', { id: q.task_id })} • {sourceLabel(q.source, t)}
                </div>
              </div>
              <Link href={`/tasks/${q.task_id}`} className='button button-outline' style={{ padding: '5px 9px', fontSize: 12, whiteSpace: 'nowrap' }}>
                {t('tasks.open')}
              </Link>
              <button className='button button-outline' onClick={() => void onRemoveFromQueue(q.task_id)} style={{ padding: '5px 9px', fontSize: 12, whiteSpace: 'nowrap', borderColor: 'rgba(248,113,113,0.35)', color: '#f87171', minHeight: 30 }}>
                {t('tasks.remove')}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Task list */}
      <div style={{ borderRadius: 20, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflowX: 'auto' }}>
        <div style={{ minWidth: 1040 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) 80px 98px 88px 88px 70px 92px 78px minmax(180px,0.85fr)', gap: 10 }}>
          {[t('tasks.col.task'), t('tasks.col.source'), t('tasks.col.status'), t('tasks.col.run'), t('tasks.col.queue'), t('tasks.col.retry'), t('tasks.col.tokens'), t('tasks.col.pr'), t('tasks.col.actions')].map((h) => (
            <span key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-25)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</span>
          ))}
        </div>

        {tasks.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--ink-25)', fontSize: 14 }}>
            {t('tasks.empty')}
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={task.status === 'running' ? 'task-row-running' : ''} style={{
              padding: '14px 20px', borderBottom: '1px solid var(--panel-border)',
              display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) 80px 98px 88px 88px 70px 92px 78px minmax(180px,0.85fr)', gap: 10, alignItems: 'center',
              transition: 'background 0.2s',
              borderLeft: task.status === 'running' ? '3px solid #38bdf8' : '3px solid transparent',
              background: task.status === 'running' ? 'rgba(56,189,248,0.04)' : undefined,
              animation: task.status === 'running' ? 'running-glow 2s ease-in-out infinite' : undefined,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink-78)', fontSize: 14, marginBottom: 2 }}>{task.title}</div>
                <div style={{
                  fontSize: 12,
                  color: 'var(--ink-30)',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: 1.35,
                  maxHeight: 32,
                }}>{task.description}</div>
              </div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: 'var(--glass)', color: 'var(--ink-50)',
                textTransform: 'capitalize', width: 'fit-content',
              }}>{sourceLabel(task.source, t)}</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                background: `${statusColor(task.status)}18`,
                border: `1px solid ${statusColor(task.status)}40`,
                color: statusColor(task.status), width: 'fit-content', textTransform: 'capitalize',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor(task.status), animation: task.status === 'running' ? 'pulse-brand 1.5s infinite' : 'none' }} />
                {statusLabel(task.status, t)}
              </span>
              <div>
                <span style={{ fontSize: 12, color: 'var(--ink-65)', fontWeight: 600 }}>{fmtDuration(task.run_duration_sec ?? task.duration_sec)}</span>
              </div>
              <div>
                <span style={{ fontSize: 12, color: 'var(--ink-65)', fontWeight: 600 }}>{fmtDuration(task.queue_wait_sec)}</span>
              </div>
              <div>
                <span style={{ fontSize: 12, color: 'var(--ink-65)', fontWeight: 600 }}>{task.retry_count ?? 0}</span>
              </div>
              <div>
                <span style={{ fontSize: 12, color: 'var(--ink-65)', fontWeight: 600 }}>
                  {task.total_tokens !== null && task.total_tokens !== undefined ? task.total_tokens.toLocaleString() : '—'}
                </span>
              </div>
              <div>
                {task.repo_assignments && task.repo_assignments.length > 0 ? (
                  task.repo_assignments.length === 1 ? (
                    task.repo_assignments[0].pr_url ? (
                      <a href={task.repo_assignments[0].pr_url} target='_blank' rel='noreferrer' style={{ fontSize: 12, color: '#5eead4', textDecoration: 'none' }}>{t('tasks.viewPr')} ↗</a>
                    ) : (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `${statusColor(task.repo_assignments[0].status)}18`, color: statusColor(task.repo_assignments[0].status), fontWeight: 600 }}>
                        {statusLabel(task.repo_assignments[0].status, t)}
                      </span>
                    )
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#5eead4' }}>
                        {t('tasks.multiPrCount', { n: task.repo_assignments.filter((ra: RepoAssignment) => ra.pr_url).length, total: task.repo_assignments.length })}
                      </span>
                      {task.repo_assignments.slice(0, 2).map((ra: RepoAssignment) => (
                        <span key={ra.id} style={{ fontSize: 10, color: ra.pr_url ? '#5eead4' : 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
                          {ra.pr_url ? (
                            <a href={ra.pr_url} target='_blank' rel='noreferrer' style={{ color: '#5eead4', textDecoration: 'none' }}>↗ {ra.repo_display_name.split('/').pop()}</a>
                          ) : ra.repo_display_name.split('/').pop()}
                        </span>
                      ))}
                    </div>
                  )
                ) : task.pr_url ? (
                  <a href={task.pr_url} target='_blank' rel='noreferrer' style={{ fontSize: 12, color: '#5eead4', textDecoration: 'none' }}>{t('tasks.viewPr')} ↗</a>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink-25)' }}>—</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  className='button button-primary'
                  disabled={task.status === 'queued' || task.status === 'running'}
                  onClick={() => void onAssignAI(task.id)}
                  style={{ padding: '6px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 30, opacity: task.status === 'queued' || task.status === 'running' ? 0.6 : 1, cursor: task.status === 'queued' || task.status === 'running' ? 'not-allowed' : 'pointer' }}
                >
                  {task.status === 'queued' || task.status === 'running' ? statusLabel(task.status, t) : t('tasks.assignAi')}
                </button>
                <button
                  className='button button-outline'
                  disabled={task.status === 'queued' || task.status === 'running'}
                  onClick={() => void onAssignFlow(task.id)}
                  style={{ padding: '6px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 30, opacity: task.status === 'queued' || task.status === 'running' ? 0.6 : 1, cursor: task.status === 'queued' || task.status === 'running' ? 'not-allowed' : 'pointer', background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', border: 'none', color: '#fff' }}
                >
                  {t('tasks.assignFlow')}
                </button>
                <Link href={`/tasks/${task.id}`} className='button button-outline' style={{ padding: '6px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 30 }}>
                  {t('tasks.details')}
                </Link>
                {task.status !== 'running' && (
                  <button onClick={() => setDeleteConfirmTask(task)}
                    style={{ padding: '6px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 30, borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        </div>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>
          {t('tasks.showing', { from: (currentPage - 1) * pageSize + (tasks.length > 0 ? 1 : 0), to: (currentPage - 1) * pageSize + tasks.length, total })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className='button button-outline'
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            style={{ padding: '6px 10px', fontSize: 12, opacity: currentPage <= 1 ? 0.5 : 1 }}
          >
            {t('tasks.prev')}
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-58)' }}>{t('tasks.page')} {currentPage} / {totalPages}</span>
          <button
            className='button button-outline'
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            style={{ padding: '6px 10px', fontSize: 12, opacity: currentPage >= totalPages ? 0.5 : 1 }}
          >
            {t('tasks.next')}
          </button>
        </div>
      </div>
      {/* AI Agent Select Popup — with repo config */}
      {aiPopupTaskId !== null && (
        <AssignPopup
          taskId={aiPopupTaskId}
          mode='ai'
          tasks={tasks}
          agents={agentConfigs}
          flows={savedFlows}
          onAssignAI={(id, agent, repoMeta, repoMappingIds) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignAI(id, agent, extra, repoMappingIds);
          }}
          onAssignFlow={(id, flowId, flowName, repoMeta, repoMappingIds) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignFlow(id, flowId, flowName, extra, repoMappingIds);
          }}
          onClose={() => setAiPopupTaskId(null)}
          t={t}
        />
      )}
      {/* Flow Select Popup — with repo config */}
      {flowPopupTaskId !== null && (
        <AssignPopup
          taskId={flowPopupTaskId}
          mode='flow'
          tasks={tasks}
          agents={agentConfigs}
          flows={savedFlows}
          onAssignAI={(id, agent, repoMeta, repoMappingIds) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignAI(id, agent, extra, repoMappingIds);
          }}
          onAssignFlow={(id, flowId, flowName, repoMeta, repoMappingIds) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignFlow(id, flowId, flowName, extra, repoMappingIds);
          }}
          onClose={() => setFlowPopupTaskId(null)}
          t={t}
        />
      )}
      {/* Delete confirmation modal */}
      {deleteConfirmTask && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setDeleteConfirmTask(null)}>
          <div style={{ width: 'min(400px, 100%)', borderRadius: 20, border: '1px solid rgba(239,68,68,0.25)', background: 'var(--surface)', padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 16px' }}>🗑</div>
            <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 8 }}>{t('tasks.deleteConfirm')}</div>
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-35)', lineHeight: 1.5, marginBottom: 20 }}>
              <strong style={{ color: 'var(--ink-78)' }}>{deleteConfirmTask.title}</strong>
              {' '}{t('tasks.deleteDesc')}
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)', marginBottom: 20, fontSize: 12, color: 'var(--ink-50)' }}>
              #{deleteConfirmTask.id} · {statusLabel(deleteConfirmTask.status, t)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteConfirmTask(null)}
                style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                {t('tasks.cancelAction')}
              </button>
              <button onClick={() => { void onDeleteTask(deleteConfirmTask.id); setDeleteConfirmTask(null); }}
                style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', color: '#fff' }}>
                {t('tasks.deleteAction')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignPopup({ taskId, mode, tasks, agents, flows, onAssignAI, onAssignFlow, onClose, t }: {
  taskId: number;
  mode: 'ai' | 'flow';
  tasks: TaskItem[];
  agents: { role: string; model: string; provider: string; enabled: boolean }[];
  flows: { id: string; name: string }[];
  onAssignAI: (id: number, agent: { role: string; model: string; provider: string }, repoMeta?: string, repoMappingIds?: number[]) => void;
  onAssignFlow: (id: number, flowId: string, flowName: string, repoMeta?: string, repoMappingIds?: number[]) => void;
  onClose: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [repoSel, setRepoSel] = useState<{ meta: string } | null>(null);
  const [backendMappings, setBackendMappings] = useState<BackendRepoMapping[]>([]);
  const [selectedMappingIds, setSelectedMappingIds] = useState<number[]>([]);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const task = tasks.find((tk) => tk.id === taskId);
  const taskDesc = ((task as unknown as { description?: string })?.description || '').toLowerCase();
  const hasRepo = taskDesc.includes('local repo path') || taskDesc.includes('remote repo');

  useEffect(() => {
    apiFetch<BackendRepoMapping[]>('/repo-mappings')
      .then((data) => { setBackendMappings(data); setMappingsLoaded(true); })
      .catch(() => setMappingsLoaded(true));
  }, []);

  function toggleMapping(id: number) {
    setSelectedMappingIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const mappingIds = selectedMappingIds.length > 0 ? selectedMappingIds : undefined;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, minWidth: 360, maxWidth: 480, overflow: 'hidden' }}>
        <div style={{ height: 3, background: mode === 'ai' ? 'linear-gradient(90deg, #0d9488, #22c55e)' : 'linear-gradient(90deg, #7c3aed, #a78bfa)' }} />
        <div style={{ padding: '18px 22px', display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
            {mode === 'ai' ? t('tasks.selectAgent') : t('tasks.assignFlow')}
          </h3>

          {/* Multi-repo selector from backend mappings */}
          {mappingsLoaded && backendMappings.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>{t('tasks.multiRepo.title' as TranslationKey)}</div>
              <div style={{ maxHeight: 160, overflowY: 'auto', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: '4px 0' }}>
                {backendMappings.map((m) => (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ink-78)', transition: 'background 0.15s', background: selectedMappingIds.includes(m.id) ? 'rgba(94,234,212,0.08)' : 'transparent' }}>
                    <input
                      type='checkbox'
                      checked={selectedMappingIds.includes(m.id)}
                      onChange={() => toggleMapping(m.id)}
                      style={{ accentColor: '#0d9488', width: 14, height: 14 }}
                    />
                    <span style={{ fontWeight: 600 }}>{m.display_name || `${m.provider}:${m.owner}/${m.repo_name}`}</span>
                  </label>
                ))}
              </div>
              {selectedMappingIds.length > 0 && (
                <div style={{ fontSize: 11, color: '#5eead4', marginTop: 4 }}>
                  {t('tasks.multiRepo.selected' as TranslationKey, { n: selectedMappingIds.length })}
                </div>
              )}
            </div>
          )}

          {/* Repo selector — only if task has no repo config and no backend mappings selected */}
          {!hasRepo && selectedMappingIds.length === 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Target Repository</div>
              <RemoteRepoSelector compact onChange={(sel) => setRepoSel(sel ? { meta: sel.meta } : null)} />
            </div>
          )}
          {hasRepo && selectedMappingIds.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--ink-35)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
              {t('tasks.multiRepo.configured' as TranslationKey)}
            </div>
          )}

          {/* Agent / Flow selection */}
          {mode === 'ai' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>{t('tasks.selectAgent')}</div>
              {agents.filter((a) => a.enabled).map((agent) => {
                const canAssign = hasRepo || repoSel || selectedMappingIds.length > 0;
                return (
                <button key={agent.role}
                  onClick={() => onAssignAI(taskId, agent, !hasRepo && selectedMappingIds.length === 0 ? repoSel?.meta : undefined, mappingIds)}
                  disabled={!canAssign}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--panel)', cursor: !canAssign ? 'not-allowed' : 'pointer', textAlign: 'left', width: '100%', opacity: !canAssign ? 0.5 : 1 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', textTransform: 'capitalize' }}>{agent.role}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{agent.model || 'default'} {agent.provider ? `· ${agent.provider}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 16, color: 'var(--muted)' }}>→</span>
                </button>
                );
              })}
            </div>
          )}
          {mode === 'flow' && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>{t('tasks.assignFlow')}</div>
              {flows.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: 10 }}>{t('tasks.noSavedFlows')}</div>
              ) : flows.map((flow) => {
                const canAssignFlow = hasRepo || repoSel || selectedMappingIds.length > 0;
                return (
                <button key={flow.id}
                  onClick={() => onAssignFlow(taskId, flow.id, flow.name, !hasRepo && selectedMappingIds.length === 0 ? repoSel?.meta : undefined, mappingIds)}
                  disabled={!canAssignFlow}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.06)', cursor: !canAssignFlow ? 'not-allowed' : 'pointer', textAlign: 'left', width: '100%', opacity: !canAssignFlow ? 0.5 : 1 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{flow.name}</div>
                  </div>
                  <span style={{ fontSize: 16, color: '#a78bfa' }}>▶</span>
                </button>
                );
              })}
            </div>
          )}

          <button onClick={onClose} className='button button-outline' style={{ fontSize: 12, justifyContent: 'center' }}>{t('tasks.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
