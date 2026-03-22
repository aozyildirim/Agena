'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, getToken, loadPrefs, resolveApiBase } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { useLocale } from '@/lib/i18n';

type TaskDetail = {
  id: number;
  title: string;
  description: string;
  story_context?: string | null;
  acceptance_criteria?: string | null;
  edge_cases?: string | null;
  max_tokens?: number | null;
  max_cost_usd?: number | null;
  source: string;
  status: string;
  pr_url?: string | null;
  branch_name?: string | null;
  failure_reason?: string | null;
  created_at: string;
  duration_sec?: number | null;
  run_duration_sec?: number | null;
  queue_wait_sec?: number | null;
  retry_count?: number | null;
  queue_position?: number | null;
  estimated_start_sec?: number | null;
  lock_scope?: string | null;
  blocked_by_task_id?: number | null;
  blocked_by_task_title?: string | null;
  dependency_blockers?: number[];
  dependent_task_ids?: number[];
  pr_risk_score?: number | null;
  pr_risk_level?: string | null;
  pr_risk_reason?: string | null;
  total_tokens?: number | null;
};

type TaskLog = {
  id?: number;
  stage: string;
  message: string;
  created_at: string;
};

type CodeFile = {
  path: string;
  content: string;
  isDiff?: boolean;
};

type TaskDeps = {
  depends_on_task_ids: number[];
  dependent_task_ids: number[];
  blocker_task_ids: number[];
};

type DependencyTaskOption = {
  id: number;
  title: string;
  status: string;
};

const STEP_ORDER = ['queued', 'running', 'agent', 'code_ready', 'local_exec', 'pr', 'completed'];

function stageColor(stage: string): string {
  const map: Record<string, string> = {
    queued: '#a3a3a3',
    running: '#38bdf8',
    agent: '#5eead4',
    code_ready: '#60a5fa',
    code_preview: '#f97316',
    code_diff: '#10b981',
    local_exec: '#c084fc',
    pr: '#f59e0b',
    run_metrics: '#22c55e',
    completed: '#22c55e',
    failed: '#f87171',
  };
  return map[stage] ?? '#94a3b8';
}

function parseRunMetrics(logs: TaskLog[]) {
  const item = [...logs].reverse().find((l) => l.stage === 'run_metrics');
  if (!item) return null;
  const m = item.message;
  const extract = (name: string) => {
    const r = new RegExp(`${name}:\\s*([^|]+)`);
    return (m.match(r)?.[1] || '').trim();
  };
  return {
    startedAt: extract('StartedAt'),
    finishedAt: extract('FinishedAt'),
    durationSec: extract('DurationSec'),
    promptTokens: extract('PromptTokens'),
    completionTokens: extract('CompletionTokens'),
    totalTokens: extract('TotalTokens'),
  };
}

function parseCodePreview(logs: TaskLog[]): CodeFile[] {
  const diffs = logs.filter((l) => l.stage === 'code_diff');
  const diffFiles: CodeFile[] = [];
  for (const d of diffs) {
    const pattern = /File:\s*(.+?)\n```diff\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null = pattern.exec(d.message);
    while (match) {
      diffFiles.push({ path: match[1].trim(), content: match[2].trim(), isDiff: true });
      match = pattern.exec(d.message);
    }
  }
  if (diffFiles.length > 0) return diffFiles;

  const previews = logs.filter((l) => l.stage === 'code_preview');
  const files: CodeFile[] = [];
  for (const p of previews) {
    const pattern = /File:\s*(.+?)\n```([\s\S]*?)```/g;
    let match: RegExpExecArray | null = pattern.exec(p.message);
    while (match) {
      files.push({ path: match[1].trim(), content: match[2].trim() });
      match = pattern.exec(p.message);
    }
  }
  return files;
}

function classifyFailure(text: string): { labelKey: string; detailKey: string } {
  const t = text.toLowerCase();
  if (!t) return { labelKey: 'taskDetail.failure.noneLabel', detailKey: 'taskDetail.failure.noneDetail' };
  if (t.includes('timeout')) return { labelKey: 'taskDetail.failure.timeoutLabel', detailKey: 'taskDetail.failure.timeoutDetail' };
  if (t.includes('insufficient permissions') || t.includes('missing scopes')) return { labelKey: 'taskDetail.failure.permissionsLabel', detailKey: 'taskDetail.failure.permissionsDetail' };
  if (t.includes('git checkout') || t.includes('worktree') || t.includes('local changes')) return { labelKey: 'taskDetail.failure.gitLabel', detailKey: 'taskDetail.failure.gitDetail' };
  if (t.includes('401') || t.includes('unauthorized')) return { labelKey: 'taskDetail.failure.authLabel', detailKey: 'taskDetail.failure.authDetail' };
  return { labelKey: 'taskDetail.failure.execLabel', detailKey: 'taskDetail.failure.execDetail' };
}

function fmtEta(sec?: number | null): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function fmtAgo(iso: string | null, nowMs: number): string {
  if (!iso) return '—';
  const diff = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function TaskDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const liveStripRef = useRef<HTMLDivElement | null>(null);
  const lastLogIdRef = useRef(0);
  const [isMobile, setIsMobile] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'errors' | 'code'>('all');
  const [activeCodeTab, setActiveCodeTab] = useState(0);
  const [isRerunBusy, setIsRerunBusy] = useState(false);
  const [isCancelBusy, setIsCancelBusy] = useState(false);
  const [isDepsBusy, setIsDepsBusy] = useState(false);
  const [selectedDependencyIds, setSelectedDependencyIds] = useState<number[]>([]);
  const [dependencyCandidates, setDependencyCandidates] = useState<DependencyTaskOption[]>([]);
  const [depsData, setDepsData] = useState<TaskDeps | null>(null);
  const [defaultCreatePr, setDefaultCreatePr] = useState(true);
  const [clockMs, setClockMs] = useState(() => Date.now());

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [error, setError] = useState('');
  const [streamState, setStreamState] = useState<'live' | 'reconnecting' | 'offline'>('offline');

  async function loadData() {
    try {
      const [taskData, logsData, taskList] = await Promise.all([
        apiFetch<TaskDetail>('/tasks/' + taskId),
        apiFetch<TaskLog[]>('/tasks/' + taskId + '/logs'),
        apiFetch<DependencyTaskOption[]>('/tasks'),
      ]);
      setTask(taskData);
      setLogs(logsData);
      const currentTaskId = Number(taskId);
      setDependencyCandidates(taskList.filter((item) => item.id !== currentTaskId));
      const d = await apiFetch<TaskDeps>('/tasks/' + taskId + '/dependencies');
      setDepsData(d);
      setSelectedDependencyIds(d.depends_on_task_ids || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskDetail.errorLoad'));
    }
  }

  useEffect(() => {
    if (!taskId) return;
    void loadData();
    const interval = setInterval(() => void loadData(), 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  useEffect(() => {
    const maxId = logs.reduce((acc, item) => Math.max(acc, item.id || 0), 0);
    if (maxId > lastLogIdRef.current) lastLogIdRef.current = maxId;
  }, [logs]);

  useEffect(() => {
    if (!taskId) return;
    let isClosed = false;
    let currentController: AbortController | null = null;
    const apiBase = resolveApiBase();

    const mergeLogs = (incoming: TaskLog) => {
      setLogs((prev) => {
        if (incoming.id && prev.some((x) => x.id === incoming.id)) return prev;
        return [...prev, incoming].sort((a, b) => {
          const ai = a.id || 0;
          const bi = b.id || 0;
          if (ai && bi) return ai - bi;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
      });
    };

    const connect = async () => {
      while (!isClosed) {
        const token = getToken();
        if (!token) {
          setStreamState('offline');
          return;
        }
        currentController = new AbortController();
        try {
          setStreamState('reconnecting');
          const res = await fetch(`${apiBase}/tasks/${taskId}/logs/stream?since_id=${lastLogIdRef.current}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: currentController.signal,
            cache: 'no-store',
          });
          if (!res.ok || !res.body) throw new Error(`stream_${res.status}`);
          setStreamState('live');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!isClosed) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n\n');
            buffer = chunks.pop() || '';
            for (const raw of chunks) {
              const lines = raw.split('\n');
              let eventName = '';
              const dataParts: string[] = [];
              for (const ln of lines) {
                if (ln.startsWith('event:')) eventName = ln.slice(6).trim();
                if (ln.startsWith('data:')) dataParts.push(ln.slice(5).trim());
              }
              if (eventName !== 'log' || dataParts.length === 0) continue;
              try {
                const parsed = JSON.parse(dataParts.join('\n')) as TaskLog;
                if (parsed.id && parsed.id > lastLogIdRef.current) lastLogIdRef.current = parsed.id;
                mergeLogs(parsed);
              } catch {}
            }
          }
        } catch {
          if (isClosed) break;
          setStreamState('reconnecting');
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    };

    void connect();
    return () => {
      isClosed = true;
      currentController?.abort();
      setStreamState('offline');
    };
  }, [taskId]);

  useEffect(() => {
    loadPrefs().then((prefs) => {
      const raw = (prefs.profile_settings || {}) as Record<string, unknown>;
      if (typeof raw.default_create_pr === 'boolean') setDefaultCreatePr(raw.default_create_pr);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!liveStripRef.current) return;
    liveStripRef.current.scrollTo({ left: liveStripRef.current.scrollWidth, behavior: 'smooth' });
  }, [logs, logFilter]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredLogs = useMemo(() => {
    if (logFilter === 'errors') return logs.filter((item) => item.stage === 'failed' || /error|failed|timeout/i.test(item.message));
    if (logFilter === 'code') return logs.filter((item) => item.stage === 'code_preview' || item.stage === 'code_ready' || item.stage === 'code_diff');
    return logs;
  }, [logs, logFilter]);

  const liveLogs = useMemo(() => filteredLogs.slice(-8), [filteredLogs]);
  const logHistory = useMemo(() => [...filteredLogs].reverse(), [filteredLogs]);
  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const metrics = useMemo(() => parseRunMetrics(logs), [logs]);
  const codeFiles = useMemo(() => parseCodePreview(logs), [logs]);
  const latestFailure = useMemo(() => {
    const failedLog = [...logs].reverse().find((l) => l.stage === 'failed');
    return task?.failure_reason || failedLog?.message || '';
  }, [task?.failure_reason, logs]);
  const failure = useMemo(() => classifyFailure(latestFailure), [latestFailure]);

  const createdAt = useMemo(() => logs.find((l) => l.stage === 'created')?.created_at || task?.created_at || '', [logs, task?.created_at]);
  const runningAt = useMemo(() => logs.find((l) => l.stage === 'running')?.created_at || '', [logs]);
  const queueWaitSec = useMemo(() => {
    if (!createdAt || !runningAt) return null;
    return Math.max(0, Math.round((new Date(runningAt).getTime() - new Date(createdAt).getTime()) / 1000));
  }, [createdAt, runningAt]);

  const stepMap = useMemo(() => {
    const map: Record<string, TaskLog | undefined> = {};
    for (const step of STEP_ORDER) {
      if (step === 'agent') {
        map[step] = logs.find((l) =>
          ['agent', 'analyze', 'generate_code', 'review_code', 'finalize', 'playbook'].includes(l.stage),
        );
        continue;
      }
      map[step] = logs.find((l) => l.stage === step);
    }
    if (!map.completed) map.failed = logs.find((l) => l.stage === 'failed');
    return map;
  }, [logs]);

  const executionProgress = useMemo(() => {
    const hasQueued = Boolean(stepMap.queued);
    const hasRunning = Boolean(stepMap.running);
    const effectiveSteps = !hasQueued && hasRunning
      ? STEP_ORDER.filter((step) => step !== 'queued')
      : STEP_ORDER;
    const doneCount = effectiveSteps.filter((step) => Boolean(stepMap[step])).length;
    const percent = Math.round((doneCount / effectiveSteps.length) * 100);
    return { doneCount, total: effectiveSteps.length, percent, effectiveSteps };
  }, [stepMap]);

  const currentActivity = useMemo(() => {
    const fallback = {
      title: t('taskDetail.waitingLogsTitle'),
      detail: t('taskDetail.waitingLogsDesc'),
      color: 'rgba(255,255,255,0.65)',
      pulse: false,
    };
    if (!task) return fallback;
    if (task.status === 'queued') {
      return {
        title: t('taskDetail.queued'),
        detail: `${t('taskDetail.queuePosition')} ${task.queue_position ? `#${task.queue_position}` : t('taskDetail.unknown')} • ETA ${fmtEta(task.estimated_start_sec)}`,
        color: '#f59e0b',
        pulse: false,
      };
    }
    if (task.status === 'running') {
      const stage = latestLog?.stage || t('taskDetail.running');
      return {
        title: `${t('taskDetail.running')}: ${stage}`,
        detail: latestLog?.message || t('taskDetail.agentProcessing'),
        color: stageColor(stage),
        pulse: true,
      };
    }
    if (task.status === 'completed') {
      return {
        title: t('taskDetail.completed'),
        detail: t('taskDetail.executionDone'),
        color: '#22c55e',
        pulse: false,
      };
    }
    if (task.status === 'failed') {
      return {
        title: t('taskDetail.failed'),
        detail: latestFailure || t('taskDetail.executionFailedNoDetail'),
        color: '#f87171',
        pulse: false,
      };
    }
    if (task.status === 'cancelled') {
      return {
        title: t('taskDetail.cancelled'),
        detail: t('taskDetail.executionStopped'),
        color: '#f87171',
        pulse: false,
      };
    }
    return fallback;
  }, [task, latestLog, latestFailure]);

  async function rerunTask() {
    if (!taskId) return;
    try {
      setIsRerunBusy(true);
      await apiFetch('/tasks/' + taskId + '/assign', { method: 'POST', body: JSON.stringify({ create_pr: defaultCreatePr }) });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskDetail.errorRerun'));
    } finally {
      setIsRerunBusy(false);
    }
  }

  async function cancelTask() {
    if (!taskId) return;
    try {
      setIsCancelBusy(true);
      await apiFetch('/tasks/' + taskId + '/cancel', { method: 'POST' });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskDetail.errorCancel'));
    } finally {
      setIsCancelBusy(false);
    }
  }

  async function saveDependencies() {
    if (!taskId) return;
    try {
      setIsDepsBusy(true);
      const dedup = Array.from(new Set(selectedDependencyIds.filter((v) => Number.isFinite(v) && v > 0)));
      const updated = await apiFetch<TaskDeps>('/tasks/' + taskId + '/dependencies', {
        method: 'PUT',
        body: JSON.stringify({ depends_on_task_ids: dedup }),
      });
      setDepsData(updated);
      setSelectedDependencyIds(updated.depends_on_task_ids || []);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskDetail.errorDeps'));
    } finally {
      setIsDepsBusy(false);
    }
  }

  function downloadLogs() {
    const body = logs
      .map((l) => `[${new Date(l.created_at).toISOString()}] ${l.stage}\n${l.message}\n`)
      .join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('taskDetail.task').toLowerCase()}-${taskId}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeCode = codeFiles[activeCodeTab];
  const renderCodeContent = (item: CodeFile) => {
    if (!item.isDiff) {
      return (
        <pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', padding: 10, fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,0.82)' }}>
          {item.content}
        </pre>
      );
    }
    return (
      <div style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, lineHeight: 1.45, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {item.content.split('\n').map((line, idx) => {
          const isAdd = line.startsWith('+') && !line.startsWith('+++');
          const isDel = line.startsWith('-') && !line.startsWith('---');
          const bg = isAdd ? 'rgba(34,197,94,0.18)' : isDel ? 'rgba(248,113,113,0.18)' : 'transparent';
          const color = isAdd ? '#86efac' : isDel ? '#fca5a5' : 'rgba(255,255,255,0.82)';
          return (
            <div key={`${idx}-${line.slice(0, 8)}`} style={{ padding: '1px 10px', background: bg, color, whiteSpace: 'pre' }}>
              {line || ' '}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className='container' style={{ paddingTop: 96, paddingBottom: 20, maxWidth: 1820 }}>
      <section
        style={{
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
          padding: '10px 12px',
          marginBottom: 12,
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(10, minmax(0,1fr))',
          gap: 8,
        }}
      >
        {[
          [t('taskDetail.status'), task?.status ?? '—'],
          [t('taskDetail.source'), task?.source ?? '—'],
          [t('taskDetail.duration'), fmtEta(task?.run_duration_sec ?? (metrics?.durationSec ? Number(metrics.durationSec) : null))],
          [t('taskDetail.queueWait'), fmtEta(task?.queue_wait_sec ?? queueWaitSec)],
          [t('taskDetail.retries'), String(task?.retry_count ?? 0)],
          [t('taskDetail.queuePos'), task?.queue_position !== null && task?.queue_position !== undefined ? `#${task.queue_position}` : '—'],
          [t('taskDetail.eta'), fmtEta(task?.estimated_start_sec)],
          [t('taskDetail.tokens'), task?.total_tokens !== null && task?.total_tokens !== undefined ? String(task.total_tokens) : metrics?.totalTokens || '—'],
          [t('taskDetail.lastStage'), latestLog?.stage ?? '—'],
          [t('taskDetail.lastUpdate'), latestLog ? new Date(latestLog.created_at).toLocaleTimeString() : '—'],
          [t('taskDetail.logs'), String(logs.length)],
        ].map(([k, v]) => (
          <div key={k} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', fontWeight: 700, textTransform: k === t('taskDetail.source') ? 'capitalize' : 'none' }}>{v}</div>
          </div>
        ))}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '340px minmax(860px, 1fr)', gap: 14, alignItems: 'start' }}>
        <section
          className='card'
          style={{ position: isMobile ? 'static' : 'sticky', top: 92, maxHeight: isMobile ? 'none' : 'calc(100vh - 120px)', overflowY: 'auto', borderRadius: 16 }}
        >
          <h1 style={{ marginTop: 0, marginBottom: 8, fontSize: 18, lineHeight: 1.35 }}>{task?.title ?? t('taskDetail.task')}</h1>
          {task ? (
            <>
              <p style={{ marginTop: 0, color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.description}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <StatusBadge status={task.status} />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textTransform: 'capitalize' }}>{t('taskDetail.source')}: {task.source}</span>
              </div>
              <div style={{ display: 'grid', gap: 7, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t('taskDetail.created')}: {new Date(task.created_at).toLocaleString()}</div>
                {metrics?.startedAt ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t('taskDetail.runStart')}: {new Date(metrics.startedAt).toLocaleString()}</div> : null}
                {metrics?.finishedAt ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t('taskDetail.runEnd')}: {new Date(metrics.finishedAt).toLocaleString()}</div> : null}
              </div>
              {(task.story_context || task.acceptance_criteria || task.edge_cases || task.max_tokens || task.max_cost_usd) ? (
                <div style={{ border: '1px solid rgba(56,189,248,0.25)', borderRadius: 10, background: 'rgba(56,189,248,0.06)', padding: '9px 10px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7dd3fc', textTransform: 'uppercase', marginBottom: 5 }}>{t('taskDetail.storyGuardrails')}</div>
                  {task.story_context ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', marginBottom: 4 }}><b>{t('taskDetail.context')}:</b> {task.story_context}</div> : null}
                  {task.acceptance_criteria ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginBottom: 4 }}><b>{t('taskDetail.acceptance')}:</b> {task.acceptance_criteria}</div> : null}
                  {task.edge_cases ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginBottom: 4 }}><b>{t('taskDetail.edgeCases')}:</b> {task.edge_cases}</div> : null}
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
                    {t('taskDetail.guardrails')}: max_tokens={task.max_tokens ?? '—'} | max_cost_usd={task.max_cost_usd ?? '—'}
                  </div>
                </div>
              ) : null}
              {(task.lock_scope || task.blocked_by_task_id || (task.queue_position !== null && task.queue_position !== undefined)) ? (
                <div style={{ border: '1px solid rgba(94,234,212,0.25)', borderRadius: 10, background: 'rgba(94,234,212,0.06)', padding: '9px 10px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', textTransform: 'uppercase', marginBottom: 5 }}>{t('taskDetail.queueInsight')}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', lineHeight: 1.45 }}>
                    {task.queue_position !== null && task.queue_position !== undefined ? `${t('taskDetail.position')}: #${task.queue_position} | ` : ''}
                    ETA: {fmtEta(task.estimated_start_sec)}
                  </div>
                  {task.blocked_by_task_id ? (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>
                      {t('taskDetail.blockedBy')} #{task.blocked_by_task_id}{task.blocked_by_task_title ? ` — ${task.blocked_by_task_title}` : ''}
                    </div>
                  ) : null}
                  {task.lock_scope ? (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4, wordBreak: 'break-all' }}>
                      {t('taskDetail.lockScope')}: {task.lock_scope}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '9px 10px', marginBottom: 12, background: 'rgba(255,255,255,0.015)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.72)', textTransform: 'uppercase', marginBottom: 6 }}>{t('taskDetail.dependencies')}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', marginBottom: 8 }}>
                  {t('taskDetail.blockers')}: {(depsData?.blocker_task_ids || []).length > 0 ? depsData?.blocker_task_ids?.join(', ') : t('taskDetail.none')}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.48)', marginBottom: 6 }}>
                  {t('taskDetail.selectedDependencies')}: {selectedDependencyIds.length}
                </div>
                <div
                  style={{
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.03)',
                    maxHeight: 170,
                    overflowY: 'auto',
                    padding: '6px 8px',
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  {dependencyCandidates.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '4px 2px' }}>{t('taskDetail.noOtherTasks')}</div>
                  ) : (
                    dependencyCandidates.map((candidate) => {
                      const checked = selectedDependencyIds.includes(candidate.id);
                      return (
                        <label key={candidate.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', padding: '4px 2px' }}>
                          <input
                            type='checkbox'
                            checked={checked}
                            onChange={(e) => {
                              setSelectedDependencyIds((prev) => {
                                if (e.target.checked) return Array.from(new Set([...prev, candidate.id]));
                                return prev.filter((id) => id !== candidate.id);
                              });
                            }}
                            style={{ marginTop: 2 }}
                          />
                          <span style={{ fontSize: 12, color: checked ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.7)', lineHeight: 1.35 }}>
                            #{candidate.id} • {candidate.title} <span style={{ color: 'rgba(255,255,255,0.45)' }}>({candidate.status})</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <button
                  className='button button-outline'
                  onClick={() => setSelectedDependencyIds([])}
                  type='button'
                  style={{ marginTop: 8 }}
                >
                  {t('taskDetail.clearSelection')}
                </button>
                <button className='button button-outline' onClick={() => void saveDependencies()} disabled={isDepsBusy} style={{ marginTop: 8 }}>
                  {isDepsBusy ? t('taskDetail.saving') : t('taskDetail.saveDependencies')}
                </button>
              </div>
              {(task.pr_risk_score !== null && task.pr_risk_score !== undefined) ? (
                <div style={{ border: '1px solid rgba(245,158,11,0.28)', borderRadius: 10, padding: '9px 10px', marginBottom: 12, background: 'rgba(245,158,11,0.08)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 4 }}>{t('taskDetail.prRisk')}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)' }}>
                    {t('taskDetail.score')}: <b>{task.pr_risk_score}</b> / 100 ({task.pr_risk_level || t('taskDetail.unknown')})
                  </div>
                  {task.pr_risk_reason ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', marginTop: 3 }}>{task.pr_risk_reason}</div> : null}
                </div>
              ) : null}

              <div style={{ display: 'grid', gap: 8 }}>
                <button className='button button-primary' onClick={() => void rerunTask()} disabled={isRerunBusy}>
                  {isRerunBusy ? t('taskDetail.rerunning') : t('taskDetail.rerunTask')}
                </button>
                <button
                  className='button button-outline'
                  onClick={() => void cancelTask()}
                  disabled={isCancelBusy || !(task.status === 'queued' || task.status === 'running')}
                >
                  {isCancelBusy ? t('taskDetail.stopping') : t('taskDetail.stopTask')}
                </button>
                <button className='button button-outline' onClick={downloadLogs}>{t('taskDetail.downloadLogs')}</button>
                {task.pr_url ? <a href={task.pr_url} target='_blank' rel='noreferrer' className='button button-outline'>{t('taskDetail.openPullRequest')}</a> : null}
                {task.branch_name ? (
                  <button className='button button-outline' onClick={() => navigator.clipboard.writeText(task.branch_name || '')}>
                    {t('taskDetail.copyBranch')}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          {error ? <p style={{ color: '#f87171', marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
        </section>

        <section style={{ display: 'grid', gap: 12 }}>
          <section style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 10, color: 'rgba(255,255,255,0.9)', fontSize: 15 }}>{t('taskDetail.executionSteps')}</h3>
            <div style={{ border: `1px solid ${currentActivity.color}66`, background: `${currentActivity.color}18`, borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: currentActivity.color,
                      boxShadow: currentActivity.pulse ? `0 0 0 4px ${currentActivity.color}33` : 'none',
                    }}
                  />
                  <span style={{ color: currentActivity.color, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {currentActivity.title}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>
                  {latestLog ? `${t('taskDetail.updated')} ${fmtAgo(latestLog.created_at, clockMs)}` : t('taskDetail.autoRefresh')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', lineHeight: 1.45, marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                {currentActivity.detail}
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${executionProgress.percent}%`,
                    height: '100%',
                    background: currentActivity.color,
                    transition: 'width .35s ease',
                  }}
                />
              </div>
              <div style={{ marginTop: 5, fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                {t('taskDetail.progress')}: {executionProgress.doneCount}/{executionProgress.total} {t('taskDetail.steps')} ({executionProgress.percent}%)
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {executionProgress.effectiveSteps.map((step) => {
                const item = stepMap[step];
                const done = Boolean(item);
                const color = done ? stageColor(step) : 'rgba(255,255,255,0.25)';
                return (
                  <div key={step} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color }}>{step}</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item?.message || t('taskDetail.pending')}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{item ? new Date(item.created_at).toLocaleTimeString() : '—'}</span>
                  </div>
                );
              })}
              {stepMap.failed ? (
                <div style={{ border: '1px solid rgba(248,113,113,0.5)', borderRadius: 10, padding: '8px 10px', background: 'rgba(248,113,113,0.08)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', marginBottom: 4 }}>{t('taskDetail.failed')}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', whiteSpace: 'pre-wrap' }}>{stepMap.failed.message}</div>
                </div>
              ) : null}
            </div>
          </section>

          <section style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 10, color: 'rgba(255,255,255,0.9)', fontSize: 15 }}>{t('taskDetail.codeDiffPreview')}</h3>
            {codeFiles.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t('taskDetail.noGeneratedCode')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                  {codeFiles.map((file, idx) => (
                    <button
                      key={`${file.path}-${idx}`}
                      onClick={() => setActiveCodeTab(idx)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 999,
                        border: activeCodeTab === idx ? '1px solid rgba(94,234,212,0.55)' : '1px solid rgba(255,255,255,0.15)',
                        background: activeCodeTab === idx ? 'rgba(94,234,212,0.12)' : 'transparent',
                        color: activeCodeTab === idx ? '#5eead4' : 'rgba(255,255,255,0.65)',
                        fontSize: 11,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>
                {activeCode ? (
                  <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{activeCode.path}</div>
                    {renderCodeContent(activeCode)}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden', minHeight: 380, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: 15 }}>{t('taskDetail.liveLogs')}</h3>
                <span style={{ fontSize: 12, color: streamState === 'live' ? '#22c55e' : streamState === 'reconnecting' ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>
                  {streamState === 'live' ? t('taskDetail.liveOn') : streamState === 'reconnecting' ? t('taskDetail.reconnecting') : t('taskDetail.offline')}
                  {latestLog ? ` • ${latestLog.stage} • ${new Date(latestLog.created_at).toLocaleTimeString()}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[
                  { key: 'all', label: t('taskDetail.filterAll') },
                  { key: 'errors', label: t('taskDetail.filterErrors') },
                  { key: 'code', label: t('taskDetail.filterCode') },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setLogFilter(f.key as 'all' | 'errors' | 'code')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: logFilter === f.key ? '1px solid rgba(94,234,212,0.55)' : '1px solid rgba(255,255,255,0.15)',
                      background: logFilter === f.key ? 'rgba(94,234,212,0.12)' : 'transparent',
                      color: logFilter === f.key ? '#5eead4' : 'rgba(255,255,255,0.6)',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div ref={liveStripRef} style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'thin' }}>
                {liveLogs.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>{t('taskDetail.noLiveLogs')}</div>
                ) : (
                  liveLogs.map((log, idx) => {
                    const color = stageColor(log.stage);
                    return (
                      <div key={`${log.created_at}-${idx}`} style={{ minWidth: isMobile ? 240 : 280, maxWidth: 360, borderRadius: 10, border: `1px solid ${color}55`, background: `${color}12`, padding: '8px 9px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{log.stage}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{log.message}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>{new Date(log.created_at).toLocaleString()}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: 10 }}>
              <div style={{ border: `1px solid ${latestFailure ? 'rgba(248,113,113,0.35)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, padding: '8px 10px', marginBottom: 10, background: latestFailure ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.015)' }}>
                <div style={{ fontSize: 11, color: latestFailure ? '#f87171' : 'rgba(255,255,255,0.6)', fontWeight: 700, textTransform: 'uppercase' }}>{t('taskDetail.failureAnalysis')}: {t(failure.labelKey as never)}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>{t(failure.detailKey as never)}</div>
              </div>
              {logHistory.length === 0 ? (
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, margin: 0 }}>{t('taskDetail.noLogs')}</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {logHistory.map((log, idx) => {
                    const color = stageColor(log.stage);
                    return (
                      <div key={`${log.created_at}-${idx}-history`} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.015)', padding: '9px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8 }}>{log.stage}</span>
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.45, whiteSpace: log.stage === 'code_preview' || log.stage === 'code_diff' ? 'pre-wrap' : 'normal', fontFamily: log.stage === 'code_preview' || log.stage === 'code_diff' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', overflowX: log.stage === 'code_preview' || log.stage === 'code_diff' ? 'auto' : 'visible' }}>
                          {log.message}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
