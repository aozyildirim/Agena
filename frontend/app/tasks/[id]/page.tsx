'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, getToken, loadPrefs, resolveApiBase } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import RemoteRepoSelector, { type RemoteRepoSelection, type RepoDefault } from '@/components/RemoteRepoSelector';
import { useLocale, type TranslationKey } from '@/lib/i18n';

type TaskDetail = {
  id: number;
  title: string;
  description: string;
  preferred_agent_model?: string | null;
  preferred_agent_provider?: string | null;
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
  last_mode?: string | null;
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
  repo_assignments?: {
    id: number;
    repo_mapping_id: number;
    repo_display_name: string;
    status: string;
    pr_url?: string | null;
    branch_name?: string | null;
    failure_reason?: string | null;
  }[];
};

type TaskLog = {
  id?: number;
  stage: string;
  message: string;
  created_at: string;
};

type RunInfo = {
  id: number;
  task_id: number;
  source: string;
  usage_total_tokens: number;
  estimated_cost_usd: number;
  pr_url?: string | null;
  created_at: string;
};

type CodeFile = {
  path: string;
  content: string;
  isDiff?: boolean;
};

type MemoryImpact = {
  mode: string;
  hits: number;
  best_score: number | null;
  avg_score: number | null;
  top_matches: Array<{ key: string; score: number | null; preview: string }>;
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
    memory_impact: '#5eead4',
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

function parseMemoryImpact(logs: TaskLog[]): MemoryImpact | null {
  const item = [...logs].reverse().find((l) => l.stage === 'memory_impact');
  if (!item) return null;
  const marker = 'MemoryImpactJSON:';
  const idx = item.message.indexOf(marker);
  if (idx < 0) return null;
  const raw = item.message.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(raw) as MemoryImpact;
    return {
      mode: String(parsed.mode || 'unknown'),
      hits: Number.isFinite(parsed.hits) ? Number(parsed.hits) : 0,
      best_score: parsed.best_score === null || parsed.best_score === undefined ? null : Number(parsed.best_score),
      avg_score: parsed.avg_score === null || parsed.avg_score === undefined ? null : Number(parsed.avg_score),
      top_matches: Array.isArray(parsed.top_matches)
        ? parsed.top_matches.map((row) => ({
          key: String(row?.key || ''),
          score: row?.score === null || row?.score === undefined ? null : Number(row.score),
          preview: String(row?.preview || ''),
        }))
        : [],
    };
  } catch {
    return null;
  }
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

/** Split flat log array into per-run groups using 'running' stage as boundary */
function splitLogsByRun(allLogs: TaskLog[]): TaskLog[][] {
  if (allLogs.length === 0) return [[]];
  const runs: TaskLog[][] = [];
  let current: TaskLog[] = [];
  for (const log of allLogs) {
    if (log.stage === 'running' && current.length > 0) {
      runs.push(current);
      current = [];
    }
    current.push(log);
  }
  if (current.length > 0) runs.push(current);
  return runs.length > 0 ? runs : [[]];
}

function showConflictDialog(info: string, onQueue: () => void) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '999999', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
  });
  overlay.innerHTML = `
    <div style="width:100%;max-width:440px;border-radius:16px;border:1px solid rgba(255,255,255,0.08);background:#1a1a2e;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#e2e8f0">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);display:flex;align-items:center;justify-content:center;font-size:18px">&#9888;&#65039;</div>
        <div style="font-size:16px;font-weight:700">Repo Busy</div>
      </div>
      <p style="font-size:13px;color:#94a3b8;line-height:1.6;margin:0 0 8px">This repo already has an active task:</p>
      <div style="padding:10px 14px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);font-size:12px;color:#cbd5e1;margin-bottom:16px;word-break:break-word">${info.replace(/</g, '&lt;')}</div>
      <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 20px">Queue this task to run after the current one finishes?</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="conflict-cancel" style="padding:8px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#94a3b8;font-size:13px;font-weight:600;cursor:pointer">Cancel</button>
        <button id="conflict-queue" style="padding:8px 20px;border-radius:8px;border:none;background:#0d9488;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Queue Anyway</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { document.body.removeChild(overlay); } });
  overlay.querySelector('#conflict-cancel')!.addEventListener('click', () => { document.body.removeChild(overlay); });
  overlay.querySelector('#conflict-queue')!.addEventListener('click', () => { document.body.removeChild(overlay); onQueue(); });
}

export default function TaskDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const lastLogIdRef = useRef(0);
  const [isMobile, setIsMobile] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'errors' | 'code'>('all');
  const [activeCodeTab, setActiveCodeTab] = useState(0);
  const [isRerunBusy, setIsRerunBusy] = useState(false);
  const [showRunConfig, setShowRunConfig] = useState(false);

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = showRunConfig ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showRunConfig]);
  const [isCancelBusy, setIsCancelBusy] = useState(false);
  const [isDepsBusy, setIsDepsBusy] = useState(false);
  const [selectedDependencyIds, setSelectedDependencyIds] = useState<number[]>([]);
  const [dependencyCandidates, setDependencyCandidates] = useState<DependencyTaskOption[]>([]);
  const [depsData, setDepsData] = useState<TaskDeps | null>(null);
  const [defaultCreatePr, setDefaultCreatePr] = useState(true);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [selectedRunIndex, setSelectedRunIndex] = useState<number>(-1); // -1 = latest
  const [terminalAutoScroll, setTerminalAutoScroll] = useState(true);

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [streamState, setStreamState] = useState<'live' | 'reconnecting' | 'offline'>('offline');

  async function loadData() {
    try {
      const [taskData, logsData, runsData, taskList] = await Promise.all([
        apiFetch<TaskDetail>('/tasks/' + taskId),
        apiFetch<TaskLog[]>('/tasks/' + taskId + '/logs'),
        apiFetch<RunInfo[]>('/tasks/' + taskId + '/runs').catch(() => [] as RunInfo[]),
        apiFetch<DependencyTaskOption[]>('/tasks'),
      ]);
      setTask(taskData);
      setLogs(logsData);
      setRuns(runsData);
      const currentTaskId = Number(taskId);
      setDependencyCandidates(taskList.filter((item) => item.id !== currentTaskId));
      const d = await apiFetch<TaskDeps>('/tasks/' + taskId + '/dependencies');
      setDepsData(d);
      setSelectedDependencyIds(d.depends_on_task_ids || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('taskDetail.errorLoad'));
    } finally {
      setLoading(false);
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
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalAutoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, terminalAutoScroll]);

  // Split logs into runs
  const logRuns = useMemo(() => splitLogsByRun(logs), [logs]);
  const activeRunIndex = selectedRunIndex === -1 ? logRuns.length - 1 : selectedRunIndex;
  const activeRunLogs = logRuns[activeRunIndex] || [];
  const isLatestRun = activeRunIndex === logRuns.length - 1;

  const filteredLogs = useMemo(() => {
    if (logFilter === 'errors') return activeRunLogs.filter((item) => item.stage === 'failed' || /error|failed|timeout/i.test(item.message));
    if (logFilter === 'code') return activeRunLogs.filter((item) => item.stage === 'code_preview' || item.stage === 'code_ready' || item.stage === 'code_diff');
    return activeRunLogs;
  }, [activeRunLogs, logFilter]);

  const logHistory = useMemo(() => [...filteredLogs].reverse(), [filteredLogs]);
  const latestLog = activeRunLogs.length > 0 ? activeRunLogs[activeRunLogs.length - 1] : null;
  const metrics = useMemo(() => parseRunMetrics(activeRunLogs), [activeRunLogs]);
  const codeFiles = useMemo(() => parseCodePreview(activeRunLogs), [activeRunLogs]);
  const memoryImpact = useMemo(() => parseMemoryImpact(activeRunLogs), [activeRunLogs]);
  const latestFailure = useMemo(() => {
    const failedLog = [...activeRunLogs].reverse().find((l) => l.stage === 'failed');
    return (isLatestRun ? task?.failure_reason : null) || failedLog?.message || '';
  }, [task?.failure_reason, activeRunLogs, isLatestRun]);
  const failure = useMemo(() => classifyFailure(latestFailure), [latestFailure]);

  const createdAt = useMemo(() => activeRunLogs.find((l) => l.stage === 'created' || l.stage === 'queued')?.created_at || task?.created_at || '', [activeRunLogs, task?.created_at]);
  const runningAt = useMemo(() => activeRunLogs.find((l) => l.stage === 'running')?.created_at || '', [activeRunLogs]);
  const queueWaitSec = useMemo(() => {
    if (!createdAt || !runningAt) return null;
    return Math.max(0, Math.round((new Date(runningAt).getTime() - new Date(createdAt).getTime()) / 1000));
  }, [createdAt, runningAt]);

  const stepMap = useMemo(() => {
    const map: Record<string, TaskLog | undefined> = {};
    for (const step of STEP_ORDER) {
      if (step === 'agent') {
        map[step] = activeRunLogs.find((l) =>
          ['agent', 'analyze', 'generate_code', 'review_code', 'finalize', 'playbook'].includes(l.stage),
        );
        continue;
      }
      map[step] = activeRunLogs.find((l) => l.stage === step);
    }
    if (!map.completed) map.failed = activeRunLogs.find((l) => l.stage === 'failed');
    return map;
  }, [activeRunLogs]);

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
      color: 'var(--ink-65)',
      pulse: false,
    };
    if (!task) return fallback;
    if (!isLatestRun) {
      const hasCompleted = activeRunLogs.some((l) => l.stage === 'completed');
      const hasFailed = activeRunLogs.some((l) => l.stage === 'failed');
      if (hasCompleted) return { title: t('taskDetail.completed'), detail: t('taskDetail.executionDone'), color: '#22c55e', pulse: false };
      if (hasFailed) return { title: t('taskDetail.failed'), detail: latestFailure || t('taskDetail.executionFailedNoDetail'), color: '#f87171', pulse: false };
      return { title: 'Run #' + (activeRunIndex + 1), detail: latestLog?.message || '', color: '#94a3b8', pulse: false };
    }
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
  }, [task, latestLog, latestFailure, isLatestRun, activeRunIndex, activeRunLogs]);

  function handleRunClick() {
    // Check if task already has repo config in description
    const desc = (task?.description || '').toLowerCase();
    const hasRepo = desc.includes('local repo path') || desc.includes('remote repo');
    // Always show run config so user can pick model/provider each time
    setShowRunConfig(true);
  }

  async function rerunTask(extraDesc?: string, agentOpts?: { provider?: string; model?: string; createPr?: boolean; mode?: string; flowId?: string }, forceQueue = false) {
    if (!taskId) return;
    const body: Record<string, unknown> = {
      create_pr: agentOpts?.createPr ?? defaultCreatePr,
      mode: agentOpts?.mode || task?.last_mode || 'ai',
      agent_model: agentOpts?.model || task?.preferred_agent_model || undefined,
      agent_provider: agentOpts?.provider || task?.preferred_agent_provider || undefined,
      extra_description: extraDesc || undefined,
      flow_id: agentOpts?.flowId || undefined,
    };
    if (forceQueue) body.force_queue = true;
    try {
      setIsRerunBusy(true);
      setShowRunConfig(false);
      await apiFetch('/tasks/' + taskId + '/assign', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSelectedRunIndex(-1);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('REPO_CONFLICT:')) {
        setShowRunConfig(false);
        const info = msg.replace('REPO_CONFLICT:', '').trim();
        showConflictDialog(info, async () => {
          await rerunTask(
            body.extra_description as string | undefined,
            {
              provider: body.agent_provider as string | undefined,
              model: body.agent_model as string | undefined,
              createPr: body.create_pr as boolean | undefined,
              mode: body.mode as string | undefined,
              flowId: body.flow_id as string | undefined,
            },
            true,
          );
        });
      } else {
        setError(msg || t('taskDetail.errorRerun'));
      }
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
    const body = activeRunLogs
      .map((l) => `[${new Date(l.created_at).toISOString()}] ${l.stage}\n${l.message}\n`)
      .join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t('taskDetail.task').toLowerCase()}-${taskId}-run${activeRunIndex + 1}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeCode = codeFiles[activeCodeTab];
  const renderCodeContent = (item: CodeFile) => {
    if (!item.isDiff) {
      return (
        <pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', padding: 10, fontSize: 12, lineHeight: 1.45, color: 'var(--ink-90)' }}>
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
          const color = isAdd ? '#86efac' : isDel ? '#fca5a5' : 'var(--ink-90)';
          return (
            <div key={`${idx}-${line.slice(0, 8)}`} style={{ padding: '1px 10px', background: bg, color, whiteSpace: 'pre' }}>
              {line || ' '}
            </div>
          );
        })}
      </div>
    );
  };

  // Get run info for the matched RunRecord (if exists)
  const activeRunRecord = runs[activeRunIndex] || null;

  return (
    <div className='container' style={{ paddingTop: 96, paddingBottom: 20, maxWidth: 1820 }}>
      {/* Top action bar */}
      <section style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, flex: 1, minWidth: 200, lineHeight: 1.3 }}>
          <span style={{ color: 'var(--ink-35)', fontWeight: 600 }}>#{task?.id}</span>{' '}
          {task?.title ?? t('taskDetail.task')}
        </h1>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className='button button-primary' onClick={handleRunClick} disabled={isRerunBusy} style={{ padding: '8px 18px', fontSize: 13 }}>
            {isRerunBusy ? t('taskDetail.rerunning') : t('taskDetail.rerunTask')}
          </button>
          <button
            className='button button-outline'
            onClick={() => void cancelTask()}
            disabled={isCancelBusy || !(task?.status === 'queued' || task?.status === 'running')}
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            {isCancelBusy ? t('taskDetail.stopping') : t('taskDetail.stopTask')}
          </button>
        </div>
      </section>

      {/* Run selector tabs */}
      {logRuns.length > 1 && (
        <section
          style={{
            borderRadius: 16,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--panel)',
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Runs ({logRuns.length})
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {logRuns.map((runLogs, idx) => {
              const isActive = idx === activeRunIndex;
              const hasCompleted = runLogs.some((l) => l.stage === 'completed');
              const hasFailed = runLogs.some((l) => l.stage === 'failed');
              const isRunning = idx === logRuns.length - 1 && task?.status === 'running';
              const statusColor = hasCompleted ? '#22c55e' : hasFailed ? '#f87171' : isRunning ? '#38bdf8' : '#a3a3a3';
              const runRecord = runs[idx];
              const runTime = runLogs[0]?.created_at ? new Date(runLogs[0].created_at).toLocaleTimeString() : '';
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedRunIndex(idx === logRuns.length - 1 ? -1 : idx)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: isActive ? `1px solid ${statusColor}88` : '1px solid var(--panel-border-3)',
                    background: isActive ? `${statusColor}18` : 'var(--panel-alt)',
                    color: isActive ? statusColor : 'var(--ink-65)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 3,
                    minWidth: 120,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor, flexShrink: 0 }} />
                    Run #{idx + 1}
                    {isRunning && <span style={{ fontSize: 10, opacity: 0.7 }}>(live)</span>}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 400 }}>
                    {runTime}
                    {runRecord ? ` | ${Math.round(runRecord.usage_total_tokens)} tok` : ` | ${runLogs.length} logs`}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Top stats strip */}
      <section
        style={{
          borderRadius: 16,
          border: '1px solid var(--panel-border-2)',
          background: 'var(--panel)',
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
          [t('taskDetail.logs'), String(activeRunLogs.length)],
        ].map(([k, v]) => (
          <div key={k} style={{ border: '1px solid var(--panel-border)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'var(--ink-35)', textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-90)', fontWeight: 700, textTransform: k === t('taskDetail.source') ? 'capitalize' : 'none' }}>{v}</div>
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
              <p style={{ marginTop: 0, color: 'var(--ink-78)', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.description}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <StatusBadge status={task.status} />
                <span style={{ color: 'var(--ink-50)', fontSize: 13, textTransform: 'capitalize' }}>{t('taskDetail.source')}: {task.source}</span>
                {(task.preferred_agent_provider || task.preferred_agent_model) ? (
                  <span style={{ color: 'var(--ink-50)', fontSize: 13 }}>
                    {t('agents.provider')}: {task.preferred_agent_provider || '—'} | {t('agents.model')}: {task.preferred_agent_model || '—'}
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button className='button button-primary' onClick={handleRunClick} disabled={isRerunBusy} style={{ flex: 1 }}>
                  {isRerunBusy ? t('taskDetail.rerunning') : t('taskDetail.rerunTask')}
                </button>
                <button
                  className='button button-outline'
                  onClick={() => void cancelTask()}
                  disabled={isCancelBusy || !(task.status === 'queued' || task.status === 'running')}
                  style={{ flex: 1 }}
                >
                  {isCancelBusy ? t('taskDetail.stopping') : t('taskDetail.stopTask')}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <button className='button button-outline' onClick={downloadLogs} style={{ fontSize: 11, padding: '5px 10px' }}>{t('taskDetail.downloadLogs')}</button>
                {task.repo_assignments && task.repo_assignments.length > 0 ? (
                  task.repo_assignments.filter((ra) => ra.pr_url).map((ra) => (
                    <a key={ra.id} href={ra.pr_url!} target='_blank' rel='noreferrer' className='button button-outline' style={{ fontSize: 11, padding: '5px 10px' }}>
                      {t('taskDetail.openPullRequest')} — {ra.repo_display_name.split('/').pop()}
                    </a>
                  ))
                ) : task.pr_url ? (
                  <a href={task.pr_url} target='_blank' rel='noreferrer' className='button button-outline' style={{ fontSize: 11, padding: '5px 10px' }}>{t('taskDetail.openPullRequest')}</a>
                ) : null}
                {task.repo_assignments && task.repo_assignments.length > 0 ? (
                  task.repo_assignments.filter((ra) => ra.branch_name).map((ra) => (
                    <button key={ra.id} className='button button-outline' onClick={() => navigator.clipboard.writeText(ra.branch_name || '')} style={{ fontSize: 11, padding: '5px 10px' }}>
                      {t('taskDetail.copyBranch')} — {ra.repo_display_name.split('/').pop()}
                    </button>
                  ))
                ) : task.branch_name ? (
                  <button className='button button-outline' onClick={() => navigator.clipboard.writeText(task.branch_name || '')} style={{ fontSize: 11, padding: '5px 10px' }}>
                    {t('taskDetail.copyBranch')}
                  </button>
                ) : null}
              </div>
              {/* Multi-repo assignment cards */}
              {task.repo_assignments && task.repo_assignments.length > 0 && (
                <div style={{ border: '1px solid rgba(94,234,212,0.25)', borderRadius: 10, background: 'rgba(94,234,212,0.06)', padding: '9px 10px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', textTransform: 'uppercase', marginBottom: 6 }}>{t('taskDetail.repoAssignments' as never)}</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {task.repo_assignments.map((ra) => {
                      const sc: Record<string, string> = { completed: '#22c55e', running: '#38bdf8', failed: '#f87171', queued: '#f59e0b', new: '#94a3b8' };
                      const c = sc[ra.status] ?? '#6b7280';
                      return (
                        <div key={ra.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-78)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ra.repo_display_name}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${c}18`, color: c, textTransform: 'capitalize' }}>
                            {ra.status}
                          </span>
                          {ra.pr_url && (
                            <a href={ra.pr_url} target='_blank' rel='noreferrer' style={{ fontSize: 11, color: '#5eead4', textDecoration: 'none', whiteSpace: 'nowrap' }}>PR ↗</a>
                          )}
                          {ra.failure_reason && (
                            <span style={{ fontSize: 10, color: '#f87171', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ra.failure_reason}>
                              {ra.failure_reason}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gap: 7, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{t('taskDetail.created')}: {new Date(task.created_at).toLocaleString()}</div>
                {metrics?.startedAt ? <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{t('taskDetail.runStart')}: {new Date(metrics.startedAt).toLocaleString()}</div> : null}
                {metrics?.finishedAt ? <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{t('taskDetail.runEnd')}: {new Date(metrics.finishedAt).toLocaleString()}</div> : null}
              </div>
              {(task.story_context || task.acceptance_criteria || task.edge_cases || task.max_tokens || task.max_cost_usd) ? (
                <div style={{ border: '1px solid rgba(56,189,248,0.25)', borderRadius: 10, background: 'rgba(56,189,248,0.06)', padding: '9px 10px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7dd3fc', textTransform: 'uppercase', marginBottom: 5 }}>{t('taskDetail.storyGuardrails')}</div>
                  {task.story_context ? <div style={{ fontSize: 12, color: 'var(--ink-78)', marginBottom: 4 }}><b>{t('taskDetail.context')}:</b> {task.story_context}</div> : null}
                  {task.acceptance_criteria ? <div style={{ fontSize: 12, color: 'var(--ink-72)', marginBottom: 4 }}><b>{t('taskDetail.acceptance')}:</b> {task.acceptance_criteria}</div> : null}
                  {task.edge_cases ? <div style={{ fontSize: 12, color: 'var(--ink-72)', marginBottom: 4 }}><b>{t('taskDetail.edgeCases')}:</b> {task.edge_cases}</div> : null}
                  <div style={{ fontSize: 12, color: 'var(--ink-65)' }}>
                    {t('taskDetail.guardrails')}: max_tokens={task.max_tokens ?? '—'} | max_cost_usd={task.max_cost_usd ?? '—'}
                  </div>
                </div>
              ) : null}
              {(task.lock_scope || task.blocked_by_task_id || (task.queue_position !== null && task.queue_position !== undefined)) ? (
                <div style={{ border: '1px solid rgba(94,234,212,0.25)', borderRadius: 10, background: 'rgba(94,234,212,0.06)', padding: '9px 10px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', textTransform: 'uppercase', marginBottom: 5 }}>{t('taskDetail.queueInsight')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-78)', lineHeight: 1.45 }}>
                    {task.queue_position !== null && task.queue_position !== undefined ? `${t('taskDetail.position')}: #${task.queue_position} | ` : ''}
                    ETA: {fmtEta(task.estimated_start_sec)}
                  </div>
                  {task.blocked_by_task_id ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-72)', marginTop: 4 }}>
                      {t('taskDetail.blockedBy')} #{task.blocked_by_task_id}{task.blocked_by_task_title ? ` — ${task.blocked_by_task_title}` : ''}
                    </div>
                  ) : null}
                  {task.lock_scope ? (
                    <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4, wordBreak: 'break-all' }}>
                      {t('taskDetail.lockScope')}: {task.lock_scope}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 10, padding: '9px 10px', marginBottom: 12, background: 'var(--panel)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-72)', textTransform: 'uppercase', marginBottom: 6 }}>{t('taskDetail.dependencies')}</div>

                {/* Blocker status banner */}
                {(depsData?.blocker_task_ids || []).length > 0 ? (
                  <div style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)', marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 3 }}>
                      &#9888; {t('tasks.deps.blockedBy' as TranslationKey)}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                      {(depsData?.blocker_task_ids || []).map((blockerId) => {
                        const blockerTask = dependencyCandidates.find((c) => c.id === blockerId);
                        return (
                          <span key={blockerId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
                            #{blockerId} {blockerTask ? blockerTask.title : ''}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>
                      {t('tasks.deps.blockerWarning' as TranslationKey)}
                    </div>
                  </div>
                ) : (depsData?.depends_on_task_ids || []).length > 0 ? (
                  <div style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.06)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#22c55e', fontSize: 13 }}>&#10003;</span>
                    <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{t('tasks.deps.noBlockers' as TranslationKey)}</span>
                  </div>
                ) : null}

                {/* Auto-queue indicator */}
                {(depsData?.blocker_task_ids || []).length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--ink-45)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'pulse-brand 2s infinite' }} />
                    {t('tasks.deps.autoQueue' as TranslationKey)}
                  </div>
                )}

                {/* Visual dependency flow */}
                {(depsData?.depends_on_task_ids || []).length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 10, padding: '6px 8px', borderRadius: 8, background: 'var(--panel-alt)' }}>
                    {(depsData?.depends_on_task_ids || []).map((depId, idx) => {
                      const depTask = dependencyCandidates.find((c) => c.id === depId);
                      const isBlocked = (depsData?.blocker_task_ids || []).includes(depId);
                      const depStatus = depTask?.status || 'unknown';
                      const depColor = depStatus === 'completed' ? '#22c55e' : depStatus === 'running' ? '#f59e0b' : depStatus === 'failed' ? '#f87171' : 'var(--ink-45)';
                      return (
                        <span key={depId} style={{ display: 'contents' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: `1px solid ${depColor}40`, background: `${depColor}12`, color: depColor }}>
                            {depStatus === 'completed' ? '\u2713' : depStatus === 'running' ? '\u25CB' : depStatus === 'failed' ? '\u2717' : '\u25CB'}{' '}
                            #{depId} {depTask ? depTask.title.slice(0, 20) + (depTask.title.length > 20 ? '...' : '') : ''}
                          </span>
                          {idx < (depsData?.depends_on_task_ids || []).length - 1 && (
                            <span style={{ color: 'var(--ink-35)', fontSize: 11 }}>&rarr;</span>
                          )}
                        </span>
                      );
                    })}
                    <span style={{ color: 'var(--ink-35)', fontSize: 11 }}>&rarr;</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8' }}>
                      {t('tasks.deps.waiting' as TranslationKey)}
                    </span>
                  </div>
                )}

                {/* Dependent tasks (downstream) */}
                {(depsData?.dependent_task_ids || []).length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', marginBottom: 4 }}>{t('tasks.deps.dependents' as TranslationKey)}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(depsData?.dependent_task_ids || []).map((depId) => {
                        const depTask = dependencyCandidates.find((c) => c.id === depId);
                        return (
                          <span key={depId} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid rgba(94,234,212,0.25)', background: 'rgba(94,234,212,0.06)', color: '#5eead4' }}>
                            #{depId} {depTask ? depTask.title.slice(0, 25) + (depTask.title.length > 25 ? '...' : '') : ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 11, color: 'var(--ink-45)', marginBottom: 6 }}>
                  {t('taskDetail.selectedDependencies')}: {selectedDependencyIds.length}
                </div>
                <div
                  style={{
                    borderRadius: 10,
                    border: '1px solid var(--panel-border-3)',
                    background: 'var(--panel-alt)',
                    maxHeight: 170,
                    overflowY: 'auto',
                    padding: '6px 8px',
                    display: 'grid',
                    gap: 4,
                  }}
                >
                  {dependencyCandidates.length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--ink-45)', padding: '4px 2px' }}>{t('taskDetail.noOtherTasks')}</div>
                  ) : (
                    dependencyCandidates.map((candidate) => {
                      const checked = selectedDependencyIds.includes(candidate.id);
                      const isBlocker = (depsData?.blocker_task_ids || []).includes(candidate.id);
                      const sColor = candidate.status === 'completed' ? '#22c55e' : candidate.status === 'running' ? '#f59e0b' : candidate.status === 'failed' ? '#f87171' : 'var(--ink-45)';
                      return (
                        <label key={candidate.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: checked ? 'rgba(94,234,212,0.06)' : 'transparent', transition: 'background 0.15s' }}>
                          <input
                            type='checkbox'
                            checked={checked}
                            onChange={(e) => {
                              setSelectedDependencyIds((prev) => {
                                if (e.target.checked) return Array.from(new Set([...prev, candidate.id]));
                                return prev.filter((id) => id !== candidate.id);
                              });
                            }}
                            style={{ accentColor: '#0d9488', width: 14, height: 14, flexShrink: 0 }}
                          />
                          <span style={{ fontSize: 12, color: checked ? 'var(--ink-90)' : 'var(--ink-72)', lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 5 }}>
                            #{candidate.id} {candidate.title}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: `${sColor}15`, color: sColor }}>
                              {candidate.status}
                            </span>
                            {isBlocker && (
                              <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>&#9888;</span>
                            )}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    className='button button-outline'
                    onClick={() => setSelectedDependencyIds([])}
                    type='button'
                    style={{ fontSize: 11, padding: '5px 10px' }}
                  >
                    {t('taskDetail.clearSelection')}
                  </button>
                  <button className='button button-outline' onClick={() => void saveDependencies()} disabled={isDepsBusy} style={{ fontSize: 11, padding: '5px 10px' }}>
                    {isDepsBusy ? t('taskDetail.saving') : t('taskDetail.saveDependencies')}
                  </button>
                </div>
              </div>
              {(task.pr_risk_score !== null && task.pr_risk_score !== undefined) ? (
                <div style={{ border: '1px solid rgba(245,158,11,0.28)', borderRadius: 10, padding: '9px 10px', marginBottom: 12, background: 'rgba(245,158,11,0.08)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 4 }}>{t('taskDetail.prRisk')}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-90)' }}>
                    {t('taskDetail.score')}: <b>{task.pr_risk_score}</b> / 100 ({task.pr_risk_level || t('taskDetail.unknown')})
                  </div>
                  {task.pr_risk_reason ? <div style={{ fontSize: 12, color: 'var(--ink-65)', marginTop: 3 }}>{task.pr_risk_reason}</div> : null}
                </div>
              ) : null}

              {/* action buttons moved to top of sidebar */}
            </>
          ) : null}
          {error ? <p style={{ color: '#f87171', marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
        </section>

        <section style={{ display: 'grid', gap: 12 }}>
          {/* Terminal-like agent output */}
          <section
            style={{
              borderRadius: 16,
              border: isLatestRun && task?.status === 'running'
                ? '1px solid rgba(56,189,248,0.35)'
                : '1px solid var(--panel-border-2)',
              background: 'var(--terminal-bg)',
              overflow: 'hidden',
              minHeight: 320,
              display: 'grid',
              gridTemplateRows: 'auto 1fr',
            }}
          >
            <div style={{
              borderBottom: '1px solid var(--panel-border-2)',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--panel-alt)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: '#f87171' }} />
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: '#fbbf24' }} />
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: '#22c55e' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-72)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  Agent Output — Run #{activeRunIndex + 1}
                </span>
                {isLatestRun && task?.status === 'running' && (
                  <span style={{
                    fontSize: 10,
                    color: '#38bdf8',
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: '1px solid rgba(56,189,248,0.4)',
                    background: 'rgba(56,189,248,0.12)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    animation: 'pulse 2s ease-in-out infinite',
                  }}>
                    LIVE
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: streamState === 'live' ? '#22c55e' : streamState === 'reconnecting' ? '#f59e0b' : 'var(--ink-35)' }}>
                  {streamState === 'live' ? t('taskDetail.liveOn') : streamState === 'reconnecting' ? t('taskDetail.reconnecting') : t('taskDetail.offline')}
                </span>
                <button
                  onClick={() => setTerminalAutoScroll(!terminalAutoScroll)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--panel-border-4)',
                    background: terminalAutoScroll ? 'rgba(94,234,212,0.15)' : 'transparent',
                    color: terminalAutoScroll ? '#5eead4' : 'var(--ink-50)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Auto-scroll {terminalAutoScroll ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>
            <div
              ref={terminalRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                if (terminalAutoScroll && !atBottom) setTerminalAutoScroll(false);
                if (!terminalAutoScroll && atBottom) setTerminalAutoScroll(true);
              }}
              style={{
                overflowY: 'auto',
                padding: '10px 14px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--ink-78)',
                maxHeight: 420,
              }}
            >
              {activeRunLogs.length === 0 ? (
                <div style={{ color: 'var(--ink-30)' }}>Waiting for agent output...</div>
              ) : (
                activeRunLogs.map((log, idx) => {
                  const color = stageColor(log.stage);
                  const ts = new Date(log.created_at).toLocaleTimeString();
                  return (
                    <div key={`${log.id || idx}-term`} style={{ marginBottom: 2, display: 'flex', gap: 0 }}>
                      <span style={{ color: 'var(--ink-25)', minWidth: 70, flexShrink: 0 }}>{ts}</span>
                      <span style={{ color, fontWeight: 700, minWidth: 110, flexShrink: 0, textTransform: 'uppercase', fontSize: 11, paddingTop: 1 }}>{log.stage}</span>
                      <span style={{
                        color: log.stage === 'failed' ? '#fca5a5' : 'var(--ink-78)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}>
                        {log.message}
                      </span>
                    </div>
                  );
                })
              )}
              {isLatestRun && task?.status === 'running' && (
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#38bdf8', animation: 'pulse 1.5s ease-in-out infinite' }}>_</span>
                </div>
              )}
            </div>
          </section>

          {/* Execution steps */}
          <section style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 10, color: 'var(--ink-90)', fontSize: 15 }}>{t('taskDetail.executionSteps')}</h3>
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
                <span style={{ fontSize: 11, color: 'var(--ink-42)' }}>
                  {latestLog ? `${t('taskDetail.updated')} ${fmtAgo(latestLog.created_at, clockMs)}` : t('taskDetail.autoRefresh')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-78)', lineHeight: 1.45, marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                {currentActivity.detail}
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--panel-border-3)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${executionProgress.percent}%`,
                    height: '100%',
                    background: currentActivity.color,
                    transition: 'width .35s ease',
                  }}
                />
              </div>
              <div style={{ marginTop: 5, fontSize: 11, color: 'var(--ink-45)' }}>
                {t('taskDetail.progress')}: {executionProgress.doneCount}/{executionProgress.total} {t('taskDetail.steps')} ({executionProgress.percent}%)
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {executionProgress.effectiveSteps.map((step) => {
                const item = stepMap[step];
                const done = Boolean(item);
                const color = done ? stageColor(step) : 'var(--ink-25)';
                return (
                  <div key={step} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '110px 1fr auto', gap: isMobile ? 4 : 10, alignItems: isMobile ? 'flex-start' : 'center', border: '1px solid var(--panel-border)', borderRadius: 10, padding: '8px 10px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color }}>{step}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item?.message || t('taskDetail.pending')}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-42)' }}>{item ? new Date(item.created_at).toLocaleTimeString() : '—'}</span>
                  </div>
                );
              })}
              {stepMap.failed ? (
                <div style={{ border: '1px solid rgba(248,113,113,0.5)', borderRadius: 10, padding: '8px 10px', background: 'rgba(248,113,113,0.08)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', marginBottom: 4 }}>{t('taskDetail.failed')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-90)', whiteSpace: 'pre-wrap' }}>{stepMap.failed.message}</div>
                </div>
              ) : null}
            </div>
          </section>

          {/* Memory impact */}
          <section style={{ borderRadius: 16, border: '1px solid rgba(94,234,212,0.18)', background: 'var(--panel)', padding: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 10, color: '#5eead4', fontSize: 15 }}>{t('taskDetail.memoryImpact')}</h3>
            {!memoryImpact ? (
              <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{t('taskDetail.memoryImpactEmpty')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(0,1fr))', gap: 8 }}>
                  <div style={{ border: '1px solid rgba(94,234,212,0.25)', borderRadius: 10, padding: '8px 10px', background: 'rgba(94,234,212,0.08)' }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-45)', textTransform: 'uppercase' }}>{t('taskDetail.memoryMode')}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#5eead4' }}>{memoryImpact.mode}</div>
                  </div>
                  <div style={{ border: '1px solid rgba(56,189,248,0.25)', borderRadius: 10, padding: '8px 10px', background: 'rgba(56,189,248,0.08)' }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-45)', textTransform: 'uppercase' }}>{t('taskDetail.memoryHits')}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>{memoryImpact.hits}</div>
                  </div>
                  <div style={{ border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, padding: '8px 10px', background: 'rgba(34,197,94,0.08)' }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-45)', textTransform: 'uppercase' }}>{t('taskDetail.memoryBestScore')}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#86efac' }}>{memoryImpact.best_score !== null ? memoryImpact.best_score.toFixed(3) : '—'}</div>
                  </div>
                  <div style={{ border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '8px 10px', background: 'rgba(245,158,11,0.08)' }}>
                    <div style={{ fontSize: 10, color: 'var(--ink-45)', textTransform: 'uppercase' }}>{t('taskDetail.memoryAvgScore')}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>{memoryImpact.avg_score !== null ? memoryImpact.avg_score.toFixed(3) : '—'}</div>
                  </div>
                </div>

                <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--panel-border-2)', fontSize: 11, color: 'var(--ink-58)', textTransform: 'uppercase', fontWeight: 700 }}>
                    {t('taskDetail.memoryTopMatches')}
                  </div>
                  {memoryImpact.top_matches.length === 0 ? (
                    <div style={{ padding: '10px', fontSize: 12, color: 'var(--ink-45)' }}>{t('taskDetail.memoryNoMatch')}</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 0 }}>
                      {memoryImpact.top_matches.map((m, idx) => (
                        <div key={`${m.key}-${idx}`} style={{ padding: '9px 10px', borderTop: idx === 0 ? 'none' : '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '120px 100px 1fr', gap: 8 }}>
                          <div style={{ fontSize: 12, color: 'var(--ink-78)' }}>key: <b>{m.key || '—'}</b></div>
                          <div style={{ fontSize: 12, color: '#7dd3fc' }}>score: {m.score !== null ? m.score.toFixed(3) : '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.preview || '—'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Code diff/preview */}
          <section style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 12 }}>
            <h3 style={{ marginTop: 0, marginBottom: 10, color: 'var(--ink-90)', fontSize: 15 }}>{t('taskDetail.codeDiffPreview')}</h3>
            {codeFiles.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{t('taskDetail.noGeneratedCode')}</div>
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
                        border: activeCodeTab === idx ? '1px solid rgba(94,234,212,0.55)' : '1px solid var(--panel-border-4)',
                        background: activeCodeTab === idx ? 'rgba(94,234,212,0.12)' : 'transparent',
                        color: activeCodeTab === idx ? '#5eead4' : 'var(--ink-65)',
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
                  <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--panel-border-2)', fontSize: 11, color: 'var(--ink-58)' }}>{activeCode.path}</div>
                    {renderCodeContent(activeCode)}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* Log history */}
          <section style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', overflow: 'hidden', minHeight: 300, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
            <div style={{ borderBottom: '1px solid var(--panel-border)', padding: '10px 12px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ margin: 0, color: 'var(--ink-90)', fontSize: 15 }}>{t('taskDetail.liveLogs')}</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-42)' }}>
                  {latestLog ? `${latestLog.stage} • ${new Date(latestLog.created_at).toLocaleTimeString()}` : ''}
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
                      border: logFilter === f.key ? '1px solid rgba(94,234,212,0.55)' : '1px solid var(--panel-border-4)',
                      background: logFilter === f.key ? 'rgba(94,234,212,0.12)' : 'transparent',
                      color: logFilter === f.key ? '#5eead4' : 'var(--ink-58)',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: 10 }}>
              <div style={{ border: `1px solid ${latestFailure ? 'rgba(248,113,113,0.35)' : 'var(--panel-border-2)'}`, borderRadius: 10, padding: '8px 10px', marginBottom: 10, background: latestFailure ? 'rgba(248,113,113,0.08)' : 'var(--panel)' }}>
                <div style={{ fontSize: 11, color: latestFailure ? '#f87171' : 'var(--ink-58)', fontWeight: 700, textTransform: 'uppercase' }}>{t('taskDetail.failureAnalysis')}: {t(failure.labelKey as never)}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-78)', marginTop: 4 }}>{t(failure.detailKey as never)}</div>
              </div>
              {logHistory.length === 0 ? (
                <p style={{ color: 'var(--ink-35)', fontSize: 14, margin: 0 }}>{t('taskDetail.noLogs')}</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {logHistory.map((log, idx) => {
                    const color = stageColor(log.stage);
                    return (
                      <div key={`${log.created_at}-${idx}-history`} style={{ borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: '9px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.8 }}>{log.stage}</span>
                          <span style={{ fontSize: 11, color: 'var(--ink-35)', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-78)', lineHeight: 1.45, whiteSpace: log.stage === 'code_preview' || log.stage === 'code_diff' ? 'pre-wrap' : 'normal', fontFamily: log.stage === 'code_preview' || log.stage === 'code_diff' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', overflowX: log.stage === 'code_preview' || log.stage === 'code_diff' ? 'auto' : 'visible' }}>
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

      {/* ── Run Config Popup ── */}
      {showRunConfig && (
        <RunConfigModal
          task={task}
          onRun={(extraDesc, agentOpts) => void rerunTask(extraDesc, agentOpts)}
          onClose={() => setShowRunConfig(false)}
        />
      )}

      {/* conflict modal is handled by showConflictDialog() via imperative DOM */}
    </div>
  );
}

function RunConfigModal({ task, onRun, onClose }: {
  task: TaskDetail | null;
  onRun: (extraDesc?: string, agentOpts?: { provider?: string; model?: string; createPr?: boolean; mode?: string; flowId?: string }) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();

  // Parse previous repo selection from task description
  const rawDesc = task?.description || '';
  const repoDefault = (() => {
    // azure:Project/Repo@branch or Remote Repo: azure:Project/Repo@branch
    const azureMetaMatch = rawDesc.match(/(?:Remote Repo:\s*)?azure:([^/]+)\/([^@\s]+)@(\S+)/);
    if (azureMetaMatch) return { provider: 'azure' as const, project: azureMetaMatch[1], repo: azureMetaMatch[2], branch: azureMetaMatch[3] };
    // Azure Repo URL → extract project + repo name
    const azureUrlMatch = rawDesc.match(/Azure Repo:\s*https?:\/\/\S+\/([^/]+)\/_git\/(\S+)/);
    const azureProjectMatch = rawDesc.match(/Project:\s*(.+)/);
    if (azureUrlMatch) return { provider: 'azure' as const, project: azureProjectMatch?.[1]?.trim() || azureUrlMatch[1], repo: azureUrlMatch[2].trim() };
    // github:owner/repo@branch
    const ghMatch = rawDesc.match(/(?:Remote Repo:\s*)?github:([^@\s]+)@(\S+)/);
    if (ghMatch) return { provider: 'github' as const, repo: ghMatch[1], branch: ghMatch[2] };
    return null;
  })() as RepoDefault | null;

  const [repoSel, setRepoSel] = useState<RemoteRepoSelection | null>(null);
  const [repoMode, setRepoMode] = useState<'remote' | 'mapping'>(repoDefault ? 'remote' : 'mapping');
  const [mappings, setMappings] = useState<{ id: string; name: string; local_path: string; provider?: string; azure_project?: string; azure_repo_name?: string; github_repo_full_name?: string }[]>([]);
  const [selectedMapping, setSelectedMapping] = useState('');
  const [agentConfigs, setAgentConfigs] = useState<{ role: string; label: string; provider: string; model: string; custom_model?: string }[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [runMode, setRunMode] = useState<'agent' | 'mcp' | 'flow'>((task?.last_mode === 'mcp_agent') ? 'mcp' : 'agent');
  const [createPr, setCreatePr] = useState(true);
  const [flows, setFlows] = useState<{ id: string; name: string; description?: string; nodes?: unknown[] }[]>([]);
  const [selectedFlow, setSelectedFlow] = useState('');

  useEffect(() => {
    loadPrefs().then((prefs) => {
      if (prefs.repo_mappings?.length) {
        const mList = prefs.repo_mappings as typeof mappings;
        setMappings(mList);
        // Auto-select mapping: try repo_mapping_name from API, then parse from description
        const taskAny = task as Record<string, unknown> | null;
        const dbMappingName = taskAny?.repo_mapping_name as string | undefined;
        const byDbName = dbMappingName ? mList.find((m) => m.name === dbMappingName) : null;
        const taskDesc = task?.description || '';
        const mappingMatch = taskDesc.match(/Local Repo Mapping:\s*(.+)/i);
        const descName = mappingMatch?.[1]?.trim();
        const byDescName = descName ? mList.find((m) => m.name === descName) : null;
        const matched = byDbName || byDescName;
        setSelectedMapping(matched?.id || mList[0]?.id || '');
        if (matched) setRepoMode('mapping');
      }
      let agents = prefs.agents as typeof agentConfigs | undefined;
      if (!agents?.length) {
        try { const ls = JSON.parse(localStorage.getItem('agena_agent_configs') || '[]'); if (Array.isArray(ls) && ls.length) agents = ls; } catch {}
      }
      if (agents?.length) {
        const active = agents.filter((a: Record<string, unknown>) => {
          const ag = a as Record<string, unknown>;
          return ag.enabled !== false && (typeof ag.provider === 'string' && (ag.provider as string).trim() !== '') && ((typeof ag.model === 'string' && (ag.model as string).trim() !== '') || (typeof ag.custom_model === 'string' && (ag.custom_model as string).trim() !== ''));
        });
        setAgentConfigs(active);
        setSelectedAgent(active[0]?.role || '');
      }
      const userFlows = prefs.flows as typeof flows | undefined;
      if (userFlows?.length) {
        setFlows(userFlows);
        setSelectedFlow(userFlows[0]?.id || '');
      }
    }).catch(() => {});
  }, []);

  const desc = rawDesc.toLowerCase();
  const hasRepo = desc.includes('local repo path') || desc.includes('remote repo') || desc.includes('azure repo');

  function handleRun() {
    const parts: string[] = [];
    if (repoMode === 'remote' && repoSel) {
      parts.push(`Remote Repo: ${repoSel.meta}`);
    } else if (repoMode === 'mapping' && selectedMapping) {
      const m = mappings.find((x) => x.id === selectedMapping);
      if (m) {
        if (m.local_path) parts.push(`Local Repo Path: ${m.local_path}`);
        parts.push(`Local Repo Mapping: ${m.name}`);
        if (m.azure_project) parts.push(`Project: ${m.azure_project}`);
        if (m.azure_repo_name) parts.push(`Azure Repo: ${m.azure_repo_name}`);
      }
    }
    const agent = agentConfigs.find((a) => a.role === selectedAgent);
    onRun(
      parts.length > 0 ? parts.join('\n') : undefined,
      {
        provider: agent?.provider || undefined,
        model: agent?.custom_model || agent?.model || undefined,
        createPr,
        mode: runMode === 'mcp' ? 'mcp_agent' : runMode === 'flow' ? 'flow' : undefined,
        flowId: runMode === 'flow' ? selectedFlow || undefined : undefined,
      },
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ width: 'min(480px, 100%)', maxHeight: 'calc(100vh - 32px)', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, #0d9488, #7c3aed, #f59e0b)' }} />
        <div style={{ padding: '18px 20px', display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>Run Configuration</h3>
            <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-45)', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>

          {/* Task info */}
          <div style={{ fontSize: 12, color: 'var(--ink-50)', padding: '8px 10px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
            <strong style={{ color: 'var(--ink-78)' }}>#{task?.id}</strong> {task?.title}
          </div>

          {/* Repo selection – mapping or remote */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Target Repository</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {mappings.length > 0 && (
                <button type="button" onClick={() => setRepoMode('mapping')}
                  style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    border: repoMode === 'mapping' ? '1px solid rgba(56,189,248,0.5)' : '1px solid var(--panel-border-2)',
                    background: repoMode === 'mapping' ? 'rgba(56,189,248,0.12)' : 'transparent',
                    color: repoMode === 'mapping' ? '#7dd3fc' : 'var(--ink-45)' }}>
                  Mapping
                </button>
              )}
              <button type="button" onClick={() => setRepoMode('remote')}
                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: repoMode === 'remote' ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border-2)',
                  background: repoMode === 'remote' ? 'rgba(94,234,212,0.12)' : 'transparent',
                  color: repoMode === 'remote' ? '#5eead4' : 'var(--ink-45)' }}>
                Remote
              </button>
            </div>
            {repoMode === 'remote' ? (
              <RemoteRepoSelector onChange={setRepoSel} defaultValue={repoDefault} />
            ) : (
              <select value={selectedMapping} onChange={(e) => setSelectedMapping(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)' }}>
                <option value=''>Select mapping...</option>
                {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}{m.local_path ? ` — ${m.local_path}` : ''}</option>)}
              </select>
            )}
          </div>

          {/* Run mode */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Mode</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => setRunMode('mcp')}
                style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: runMode === 'mcp' ? '1px solid rgba(8,145,178,0.5)' : '1px solid var(--panel-border-2)',
                  background: runMode === 'mcp' ? 'rgba(8,145,178,0.12)' : 'transparent',
                  color: runMode === 'mcp' ? '#06b6d4' : 'var(--ink-45)' }}>
                ⚡ MCP Agent
              </button>
              <button type="button" onClick={() => setRunMode('agent')}
                style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: runMode === 'agent' ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border-2)',
                  background: runMode === 'agent' ? 'rgba(94,234,212,0.12)' : 'transparent',
                  color: runMode === 'agent' ? '#5eead4' : 'var(--ink-45)' }}>
                🤖 AI Agent
              </button>
              {flows.length > 0 && (
                <button type="button" onClick={() => setRunMode('flow')}
                  style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: runMode === 'flow' ? '1px solid rgba(168,85,247,0.5)' : '1px solid var(--panel-border-2)',
                    background: runMode === 'flow' ? 'rgba(168,85,247,0.12)' : 'transparent',
                    color: runMode === 'flow' ? '#c084fc' : 'var(--ink-45)' }}>
                  🔀 Flow
                </button>
              )}
            </div>
          </div>

          {/* Agent selection (hidden in flow mode) */}
          {runMode !== 'flow' && <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Agent</div>
            {agentConfigs.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {agentConfigs.map((a) => (
                  <button key={a.role} onClick={() => setSelectedAgent(a.role)}
                    style={{ padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: selectedAgent === a.role ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border-2)',
                      background: selectedAgent === a.role ? 'rgba(94,234,212,0.12)' : 'transparent',
                      color: selectedAgent === a.role ? '#5eead4' : 'var(--ink-45)',
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span>{a.label || a.role}</span>
                    <span style={{ fontSize: 9, opacity: 0.6 }}>{a.provider} / {a.custom_model || a.model}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--ink-30)', padding: '8px 0' }}>
                No agents configured. <a href="/dashboard/agents" style={{ color: '#5eead4', textDecoration: 'underline' }}>Configure agents</a>
              </div>
            )}
          </div>}

          {/* Flow selection (only visible in Flow mode) */}
          {runMode === 'flow' && flows.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>Flow</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {flows.map((f) => (
                  <button key={f.id} onClick={() => setSelectedFlow(f.id)}
                    style={{ padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: selectedFlow === f.id ? '1px solid rgba(168,85,247,0.5)' : '1px solid var(--panel-border-2)',
                      background: selectedFlow === f.id ? 'rgba(168,85,247,0.12)' : 'transparent',
                      color: selectedFlow === f.id ? '#c084fc' : 'var(--ink-45)',
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left' }}>
                    <span>{f.name}</span>
                    {f.description && <span style={{ fontSize: 9, opacity: 0.6 }}>{f.description}</span>}
                    {f.nodes && <span style={{ fontSize: 9, opacity: 0.4 }}>{(f.nodes as unknown[]).length} nodes</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Create PR toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-65)', cursor: 'pointer' }}>
            <input type='checkbox' checked={createPr} onChange={(e) => setCreatePr(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#0d9488' }} />
            Create Pull Request
          </label>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className='button button-outline' style={{ flex: 1, justifyContent: 'center' }}>
              Cancel
            </button>
            <button onClick={handleRun}
              disabled={!hasRepo && !repoSel && !selectedMapping}
              className='button button-primary' style={{ flex: 1, justifyContent: 'center', opacity: (!hasRepo && !repoSel && !selectedMapping) ? 0.5 : 1, minHeight: 38 }}>
              Run Task
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
