'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, loadPrefs, type BackendRepoMapping, type RepoMapping } from '@/lib/api';
import { TaskItem, type RepoAssignment } from '@/components/TaskTable';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import RemoteRepoSelector from '@/components/RemoteRepoSelector';

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

const STATUS_FILTERS = ['all', 'new', 'queued', 'running', 'completed', 'failed'];
const SOURCE_FILTERS = ['all', 'internal', 'azure', 'jira', 'newrelic'];

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
  const router = useRouter();
  const mob = useIsMobile();
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
  const [conflictModal, setConflictModal] = useState<{ id: number; info: string; body: Record<string, unknown> } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [storyContext, setStoryContext] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [edgeCases, setEdgeCases] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [remoteRepoMeta, setRemoteRepoMeta] = useState('');
  const [showDepsSection, setShowDepsSection] = useState(false);
  const [depSearchQuery, setDepSearchQuery] = useState('');
  const [selectedDepIds, setSelectedDepIds] = useState<number[]>([]);
  const [depCandidates, setDepCandidates] = useState<{ id: number; title: string; status: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [agentConfigs, setAgentConfigs] = useState<{ role: string; model: string; provider: string; enabled: boolean }[]>([]);
  const [savedFlows, setSavedFlows] = useState<{ id: string; name: string }[]>([]);
  const [aiPopupTaskId, setAiPopupTaskId] = useState<number | null>(null);
  const [flowPopupTaskId, setFlowPopupTaskId] = useState<number | null>(null);
  const [mcpPopupTaskId, setMcpPopupTaskId] = useState<number | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskItem | null>(null);
  const [editTask, setEditTask] = useState<TaskItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [createMappings, setCreateMappings] = useState<BackendRepoMapping[]>([]);
  const [createMappingsLoaded, setCreateMappingsLoaded] = useState(false);
  const [selectedRepoMappingIds, setSelectedRepoMappingIds] = useState<number[]>([]);

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

  useEffect(() => {
    if (showCreate && !createMappingsLoaded) {
      apiFetch<BackendRepoMapping[]>('/repo-mappings')
        .then((data) => { setCreateMappings(data); setCreateMappingsLoaded(true); })
        .catch(() => setCreateMappingsLoaded(true));
    }
  }, [showCreate, createMappingsLoaded]);

  async function loadDepCandidates() {
    try {
      const data = await apiFetch<{ items: { id: number; title: string; status: string }[] }>('/tasks/search?page=1&page_size=50');
      setDepCandidates(data.items || []);
    } catch {
      try {
        const data = await apiFetch<{ id: number; title: string; status: string }[]>('/tasks');
        setDepCandidates(data || []);
      } catch { /* ignore */ }
    }
  }

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
          depends_on_task_ids: selectedDepIds.length > 0 ? selectedDepIds : undefined,
          repo_mapping_ids: selectedRepoMappingIds.length > 0 ? selectedRepoMappingIds : undefined,
        }),
      });
      setTitle('');
      setDescription('');
      setStoryContext('');
      setAcceptanceCriteria('');
      setEdgeCases('');
      setMaxTokens('');
      setMaxCostUsd('');
      setSelectedDepIds([]);
      setSelectedRepoMappingIds([]);
      setShowDepsSection(false);
      setDepSearchQuery('');
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

  function onAssignMCP(id: number) {
    setMcpPopupTaskId(id);
  }

  async function _assignWithConflictRetry(id: number, body: Record<string, unknown>) {
    try {
      await apiFetch('/tasks/' + id + '/assign', { method: 'POST', body: JSON.stringify(body) });
      router.push(`/tasks/${id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('REPO_CONFLICT:')) {
        setAiPopupTaskId(null);
        setFlowPopupTaskId(null);
        setMcpPopupTaskId(null);
        setConflictModal({ id, info: msg.replace('REPO_CONFLICT:', '').trim(), body });
      } else {
        setError(msg || t('tasks.assignFailed'));
      }
    }
  }

  async function _forceQueueConflict() {
    if (!conflictModal) return;
    const { id, body } = conflictModal;
    setConflictModal(null);
    try {
      await apiFetch('/tasks/' + id + '/assign', { method: 'POST', body: JSON.stringify({ ...body, force_queue: true }) });
      router.push(`/tasks/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.assignFailed'));
    }
  }

  async function doAssignMCP(id: number, repoMeta?: string, repoMappingIds?: number[], mcpModel?: string, mcpProvider?: string, createPr?: boolean) {
    setMcpPopupTaskId(null);
    await _assignWithConflictRetry(id, {
      create_pr: createPr ?? defaultCreatePr,
      mode: 'mcp_agent',
      extra_description: repoMeta || undefined,
      repo_mapping_ids: repoMappingIds || undefined,
      agent_model: mcpModel || undefined,
      agent_provider: mcpProvider || undefined,
    });
  }

  async function doAssignAI(id: number, agent: { role: string; model: string; provider: string }, extraDesc?: string, repoMappingIds?: number[], createPr?: boolean) {
    setAiPopupTaskId(null);
    await _assignWithConflictRetry(id, {
      create_pr: createPr ?? defaultCreatePr,
      mode: 'ai',
      agent_role: agent.role,
      agent_model: agent.model,
      agent_provider: agent.provider,
      extra_description: extraDesc || undefined,
      repo_mapping_ids: repoMappingIds || undefined,
    });
  }

  async function doAssignFlow(id: number, flowId: string, flowName: string, extraDesc?: string, repoMappingIds?: number[], createPr?: boolean) {
    setFlowPopupTaskId(null);
    await _assignWithConflictRetry(id, {
      create_pr: createPr ?? defaultCreatePr,
      mode: 'flow',
      flow_id: flowId,
      extra_description: extraDesc || undefined,
      repo_mapping_ids: repoMappingIds || undefined,
    });
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

  function openEditTask(task: TaskItem) {
    setEditTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
  }

  async function saveEditTask() {
    if (!editTask) return;
    try {
      await apiFetch('/tasks/' + editTask.id, {
        method: 'PUT',
        body: JSON.stringify({ title: editTitle, description: editDesc }),
      });
      setEditTask(null);
      setMsg('Task updated');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: mob ? 10 : 16 }}>
        <div>
          <div className='section-label'>{t('nav.tasks')}</div>
          <h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
            {t('tasks.title')}
          </h1>
          <p style={{ color: 'var(--ink-35)', fontSize: mob ? 12 : 14 }}>{t('tasks.total', { n: total.toLocaleString() })}</p>
        </div>
        <button
          className='button button-primary'
          onClick={() => setShowCreate(!showCreate)}
          style={{ alignSelf: 'flex-start', fontSize: mob ? 13 : undefined }}
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
            {/* Target Repo Selector */}
            <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '10px 12px', background: 'var(--panel)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>{t('tasks.multiRepo.title' as TranslationKey)}</div>
              {createMappingsLoaded && createMappings.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ maxHeight: 160, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: '4px 0' }}>
                    {createMappings.map((m) => (
                      <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ink-78)', background: selectedRepoMappingIds.includes(m.id) ? 'rgba(94,234,212,0.08)' : 'transparent' }}>
                        <input
                          type='checkbox'
                          checked={selectedRepoMappingIds.includes(m.id)}
                          onChange={() => setSelectedRepoMappingIds((prev) => prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id])}
                          style={{ accentColor: '#0d9488', width: 14, height: 14 }}
                        />
                        <span style={{ fontWeight: 600 }}>{m.display_name || `${m.provider}:${m.owner}/${m.repo_name}`}</span>
                      </label>
                    ))}
                  </div>
                  {selectedRepoMappingIds.length > 0 && (
                    <div style={{ fontSize: 11, color: '#5eead4', marginTop: 4 }}>
                      {t('tasks.multiRepo.selected' as TranslationKey, { n: selectedRepoMappingIds.length })}
                    </div>
                  )}
                </div>
              )}
              <RemoteRepoSelector compact onChange={(sel) => setRemoteRepoMeta(sel?.meta || '')} />
            </div>

            {/* Dependencies section */}
            <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden' }}>
              <button
                type='button'
                onClick={() => { setShowDepsSection(!showDepsSection); if (!showDepsSection) void loadDepCandidates(); }}
                style={{
                  width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-72)',
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>
                  {t('tasks.deps.title' as TranslationKey)} {selectedDepIds.length > 0 ? `(${selectedDepIds.length})` : ''}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-35)', transform: showDepsSection ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
              </button>
              {showDepsSection && (
                <div style={{ padding: '0 12px 12px' }}>
                  <input
                    value={depSearchQuery}
                    onChange={(e) => setDepSearchQuery(e.target.value)}
                    placeholder={t('tasks.deps.searchPlaceholder' as TranslationKey)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: 12, marginBottom: 8, borderRadius: 8 }}
                  />
                  <div style={{ maxHeight: 160, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: '4px 6px', display: 'grid', gap: 2 }}>
                    {depCandidates
                      .filter((c) => !depSearchQuery || c.title.toLowerCase().includes(depSearchQuery.toLowerCase()) || String(c.id).includes(depSearchQuery))
                      .map((c) => (
                        <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: '4px 4px', borderRadius: 6, background: selectedDepIds.includes(c.id) ? 'rgba(94,234,212,0.08)' : 'transparent' }}>
                          <input
                            type='checkbox'
                            checked={selectedDepIds.includes(c.id)}
                            onChange={(e) => {
                              setSelectedDepIds((prev) => e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id));
                            }}
                            style={{ accentColor: '#0d9488', width: 14, height: 14, flexShrink: 0 }}
                          />
                          <span style={{ fontSize: 12, color: selectedDepIds.includes(c.id) ? 'var(--ink-90)' : 'var(--ink-65)' }}>
                            #{c.id} {c.title}{' '}
                            <span style={{ color: statusColor(c.status), fontSize: 11 }}>({c.status})</span>
                          </span>
                        </label>
                      ))}
                    {depCandidates.filter((c) => !depSearchQuery || c.title.toLowerCase().includes(depSearchQuery.toLowerCase()) || String(c.id).includes(depSearchQuery)).length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ink-35)', padding: '6px 4px' }}>{t('tasks.deps.selectTasks' as TranslationKey)}</div>
                    )}
                  </div>
                </div>
              )}
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: mob ? 8 : 10, background: 'var(--panel)' }}>
        <input
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
          placeholder={t('tasks.searchPlaceholder')}
          style={{ width: mob ? '100%' : 220, padding: '8px 14px', fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: mob ? 4 : 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setFilter(s); setPage(1); }}
              style={{
                padding: mob ? '5px 10px' : '6px 14px', borderRadius: 999, fontSize: mob ? 11 : 12, fontWeight: 600,
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
        <div style={{ display: 'flex', gap: mob ? 4 : 6, flexWrap: 'wrap' }}>
          {SOURCE_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => { setSourceFilter(s); setPage(1); }}
              style={{
                padding: mob ? '5px 8px' : '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
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
        {!mob && (
          <>
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
          </>
        )}
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
            <div key={q.task_id} style={{ padding: mob ? '8px 10px' : '10px 14px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: mob ? '36px 1fr' : '52px minmax(0,1fr) auto auto', gap: mob ? 6 : 10, alignItems: mob ? 'start' : 'center' }}>
              <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 800 }}>#{q.position}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: mob ? 12 : 13, color: 'var(--ink-90)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>
                  {t('tasks.taskWithId', { id: q.task_id })} • {sourceLabel(q.source, t)}
                </div>
                {mob && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Link href={`/tasks/${q.task_id}`} className='button button-outline' style={{ padding: '4px 8px', fontSize: 11 }}>{t('tasks.open')}</Link>
                    <button className='button button-outline' onClick={() => void onRemoveFromQueue(q.task_id)} style={{ padding: '4px 8px', fontSize: 11, borderColor: 'rgba(248,113,113,0.35)', color: '#f87171' }}>{t('tasks.remove')}</button>
                  </div>
                )}
              </div>
              {!mob && (
                <>
                  <Link href={`/tasks/${q.task_id}`} className='button button-outline' style={{ padding: '5px 9px', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t('tasks.open')}
                  </Link>
                  <button className='button button-outline' onClick={() => void onRemoveFromQueue(q.task_id)} style={{ padding: '5px 9px', fontSize: 12, whiteSpace: 'nowrap', borderColor: 'rgba(248,113,113,0.35)', color: '#f87171', minHeight: 30 }}>
                    {t('tasks.remove')}
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Task list */}
      <div style={{ borderRadius: mob ? 14 : 20, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflowX: mob ? 'hidden' : 'auto' }}>
        {!mob && (
          <div style={{ minWidth: 1040 }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) 80px 98px 88px 88px 70px 92px 78px minmax(180px,0.85fr)', gap: 10 }}>
              {[t('tasks.col.task'), t('tasks.col.source'), t('tasks.col.status'), t('tasks.col.run'), t('tasks.col.queue'), t('tasks.col.retry'), t('tasks.col.tokens'), t('tasks.col.pr'), t('tasks.col.actions')].map((h) => (
                <span key={h} style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-25)', textTransform: 'uppercase', letterSpacing: 1 }}>{h}</span>
              ))}
            </div>
          </div>
        )}

        {!mob && (
          <div style={{ minWidth: 1040 }}>
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
                <div style={{ fontWeight: 600, color: 'var(--ink-78)', fontSize: 14, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                  {(task.dependency_blockers && task.dependency_blockers.length > 0) && (
                    <span title={`${t('tasks.deps.blockedBy' as TranslationKey)}: ${task.dependency_blockers.map((id: number) => '#' + id).join(', ')}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 1L3 4v4c0 3.3 2.1 6.4 5 7.5 2.9-1.1 5-4.2 5-7.5V4L8 1z" stroke="#f59e0b" strokeWidth="1.5" fill="none"/><path d="M6 8h4M8 6v4" stroke="#f59e0b" strokeWidth="1.2"/></svg>
                      {t('tasks.deps.depCount' as TranslationKey, { n: task.dependency_blockers.length })}
                    </span>
                  )}
                  {(task.dependent_task_ids && task.dependent_task_ids.length > 0) && (
                    <span title={`${t('tasks.deps.dependents' as TranslationKey)}: ${task.dependent_task_ids.map((id: number) => '#' + id).join(', ')}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(94,234,212,0.1)', border: '1px solid rgba(94,234,212,0.25)', color: '#5eead4', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      &rarr;{task.dependent_task_ids.length}
                    </span>
                  )}
                </div>
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
                    (task.repo_assignments[0].pr_url || task.pr_url) ? (
                      <a href={task.repo_assignments[0].pr_url || task.pr_url!} target='_blank' rel='noreferrer' style={{ fontSize: 12, color: '#5eead4', textDecoration: 'none' }}>{t('tasks.viewPr')} ↗</a>
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
              <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {task.status === 'queued' || task.status === 'running' ? (
                  <span style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: statusColor(task.status) }}>
                    {statusLabel(task.status, t)}
                  </span>
                ) : (
                  <>
                    <button onClick={() => void onAssignMCP(task.id)}
                      style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0d9488, #7c3aed)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Run
                    </button>
                  </>
                )}
                <Link href={`/tasks/${task.id}`} className='button button-outline' style={{ padding: '6px 8px', fontSize: 11, whiteSpace: 'nowrap', minHeight: 30 }}>
                  {t('tasks.details')}
                </Link>
                <button onClick={() => openEditTask(task)}
                  style={{ padding: '6px 6px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(56,189,248,0.2)', background: 'transparent', color: '#38bdf8', cursor: 'pointer', lineHeight: 1 }}>
                  ✏️
                </button>
                {task.status !== 'running' && (
                  <button onClick={() => setDeleteConfirmTask(task)}
                    style={{ padding: '6px 6px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#ef4444', cursor: 'pointer', lineHeight: 1 }}>
                    🗑
                  </button>
                )}
              </div>
            </div>
          ))
        )}
          </div>
        )}

        {/* Mobile card layout */}
        {mob && (
          tasks.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-25)', fontSize: 13 }}>
              {t('tasks.empty')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 0 }}>
              {tasks.map((task) => {
                const busy = task.status === 'queued' || task.status === 'running';
                const prUrl = task.repo_assignments?.[0]?.pr_url || task.pr_url;
                return (
                  <div key={task.id} style={{
                    padding: '12px 14px', borderBottom: '1px solid var(--panel-border)',
                    borderLeft: task.status === 'running' ? '3px solid #38bdf8' : '3px solid transparent',
                    background: task.status === 'running' ? 'rgba(56,189,248,0.04)' : undefined,
                  }}>
                    {/* Row 1: title + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                        background: `${statusColor(task.status)}18`,
                        border: `1px solid ${statusColor(task.status)}40`,
                        color: statusColor(task.status), flexShrink: 0, textTransform: 'capitalize',
                      }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor(task.status), animation: task.status === 'running' ? 'pulse-brand 1.5s infinite' : 'none' }} />
                        {statusLabel(task.status, t)}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--ink-35)', fontWeight: 600, textTransform: 'capitalize' }}>{sourceLabel(task.source, t)}</span>
                      {prUrl && (
                        <a href={prUrl} target='_blank' rel='noreferrer' style={{ fontSize: 10, color: '#5eead4', textDecoration: 'none', marginLeft: 'auto', flexShrink: 0 }}>PR ↗</a>
                      )}
                    </div>
                    {/* Row 2: title */}
                    <div style={{ fontWeight: 600, color: 'var(--ink-78)', fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.title}
                    </div>
                    {/* Row 3: badges */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
                      {(task.dependency_blockers && task.dependency_blockers.length > 0) && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                          {t('tasks.deps.depCount' as TranslationKey, { n: task.dependency_blockers.length })}
                        </span>
                      )}
                      {(task.dependent_task_ids && task.dependent_task_ids.length > 0) && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 6px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: 'rgba(94,234,212,0.1)', border: '1px solid rgba(94,234,212,0.25)', color: '#5eead4' }}>
                          &rarr;{task.dependent_task_ids.length}
                        </span>
                      )}
                    </div>
                    {/* Row 4: stats */}
                    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--ink-45)', marginBottom: 8 }}>
                      <span>{fmtDuration(task.run_duration_sec ?? task.duration_sec)}</span>
                      {(task.total_tokens !== null && task.total_tokens !== undefined) && <span>{task.total_tokens.toLocaleString()} tok</span>}
                      {(task.retry_count !== null && task.retry_count !== undefined && task.retry_count > 0) && <span>retry: {task.retry_count}</span>}
                    </div>
                    {/* Row 5: actions */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      {busy ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(task.status) }}>{statusLabel(task.status, t)}</span>
                      ) : (
                        <>
                          <button onClick={() => void onAssignMCP(task.id)}
                            style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0d9488, #7c3aed)', color: '#fff', cursor: 'pointer' }}>
                            Run
                          </button>
                        </>
                      )}
                      <Link href={`/tasks/${task.id}`} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-50)', textAlign: 'center', textDecoration: 'none' }}>
                        {t('tasks.details')}
                      </Link>
                      <button onClick={() => openEditTask(task)}
                        style={{ padding: '7px 6px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(56,189,248,0.2)', background: 'transparent', color: '#38bdf8', cursor: 'pointer', lineHeight: 1 }}>
                        ✏️
                      </button>
                      {task.status !== 'running' && (
                        <button onClick={() => setDeleteConfirmTask(task)}
                          style={{ padding: '7px 6px', fontSize: 11, borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#ef4444', cursor: 'pointer', lineHeight: 1 }}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
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
          defaultCreatePr={defaultCreatePr}
          onAssignAI={(id, agent, repoMeta, repoMappingIds, pr) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignAI(id, agent, extra, repoMappingIds, pr);
          }}
          onAssignFlow={(id, flowId, flowName, repoMeta, repoMappingIds, pr) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignFlow(id, flowId, flowName, extra, repoMappingIds, pr);
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
          defaultCreatePr={defaultCreatePr}
          onAssignAI={(id, agent, repoMeta, repoMappingIds, pr) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignAI(id, agent, extra, repoMappingIds, pr);
          }}
          onAssignFlow={(id, flowId, flowName, repoMeta, repoMappingIds, pr) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignFlow(id, flowId, flowName, extra, repoMappingIds, pr);
          }}
          onClose={() => setFlowPopupTaskId(null)}
          t={t}
        />
      )}
      {/* Unified Run Popup — shows all modes: MCP, AI, Flow */}
      {mcpPopupTaskId !== null && (
        <AssignPopup
          taskId={mcpPopupTaskId}
          mode='ai'
          tasks={tasks}
          agents={agentConfigs}
          flows={savedFlows}
          defaultCreatePr={defaultCreatePr}
          onAssignAI={(id, agent, repoMeta, repoMappingIds, pr) => {
            if (agent.provider === 'claude_cli' || agent.provider === 'codex_cli') {
              void doAssignMCP(id, repoMeta, repoMappingIds, agent.model, agent.provider, pr);
            } else {
              void doAssignAI(id, agent, repoMeta ? `Remote Repo: ${repoMeta}` : undefined, repoMappingIds, pr);
            }
          }}
          onAssignFlow={(id, flowId, flowName, repoMeta, repoMappingIds, pr) => {
            const extra = repoMeta ? `Remote Repo: ${repoMeta}` : undefined;
            void doAssignFlow(id, flowId, flowName, extra, repoMappingIds, pr);
          }}
          onClose={() => setMcpPopupTaskId(null)}
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
      {/* Edit task modal */}
      {editTask && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setEditTask(null)}>
          <div style={{ width: 'min(520px, 100%)', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.4)', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ height: 3, background: 'linear-gradient(90deg, #38bdf8, #7c3aed)' }} />
            <div style={{ padding: '20px 24px', display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>Edit Task #{editTask.id}</h3>
                <button onClick={() => setEditTask(null)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-45)', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>Title</label>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>Description</label>
                <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={6}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setEditTask(null)}
                  style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                  Cancel
                </button>
                <button onClick={() => void saveEditTask()}
                  style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg, #0d9488, #22c55e)', border: 'none', color: '#fff' }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Repo conflict modal */}
      {conflictModal && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setConflictModal(null)} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10001,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16, overflowY: 'auto',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 440, borderRadius: 16,
            border: '1px solid var(--panel-border)',
            background: 'var(--surface)', padding: 24,
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            margin: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>&#9888;</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Repo Busy</div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-58)', lineHeight: 1.6, margin: '0 0 8px' }}>
              This repo already has an active task:
            </p>
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--glass)', border: '1px solid var(--panel-border)', fontSize: 12, color: 'var(--ink-72)', marginBottom: 16, wordBreak: 'break-word' }}>
              {conflictModal.info}
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-45)', lineHeight: 1.6, margin: '0 0 20px' }}>
              Queue this task to run after the current one finishes?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConflictModal(null)} style={{
                padding: '8px 20px', borderRadius: 8, border: '1px solid var(--panel-border)',
                background: 'transparent', color: 'var(--ink-50)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={() => void _forceQueueConflict()} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Queue Anyway</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const MCP_MODELS = [
  { label: 'GPT-4o', model: 'gpt-4o', provider: 'openai' },
  { label: 'GPT-4.1', model: 'gpt-4.1', provider: 'openai' },
  { label: 'GPT-4.1 mini', model: 'gpt-4.1-mini', provider: 'openai' },
  { label: 'o3', model: 'o3', provider: 'openai' },
  { label: 'o4-mini', model: 'o4-mini', provider: 'openai' },
  { label: 'Claude Sonnet 4', model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
  { label: 'Claude Opus 4', model: 'claude-opus-4-20250514', provider: 'anthropic' },
  { label: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', provider: 'gemini' },
  { label: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', provider: 'gemini' },
  { label: 'Codex CLI', model: 'gpt-4o', provider: 'codex_cli' },
  { label: 'Claude CLI', model: 'sonnet', provider: 'claude_cli' },
];

function McpModelSelect({ taskId, agents, hasRepo, repoSel, mappingIds, createPr, onAssignAI, t }: {
  taskId: number;
  agents: { role: string; model: string; provider: string; enabled: boolean }[];
  hasRepo: boolean;
  repoSel: { meta: string } | null;
  mappingIds: number[] | undefined;
  createPr?: boolean;
  onAssignAI: (id: number, agent: { role: string; model: string; provider: string }, repoMeta?: string, repoMappingIds?: number[], createPr?: boolean) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const canRun = hasRepo || repoSel || (mappingIds && mappingIds.length > 0);
  const chosen = MCP_MODELS[selectedIdx];

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>{t('tasks.assignMcp' as TranslationKey)}</div>
      <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(8,145,178,0.2)', background: 'rgba(8,145,178,0.06)', fontSize: 12, color: 'var(--ink-50)', lineHeight: 1.5 }}>
        {t('tasks.mcpDesc' as TranslationKey)}
      </div>

      {/* Model selector */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Model</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {MCP_MODELS.map((m, i) => {
            const active = i === selectedIdx;
            const provColor = m.provider === 'openai' ? '#22c55e' : m.provider === 'anthropic' ? '#f59e0b' : m.provider === 'codex_cli' ? '#a78bfa' : m.provider === 'claude_cli' ? '#fb923c' : '#38bdf8';
            return (
              <button key={m.model} type="button" onClick={() => setSelectedIdx(i)}
                style={{
                  padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: active ? 700 : 500, cursor: 'pointer',
                  border: active ? `1px solid ${provColor}80` : '1px solid var(--panel-border-2)',
                  background: active ? `${provColor}18` : 'transparent',
                  color: active ? provColor : 'var(--ink-50)',
                }}>
                {m.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--ink-30)', marginTop: 4 }}>
          {chosen.provider} · {chosen.model}
        </div>
      </div>

      <button
        onClick={() => onAssignAI(taskId, { role: 'mcp_agent', model: chosen.model, provider: chosen.provider }, !hasRepo ? repoSel?.meta : undefined, mappingIds, createPr)}
        disabled={!canRun}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: canRun ? 'linear-gradient(135deg, #0891b2, #06b6d4)' : 'var(--panel)', cursor: canRun ? 'pointer' : 'not-allowed', width: '100%', opacity: canRun ? 1 : 0.5, color: canRun ? '#fff' : 'var(--ink-35)', fontSize: 13, fontWeight: 700 }}>
        {t('tasks.runMcpAgent' as TranslationKey)} — {chosen.label}
        <span style={{ fontSize: 16 }}>→</span>
      </button>
    </div>
  );
}

function AssignPopup({ taskId, mode, tasks, agents, flows, defaultCreatePr: initialCreatePr, onAssignAI, onAssignFlow, onClose, t }: {
  taskId: number;
  mode: 'ai' | 'flow' | 'mcp_agent';
  tasks: TaskItem[];
  agents: { role: string; model: string; provider: string; enabled: boolean }[];
  flows: { id: string; name: string }[];
  defaultCreatePr: boolean;
  onAssignAI: (id: number, agent: { role: string; model: string; provider: string }, repoMeta?: string, repoMappingIds?: number[], createPr?: boolean) => void;
  onAssignFlow: (id: number, flowId: string, flowName: string, repoMeta?: string, repoMappingIds?: number[], createPr?: boolean) => void;
  onClose: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const [repoSel, setRepoSel] = useState<{ meta: string } | null>(null);
  const [backendMappings, setBackendMappings] = useState<BackendRepoMapping[]>([]);
  const [selectedMappingIds, setSelectedMappingIds] = useState<number[]>([]);
  const [mappingsLoaded, setMappingsLoaded] = useState(false);
  const [createPr, setCreatePr] = useState(initialCreatePr);
  const [selected, setSelected] = useState<{ type: 'agent' | 'cli' | 'flow'; agent?: { role: string; model: string; provider: string }; flow?: { id: string; name: string } } | null>(null);
  const task = tasks.find((tk) => tk.id === taskId);
  const taskDesc = ((task as unknown as { description?: string })?.description || '').toLowerCase();
  const hasRepo = taskDesc.includes('local repo path') || taskDesc.includes('remote repo');

  useEffect(() => {
    apiFetch<BackendRepoMapping[]>('/repo-mappings')
      .then((data) => {
        setBackendMappings(data);
        setMappingsLoaded(true);
        // Auto-select the task's existing repo mapping
        const taskObj = task as unknown as { repo_mapping_id?: number } | undefined;
        const existingId = taskObj?.repo_mapping_id;
        if (existingId && data.some((m) => m.id === existingId)) {
          setSelectedMappingIds([existingId]);
        }
      })
      .catch(() => setMappingsLoaded(true));
  }, []);

  function toggleMapping(id: number) {
    setSelectedMappingIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const mappingIds = selectedMappingIds.length > 0 ? selectedMappingIds : undefined;

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 16px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, width: 'min(480px, 100%)', maxHeight: '85vh', overflowY: 'auto', margin: 'auto 0' }}>
        <div style={{ height: 3, background: mode === 'ai' ? 'linear-gradient(90deg, #0d9488, #22c55e)' : mode === 'mcp_agent' ? 'linear-gradient(90deg, #0891b2, #06b6d4)' : 'linear-gradient(90deg, #7c3aed, #a78bfa)' }} />
        <div style={{ padding: '18px 22px', display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
            {mode === 'ai' ? t('tasks.selectAgent') : mode === 'mcp_agent' ? t('tasks.assignMcp' as TranslationKey) : t('tasks.assignFlow')}
          </h3>

          {/* Dependency blocker warning */}
          {task && task.dependency_blockers && task.dependency_blockers.length > 0 ? (
            <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>
                &#9888; {t('tasks.deps.blockedBy' as TranslationKey)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-65)', lineHeight: 1.4 }}>
                {task.dependency_blockers.map((id: number) => `#${id}`).join(', ')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-45)', marginTop: 4 }}>
                {t('tasks.deps.blockerWarning' as TranslationKey)}
              </div>
            </div>
          ) : task ? (
            <div style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#22c55e', fontSize: 13 }}>&#10003;</span>
              <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{t('tasks.deps.noBlockers' as TranslationKey)}</span>
            </div>
          ) : null}

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

          {/* Remote repo selector — always show as additional option */}
          {selectedMappingIds.length === 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>
                {mappingsLoaded && backendMappings.length > 0 ? t('tasks.multiRepo.orRemote' as TranslationKey) : 'Target Repository'}
              </div>
              <RemoteRepoSelector compact onChange={(sel) => setRepoSel(sel ? { meta: sel.meta } : null)} />
            </div>
          )}
          {hasRepo && selectedMappingIds.length === 0 && !repoSel && (
            <div style={{ fontSize: 11, color: 'var(--ink-35)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
              {t('tasks.multiRepo.configured' as TranslationKey)}
            </div>
          )}

          {/* Create PR toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 10, border: createPr ? '1px solid rgba(34,197,94,0.35)' : '1px solid var(--panel-border-2)', background: createPr ? 'rgba(34,197,94,0.06)' : 'var(--panel)' }}>
            <input type='checkbox' checked={createPr} onChange={(e) => setCreatePr(e.target.checked)} style={{ accentColor: '#22c55e', width: 16, height: 16 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: createPr ? '#22c55e' : 'var(--ink-58)' }}>Create PR</div>
              <div style={{ fontSize: 10, color: 'var(--ink-35)' }}>{createPr ? t('tasks.prEnabled' as TranslationKey) : t('tasks.prDisabled' as TranslationKey)}</div>
            </div>
          </label>

          {/* Agent / Flow selection */}
          {/* Agent / CLI / Flow selection — select first, then run */}
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>{t('tasks.selectAgent')}</div>
            {agents.filter((a) => a.enabled).map((agent) => {
              const isSelected = selected?.type === 'agent' && selected.agent?.role === agent.role;
              return (
              <button key={agent.role}
                onClick={() => setSelected({ type: 'agent', agent })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10,
                  border: isSelected ? '1px solid rgba(94,234,212,0.6)' : '1px solid var(--panel-border-3)',
                  background: isSelected ? 'rgba(94,234,212,0.12)' : 'var(--panel)',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  opacity: selected && !isSelected ? 0.4 : 1, transition: 'all 0.15s' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#5eead4' : 'var(--ink)', textTransform: 'capitalize' }}>{agent.role}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{agent.model || 'default'} {agent.provider ? `· ${agent.provider}` : ''}</div>
                </div>
                {isSelected && <span style={{ fontSize: 14, color: '#5eead4' }}>✓</span>}
              </button>
              );
            })}
            {/* CLI options */}
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginTop: 6 }}>Local CLI</div>
            {[
              { label: 'Claude CLI', model: 'sonnet', provider: 'claude_cli', color: '#fb923c', icon: '✎' },
              { label: 'Codex CLI', model: 'gpt-4o', provider: 'codex_cli', color: '#a78bfa', icon: '⌘' },
            ].map((cli) => {
              const isSelected = selected?.type === 'cli' && selected.agent?.provider === cli.provider;
              return (
              <button key={cli.provider}
                onClick={() => setSelected({ type: 'cli', agent: { role: 'mcp_agent', model: cli.model, provider: cli.provider } })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10,
                  border: isSelected ? `1px solid ${cli.color}80` : `1px solid ${cli.color}40`,
                  background: isSelected ? `${cli.color}1a` : `${cli.color}0a`,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  opacity: selected && !isSelected ? 0.4 : 1, transition: 'all 0.15s' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: cli.color }}>{cli.icon} {cli.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{cli.provider} · {cli.model}</div>
                </div>
                {isSelected && <span style={{ fontSize: 14, color: cli.color }}>✓</span>}
              </button>
              );
            })}
            {/* Flow options */}
            {flows.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginTop: 6 }}>Flows</div>
                {flows.map((flow) => {
                  const isSelected = selected?.type === 'flow' && selected.flow?.id === flow.id;
                  return (
                  <button key={flow.id}
                    onClick={() => setSelected({ type: 'flow', flow })}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10,
                      border: isSelected ? '1px solid rgba(168,85,247,0.6)' : '1px solid rgba(124,58,237,0.3)',
                      background: isSelected ? 'rgba(168,85,247,0.15)' : 'rgba(124,58,237,0.06)',
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                      opacity: selected && !isSelected ? 0.4 : 1, transition: 'all 0.15s' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#c084fc' : 'var(--ink)' }}>{flow.name}</div>
                    </div>
                    {isSelected && <span style={{ fontSize: 14, color: '#c084fc' }}>✓</span>}
                  </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className='button button-outline' style={{ flex: 1, fontSize: 12, justifyContent: 'center' }}>{t('tasks.cancel')}</button>
            <button
              disabled={!selected || (!hasRepo && !repoSel && selectedMappingIds.length === 0)}
              onClick={() => {
                if (!selected) return;
                const repoMeta = !hasRepo ? repoSel?.meta : undefined;
                if (selected.type === 'flow' && selected.flow) {
                  onAssignFlow(taskId, selected.flow.id, selected.flow.name, repoMeta, mappingIds, createPr);
                } else if (selected.agent) {
                  onAssignAI(taskId, selected.agent, repoMeta, mappingIds, createPr);
                }
              }}
              style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: selected ? 'pointer' : 'not-allowed',
                background: selected ? 'linear-gradient(135deg, #0d9488, #7c3aed)' : 'var(--panel)',
                border: selected ? 'none' : '1px solid var(--panel-border)',
                color: selected ? '#fff' : 'var(--ink-30)',
                opacity: (!selected || (!hasRepo && !repoSel && selectedMappingIds.length === 0)) ? 0.5 : 1 }}>
              Run Task
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
