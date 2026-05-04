'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, apiUpload, loadPrefs, type BackendRepoMapping, type RepoMapping } from '@/lib/api';
import { TaskItem, type RepoAssignment } from '@/components/TaskTable';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import { useEnabledModules } from '@/lib/useEnabledModules';
import RemoteRepoSelector from '@/components/RemoteRepoSelector';
import RichDescription from '@/components/RichDescription';
import ShareTaskModal from '@/components/ShareTaskModal';
import AiFillButton from '@/components/AiFillButton';

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
const SOURCE_FILTERS = ['all', 'internal', 'azure', 'jira', 'newrelic', 'sentry'];

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

// Task description preview is rendered inside a -webkit-line-clamp box,
// so any HTML in the body shows up as raw `<div><br></div>...` instead of
// formatted text. Strip tags + decode the common HTML entities so the
// preview reads like the rendered view does in the detail page.
function stripHtmlForPreview(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function sourceLabel(s: string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const normalized = (s || '').toLowerCase();
  const key = `tasks.source.${normalized}` as TranslationKey;
  const translated = t(key);
  return translated === key ? s : translated;
}

// Compact ⋮ overflow menu used in both desktop and mobile row actions.
// Six row buttons made the actions cell wrap onto two lines and hurt
// readability — Run + Review stay inline as primary, Details/Edit/Share/
// Delete collapse in here so the row stays one-line at any width.
function RowActionsKebab({
  items,
  ariaLabel,
}: {
  items: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    href?: string;
    hidden?: boolean;
  }>;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);
  const visible = items.filter((it) => !it.hidden);
  if (visible.length === 0) return null;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type='button'
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          padding: '6px 8px', fontSize: 14, lineHeight: 1, borderRadius: 8,
          border: '1px solid var(--panel-border-2)', background: open ? 'var(--panel-alt)' : 'transparent',
          color: 'var(--ink-50)', cursor: 'pointer', minWidth: 30, minHeight: 30,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ⋮
      </button>
      {open && (
        <div
          role='menu'
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 30,
            minWidth: 160, padding: 4, borderRadius: 10,
            border: '1px solid var(--panel-border-3)', background: 'var(--surface, var(--panel))',
            boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
            display: 'grid', gap: 1,
          }}
        >
          {visible.map((it) => {
            const inner = (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{it.icon}</span>
                {it.label}
              </span>
            );
            const baseStyle: React.CSSProperties = {
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
              borderRadius: 8, border: 'none', background: 'transparent', textAlign: 'left',
              fontSize: 12, fontWeight: 600,
              color: it.danger ? '#f87171' : 'var(--ink-78)',
              cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none',
            };
            if (it.href) {
              return (
                <a key={it.key} href={it.href} style={baseStyle}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--panel-alt)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  {inner}
                </a>
              );
            }
            return (
              <button key={it.key} type='button' style={baseStyle}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--panel-alt)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DashboardTasksPage() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mob = useIsMobile();
  const enabledModules = useEnabledModules();
  const reviewsEnabled = enabledModules?.has('reviews') ?? true;
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
  const [shareTask, setShareTask] = useState<TaskItem | null>(null);
  const [editTask, setEditTask] = useState<TaskItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStoryContext, setEditStoryContext] = useState('');
  const [editAcceptance, setEditAcceptance] = useState('');
  const [editEdgeCases, setEditEdgeCases] = useState('');
  const [editMaxTokens, setEditMaxTokens] = useState('');
  const [editMaxCost, setEditMaxCost] = useState('');
  const [editRepoMappingIds, setEditRepoMappingIds] = useState<number[]>([]);
  const [editDepIds, setEditDepIds] = useState<number[]>([]);
  const [editDepSearch, setEditDepSearch] = useState('');
  const [editShowDeps, setEditShowDeps] = useState(false);
  const [editShowRawDescription, setEditShowRawDescription] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editAttachments, setEditAttachments] = useState<Array<{ id: number; filename: string; content_type: string; size_bytes: number }>>([]);
  const [editAttachUploading, setEditAttachUploading] = useState(false);
  const [createMappings, setCreateMappings] = useState<BackendRepoMapping[]>([]);
  const [createMappingsLoaded, setCreateMappingsLoaded] = useState(false);
  const [selectedRepoMappingIds, setSelectedRepoMappingIds] = useState<number[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  // When description has HTML markers (came from a sprint pick), default
  // to the rendered preview view; an "edit" toggle reveals the raw textarea.
  const [showRawDescription, setShowRawDescription] = useState(false);
  // Currently-saved sprint labels for the picker buttons. Pulled from
  // /preferences on modal open so users can see "Azure Sprint'ten çek
  // (2026_09_Nankatsu)" without opening the picker first. Falls back
  // to localStorage if the DB call fails.
  const [activeAzureSprintLabel, setActiveAzureSprintLabel] = useState('');
  const [activeJiraSprintLabel, setActiveJiraSprintLabel] = useState('');
  // Create-modal "fetch from sprint" picker. Empty = blank task; otherwise
  // the user is browsing Azure/Jira items and a click prefills the form.
  const [pickerSource, setPickerSource] = useState<'empty' | 'azure' | 'jira'>('empty');
  type SprintItem = { id: string; title: string; description?: string };
  const [pickerItems, setPickerItems] = useState<SprintItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');
  // external_id → existing Agena task id, so the picker can mark items
  // that have already been imported and route the user to the existing
  // task instead of creating a duplicate.
  const [importedExternalMap, setImportedExternalMap] = useState<Record<string, number>>({});
  // When the user clicks a row that's already imported, hold off on
  // navigating until they confirm in a themed modal (replaces the
  // jarring window.confirm browser dialog).
  const [alreadyImportedPrompt, setAlreadyImportedPrompt] = useState<{ taskId: number; title: string } | null>(null);
  const [createSource, setCreateSource] = useState<'internal' | 'azure' | 'jira'>('internal');
  const [createExternalId, setCreateExternalId] = useState('');

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasAnyModalOpen = aiPopupTaskId !== null
    || flowPopupTaskId !== null
    || mcpPopupTaskId !== null
    || deleteConfirmTask !== null
    || editTask !== null
    || conflictModal !== null;

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

      const statusRank = (s: string): number => (s === 'running' ? 0 : s === 'queued' ? 1 : 2);
      const sortTasks = (items: TaskItem[]): TaskItem[] =>
        [...items].sort((a, b) => {
          const r = statusRank(a.status) - statusRank(b.status);
          if (r !== 0) return r;
          const ta = new Date((a as TaskItem & { created_at?: string }).created_at ?? 0).getTime();
          const tb = new Date((b as TaskItem & { created_at?: string }).created_at ?? 0).getTime();
          return tb - ta;
        });

      try {
        const [data, queueData] = await Promise.all([
          apiFetch<{ items: TaskItem[]; total: number; page: number; page_size: number }>(`/tasks/search?${qs.toString()}`),
          queuePromise,
        ]);
        setTasks(sortTasks(data.items));
        setTotal(data.total);
        setQueueItems(queueData);
        // Pull latest review per task so the row's button can switch
        // from "🔎 Review" to "✓ Reviewed" + link to detail page.
        void (async () => {
          try {
            type ReviewLite = { id: number; task_id: number; status: string; severity: string | null; findings_count: number | null };
            const recent = await apiFetch<ReviewLite[]>('/reviews?limit=200');
            const latestByTask: Record<number, ReviewLite> = {};
            for (const r of recent) {
              const cur = latestByTask[r.task_id];
              if (!cur || r.id > cur.id) latestByTask[r.task_id] = r;
            }
            setLatestReviewByTask(latestByTask);
          } catch {
            // optional — graceful degradation if reviews API is unavailable
          }
        })();
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
        setTasks(sortTasks(pagedLegacy));
        setTotal(filteredLegacy.length);
        setQueueItems(queueData);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tasks.loadFailed'));
    }
  }, [dateFrom, dateTo, filter, sourceFilter, page, search, t]);

  // Header's "+ New Task" button deep-links here with `?new=1` to auto-open
  // the Create form. Strip the param afterwards so refreshes don't re-open.
  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      setShowCreate(true);
      router.replace('/dashboard/tasks');
    }
  }, [searchParams, router]);

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
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    if (hasAnyModalOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [hasAnyModalOpen]);

  useEffect(() => {
    // Both Create and Edit modals render the local-repo-mappings checkbox
    // list, so trigger the load whenever either is opened.
    if ((showCreate || editTask) && !createMappingsLoaded) {
      apiFetch<BackendRepoMapping[]>('/repo-mappings')
        .then((data) => { setCreateMappings(data); setCreateMappingsLoaded(true); })
        .catch(() => setCreateMappingsLoaded(true));
    }
  }, [showCreate, editTask, createMappingsLoaded]);

  useEffect(() => {
    // Refresh the sprint-name suffix on the picker buttons every time
    // the Create modal opens — the user might have switched sprints
    // since the last time it was rendered.
    if (!showCreate) return;
    type Prefs = {
      azure_sprint_path?: string | null;
      profile_settings?: { jira_sprint_id?: string; jira_sprint_name?: string } | null;
    };
    apiFetch<Prefs>('/preferences')
      .then((prefs) => {
        const azPath = (prefs.azure_sprint_path || '').trim();
        // Azure sprint paths look like "Project\\Iter\\2026_09_Nankatsu" —
        // the leaf is the sprint name.
        const azLeaf = azPath ? azPath.split(/[\\/]/).filter(Boolean).pop() || azPath : '';
        setActiveAzureSprintLabel(azLeaf || localStorage.getItem('agena_sprint_path') || '');
        const ps = prefs.profile_settings || {};
        const jiraName = (ps.jira_sprint_name || ps.jira_sprint_id || '').toString().trim();
        setActiveJiraSprintLabel(jiraName || localStorage.getItem('agena_jira_sprint') || '');
      })
      .catch(() => {
        // DB fetch failed — fall back to whatever's in localStorage.
        const az = localStorage.getItem('agena_sprint_path') || '';
        const azLeaf = az ? az.split(/[\\/]/).filter(Boolean).pop() || az : '';
        setActiveAzureSprintLabel(azLeaf);
        setActiveJiraSprintLabel(localStorage.getItem('agena_jira_sprint') || '');
      });
  }, [showCreate]);

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

  async function loadSprintItems(source: 'azure' | 'jira') {
    setPickerLoading(true);
    setPickerError('');
    try {
      // Single source of truth: /preferences (DB-backed). Azure values live
      // in named columns; Jira values are tucked into profile_settings JSON
      // (see SprintSwitcher.save). We don't read localStorage here — the
      // user might be on a fresh browser, second device, or have it cleared.
      type Prefs = {
        azure_project?: string | null;
        azure_team?: string | null;
        azure_sprint_path?: string | null;
        profile_settings?: Record<string, string | undefined>;
      };
      const prefs = await apiFetch<Prefs>('/preferences').catch(() => ({} as Prefs));
      const ps = prefs.profile_settings || {};
      const project = (source === 'jira' ? (ps.jira_project || '') : prefs.azure_project) || '';
      const team = (source === 'jira' ? (ps.jira_board || '') : prefs.azure_team) || '';
      const sprint = (source === 'jira' ? (ps.jira_sprint_id || '') : prefs.azure_sprint_path) || '';
      if (!sprint) {
        setPickerError(t('tasks.picker.needSprint' as TranslationKey));
        setPickerItems([]);
        return;
      }
      const qs = new URLSearchParams();
      if (source === 'jira') {
        if (project) qs.set('project_key', project);
        if (team) qs.set('board_id', team);
        if (sprint) qs.set('sprint_id', sprint);
      } else {
        if (project) qs.set('project', project);
        if (team) qs.set('team', team);
        if (sprint) qs.set('sprint_path', sprint);
        // Default backend filter is `state=New`; we want every state in
        // the sprint so the picker can pull bugs / in-progress items too.
        qs.set('state', '');
      }
      const path = source === 'jira' ? '/tasks/jira' : '/tasks/azure';
      const data = await apiFetch<{ items?: SprintItem[] } | SprintItem[]>(`${path}?${qs.toString()}`);
      const items = Array.isArray(data) ? data : (data.items || []);
      setPickerItems(items);
      // Build a map of already-imported items so we can mark them and route
      // clicks to the existing task instead of trying to recreate it.
      try {
        type Row = { id: number; external_id?: string; title?: string };
        const tagged = await apiFetch<{ items: Row[] }>(`/tasks/search?source=${source}&page=1&page_size=100`).catch(() => ({ items: [] as Row[] }));
        const internal = await apiFetch<{ items: Row[] }>(`/tasks/search?source=internal&page=1&page_size=100`).catch(() => ({ items: [] as Row[] }));
        const map: Record<string, number> = {};
        for (const r of tagged.items || []) {
          if (r.external_id) map[r.external_id] = r.id;
        }
        // Legacy: pre-source imports still use `[Azure #N] / [Jira KEY]` titles.
        const titleRe = new RegExp(`^\\[${source === 'jira' ? 'Jira' : 'Azure'}\\s*#([^\\]\\s]+)\\]`);
        for (const r of internal.items || []) {
          const m = r.title ? titleRe.exec(r.title) : null;
          if (m && m[1] && !map[m[1]]) map[m[1]] = r.id;
        }
        setImportedExternalMap(map);
      } catch {
        setImportedExternalMap({});
      }
      if (items.length === 0) {
        setPickerError(t('tasks.picker.empty.list' as TranslationKey));
      }
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : t('tasks.picker.loadFailed' as TranslationKey));
    } finally {
      setPickerLoading(false);
    }
  }

  function applyPickedItem(source: 'azure' | 'jira', item: SprintItem) {
    const prefix = source === 'jira' ? 'Jira' : 'Azure';
    setTitle(`[${prefix} #${item.id}] ${item.title}`);
    // Keep the original HTML — the textarea shows raw markup for editing
    // but a live preview pane (renderMarkdown, same path the task detail
    // uses) renders it underneath so the user sees the formatted version.
    setDescription((item.description || '').trim());
    setCreateSource(source);
    setCreateExternalId(String(item.id));
    setShowRawDescription(false);  // start in rendered preview
    setPickerSource('empty');  // collapse the list, full form is now visible
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const fullDesc = remoteRepoMeta
        ? description + '\n\n---\nRemote Repo: ' + remoteRepoMeta
        : description;
      const created = await apiFetch<{ id: number; was_existing?: boolean }>('/tasks', {
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
          // Tag with the originating system when the user prefilled the form
          // from a sprint item — landed in the same dedup bucket as bulk
          // imports and unlocks the "Azure #ID ↗" chip on the detail page.
          source: createSource !== 'internal' ? createSource : undefined,
          external_id: createSource !== 'internal' && createExternalId ? createExternalId : undefined,
        }),
      });
      // If the task was already in the system (matched by source +
      // external_id), don't pretend we just created it — tell the user
      // and jump straight to the existing detail page so they can decide
      // what to do next.
      if (created?.was_existing && created?.id) {
        setMsg(t('tasks.alreadyExisted' as TranslationKey));
        setShowCreate(false);
        router.push(`/tasks/${created.id}`);
        return;
      }
      if (attachedFiles.length > 0 && created?.id) {
        setUploadingFiles(true);
        try {
          const fd = new FormData();
          attachedFiles.forEach((f) => fd.append('files', f, f.name));
          await apiUpload(`/tasks/${created.id}/attachments`, fd);
        } catch (upErr) {
          setError(upErr instanceof Error ? upErr.message : t('tasks.attachments.uploadFailed' as TranslationKey));
        } finally {
          setUploadingFiles(false);
        }
      }
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
      setAttachedFiles([]);
      setPickerSource('empty');
      setPickerItems([]);
      setPickerSearch('');
      setCreateSource('internal');
      setCreateExternalId('');
      setShowRawDescription(false);
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

  // Reviewer picker — opened when user clicks 🔎 Review on a task. Closed
  // (null) by default; opening sets the task id + anchor element, the
  // popover renders via portal positioned next to the button (flips up
  // when the row is near the viewport bottom).
  const [reviewPickerTaskId, setReviewPickerTaskId] = useState<number | null>(null);
  const [reviewPickerAnchor, setReviewPickerAnchor] = useState<HTMLElement | null>(null);
  const [reviewerAgentOptions, setReviewerAgentOptions] = useState<Array<{ role: string; label: string }>>([]);
  // Track which tasks have an in-flight review run so the row's button
  // can render "⏳ Reviewing" until the backend reaches a terminal state.
  const [reviewingTaskIds, setReviewingTaskIds] = useState<Set<number>>(new Set());
  // Most recent review per task — the Review button in the row uses this
  // to render an "✓ Reviewed" link to the detail page when the task has
  // already been reviewed (instead of triggering yet another run).
  type LatestReview = { id: number; task_id: number; status: string; severity: string | null; findings_count: number | null };
  const [latestReviewByTask, setLatestReviewByTask] = useState<Record<number, LatestReview>>({});
  // Result of the most recently completed review surfaced as a modal so
  // the user sees the verdict immediately + can jump to the task detail
  // for the full report.
  type ReviewResult = {
    id: number; status: string; severity: string | null;
    findings_count: number | null; score: number | null;
    summary: string | null; reviewer_agent_role: string | null;
    task_id: number; task_title: string | null;
  };
  const [reviewResultModal, setReviewResultModal] = useState<ReviewResult | null>(null);

  useEffect(() => {
    // Load the user's reviewer-flagged agents once. Falls back to the
    // canonical four when the user hasn't customised. The list drives the
    // picker that the 🔎 Review button opens.
    void loadPrefs()
      .then((prefs) => {
        const agents = (prefs.agents || []) as Array<{ role?: string; label?: string; is_reviewer?: boolean; enabled?: boolean }>;
        const opts = agents
          .filter((a) => a.role && a.is_reviewer && a.enabled !== false)
          .map((a) => ({ role: String(a.role), label: String(a.label || a.role) }));
        if (opts.length > 0) setReviewerAgentOptions(opts);
        else setReviewerAgentOptions([
          { role: 'reviewer', label: 'Code Reviewer' },
          { role: 'security_developer', label: 'Security Developer' },
          { role: 'qa', label: 'QA' },
          { role: 'lead_developer', label: 'Lead Developer' },
        ]);
      })
      .catch(() => {});
  }, []);

  function openReviewPicker(taskId: number, anchor?: HTMLElement | null) {
    if (reviewerAgentOptions.length <= 1) {
      // Only one reviewer agent → run it immediately, no menu needed.
      void triggerReview(taskId, reviewerAgentOptions[0]?.role || 'auto');
      return;
    }
    if (reviewPickerTaskId === taskId) {
      setReviewPickerTaskId(null);
      setReviewPickerAnchor(null);
    } else {
      setReviewPickerTaskId(taskId);
      setReviewPickerAnchor(anchor || null);
    }
  }

  // Close the reviewer popover when the user clicks outside it or hits Esc.
  // Without this the floating menu sticks open forever after triggering it,
  // since the inline render has e.stopPropagation() on the inner div.
  useEffect(() => {
    if (reviewPickerTaskId === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-review-picker]')) return;
      if (target?.closest('[data-review-trigger]')) return;
      setReviewPickerTaskId(null);
      setReviewPickerAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setReviewPickerTaskId(null); setReviewPickerAnchor(null); }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [reviewPickerTaskId]);

  async function triggerReview(taskId: number, role: string) {
    setReviewPickerTaskId(null);
    setReviewPickerAnchor(null);
    setError('');
    // Optimistically mark the row as reviewing so the button flips to
    // "⏳ Reviewing" the same render — feedback shouldn't wait for the
    // POST round-trip.
    setReviewingTaskIds((s) => { const n = new Set(s); n.add(taskId); return n; });
    try {
      const res = await apiFetch<ReviewResult>('/reviews', {
        method: 'POST',
        body: JSON.stringify({ task_id: taskId, reviewer_agent_role: role }),
      });
      // Backend returns immediately with status='running' and runs the
      // reviewer in a strong-ref asyncio task. Poll /reviews/{id} every
      // 3s until we hit a terminal status, then pop the result modal.
      const reviewId = res.id;
      let final: ReviewResult | null = null;
      if (res.status === 'running' || res.status === 'queued') {
        const start = Date.now();
        const TIMEOUT_MS = 30 * 60 * 1000; // match backend reaper
        while (Date.now() - start < TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const poll = await apiFetch<ReviewResult>(`/reviews/${reviewId}`);
            if (poll.status !== 'running' && poll.status !== 'queued') {
              final = poll;
              break;
            }
          } catch {
            // transient — keep polling
          }
        }
      } else {
        final = res;
      }
      if (final) {
        setReviewResultModal({
          ...final,
          task_id: taskId,
          task_title: tasks.find((tk) => tk.id === taskId)?.title || final.task_title || `Task #${taskId}`,
        });
        // Refresh the row's button → from "⏳ Reviewing" to "✓ Reviewed"
        // (linked to the new review's detail page) on next render.
        setLatestReviewByTask((prev) => ({
          ...prev,
          [taskId]: { id: final!.id, task_id: taskId, status: final!.status, severity: final!.severity, findings_count: final!.findings_count },
        }));
      } else {
        setError(`Review #${reviewId} timed out — open the task detail for the latest status.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setReviewingTaskIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
    }
  }

  async function toggleSentryResolve(taskId: number) {
    // Optimistic toggle: flip the "Status: resolved" line in the description
    // locally so the row turns purple instantly. On failure we revert.
    let prev: TaskItem | undefined;
    setTasks((cur) => cur.map((task) => {
      if (task.id !== taskId) return task;
      prev = task;
      const desc = task.description || '';
      const isResolved = desc.includes('Status: resolved');
      const nextDesc = isResolved
        ? desc.replace(/^Status: resolved\s*$/m, 'Status: unresolved').replace(/\nStatus: resolved\s*/g, '\nStatus: unresolved')
        : (/^Status:/m.test(desc)
            ? desc.replace(/^Status:.*$/m, 'Status: resolved')
            : (desc ? `${desc}\nStatus: resolved` : 'Status: resolved'));
      return { ...task, description: nextDesc };
    }));
    try {
      const data = await apiFetch<{ status: string }>(`/tasks/${taskId}/sentry-resolve`, { method: 'POST' });
      setMsg(`Sentry: ${data.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sentry resolve failed');
      if (prev) {
        const original = prev;
        setTasks((cur) => cur.map((task) => task.id === taskId ? original : task));
      }
    }
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

  async function openEditTask(task: TaskItem) {
    setEditTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    setEditStoryContext('');
    setEditAcceptance('');
    setEditEdgeCases('');
    setEditMaxTokens('');
    setEditMaxCost('');
    // Seed repo selection from the list-row task immediately so the
    // checkbox flips as soon as the modal opens — without this the modal
    // showed empty for a beat (and stayed empty for tasks without
    // repo_assignments rows, e.g. IntegrationRule auto-routed tasks).
    const initialRepoIds: number[] = [];
    if (task.repo_assignments && task.repo_assignments.length > 0) {
      for (const a of task.repo_assignments) {
        if (typeof a.repo_mapping_id === 'number') initialRepoIds.push(a.repo_mapping_id);
      }
    } else if (typeof task.repo_mapping_id === 'number' && task.repo_mapping_id > 0) {
      initialRepoIds.push(task.repo_mapping_id);
    }
    setEditRepoMappingIds(initialRepoIds);
    setEditDepIds([]);
    setEditDepSearch('');
    setEditShowDeps(false);
    setEditShowRawDescription(false);
    setEditAttachments([]);
    void loadDepCandidates();
    apiFetch<Array<{ id: number; filename: string; content_type: string; size_bytes: number }>>(`/tasks/${task.id}/attachments`)
      .then((items) => setEditAttachments(items || []))
      .catch(() => setEditAttachments([]));
    // List rows don't carry the rich guardrail fields — fetch the full
    // task so the edit form can prefill story_context / acceptance /
    // edge_cases / max_tokens / max_cost_usd / repo assignments.
    setEditLoading(true);
    try {
      type FullTask = {
        title: string;
        description: string;
        story_context?: string | null;
        acceptance_criteria?: string | null;
        edge_cases?: string | null;
        max_tokens?: number | null;
        max_cost_usd?: number | null;
        repo_mapping_id?: number | null;
        repo_assignments?: { repo_mapping_id: number }[];
      };
      const full = await apiFetch<FullTask>('/tasks/' + task.id);
      setEditTitle(full.title || '');
      setEditDesc(full.description || '');
      setEditStoryContext(full.story_context || '');
      setEditAcceptance(full.acceptance_criteria || '');
      setEditEdgeCases(full.edge_cases || '');
      setEditMaxTokens(full.max_tokens != null ? String(full.max_tokens) : '');
      setEditMaxCost(full.max_cost_usd != null ? String(full.max_cost_usd) : '');
      // Prefer task_repo_assignments rows; fall back to the legacy single
      // repo_mapping_id column for tasks that came in via paths that don't
      // create assignment rows (e.g. IntegrationRule auto-routing on import).
      const fromAssignments = (full.repo_assignments || []).map((a) => a.repo_mapping_id);
      if (fromAssignments.length > 0) {
        setEditRepoMappingIds(fromAssignments);
      } else if (typeof full.repo_mapping_id === 'number' && full.repo_mapping_id > 0) {
        setEditRepoMappingIds([full.repo_mapping_id]);
      } else {
        setEditRepoMappingIds([]);
      }
      // Pull current dependency set so the user can edit it.
      try {
        const deps = await apiFetch<{ depends_on_task_ids: number[] }>(`/tasks/${task.id}/dependencies`);
        setEditDepIds(deps.depends_on_task_ids || []);
      } catch { /* non-fatal */ }
    } catch {
      // Keep title + description from the row; the rest stays empty.
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEditTask() {
    if (!editTask) return;
    try {
      const body: Record<string, unknown> = {
        title: editTitle,
        description: editDesc,
        story_context: editStoryContext,
        acceptance_criteria: editAcceptance,
        edge_cases: editEdgeCases,
      };
      // Numeric fields: send 0 to mean "unset" so the backend can null
      // them (max_tokens=0 → null, max_cost_usd=0 → null per task_service).
      body.max_tokens = editMaxTokens.trim() ? Number(editMaxTokens) : 0;
      body.max_cost_usd = editMaxCost.trim() ? Number(editMaxCost) : 0;
      await apiFetch('/tasks/' + editTask.id, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      // Repo assignments live on a separate endpoint — sync them
      // alongside the field edits so the user can fix a wrong repo
      // without leaving the modal.
      try {
        await apiFetch(`/tasks/${editTask.id}/repo-assignments`, {
          method: 'PUT',
          body: JSON.stringify({ repo_mapping_ids: editRepoMappingIds }),
        });
      } catch (assignErr) {
        setError(assignErr instanceof Error ? assignErr.message : 'Repo assignments save failed');
      }
      // Sync dependencies through the dedicated endpoint.
      try {
        await apiFetch(`/tasks/${editTask.id}/dependencies`, {
          method: 'PUT',
          body: JSON.stringify({ depends_on_task_ids: editDepIds }),
        });
      } catch (depsErr) {
        setError(depsErr instanceof Error ? depsErr.message : 'Dependencies save failed');
      }
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

      {/* Create modal — portaled so the overlay covers the whole viewport
          and the form scrolls independently of the task list behind. */}
      {showCreate && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => !uploadingFiles && setShowCreate(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '40px 16px', overflowY: 'auto',
          }}
        >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 880, maxWidth: '100%',
            borderRadius: 20, border: '1px solid rgba(13,148,136,0.35)',
            background: 'var(--surface)', padding: 24,
            position: 'relative', boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.6), transparent)' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ color: 'var(--ink-90)', margin: 0 }}>{t('tasks.createTitle')}</h3>
            <button
              type='button'
              onClick={() => !uploadingFiles && setShowCreate(false)}
              disabled={uploadingFiles}
              style={{ background: 'none', border: 'none', color: 'var(--ink-50)', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}
              aria-label={t('tasks.cancel')}
            >×</button>
          </div>

          {/* Source picker — three tabs above the form. Picking Azure/Jira
              loads sprint items below; clicking one prefills title +
              description and tags the task with source/external_id so it
              joins the same dedup bucket as bulk imports. */}
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>
              {t('tasks.picker.label' as TranslationKey)}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['empty', 'azure', 'jira'] as const).map((src) => {
                const active = pickerSource === src;
                return (
                  <button
                    key={src}
                    type='button'
                    onClick={() => {
                      setPickerSource(src);
                      if (src !== 'empty' && pickerItems.length === 0) {
                        void loadSprintItems(src);
                      }
                    }}
                    style={{
                      padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: '1px solid ' + (active ? 'rgba(13,148,136,0.55)' : 'var(--panel-border-3)'),
                      background: active ? 'rgba(13,148,136,0.12)' : 'transparent',
                      color: active ? 'var(--ink-90)' : 'var(--ink-65)',
                    }}
                  >
                    {src === 'empty' && '✏️ ' + t('tasks.picker.empty' as TranslationKey)}
                    {src === 'azure' && (
                      <>
                        📥 {t('tasks.picker.azure' as TranslationKey)}
                        {activeAzureSprintLabel && (
                          <span style={{ marginLeft: 6, fontWeight: 500, opacity: 0.75 }}>({activeAzureSprintLabel})</span>
                        )}
                      </>
                    )}
                    {src === 'jira' && (
                      <>
                        📥 {t('tasks.picker.jira' as TranslationKey)}
                        {activeJiraSprintLabel && (
                          <span style={{ marginLeft: 6, fontWeight: 500, opacity: 0.75 }}>({activeJiraSprintLabel})</span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
              {/* Source chip removed — title already shows `[Azure #N]` */}
            </div>

            {pickerSource !== 'empty' && (
              <div style={{ borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 10, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder={t('tasks.picker.searchPlaceholder' as TranslationKey)}
                    style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 8 }}
                  />
                  <button
                    type='button'
                    onClick={() => void loadSprintItems(pickerSource as 'azure' | 'jira')}
                    disabled={pickerLoading}
                    title={t('tasks.picker.refresh' as TranslationKey)}
                    style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-78)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    ↻
                  </button>
                </div>
                {pickerLoading ? (
                  <div style={{ fontSize: 11, color: 'var(--ink-58)', padding: '8px 4px' }}>{t('tasks.picker.loading' as TranslationKey)}</div>
                ) : pickerError ? (
                  <div style={{ fontSize: 11, color: '#fca5a5', padding: '8px 4px' }}>{pickerError}</div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 4 }}>
                    {pickerItems
                      .filter((it) => !pickerSearch || it.title.toLowerCase().includes(pickerSearch.toLowerCase()) || String(it.id).includes(pickerSearch))
                      .slice(0, 200)
                      .map((it) => {
                        const existingId = importedExternalMap[String(it.id)];
                        const isTaken = !!existingId;
                        return (
                          <button
                            key={it.id}
                            type='button'
                            onClick={() => {
                              if (isTaken && existingId) {
                                // Don't auto-navigate — confirm via themed
                                // modal so the user can change their mind
                                // without losing their place in the picker.
                                setAlreadyImportedPrompt({ taskId: existingId, title: it.title });
                              } else {
                                applyPickedItem(pickerSource as 'azure' | 'jira', it);
                              }
                            }}
                            title={isTaken ? t('tasks.picker.alreadyImportedHint' as TranslationKey, { id: String(existingId) }) : ''}
                            style={{
                              textAlign: 'left', padding: '7px 10px', borderRadius: 8,
                              border: '1px solid ' + (isTaken ? 'var(--panel-border-2)' : 'var(--panel-border-3)'),
                              background: isTaken ? 'transparent' : 'var(--panel-alt)',
                              fontSize: 12, cursor: isTaken ? 'help' : 'pointer',
                              display: 'flex', alignItems: 'center', gap: 8,
                              opacity: isTaken ? 0.55 : 1,
                            }}
                          >
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--ink-35)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>#{it.id}</span>{' '}
                              <span style={{ fontWeight: 600, color: isTaken ? 'var(--ink-50)' : 'var(--ink-90)', textDecoration: isTaken ? 'line-through' : 'none' }}>{it.title}</span>
                            </span>
                            {isTaken && (
                              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(245,158,11,0.14)', color: '#f59e0b', whiteSpace: 'nowrap', border: '1px solid rgba(245,158,11,0.35)' }}>
                                ⚠ {t('tasks.picker.alreadyImportedBadge' as TranslationKey)} · #{existingId}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={onCreate} style={{ display: 'grid', gap: 12 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.titlePlaceholder')} required />
            {/* Two-column body so the modal fits without vertical scroll on
                most laptops. Collapses to a single column under 880px via
                `.create-task-grid` (see globals.css). */}
            <div className='create-task-grid' style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)', gap: 14, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
            {/* Description: rendered (read-only) by default when there's
                content, with an Edit toggle that flips to a raw textarea.
                When the field is empty we always show the textarea so the
                user can start typing without an extra click. */}
            {(() => {
              const hasContent = !!description.trim();
              const isRich = /<\/?(div|p|span|br|h[1-6]|ul|ol|li|table|img|strong|em|b|i|code|pre|blockquote)\b/i.test(description);
              const showText = !hasContent || showRawDescription || !isRich;
              return showText ? (
                <div style={{ position: 'relative' }}>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('tasks.descriptionPlaceholder')}
                    rows={5}
                    required
                    style={{ width: '100%' }}
                  />
                  {hasContent && isRich && (
                    <button
                      type='button'
                      onClick={() => setShowRawDescription(false)}
                      style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-72)', cursor: 'pointer' }}
                      title={t('tasks.descriptionPreview' as TranslationKey)}
                    >
                      👁
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ position: 'relative', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: '10px 36px 10px 12px' }}>
                  <button
                    type='button'
                    onClick={() => setShowRawDescription(true)}
                    style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'var(--panel)', color: 'var(--ink-72)', cursor: 'pointer' }}
                    title={t('tasks.descriptionEdit' as TranslationKey)}
                  >
                    ✏️
                  </button>
                  <RichDescription
                    className='task-md'
                    style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-78)', maxHeight: 280, overflowY: 'auto', wordBreak: 'break-word' }}
                    html={description}
                  />
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <AiFillButton
                title={title}
                description={description}
                onFilled={(r) => {
                  if (r.story_context) setStoryContext(r.story_context);
                  if (r.acceptance_criteria) setAcceptanceCriteria(r.acceptance_criteria);
                  if (r.edge_cases) setEdgeCases(r.edge_cases);
                  setMsg(t('tasks.aiFill.done' as TranslationKey) || 'AI filled the fields below.');
                }}
                onError={(m) => setError(m)}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-35)' }}>
                {t('tasks.aiFill.hint' as TranslationKey) || 'Auto-fills the three fields below from the title + description.'}
              </span>
            </div>
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
            </div>
            <div style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
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

            {/* Attachments section */}
            <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '10px 12px', background: 'var(--panel)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>
                {t('tasks.attachments.title' as TranslationKey)} {attachedFiles.length > 0 ? `(${attachedFiles.length})` : ''}
              </div>
              <input
                type='file'
                multiple
                accept='image/*,.pdf,.txt,.md,.log,.json,.csv,.zip'
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  const MAX = 20 * 1024 * 1024;
                  const oversize = picked.filter((f) => f.size > MAX);
                  const ok = picked.filter((f) => f.size <= MAX);
                  if (oversize.length > 0) {
                    setError(t('tasks.attachments.tooLarge' as TranslationKey, { names: oversize.map((f) => f.name).join(', ') }));
                  }
                  setAttachedFiles((prev) => {
                    const combined = [...prev, ...ok];
                    return combined.slice(0, 10);
                  });
                  e.target.value = '';
                }}
                style={{ fontSize: 12, color: 'var(--ink-58)' }}
              />
              <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 4 }}>
                {t('tasks.attachments.hint' as TranslationKey)}
              </div>
              {attachedFiles.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {attachedFiles.map((f, i) => (
                    <AttachedFilePreview
                      key={`${f.name}-${f.lastModified}-${i}`}
                      file={f}
                      onRemove={() => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    />
                  ))}
                </div>
              )}
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
            </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type='submit' className='button button-primary' disabled={uploadingFiles}>
                {uploadingFiles ? t('tasks.attachments.uploading' as TranslationKey) : t('tasks.create')}
              </button>
              <button type='button' className='button button-outline' onClick={() => setShowCreate(false)} disabled={uploadingFiles}>{t('tasks.cancel')}</button>
            </div>
          </form>
        </div>
        </div>,
        document.body,
      )}

      {/* Already-imported confirm — themed replacement for window.confirm.
          Sits on top of the Create modal so the user can cancel and keep
          browsing the picker. */}
      {alreadyImportedPrompt && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setAlreadyImportedPrompt(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10010,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 420, maxWidth: '100%',
              background: 'var(--surface)', color: 'var(--ink-90)',
              border: '1px solid var(--panel-border-3)', borderRadius: 14,
              padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
              display: 'grid', gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>⚠</span>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink-90)' }}>
                {t('tasks.picker.alreadyImportedBadge' as TranslationKey)}
              </h3>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-72)', lineHeight: 1.5 }}>
              {t('tasks.picker.alreadyImportedConfirm' as TranslationKey, { id: String(alreadyImportedPrompt.taskId) })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-50)', padding: '6px 10px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {alreadyImportedPrompt.title}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type='button'
                className='button button-outline'
                onClick={() => setAlreadyImportedPrompt(null)}
                style={{ fontSize: 12 }}
              >
                {t('tasks.cancel')}
              </button>
              <button
                type='button'
                className='button button-primary'
                onClick={() => {
                  const id = alreadyImportedPrompt.taskId;
                  setAlreadyImportedPrompt(null);
                  setShowCreate(false);
                  router.push(`/tasks/${id}`);
                }}
                style={{ fontSize: 12 }}
              >
                {t('tasks.picker.openTask' as TranslationKey, { id: String(alreadyImportedPrompt.taskId) })}
              </button>
            </div>
          </div>
        </div>,
        document.body,
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
              {[t('tasks.col.task'), t('tasks.col.source'), t('tasks.col.status'), t('tasks.col.run'), t('tasks.col.queue'), t('tasks.col.priority' as Parameters<typeof t>[0]) || 'Priority', t('tasks.col.tokens'), t('tasks.col.pr'), t('tasks.col.actions')].map((h) => (
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
              borderLeft: task.description?.includes('Status: resolved') ? '3px solid #a855f7' : task.status === 'running' ? '3px solid #38bdf8' : '3px solid transparent',
              background: task.description?.includes('Status: resolved') ? 'rgba(168,85,247,0.04)' : task.status === 'running' ? 'rgba(56,189,248,0.04)' : undefined,
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
                  {(task.tags || []).map((tg) => (
                    <span key={tg} title={`Tag: ${tg}`}
                      style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {tg}
                    </span>
                  ))}
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
                }}>{stripHtmlForPreview(task.description)}</div>
                {task.source === 'sentry' && (task.is_unhandled || task.substatus || task.fixability_score != null) && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                    {task.is_unhandled && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>unhandled</span>}
                    {task.substatus && task.substatus !== 'new' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: task.substatus === 'regressed' ? 'rgba(249,115,22,0.1)' : task.substatus === 'escalating' ? 'rgba(239,68,68,0.1)' : 'rgba(156,163,175,0.1)', color: task.substatus === 'regressed' ? '#f97316' : task.substatus === 'escalating' ? '#ef4444' : 'var(--ink-40)' }}>{task.substatus}</span>}
                    {task.fixability_score != null && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>fix {Math.round(task.fixability_score * 100)}%</span>}
                  </div>
                )}
                {(task.source === 'newrelic' || task.source === 'sentry') && (task.occurrences != null || task.last_seen_at) && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                    {task.occurrences != null && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
                        {task.occurrences.toLocaleString()}× {t('tasks.occurrences') || 'times'}
                      </span>
                    )}
                    {task.last_seen_at && (
                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-35)' }}>
                        {t('tasks.lastSeen') || 'Last seen'}: {new Date(task.last_seen_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
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
                {task.priority ? (() => {
                  const pc: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
                  const c = pc[task.priority] || 'var(--ink-35)';
                  return <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                    background: `${c}15`, color: c, textTransform: 'capitalize',
                  }}>{task.priority}</span>;
                })() : <span style={{ fontSize: 11, color: 'var(--ink-20)' }}>—</span>}
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
                  ) : (() => {
                    // Color the "n/total PR" badge by completion progress
                    // so the user can tell at a glance whether all repos
                    // finished. Green only when n === total, amber while
                    // some are still working, grey when none ready yet.
                    const _withPr = task.repo_assignments.filter((ra: RepoAssignment) => ra.pr_url).length;
                    const _total = task.repo_assignments.length;
                    const _allDone = _withPr === _total && _total > 0;
                    const _none = _withPr === 0;
                    const _color = _allDone ? '#22c55e' : _none ? 'var(--ink-50)' : '#f59e0b';
                    return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: _color }}>
                        {_allDone ? '✓' : _none ? '⏳' : '⏳'} {t('tasks.multiPrCount', { n: _withPr, total: _total })}
                      </span>
                      {task.repo_assignments.slice(0, 2).map((ra: RepoAssignment) => (
                        <span key={ra.id} style={{ fontSize: 10, color: ra.pr_url ? '#22c55e' : (ra.status === 'running' || ra.status === 'queued') ? '#f59e0b' : 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
                          {ra.pr_url ? (
                            <a href={ra.pr_url} target='_blank' rel='noreferrer' style={{ color: '#22c55e', textDecoration: 'none' }}>✓ {ra.repo_display_name.split('/').pop()}</a>
                          ) : (
                            <>
                              {(ra.status === 'running' || ra.status === 'queued') ? '⏳ ' : ''}
                              {ra.repo_display_name.split('/').pop()}
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                    );
                  })()
                ) : task.pr_url ? (
                  <a href={task.pr_url} target='_blank' rel='noreferrer' style={{ fontSize: 12, color: '#5eead4', textDecoration: 'none' }}>{t('tasks.viewPr')} ↗</a>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--ink-25)' }}>—</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap' }}>
                {task.source === 'sentry' && (
                  <button onClick={() => void toggleSentryResolve(task.id)}
                    style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.08)', color: '#a855f7', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {task.description?.includes('Status: resolved') ? 'Unresolve' : 'Resolve'}
                  </button>
                )}
                {task.status === 'queued' || task.status === 'running' ? (
                  <span style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: statusColor(task.status) }}>
                    {statusLabel(task.status, t)}
                  </span>
                ) : (
                  <>
                    {reviewsEnabled && (() => {
                      const reviewing = reviewingTaskIds.has(task.id);
                      const latest = latestReviewByTask[task.id];
                      // Latest review is still running anywhere in the
                      // system → show "⏳ Reviewing…" so the row reflects
                      // the same truth as /dashboard/reviews. Without
                      // this the button would say "✓ Reviewed" against
                      // the previous completed run while a fresh one is
                      // still in flight.
                      if (latest && latest.status === 'running') {
                        return (
                          <Link href={`/dashboard/reviews/${latest.id}`}
                            data-review-trigger
                            title={t('reviews.inProgress' as TranslationKey) || 'Review in progress…'}
                            style={{
                              padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8,
                              border: '1px solid rgba(168,85,247,0.45)',
                              background: 'rgba(168,85,247,0.18)',
                              color: '#c084fc',
                              textDecoration: 'none', whiteSpace: 'nowrap',
                            }}>
                            ⏳ {t('reviews.running' as TranslationKey) || 'Reviewing…'}
                          </Link>
                        );
                      }
                      // Done review → swap to a colored "Reviewed" link
                      // pointing at the dedicated detail page, so the
                      // user can re-read findings instead of triggering
                      // a duplicate run.
                      if (latest && !reviewing && (latest.status === 'completed' || latest.status === 'failed')) {
                        const sevColors: Record<string, string> = {
                          critical: '#ef4444', high: '#f97316', medium: '#eab308',
                          low: '#60a5fa', clean: '#22c55e',
                        };
                        const c = sevColors[latest.severity || 'clean'] || '#a78bfa';
                        return (
                          <Link href={`/dashboard/reviews/${latest.id}`}
                            data-review-trigger
                            title={t('reviews.openReview' as TranslationKey) || 'Open review'}
                            style={{
                              padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8,
                              border: `1px solid ${c}55`,
                              background: `${c}15`, color: c,
                              textDecoration: 'none', whiteSpace: 'nowrap',
                            }}>
                            ✓ {t('reviews.reviewed' as TranslationKey) || 'Reviewed'}
                            {latest.findings_count != null && latest.findings_count > 0 ? ` · ${latest.findings_count}` : ''}
                          </Link>
                        );
                      }
                      return (
                        <button
                          onClick={(e) => { if (!reviewing) openReviewPicker(task.id, e.currentTarget); }}
                          disabled={reviewing}
                          title={reviewing
                            ? (t('reviews.inProgress' as TranslationKey) || 'Review in progress…')
                            : (t('reviews.runReview' as TranslationKey) || 'Run review')}
                          data-review-trigger
                          style={{
                            padding: '6px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8,
                            border: '1px solid rgba(168,85,247,0.4)',
                            background: reviewing ? 'rgba(168,85,247,0.22)' : 'rgba(168,85,247,0.10)',
                            color: '#c084fc',
                            cursor: reviewing ? 'wait' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}>
                          {reviewing
                            ? `⏳ ${t('reviews.running' as TranslationKey) || 'Reviewing…'}`
                            : `🔎 ${t('reviews.review' as TranslationKey) || 'Review'}`}
                        </button>
                      );
                    })()}
                    <button onClick={() => void onAssignMCP(task.id)}
                      style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0d9488, #7c3aed)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Run
                    </button>
                  </>
                )}
                <RowActionsKebab
                  ariaLabel={t('tasks.actionsMenu' as TranslationKey) || 'More actions'}
                  items={[
                    { key: 'details', label: t('tasks.details'), icon: '🔍', href: `/tasks/${task.id}` },
                    { key: 'edit', label: t('tasks.actions.edit' as TranslationKey) || 'Edit', icon: '✏️', onClick: () => openEditTask(task) },
                    { key: 'share', label: t('taskDetail.share.button' as TranslationKey) || 'Share', icon: '🔗', onClick: () => setShareTask(task) },
                    { key: 'delete', label: t('tasks.actions.delete' as TranslationKey) || 'Delete', icon: '🗑', onClick: () => setDeleteConfirmTask(task), danger: true, hidden: task.status === 'running' },
                  ]}
                />
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
                    padding: '10px 12px', borderBottom: '1px solid var(--panel-border)',
                    borderLeft: task.description?.includes('Status: resolved') ? '3px solid #a855f7' : task.status === 'running' ? '3px solid #38bdf8' : '3px solid transparent',
                    background: task.description?.includes('Status: resolved') ? 'rgba(168,85,247,0.04)' : task.status === 'running' ? 'rgba(56,189,248,0.04)' : undefined,
                  }}>
                    {/* Row 1: title + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
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
                    {/* Row 2: title — clamped to 13px so long titles don't blow out the layout on small phones */}
                    <div style={{ fontWeight: 600, color: 'var(--ink-90)', fontSize: 13, lineHeight: 1.35, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
                      {task.title}
                    </div>
                    {/* Row 3: badges */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
                      {task.priority && (() => {
                        const pc: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
                        const c = pc[task.priority] || 'var(--ink-35)';
                        return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: `${c}15`, color: c, textTransform: 'capitalize' }}>{task.priority}</span>;
                      })()}
                      {task.description?.includes('Status: resolved') && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', color: '#a855f7' }}>
                          ✓ Resolved
                        </span>
                      )}
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
                      {(task.tags || []).map((tg) => (
                        <span key={tg} style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 999, fontSize: 9, fontWeight: 700, background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc' }}>
                          {tg}
                        </span>
                      ))}
                    </div>
                    {/* Row 4: stats */}
                    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--ink-45)', marginBottom: 8 }}>
                      <span>{fmtDuration(task.run_duration_sec ?? task.duration_sec)}</span>
                      {(task.total_tokens !== null && task.total_tokens !== undefined) && <span>{task.total_tokens.toLocaleString()} tok</span>}
                      {(task.retry_count !== null && task.retry_count !== undefined && task.retry_count > 0) && <span>retry: {task.retry_count}</span>}
                    </div>
                    {/* Row 5: actions — primary inline, rest in ⋮ kebab */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {busy ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(task.status) }}>{statusLabel(task.status, t)}</span>
                      ) : (
                        <>
                          {reviewsEnabled && (
                            <button onClick={(e) => openReviewPicker(task.id, e.currentTarget)}
                              data-review-trigger
                              style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.10)', color: '#c084fc', cursor: 'pointer' }}>
                              🔎 Review
                            </button>
                          )}
                          <button onClick={() => void onAssignMCP(task.id)}
                            style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0d9488, #7c3aed)', color: '#fff', cursor: 'pointer' }}>
                            Run
                          </button>
                        </>
                      )}
                      {task.source === 'sentry' && (
                        <button onClick={() => void toggleSentryResolve(task.id)}
                          style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.08)', color: '#a855f7', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {task.description?.includes('Status: resolved') ? 'Unresolve' : 'Resolve'}
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto' }}>
                        <RowActionsKebab
                          ariaLabel={t('tasks.actionsMenu' as TranslationKey) || 'More actions'}
                          items={[
                            { key: 'details', label: t('tasks.details'), icon: '🔍', href: `/tasks/${task.id}` },
                            { key: 'edit', label: t('tasks.actions.edit' as TranslationKey) || 'Edit', icon: '✏️', onClick: () => openEditTask(task) },
                            { key: 'share', label: t('taskDetail.share.button' as TranslationKey) || 'Share', icon: '🔗', onClick: () => setShareTask(task) },
                            { key: 'delete', label: t('tasks.actions.delete' as TranslationKey) || 'Delete', icon: '🗑', onClick: () => setDeleteConfirmTask(task), danger: true, hidden: task.status === 'running' },
                          ]}
                        />
                      </span>
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
      {/* Reviewer picker — single portal-based popover. Positions next to
          the anchor button, flips above when there's not enough room
          below. Closes via outside-click / Esc handler set up earlier. */}
      {reviewPickerTaskId !== null && reviewPickerAnchor !== null && (
        <ReviewerPickerPopover
          anchor={reviewPickerAnchor}
          options={reviewerAgentOptions}
          onPick={(role) => void triggerReview(reviewPickerTaskId, role)}
          t={t}
        />
      )}

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
      {/* Review result modal — surfaces verdict + jump to detail page */}
      {reviewResultModal && typeof document !== 'undefined' && createPortal(
        (() => {
          const r = reviewResultModal;
          const sevColors: Record<string, string> = {
            critical: '#ef4444', high: '#f97316', medium: '#eab308',
            low: '#60a5fa', clean: '#22c55e',
          };
          const c = sevColors[r.severity || 'clean'] || '#a78bfa';
          return (
            <div onClick={() => setReviewResultModal(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 16 }}>
              <div onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(540px, calc(100vw - 24px))',
                  borderRadius: 18, background: 'var(--surface)',
                  border: `1px solid ${c}55`, padding: 24,
                  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
                  display: 'grid', gap: 14, maxHeight: '90vh', overflowY: 'auto',
                }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: r.status === 'failed' ? 'rgba(239,68,68,0.12)' : `${c}18`,
                  border: r.status === 'failed' ? '1px solid rgba(239,68,68,0.45)' : `1px solid ${c}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, margin: '0 auto',
                }}>{r.status === 'failed' ? '⚠' : (r.severity === 'clean' ? '✅' : '🔎')}</div>
                <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: r.status === 'failed' ? '#f87171' : 'var(--ink-90)' }}>
                  {r.status === 'failed'
                    ? (t('reviews.failed' as TranslationKey) || 'Review failed')
                    : (t('reviews.completed' as TranslationKey) || 'Review completed')}
                </div>
                <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-50)', wordBreak: 'break-word' }}>
                  {r.task_title}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <span style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, background: `${c}22`, color: c, border: `1px solid ${c}55` }}>
                    {r.severity || '—'}
                  </span>
                  <span style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--panel-alt)', color: 'var(--ink-78)', border: '1px solid var(--panel-border-2)' }}>
                    {r.findings_count != null ? `${r.findings_count} ${t('reviews.findings' as TranslationKey) || 'findings'}` : '—'}
                  </span>
                  {r.score != null && (
                    <span style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--panel-alt)', color: 'var(--ink-78)', border: '1px solid var(--panel-border-2)' }}>
                      {t('reviews.score' as TranslationKey) || 'Score'}: {r.score}
                    </span>
                  )}
                </div>
                {r.summary && (
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--panel-alt)', border: '1px solid var(--panel-border-2)', fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
                    {r.summary}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 4 }}>
                  <button onClick={() => setReviewResultModal(null)}
                    style={{ padding: '10px 18px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-50)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                    {t('tasks.cancel' as TranslationKey) || 'Close'}
                  </button>
                  <Link href={`/dashboard/reviews/${r.id}`}
                    onClick={() => setReviewResultModal(null)}
                    style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                    {t('reviews.openDetails' as TranslationKey) || 'Open details'} →
                  </Link>
                </div>
              </div>
            </div>
          );
        })(),
        document.body,
      )}

      {/* Delete confirmation modal */}
      {deleteConfirmTask && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 16 }}
          onClick={() => setDeleteConfirmTask(null)}>
          <div style={{ width: 'min(400px, calc(100vw - 24px))', borderRadius: 20, border: '1px solid rgba(239,68,68,0.25)', background: 'var(--surface)', padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.4)', maxHeight: '92vh', overflowY: 'auto' }}
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
        </div>,
        document.body,
      )}
      {/* Edit task modal */}
      {editTask && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 16 }}
          onClick={() => setEditTask(null)}>
          <div style={{ width: 'min(880px, calc(100vw - 24px))', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.4)', overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ height: 3, background: 'linear-gradient(90deg, #38bdf8, #7c3aed)', flexShrink: 0 }} />
            {/* Header — sticky so the Save / Cancel actions are reachable
                without scrolling on small screens. */}
            <div style={{ padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border-2)', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>Edit Task #{editTask.id}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {editLoading && (
                  <span style={{ fontSize: 11, color: 'var(--ink-50)' }}>{t('tasks.picker.loading' as TranslationKey)}</span>
                )}
                <button onClick={() => setEditTask(null)}
                  style={{ padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-72)' }}>
                  {t('tasks.cancel')}
                </button>
                <button onClick={() => void saveEditTask()}
                  style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg, #0d9488, #22c55e)', border: 'none', color: '#fff' }}>
                  {t('common.save')}
                </button>
                <button onClick={() => setEditTask(null)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-45)', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            </div>
            {/* Body — two columns: left is title + description (heavy
                content), right is guardrails + repo. Each side scrolls
                independently if it overflows. */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)',
              gap: 18, padding: '18px 24px', overflowY: 'auto', flex: 1, minHeight: 0,
            }} className='edit-task-grid'>
              <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.titlePlaceholder')}</label>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.descriptionPlaceholder')}</label>
                  {(() => {
                    const hasContent = !!editDesc.trim();
                    const isRich = /<\/?(div|p|span|br|h[1-6]|ul|ol|li|table|img|strong|em|b|i|code|pre|blockquote)\b/i.test(editDesc);
                    const showText = !hasContent || editShowRawDescription || !isRich;
                    return showText ? (
                      <div style={{ position: 'relative' }}>
                        <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={14}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                        {hasContent && isRich && (
                          <button
                            type='button'
                            onClick={() => setEditShowRawDescription(false)}
                            style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-72)', cursor: 'pointer' }}
                            title={t('tasks.descriptionPreview' as TranslationKey)}
                          >👁</button>
                        )}
                      </div>
                    ) : (
                      <div style={{ position: 'relative', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: '10px 36px 10px 12px' }}>
                        <button
                          type='button'
                          onClick={() => setEditShowRawDescription(true)}
                          style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'var(--panel)', color: 'var(--ink-72)', cursor: 'pointer' }}
                          title={t('tasks.descriptionEdit' as TranslationKey)}
                        >✏️</button>
                        <RichDescription
                          className='task-md'
                          style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-78)', maxHeight: 360, overflowY: 'auto', wordBreak: 'break-word' }}
                          html={editDesc}
                        />
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <AiFillButton
                    title={editTitle}
                    description={editDesc}
                    onFilled={(r) => {
                      if (r.story_context) setEditStoryContext(r.story_context);
                      if (r.acceptance_criteria) setEditAcceptance(r.acceptance_criteria);
                      if (r.edge_cases) setEditEdgeCases(r.edge_cases);
                      setMsg(t('tasks.aiFill.done' as TranslationKey) || 'AI filled the fields below.');
                    }}
                    onError={(m) => setError(m)}
                  />
                  <span style={{ fontSize: 11, color: 'var(--ink-35)' }}>
                    {t('tasks.aiFill.hint' as TranslationKey) || 'Auto-fills the three fields below from the title + description.'}
                  </span>
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.storyContextPlaceholder')}</label>
                  <textarea value={editStoryContext} onChange={(e) => setEditStoryContext(e.target.value)} rows={2}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.acceptancePlaceholder')}</label>
                  <textarea value={editAcceptance} onChange={(e) => setEditAcceptance(e.target.value)} rows={2}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.edgeCasesPlaceholder')}</label>
                  <textarea value={editEdgeCases} onChange={(e) => setEditEdgeCases(e.target.value)} rows={2}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
                {/* Repo assignments + remote selector */}
                <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>{t('tasks.multiRepo.title' as TranslationKey)}</div>
                  {createMappingsLoaded && createMappings.length > 0 ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ maxHeight: 140, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: '4px 0' }}>
                        {createMappings.map((m) => (
                          <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--ink-78)', background: editRepoMappingIds.includes(m.id) ? 'rgba(94,234,212,0.08)' : 'transparent' }}>
                            <input
                              type='checkbox'
                              checked={editRepoMappingIds.includes(m.id)}
                              onChange={() => setEditRepoMappingIds((prev) => prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id])}
                              style={{ accentColor: '#0d9488', width: 14, height: 14 }}
                            />
                            <span style={{ fontWeight: 600 }}>{m.display_name || `${m.provider}:${m.owner}/${m.repo_name}`}</span>
                          </label>
                        ))}
                      </div>
                      {editRepoMappingIds.length > 0 && (
                        <div style={{ fontSize: 11, color: '#5eead4', marginTop: 4 }}>
                          {t('tasks.multiRepo.selected' as TranslationKey, { n: editRepoMappingIds.length })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--ink-35)', marginBottom: 8 }}>—</div>
                  )}
                  <RemoteRepoSelector compact onChange={() => { /* read-only here; assignment list is what's saved */ }} />
                </div>
                {/* Attachments — list existing + upload new ones in place.
                    Mirrors the create-modal section but talks to the live
                    task: file picker triggers an immediate POST so the
                    user does not have to re-create the task to add a
                    forgotten screenshot. */}
                <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '10px 12px', background: 'var(--panel)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>
                    {t('tasks.attachments.title' as TranslationKey)} {editAttachments.length > 0 ? `(${editAttachments.length})` : ''}
                  </div>
                  <input
                    type='file'
                    multiple
                    accept='image/*,.pdf,.txt,.md,.log,.json,.csv,.zip'
                    disabled={editAttachUploading}
                    onChange={async (e) => {
                      if (!editTask) return;
                      const picked = Array.from(e.target.files || []);
                      e.target.value = '';
                      const MAX = 20 * 1024 * 1024;
                      const oversize = picked.filter((f) => f.size > MAX);
                      const ok = picked.filter((f) => f.size <= MAX);
                      if (oversize.length > 0) {
                        setError(t('tasks.attachments.tooLarge' as TranslationKey, { names: oversize.map((f) => f.name).join(', ') }));
                      }
                      if (ok.length === 0) return;
                      setEditAttachUploading(true);
                      try {
                        for (const f of ok) {
                          const fd = new FormData();
                          fd.append('file', f);
                          await apiUpload(`/tasks/${editTask.id}/attachments`, fd);
                        }
                        const items = await apiFetch<Array<{ id: number; filename: string; content_type: string; size_bytes: number }>>(`/tasks/${editTask.id}/attachments`);
                        setEditAttachments(items || []);
                      } catch (upErr) {
                        setError(upErr instanceof Error ? upErr.message : t('tasks.attachments.uploadFailed' as TranslationKey));
                      } finally {
                        setEditAttachUploading(false);
                      }
                    }}
                    style={{ fontSize: 12, color: 'var(--ink-58)' }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 4 }}>
                    {editAttachUploading ? t('tasks.attachments.uploading' as TranslationKey) : t('tasks.attachments.hint' as TranslationKey)}
                  </div>
                  {editAttachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {editAttachments.map((a) => (
                        <div
                          key={a.id}
                          title={`${a.filename} (${(a.size_bytes / 1024).toFixed(0)} KB)`}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', fontSize: 11, color: 'var(--ink-72)', maxWidth: 180 }}
                        >
                          <span style={{ fontSize: 13 }}>{a.content_type.startsWith('image/') ? '🖼' : '📄'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.filename}</span>
                          <button
                            type='button'
                            onClick={async () => {
                              if (!editTask) return;
                              try {
                                await apiFetch(`/tasks/${editTask.id}/attachments/${a.id}`, { method: 'DELETE' });
                                setEditAttachments((prev) => prev.filter((x) => x.id !== a.id));
                              } catch (delErr) {
                                setError(delErr instanceof Error ? delErr.message : 'Delete failed');
                              }
                            }}
                            aria-label={t('tasks.attachments.delete' as TranslationKey)}
                            title={t('tasks.attachments.delete' as TranslationKey)}
                            style={{ background: 'none', border: 'none', color: 'var(--ink-35)', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Dependencies — collapsible same as Create */}
                <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden' }}>
                  <button
                    type='button'
                    onClick={() => setEditShowDeps(!editShowDeps)}
                    style={{
                      width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-72)',
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)' }}>
                      {t('tasks.deps.title' as TranslationKey)} {editDepIds.length > 0 ? `(${editDepIds.length})` : ''}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-35)', transform: editShowDeps ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
                  </button>
                  {editShowDeps && (
                    <div style={{ padding: '0 12px 12px' }}>
                      <input
                        value={editDepSearch}
                        onChange={(e) => setEditDepSearch(e.target.value)}
                        placeholder={t('tasks.deps.searchPlaceholder' as TranslationKey)}
                        style={{ width: '100%', padding: '6px 10px', fontSize: 12, marginBottom: 8, borderRadius: 8 }}
                      />
                      <div style={{ maxHeight: 160, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: '4px 6px', display: 'grid', gap: 2 }}>
                        {depCandidates
                          .filter((c) => c.id !== editTask?.id)
                          .filter((c) => !editDepSearch || c.title.toLowerCase().includes(editDepSearch.toLowerCase()) || String(c.id).includes(editDepSearch))
                          .map((c) => (
                            <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: '4px 4px', borderRadius: 6, background: editDepIds.includes(c.id) ? 'rgba(94,234,212,0.08)' : 'transparent' }}>
                              <input
                                type='checkbox'
                                checked={editDepIds.includes(c.id)}
                                onChange={(e) => setEditDepIds((prev) => e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id))}
                                style={{ accentColor: '#0d9488', width: 14, height: 14, flexShrink: 0 }}
                              />
                              <span style={{ fontSize: 12, color: editDepIds.includes(c.id) ? 'var(--ink-90)' : 'var(--ink-65)' }}>
                                #{c.id} {c.title}{' '}
                                <span style={{ color: statusColor(c.status), fontSize: 11 }}>({c.status})</span>
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.maxTokensPlaceholder')}</label>
                    <input type='number' min='0' step='1' value={editMaxTokens} onChange={(e) => setEditMaxTokens(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4, display: 'block' }}>{t('tasks.maxCostPlaceholder')}</label>
                    <input type='number' min='0' step='0.0001' value={editMaxCost} onChange={(e) => setEditMaxCost(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
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
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{t('tasks.repoBusy')}</div>
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
              }}>{t('common.cancel')}</button>
              <button onClick={() => void _forceQueueConflict()} style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>{t('tasks.queueAnyway')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <ShareTaskModal
        taskId={shareTask?.id ?? 0}
        taskTitle={shareTask?.title ?? ''}
        open={!!shareTask}
        onClose={() => setShareTask(null)}
      />
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
  { label: 'Claude CLI (Sonnet)', model: 'sonnet', provider: 'claude_cli' },
  { label: 'Claude CLI (Opus)', model: 'opus', provider: 'claude_cli' },
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
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>{t('common.model')}</div>
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

function ReviewerPickerPopover({ anchor, options, onPick, t }: {
  anchor: HTMLElement;
  options: Array<{ role: string; label: string }>;
  onPick: (role: string) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  // Compute viewport-relative coords from the anchor's bounding rect and
  // flip above if the menu would clip below the viewport. Recomputes on
  // window resize / scroll so the popover sticks to the button.
  const [coords, setCoords] = useState<{ top: number; left: number; flippedUp: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const compute = () => {
      const rect = anchor.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 240;
      const menuW = 240;
      const margin = 8;
      const fitsBelow = rect.bottom + menuH + margin <= window.innerHeight;
      const top = fitsBelow ? rect.bottom + 4 : Math.max(margin, rect.top - menuH - 4);
      // Right-align with the button — but never overflow viewport edges.
      let left = Math.min(rect.right - menuW, window.innerWidth - menuW - margin);
      if (left < margin) left = margin;
      setCoords({ top, left, flippedUp: !fitsBelow });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchor]);

  if (!coords) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-review-picker
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top: coords.top, left: coords.left,
        width: 240, padding: 4, zIndex: 9999,
        background: 'var(--surface)', border: '1px solid var(--panel-border)',
        borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', padding: '6px 10px 4px' }}>
        {t('reviews.pickReviewer' as TranslationKey) || 'Pick reviewer'}
      </div>
      <button onClick={() => onPick('auto')}
        style={{ width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
        ✨ Auto <span style={{ color: 'var(--ink-35)', fontWeight: 400 }}>(task config)</span>
      </button>
      <div style={{ height: 1, background: 'var(--panel-border)', margin: '4px 0' }} />
      {options.map((opt) => (
        <button key={opt.role} onClick={() => onPick(opt.role)}
          style={{ width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
          🔎 {opt.label} <span style={{ color: 'var(--ink-35)', fontWeight: 400, fontFamily: 'monospace' }}>({opt.role})</span>
        </button>
      ))}
    </div>,
    document.body,
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
  const taskDescRaw = ((task as unknown as { description?: string })?.description || '');
  const taskDesc = taskDescRaw.toLowerCase();
  const hasRepo = taskDesc.includes('local repo path') || taskDesc.includes('remote repo');

  // Pre-select agent from "Preferred Agent Role:" line stamped by the
  // IntegrationRule engine. Without this the user has to re-pick the
  // role the rule already chose for them.
  useEffect(() => {
    if (selected || mode !== 'ai') return;
    const m = taskDescRaw.match(/Preferred Agent Role:\s*([A-Za-z0-9_\-]+)/i);
    const preferredRole = (m?.[1] || '').trim().toLowerCase();
    if (!preferredRole) return;
    const match = agents.find((a) => (a.role || '').toLowerCase() === preferredRole && a.enabled !== false);
    if (match) {
      setSelected({ type: 'agent', agent: { role: match.role, model: match.model, provider: match.provider } });
    }
  }, [taskDescRaw, agents, mode, selected]);

  useEffect(() => {
    apiFetch<BackendRepoMapping[]>('/repo-mappings')
      .then((data) => {
        setBackendMappings(data);
        setMappingsLoaded(true);
        // Auto-select the task's existing repo mappings.
        //
        // Multi-repo imports write to ``task_repo_assignments`` and may
        // leave the legacy single ``repo_mapping_id`` column null, so we
        // prefer the ``repo_assignments`` array first and only fall back
        // to the legacy field for older / single-repo tasks. Without
        // this the Run modal popped open empty even though the user had
        // explicitly picked a repo at import time.
        const taskObj = task as unknown as {
          repo_mapping_id?: number;
          repo_assignments?: Array<{ repo_mapping_id?: number }>;
        } | undefined;
        const fromAssignments = (taskObj?.repo_assignments || [])
          .map((a) => a?.repo_mapping_id)
          .filter((id): id is number => typeof id === 'number' && data.some((m) => m.id === id));
        if (fromAssignments.length > 0) {
          setSelectedMappingIds(fromAssignments);
        } else if (taskObj?.repo_mapping_id && data.some((m) => m.id === taskObj.repo_mapping_id)) {
          setSelectedMappingIds([taskObj.repo_mapping_id as number]);
        }
      })
      .catch(() => setMappingsLoaded(true));
  }, []);

  function toggleMapping(id: number) {
    setSelectedMappingIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const mappingIds = selectedMappingIds.length > 0 ? selectedMappingIds : undefined;

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, width: 'min(480px, calc(100vw - 24px))', maxHeight: '92vh', overflowY: 'auto' }}>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: createPr ? '#22c55e' : 'var(--ink-58)' }}>{t('tasks.createPr')}</div>
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
                  transition: 'all 0.15s' }}>
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
              { label: 'Claude CLI (Sonnet)', model: 'sonnet', provider: 'claude_cli', color: '#fb923c', icon: '✎' },
              { label: 'Claude CLI (Opus)', model: 'opus', provider: 'claude_cli', color: '#a855f7', icon: '✎' },
              { label: 'Codex CLI', model: 'gpt-4o', provider: 'codex_cli', color: '#a78bfa', icon: '⌘' },
            ].map((cli) => {
              const isSelected = selected?.type === 'cli' && selected.agent?.provider === cli.provider && selected.agent?.model === cli.model;
              return (
              <button key={`${cli.provider}:${cli.model}`}
                onClick={() => setSelected({ type: 'cli', agent: { role: 'mcp_agent', model: cli.model, provider: cli.provider } })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10,
                  border: isSelected ? `1px solid ${cli.color}80` : `1px solid ${cli.color}40`,
                  background: isSelected ? `${cli.color}1a` : `${cli.color}0a`,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'all 0.15s' }}>
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
                      transition: 'all 0.15s' }}>
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
              {t('tasks.runTaskAction')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AttachedFilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string>('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [file]);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', fontSize: 11, color: 'var(--ink-72)' }}>
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={file.name} style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} />
      )}
      <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
      <span style={{ color: 'var(--ink-35)' }}>{(file.size / 1024).toFixed(0)} KB</span>
      <button
        type='button'
        onClick={onRemove}
        style={{ background: 'none', border: 'none', color: 'var(--ink-35)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
        aria-label='Remove'
      >
        ×
      </button>
    </div>
  );
}

