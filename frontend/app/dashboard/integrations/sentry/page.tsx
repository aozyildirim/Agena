'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';
import MappingHub from '@/components/integrations/MappingHub';

interface SentryProject {
  slug: string;
  name: string;
}

interface SentryIssue {
  id: string;
  short_id: string | null;
  title: string;
  level: string;
  status: string | null;
  culprit: string | null;
  count: number;
  user_count: number;
  last_seen: string | null;
  first_seen: string | null;
  permalink: string | null;
  is_unhandled: boolean;
  substatus: string | null;
  fixability_score: number | null;
  platform: string | null;
  stats_24h: number[];
  imported_task_id?: number | null;
  imported_task_status?: string | null;
  imported_work_item_url?: string | null;
}

interface SentryEnvironment { name: string; is_hidden: boolean }
interface SentryRelease { version: string; short_version: string | null; date_released: string | null; last_event: string | null }

interface SentryStackFrame {
  filename: string | null;
  function: string | null;
  lineno: number | null;
  abs_path: string | null;
  in_app: boolean;
  context_line: string | null;
  pre_context: string[];
  post_context: string[];
  repo_url: string | null;
}

interface SentryPreview {
  issue_id: string;
  event_id: string | null;
  title: string | null;
  exception_type: string | null;
  exception_value: string | null;
  platform: string | null;
  environment: string | null;
  release: string | null;
  transaction: string | null;
  request_method: string | null;
  request_url: string | null;
  frames: SentryStackFrame[];
  breadcrumbs: Array<{ timestamp: string; category: string; level: string; message: string; type: string }>;
}

interface SentryAIFixPreview {
  summary: string;
  suggested_fix: string;
  files_to_change: string[];
  confidence: number;
  cached: boolean;
}

interface SentryIssueEvent {
  event_id: string;
  title: string;
  message: string | null;
  timestamp: string | null;
  level: string | null;
  location: string | null;
  trace_preview: string | null;
}

interface SentryMapping {
  id: number;
  project_slug: string;
  project_name: string;
  repo_mapping_id: number | null;
  repo_display_name: string | null;
  flow_id: string | null;
  auto_import: boolean;
  import_interval_minutes: number;
  last_import_at: string | null;
  is_active: boolean;
}

interface RepoMapping {
  id: number;
  provider: string;
  owner: string;
  repo_name: string;
}

function Sparkline({ values, width = 80, height = 22, color = '#cf5b57' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden>
      <polyline points={`0,${height} ${points} ${width},${height}`} fill={color} fillOpacity={0.15} stroke='none' />
      <polyline points={points} fill='none' stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function Pill({ children, color = 'var(--muted)', bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 4,
      color, background: bg ?? (color.startsWith('#') ? `${color}1f` : 'var(--acc-soft)'),
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function FixabilityBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? '#3f9d6a' : pct >= 40 ? '#c98a2b' : 'var(--muted)';
  return <Pill color={color}>AI {pct}%</Pill>;
}

function RegressionBadge({ substatus }: { substatus: string | null }) {
  if (!substatus) return null;
  const s = substatus.toLowerCase();
  if (s === 'regressed') return <Pill color='#cf5b57'>REGRESSION</Pill>;
  if (s === 'new') return <Pill color='var(--acc)'>NEW</Pill>;
  if (s === 'escalating') return <Pill color='#c98a2b'>ESCALATING</Pill>;
  return null;
}

export default function SentryPage() {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<SentryProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [orgSlug, setOrgSlug] = useState('');

  const [selectedProject, setSelectedProject] = useState('');
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [events, setEvents] = useState<SentryIssueEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState('');

  const [mappings, setMappings] = useState<SentryMapping[]>([]);
  const [repos, setRepos] = useState<RepoMapping[]>([]);

  const [modalMapping, setModalMapping] = useState<SentryMapping | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalIssues, setModalIssues] = useState<SentryIssue[]>([]);
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set());
  const [modalImporting, setModalImporting] = useState(false);
  const [modalPeriod, setModalPeriod] = useState('24h');
  const [modalMirror, setModalMirror] = useState<'auto' | 'azure' | 'jira' | 'both' | 'none'>('auto');
  const [modalStoryPoints, setModalStoryPoints] = useState<number>(2);
  const [modalSprintPath, setModalSprintPath] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sprintOptions, setSprintOptions] = useState<Array<{ path: string; name: string; is_current?: boolean }>>([]);

  const [environments, setEnvironments] = useState<SentryEnvironment[]>([]);
  const [releases, setReleases] = useState<SentryRelease[]>([]);
  const [filterEnvironment, setFilterEnvironment] = useState('');
  const [filterRelease, setFilterRelease] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('24h');

  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [previewById, setPreviewById] = useState<Record<string, SentryPreview>>({});
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  const [aiFixIssue, setAiFixIssue] = useState<SentryIssue | null>(null);
  const [aiFixData, setAiFixData] = useState<SentryAIFixPreview | null>(null);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixError, setAiFixError] = useState('');

  const [runningSlug, setRunningSlug] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, { kind: 'ok' | 'err'; text: string; ts: number }>>({});

  useEffect(() => {
    void loadMappings();
    void loadRepos();
    // Auto-load projects on first paint so landing isn't an empty form.
    void searchProjects();
  }, []);

  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(timer);
  }, [msg]);

  async function loadMappings() {
    try {
      const data = await apiFetch<SentryMapping[]>('/sentry/mappings');
      setMappings(data);
    } catch {
      /* ignore */
    }
  }

  async function loadRepos() {
    try {
      const data = await apiFetch<RepoMapping[]>('/repo-mappings');
      setRepos(data);
    } catch {
      /* ignore */
    }
  }

  async function searchProjects() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      const data = await apiFetch<{ organization_slug: string; projects: SentryProject[] }>(`/sentry/projects?${params}`);
      setOrgSlug(data.organization_slug || '');
      setProjects(data.projects || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }

  async function fetchIssues(projectSlug: string) {
    setSelectedProject(projectSlug);
    setIssuesLoading(true);
    setSelectedIssueId('');
    setEvents([]);
    setExpandedIssueId(null);
    try {
      const params = new URLSearchParams({ query: 'is:unresolved', limit: '50' });
      if (filterPeriod) params.set('stats_period', filterPeriod);
      if (filterEnvironment) params.set('environment', filterEnvironment);
      if (filterRelease) params.set('release', filterRelease);
      const data = await apiFetch<{ issues: SentryIssue[] }>(`/sentry/projects/${encodeURIComponent(projectSlug)}/issues?${params}`);
      setIssues(data.issues || []);
      // Fire and forget: load env + release lists for filter dropdowns.
      void apiFetch<SentryEnvironment[]>(`/sentry/projects/${encodeURIComponent(projectSlug)}/environments`)
        .then((envs) => setEnvironments(envs.filter((e) => !e.is_hidden)))
        .catch(() => setEnvironments([]));
      void apiFetch<SentryRelease[]>(`/sentry/projects/${encodeURIComponent(projectSlug)}/releases?limit=30`)
        .then(setReleases).catch(() => setReleases([]));
    } catch {
      setIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }

  async function togglePreview(issueId: string) {
    if (expandedIssueId === issueId) {
      setExpandedIssueId(null);
      return;
    }
    setExpandedIssueId(issueId);
    if (previewById[issueId]) return;
    setPreviewLoadingId(issueId);
    try {
      const data = await apiFetch<SentryPreview>(`/sentry/issues/${encodeURIComponent(issueId)}/preview`);
      setPreviewById((prev) => ({ ...prev, [issueId]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewLoadingId(null);
    }
  }

  async function openAiFixPreview(issue: SentryIssue) {
    setAiFixIssue(issue);
    setAiFixData(null);
    setAiFixError('');
    setAiFixLoading(true);
    try {
      const data = await apiFetch<SentryAIFixPreview>(`/sentry/issues/${encodeURIComponent(issue.id)}/ai-preview`, { method: 'POST', body: JSON.stringify({ issue_id: issue.id }) });
      setAiFixData(data);
    } catch (e) {
      setAiFixError(e instanceof Error ? e.message : 'AI preview failed');
    } finally {
      setAiFixLoading(false);
    }
  }

  function closeAiFixPreview() {
    setAiFixIssue(null);
    setAiFixData(null);
    setAiFixError('');
  }

  async function fetchIssueEvents(issueId: string) {
    setSelectedIssueId(issueId);
    setEventsLoading(true);
    try {
      const data = await apiFetch<{ events: SentryIssueEvent[] }>(`/sentry/issues/${encodeURIComponent(issueId)}/events?limit=10`);
      setEvents(data.events || []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }

  async function addMapping(project: SentryProject) {
    try {
      await apiFetch('/sentry/mappings', {
        method: 'POST',
        body: JSON.stringify({
          project_slug: project.slug,
          project_name: project.name,
        }),
      });
      setMsg((t('integrations.sentry.mapped') || '"{name}" mapped — select a repo').replace('{name}', project.name));
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add mapping');
    }
  }

  // One-step map: create the mapping already linked to a repo (the backend
  // accepts repo_mapping_id on create), so the user picks a repo directly on
  // an unmapped project instead of "Map" then "select repo".
  async function mapProjectToRepo(project: SentryProject, repoId: number) {
    try {
      await apiFetch('/sentry/mappings', {
        method: 'POST',
        body: JSON.stringify({
          project_slug: project.slug,
          project_name: project.name,
          repo_mapping_id: repoId,
        }),
      });
      setMsg((t('integrations.sentry.mapped') || '"{name}" mapped').replace('{name}', project.name));
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add mapping');
    }
  }

  async function updateMapping(id: number, updates: Record<string, unknown>) {
    try {
      await apiFetch(`/sentry/mappings/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update mapping');
    }
  }

  async function deleteMapping(id: number) {
    try {
      await apiFetch(`/sentry/mappings/${id}`, { method: 'DELETE' });
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete mapping');
    }
  }

  async function importFiltered() {
    if (!selectedProject) return;
    setError('');
    setMsg('');
    try {
      const res = await apiFetch<{ imported: number; skipped: number }>('/tasks/import/sentry', {
        method: 'POST',
        body: JSON.stringify({
          project_slug: selectedProject,
          stats_period: filterPeriod || undefined,
          environment: filterEnvironment || undefined,
          release: filterRelease || undefined,
          limit: 100,
        }),
      });
      setMsg(`${res.imported} imported, ${res.skipped} skipped`);
      void fetchIssues(selectedProject);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  }

  async function importIssues(projectSlug?: string) {
    setError('');
    setMsg('');
    const rowKey = projectSlug || '__all__';
    setRunningSlug(rowKey);
    try {
      const body: Record<string, unknown> = {};
      if (projectSlug) body.project_slug = projectSlug;
      const res = await apiFetch<{ imported: number; skipped: number }>('/tasks/import/sentry', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      let summary = '';
      if (res.imported === 0 && res.skipped > 0) {
        summary = (t('integrations.sentry.allAlreadyImported') || 'All {n} already imported').replace('{n}', String(res.skipped));
      } else if (res.imported > 0 && res.skipped > 0) {
        summary = (t('integrations.sentry.importedSomeSkipped') || '+{i} imported, {s} skipped').replace('{i}', String(res.imported)).replace('{s}', String(res.skipped));
      } else if (res.imported > 0) {
        summary = (t('integrations.sentry.importedN') || '+{n} imported').replace('{n}', String(res.imported));
      } else {
        summary = t('integrations.sentry.noNewIssues') || 'No new issues';
      }
      setMsg(summary);
      setRowResult((prev) => ({ ...prev, [rowKey]: { kind: 'ok', text: summary, ts: Date.now() } }));
      void loadMappings();
    } catch (e) {
      const errText = e instanceof Error ? e.message : 'Import failed';
      setError(errText);
      setRowResult((prev) => ({ ...prev, [rowKey]: { kind: 'err', text: errText, ts: Date.now() } }));
    } finally {
      setRunningSlug(null);
      // Clear inline result after 6s
      setTimeout(() => {
        setRowResult((prev) => {
          if (!prev[rowKey] || Date.now() - prev[rowKey].ts < 5800) return prev;
          const next = { ...prev };
          delete next[rowKey];
          return next;
        });
      }, 6000);
    }
  }

  async function openRequestModal(mapping: SentryMapping) {
    setError('');
    setMsg('');
    setModalMapping(mapping);
    setModalIssues([]);
    setModalSelected(new Set());
    setModalPeriod('24h');
    await fetchModalIssues(mapping, '24h');
  }

  async function fetchModalIssues(mapping: SentryMapping, period: string) {
    setModalLoading(true);
    try {
      const params = new URLSearchParams({ query: 'is:unresolved', limit: '50', stats_period: period });
      const data = await apiFetch<{ issues: SentryIssue[] }>(`/sentry/projects/${encodeURIComponent(mapping.project_slug)}/issues?${params}`);
      setModalIssues(data.issues || []);
      setModalSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch issues');
    } finally {
      setModalLoading(false);
    }
  }

  function closeRequestModal() {
    setModalMapping(null);
    setModalIssues([]);
    setModalSelected(new Set());
  }

  function toggleModalSelected(id: string) {
    setModalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function modalSelectAll() {
    setModalSelected(new Set(modalIssues.filter((i) => !i.imported_task_id).map((i) => i.id)));
  }

  function modalDeselectAll() {
    setModalSelected(new Set());
  }

  async function importModalSelected() {
    if (!modalMapping || modalSelected.size === 0) return;
    setModalImporting(true);
    try {
      const res = await apiFetch<{ imported: number; skipped: number; manual_azure_urls?: string[] }>('/tasks/import/sentry', {
        method: 'POST',
        body: JSON.stringify({
          project_slug: modalMapping.project_slug,
          issue_ids: Array.from(modalSelected),
          stats_period: modalPeriod,
          mirror_target: modalMirror,
          story_points: modalStoryPoints,
          iteration_path: modalSprintPath || null,
        }),
      });
      (res.manual_azure_urls || []).forEach((url) => {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      });
      const msgTpl = t('integrations.newrelic.importResult') || '{imported} imported, {skipped} skipped';
      setMsg(msgTpl.replace('{imported}', String(res.imported)).replace('{skipped}', String(res.skipped)));
      setConfirmOpen(false);
      closeRequestModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setModalImporting(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)',
    background: 'var(--glass)', color: 'var(--ink)', fontSize: 13,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  };
  const btnSmall: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border)',
    background: 'transparent', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer',
  };

  const totalMappings = mappings.length;
  const autoMappings = mappings.filter((m) => m.auto_import).length;
  const repoMappings = mappings.filter((m) => m.repo_mapping_id != null).length;

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <style>{`
        .sentry-row-card {
          display: flex !important;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        .sentry-row-card > .sentry-row-icon { flex: 0 0 auto; }
        .sentry-row-card > .sentry-row-title { flex: 1 1 180px; min-width: 0; }
        .sentry-row-card > .sentry-row-actions { flex: 0 0 auto; margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
        @media (max-width: 700px) {
          .sentry-row-card > .sentry-row-actions { flex: 1 1 100% !important; margin-left: 0 !important; padding-top: 8px; margin-top: 2px; border-top: 1px dashed var(--panel-border); justify-content: flex-start !important; }
          .sentry-row-actions select { flex: 1 1 auto; min-width: 0; max-width: 220px; }
          .sentry-issue-card { flex-direction: column; align-items: stretch !important; }
          .sentry-issue-right { flex-direction: row !important; align-items: center !important; justify-content: space-between !important; flex-wrap: wrap; gap: 8px !important; padding-top: 6px; border-top: 1px dashed var(--panel-border); }
        }
        .sentry-icon-btn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 0 !important; font-size: 13px !important; }
      `}</style>
      {/* Hero header */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--panel-border)',
        background: 'var(--surface)',
        padding: '20px 22px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'var(--panel-border)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--acc-soft)', border: '1px solid var(--panel-border)',
            color: 'var(--acc)',
          }}><NavIcon name="shield" size={22} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', letterSpacing: -0.3 }}>
              {t('integrations.providerSentry')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.5 }}>
              {t('integrations.sentry.heroSubtitle') || 'AI-powered error triage. Import production errors, get root-cause analysis with one click, ship fixes through your repo.'}
            </div>
            {orgSlug && (
              <div style={{ fontSize: 11, color: 'var(--ink-45)', marginTop: 6, fontFamily: 'monospace' }}>
                <span style={{ color: 'var(--ink-30)' }}>org:</span> <strong style={{ color: 'var(--ink)' }}>{orgSlug}</strong>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3f9d6a', marginLeft: 8, verticalAlign: 'middle' }} />
                <span style={{ color: '#3f9d6a', fontWeight: 600, marginLeft: 4, fontFamily: 'inherit' }}>connected</span>
              </div>
            )}
          </div>
        </div>

        {/* Stat tiles */}
        {totalMappings > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: t('integrations.sentry.statMapped') || 'Mapped projects', value: totalMappings, color: 'var(--ink-90)' },
              { label: t('integrations.sentry.statWithRepo') || 'Linked to a repo', value: `${repoMappings}/${totalMappings}`, color: 'var(--acc)' },
              { label: t('integrations.sentry.statAuto') || 'Auto-import on', value: autoMappings, color: 'var(--acc)' },
            ].map((tile) => (
              <div key={tile.label} style={{
                flex: 1, minWidth: 130,
                padding: '10px 14px', borderRadius: 10,
                background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{tile.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: tile.color, marginTop: 4 }}>{tile.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating toast: visible regardless of scroll position so mobile users can see the import outcome. */}
      {(runningSlug || msg || error) && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          zIndex: 9999, maxWidth: 'min(94vw, 460px)',
          padding: '12px 18px', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 700,
          color: error ? '#cf5b57' : runningSlug ? '#c98a2b' : '#3f9d6a',
          background: 'var(--surface)',
          border: `1px solid ${error ? '#cf5b57' : runningSlug ? '#c98a2b' : '#3f9d6a'}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
        }}>
          {runningSlug ? (
            <>
              <span style={{
                display: 'inline-block', width: 14, height: 14,
                border: '2px solid var(--panel-border)', borderTopColor: '#c98a2b',
                borderRadius: '50%', animation: 'sentry-spin 0.7s linear infinite',
              }} />
              <span>{(t('integrations.sentry.toastImporting') || 'Importing from {p}…').replace('{p}', runningSlug === '__all__' ? 'all projects' : runningSlug)}</span>
            </>
          ) : error ? (
            <>
              <NavIcon name="alert" size={16} />
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: '#cf5b57', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </>
          ) : (
            <>
              <NavIcon name="activity" size={16} />
              <span style={{ flex: 1 }}>{msg}</span>
              <button onClick={() => setMsg('')} style={{ background: 'transparent', border: 'none', color: '#3f9d6a', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </>
          )}
          <style>{`@keyframes sentry-spin { to { transform: rotate(360deg); } }`}</style>
        </div>,
        document.body
      )}

      <div style={cardStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>
          {t('integrations.sentry.findProjectsLabel') || 'Find a project to map'}
        </div>
        <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('integrations.sentry.searchPlaceholder')}
            style={{ ...inputStyle, flex: 1, minWidth: 200, height: 38 }}
            onKeyDown={(e) => e.key === 'Enter' && void searchProjects()}
          />
          <button onClick={() => void searchProjects()} disabled={loading} style={{ ...btnPrimary, padding: '10px 18px' }}>
            {loading ? '…' : t('integrations.common.search')}
          </button>
        </div>
      </div>

      {/* Project → repo mapping (shared guided MappingHub) */}
      <MappingHub
        title='Sentry'
        logo={<NavIcon name='shield' size={15} />}
        loading={loading}
        hint={t('integrations.sentry.heroSubtitle') || 'Map a project to a repo so AI can auto-fix its production errors and ship the patch.'}
        searchPlaceholder={`Filter ${projects.length} projects…`}
        repos={repos.map((r) => ({ id: r.id, label: `${r.owner}/${r.repo_name}` }))}
        items={projects.map((p) => {
          const m = mappings.find((mm) => mm.project_slug === p.slug);
          return {
            id: p.slug,
            name: p.name,
            sublabel: p.slug,
            live: true,
            mappedRepoId: m?.repo_mapping_id ?? null,
            autoImport: m?.auto_import,
          };
        })}
        onMapRepo={(item, repoId) => {
          const p = projects.find((x) => x.slug === item.id);
          const m = mappings.find((mm) => mm.project_slug === item.id);
          if (m) void updateMapping(m.id, { repo_mapping_id: repoId });
          else if (p && repoId != null) void mapProjectToRepo(p, repoId);
        }}
        onToggleAuto={(item) => {
          const m = mappings.find((mm) => mm.project_slug === item.id);
          if (m) void updateMapping(m.id, { auto_import: !m.auto_import });
        }}
        renderActions={(item) => {
          const m = mappings.find((mm) => mm.project_slug === item.id);
          return (
            <>
              <button onClick={() => void fetchIssues(item.id)} title={t('integrations.sentry.issuesBtn')} style={{ ...btnSmall, height: 32, width: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><NavIcon name='clipboard' size={13} /></button>
              {m && (
                <button onClick={() => void importIssues(m.project_slug)} disabled={runningSlug === m.project_slug} title={t('integrations.common.import')} style={{ ...btnSmall, height: 32, width: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: runningSlug === m.project_slug ? 0.6 : 1 }}>{runningSlug === m.project_slug ? '…' : <NavIcon name='send' size={13} />}</button>
              )}
              {m && (
                <button onClick={() => void deleteMapping(m.id)} title={t('integrations.common.unmap') || 'Unmap'} style={{ ...btnSmall, height: 32, width: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cf5b57', borderColor: 'var(--panel-border)' }}><NavIcon name='close' size={13} /></button>
              )}
              {rowResult[item.id] && (
                <span style={{ fontSize: 10, fontWeight: 700, color: rowResult[item.id].kind === 'ok' ? '#3f9d6a' : '#cf5b57', whiteSpace: 'nowrap' }}>{rowResult[item.id].text}</span>
              )}
            </>
          );
        }}
      />

      {selectedProject && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)' }}>{t('integrations.sentry.issuesFor').replace('{name}', selectedProject)}</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => void importFiltered()} disabled={issues.length === 0}
                style={{ ...btnSmall, color: 'var(--acc)', borderColor: 'var(--acc)', opacity: issues.length === 0 ? 0.5 : 1 }}>
                {(t('integrations.sentry.importFiltered') || 'Import filtered ({n})').replace('{n}', String(issues.length))}
              </button>
              <button onClick={() => void importIssues(selectedProject)} style={btnPrimary}>{t('integrations.common.importAsTasks')}</button>
            </div>
          </div>

          {/* Health header */}
          {issues.length > 0 && (() => {
            const totalEvents = issues.reduce((s, i) => s + (i.count || 0), 0);
            const totalUsers = issues.reduce((s, i) => s + (i.user_count || 0), 0);
            const regressed = issues.filter((i) => (i.substatus || '').toLowerCase() === 'regressed').length;
            const newCount = issues.filter((i) => (i.substatus || '').toLowerCase() === 'new').length;
            const unhandled = issues.filter((i) => i.is_unhandled).length;
            const importedDone = issues.filter((i) => i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'completed').length;
            const tile = (label: string, value: string | number, color = 'var(--ink-90)') => (
              <div style={{ flex: 1, minWidth: 110, padding: '8px 10px', borderRadius: 8, background: 'var(--panel-alt)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
              </div>
            );
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {tile(t('integrations.sentry.healthIssues') || 'Issues', issues.length)}
                {tile(t('integrations.sentry.healthEvents') || 'Events', totalEvents.toLocaleString(), '#cf5b57')}
                {tile(t('integrations.sentry.healthUsers') || 'Users', totalUsers.toLocaleString(), '#c98a2b')}
                {regressed > 0 && tile(t('integrations.sentry.healthRegressed') || 'Regressed', regressed, '#cf5b57')}
                {newCount > 0 && tile(t('integrations.sentry.healthNew') || 'New', newCount, 'var(--acc)')}
                {unhandled > 0 && tile(t('integrations.sentry.healthUnhandled') || 'Unhandled', unhandled, '#cf5b57')}
                {importedDone > 0 && tile(t('integrations.sentry.healthFixed') || 'AI-fixed', importedDone, '#3f9d6a')}
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select value={filterPeriod} onChange={(e) => { setFilterPeriod(e.target.value); void fetchIssues(selectedProject); }}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 11 }}>
              <option value='1h'>{t('integrations.newrelic.range1h') || 'Last 1 hour'}</option>
              <option value='24h'>{t('integrations.newrelic.range24h') || 'Last 24 hours'}</option>
              <option value='7d'>{t('integrations.newrelic.range7d') || 'Last 7 days'}</option>
              <option value='14d'>{t('integrations.sentry.range14d') || 'Last 14 days'}</option>
              <option value='30d'>{t('integrations.sentry.range30d') || 'Last 30 days'}</option>
            </select>
            <select value={filterEnvironment} onChange={(e) => { setFilterEnvironment(e.target.value); void fetchIssues(selectedProject); }}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 11 }}>
              <option value=''>{t('integrations.sentry.allEnvironments') || 'All environments'}</option>
              {environments.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
            </select>
            <select value={filterRelease} onChange={(e) => { setFilterRelease(e.target.value); void fetchIssues(selectedProject); }}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 11, maxWidth: 240 }}>
              <option value=''>{t('integrations.sentry.allReleases') || 'All releases'}</option>
              {releases.map((r) => <option key={r.version} value={r.version}>{r.short_version || r.version}</option>)}
            </select>
          </div>

          {issuesLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.loading')}</div>
          ) : issues.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.noIssues')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {issues.map((i) => {
                const expanded = expandedIssueId === i.id;
                const preview = previewById[i.id];
                const levelColor = i.level === 'fatal' || i.level === 'error' ? '#cf5b57' : i.level === 'warning' ? '#c98a2b' : 'var(--muted)';
                return (
                  <div key={i.id} style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: selectedIssueId === i.id ? 'var(--panel)' : 'var(--panel-alt)',
                    border: '1px solid var(--panel-border)',
                  }}>
                    <div className='sentry-issue-card' style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                          <Pill color={levelColor}>{i.level.toUpperCase()}</Pill>
                          <RegressionBadge substatus={i.substatus} />
                          {i.is_unhandled && <Pill color='#cf5b57'>UNHANDLED</Pill>}
                          <FixabilityBadge score={i.fixability_score} />
                          {i.platform && <Pill color='var(--muted)'>{i.platform}</Pill>}
                          {i.imported_task_id && (
                            <a href={`/tasks/${i.imported_task_id}`} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}>
                              TASK #{i.imported_task_id}
                            </a>
                          )}
                          {i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'completed' && (
                            <Pill color='#3f9d6a'>{t('integrations.sentry.aiResolved') || 'AI RESOLVED'}</Pill>
                          )}
                          {i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'running' && (
                            <Pill color='var(--acc)'>{t('integrations.sentry.aiRunning') || 'AI WORKING'}</Pill>
                          )}
                          {i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'failed' && (
                            <Pill color='#cf5b57'>{t('integrations.sentry.aiFailed') || 'AI FAILED'}</Pill>
                          )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {i.title}
                        </div>
                        {(i.culprit || i.short_id) && (
                          <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {i.culprit || i.short_id}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 10, color: 'var(--ink-45)', flexWrap: 'wrap' }}>
                          <span><strong style={{ color: '#cf5b57' }}>{i.count.toLocaleString()}</strong> events</span>
                          {i.user_count > 0 && <span><strong style={{ color: '#c98a2b' }}>{i.user_count.toLocaleString()}</strong> {(t('integrations.sentry.usersAffected') || 'users')}</span>}
                          {i.last_seen && <span>{(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(i.last_seen).toLocaleString()}</span>}
                        </div>
                      </div>
                      <div className='sentry-issue-right' style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                        {i.stats_24h && i.stats_24h.length > 1 && (
                          <Sparkline values={i.stats_24h} color={levelColor} />
                        )}
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => void togglePreview(i.id)} style={btnSmall}>
                            {expanded ? '▾' : '▸'} {t('integrations.sentry.preview') || 'Preview'}
                          </button>
                          <button onClick={() => void openAiFixPreview(i)} style={{ ...btnSmall, color: 'var(--acc)', borderColor: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <NavIcon name="zap" size={13} /> {t('integrations.sentry.aiFix') || 'AI Fix'}
                          </button>
                          {i.permalink && (
                            <a href={i.permalink} target='_blank' rel='noreferrer' style={{ ...btnSmall, color: 'var(--ink-65)', textDecoration: 'none', borderColor: 'var(--panel-border)', display: 'inline-flex', alignItems: 'center' }}>
                              <NavIcon name="chevron-right" size={13} />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--panel-border)' }}>
                        {previewLoadingId === i.id || !preview ? (
                          <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>{t('integrations.common.loading') || 'Loading...'}</div>
                        ) : (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {(preview.exception_type || preview.exception_value) && (
                              <div style={{ fontSize: 12, fontFamily: 'monospace', background: 'var(--panel-alt)', padding: '6px 10px', borderRadius: 6, color: '#cf5b57' }}>
                                {preview.exception_type && <strong>{preview.exception_type}: </strong>}
                                {preview.exception_value}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--ink-45)', flexWrap: 'wrap' }}>
                              {preview.environment && <span>env: <strong>{preview.environment}</strong></span>}
                              {preview.release && <span>release: <strong>{preview.release}</strong></span>}
                              {preview.transaction && <span>txn: <strong>{preview.transaction}</strong></span>}
                              {preview.request_method && preview.request_url && <span>{preview.request_method} {preview.request_url}</span>}
                            </div>
                            {preview.frames.length === 0 ? (
                              <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>{t('integrations.sentry.noStackFrames') || 'No stack frames available.'}</div>
                            ) : (
                              <div style={{ display: 'grid', gap: 6 }}>
                                {preview.frames.slice(0, 3).map((fr, idx) => (
                                  <div key={idx} style={{ background: 'var(--panel)', borderRadius: 6, padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, border: fr.in_app ? '1px solid var(--acc)' : '1px solid var(--panel-border)' }}>
                                    <div style={{ color: 'var(--ink-65)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ color: fr.in_app ? 'var(--acc)' : 'var(--ink-35)' }}>{fr.in_app ? '★ ' : ''}</span>
                                      <span style={{ color: 'var(--ink-90)' }}>{fr.filename || fr.abs_path || '<unknown>'}</span>
                                      {fr.lineno != null && <span style={{ color: '#c98a2b' }}>:{fr.lineno}</span>}
                                      {fr.function && <span style={{ color: 'var(--ink-50)' }}> in {fr.function}</span>}
                                      {fr.repo_url && (
                                        <a href={fr.repo_url} target='_blank' rel='noreferrer' style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--acc)', textDecoration: 'none', padding: '1px 6px', borderRadius: 4, background: 'var(--acc-soft)' }}>
                                          {t('integrations.sentry.openInRepo') || 'open in repo'} ↗
                                        </a>
                                      )}
                                    </div>
                                    {fr.context_line && (
                                      <pre style={{ margin: 0, fontSize: 10, lineHeight: 1.6, color: 'var(--ink-78)', whiteSpace: 'pre', overflowX: 'auto' }}>
                                        {fr.pre_context.map((l) => `  ${l}\n`).join('')}
                                        {`▶ ${fr.context_line}\n`}
                                        {fr.post_context.map((l) => `  ${l}\n`).join('')}
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {preview.breadcrumbs.length > 0 && (
                              <details>
                                <summary style={{ fontSize: 11, color: 'var(--ink-45)', cursor: 'pointer' }}>
                                  {(t('integrations.sentry.breadcrumbsCount') || '{n} breadcrumbs').replace('{n}', String(preview.breadcrumbs.length))}
                                </summary>
                                <div style={{ marginTop: 6, display: 'grid', gap: 3 }}>
                                  {preview.breadcrumbs.map((b, idx) => (
                                    <div key={idx} style={{ fontSize: 10, color: 'var(--ink-50)', fontFamily: 'monospace' }}>
                                      <span style={{ color: 'var(--muted)' }}>{b.timestamp}</span>{' '}
                                      <span style={{ color: '#c98a2b' }}>{b.category}</span>{' '}
                                      <span>{b.message || b.type}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                            <div>
                              <button onClick={() => void fetchIssueEvents(i.id)} style={btnSmall}>{t('integrations.sentry.tracesBtn')}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedIssueId && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)', marginBottom: 8 }}>{t('integrations.sentry.tracesFor').replace('{id}', selectedIssueId)}</h3>
          {eventsLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.loading')}</div>
          ) : events.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.sentry.noTraces')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {events.map((ev) => (
                <div key={ev.event_id || `${ev.title}_${ev.timestamp || ''}`} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--panel-alt)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: '#c98a2b', fontWeight: 700 }}>{(ev.level || 'error').toUpperCase()}</span>
                    <span style={{ color: 'var(--ink-35)' }}>{ev.timestamp || '-'}</span>
                    <span style={{ color: 'var(--ink-35)' }}>{ev.location || '-'}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-90)' }}>{ev.title}</div>
                  {ev.trace_preview && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-45)', whiteSpace: 'pre-wrap' }}>{ev.trace_preview}</div>}
                  {ev.message && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-50)', whiteSpace: 'pre-wrap' }}>{ev.message}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', margin: 0 }}>
            {t('integrations.sentry.projectMappings')}
          </h3>
          {mappings.length > 0 && (
            <button onClick={() => void importIssues()} style={btnPrimary}>{t('integrations.common.importAll')}</button>
          )}
        </div>
        {mappings.length === 0 ? (
          <div style={{
            padding: '28px 18px', textAlign: 'center', borderRadius: 10,
            background: 'var(--panel-alt)', border: '1px dashed var(--panel-border)',
          }}>
            <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center', color: 'var(--ink-35)' }}><NavIcon name="plug" size={28} /></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>
              {t('integrations.sentry.noMappingsTitle') || 'No project mappings yet'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4, lineHeight: 1.5, maxWidth: 380, margin: '4px auto 0' }}>
              {t('integrations.common.noProjectMappingsHint')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {mappings.map((m) => {
              const lastImport = m.last_import_at ? new Date(m.last_import_at) : null;
              const lastImportRel = lastImport ? (() => {
                const diffMs = Date.now() - lastImport.getTime();
                const mins = Math.floor(diffMs / 60000);
                if (mins < 1) return t('integrations.sentry.justNow') || 'just now';
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                const days = Math.floor(hrs / 24);
                return `${days}d ago`;
              })() : null;
              const nextRunRel = m.auto_import && lastImport ? (() => {
                const nextDue = lastImport.getTime() + m.import_interval_minutes * 60000;
                const diffMs = nextDue - Date.now();
                if (diffMs <= 0) return t('integrations.sentry.dueNow') || 'due now';
                const mins = Math.ceil(diffMs / 60000);
                if (mins < 60) return (t('integrations.sentry.nextInM') || 'next in {n}m').replace('{n}', String(mins));
                const hrs = Math.ceil(mins / 60);
                return (t('integrations.sentry.nextInH') || 'next in {n}h').replace('{n}', String(hrs));
              })() : null;
              return (
                <div key={m.id} className='sentry-row-card' style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'var(--panel-alt)',
                  border: '1px solid var(--panel-border)',
                }}>
                  <div className='sentry-row-icon' style={{
                    width: 36, height: 36, borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--acc-soft)',
                    border: '1px solid var(--panel-border)',
                    color: 'var(--acc)',
                  }}>
                    <NavIcon name={m.auto_import ? 'zap' : 'plug'} size={16} />
                  </div>
                  <div className='sentry-row-title'>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{m.project_name}</span>
                      {m.repo_display_name ? (
                        <span style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 600 }}>→ {m.repo_display_name}</span>
                      ) : (
                        <Pill color='#c98a2b'>{(t('integrations.sentry.noRepoLinked') || 'no repo linked').toUpperCase()}</Pill>
                      )}
                      {m.auto_import && <Pill color='var(--acc)'>AUTO</Pill>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 3, fontFamily: 'monospace' }}>
                      {m.project_slug}
                      {lastImportRel && <span style={{ color: 'var(--ink-50)', fontFamily: 'inherit', marginLeft: 8 }}>· {(t('integrations.sentry.lastImport') || 'Last import')}: {lastImportRel}</span>}
                      {nextRunRel && <span style={{ color: 'var(--acc)', fontFamily: 'inherit', marginLeft: 8 }}>· {nextRunRel}</span>}
                      {!lastImportRel && m.import_interval_minutes && m.auto_import && <span style={{ color: 'var(--ink-50)', fontFamily: 'inherit', marginLeft: 8 }}>· {(t('integrations.sentry.everyN') || 'every {n}min').replace('{n}', String(m.import_interval_minutes))}</span>}
                    </div>
                  </div>
                  <div className='sentry-row-actions'>
                    <select
                      value={m.repo_mapping_id ?? ''}
                      onChange={(e) => void updateMapping(m.id, { repo_mapping_id: e.target.value ? parseInt(e.target.value) : null })}
                      style={{ ...inputStyle, width: 150, fontSize: 11, height: 30 }}
                    >
                      <option value="">{t('integrations.common.noRepo') || 'No repo'}</option>
                      {repos.map((r) => (
                        <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                      ))}
                    </select>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      color: m.auto_import ? 'var(--acc)' : 'var(--ink-50)',
                      padding: '6px 10px', borderRadius: 6,
                      background: m.auto_import ? 'var(--acc-soft)' : 'transparent',
                      border: `1px solid ${m.auto_import ? 'var(--acc)' : 'var(--panel-border)'}`,
                    }}>
                      <input type='checkbox' checked={m.auto_import} onChange={(e) => void updateMapping(m.id, { auto_import: e.target.checked })} style={{ margin: 0 }} />
                      {t('integrations.common.auto').toUpperCase()}
                    </label>
                    <button onClick={() => void importIssues(m.project_slug)} title={t('integrations.sentry.runNow') || 'Run now'}
                      disabled={runningSlug === m.project_slug}
                      className='sentry-icon-btn' style={{ ...btnSmall, color: 'var(--acc)', borderColor: 'var(--acc)', opacity: runningSlug === m.project_slug ? 0.6 : 1 }}>
                      {runningSlug === m.project_slug ? '…' : <NavIcon name="send" size={13} />}
                    </button>
                    {rowResult[m.project_slug] && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6,
                        color: rowResult[m.project_slug].kind === 'ok' ? '#3f9d6a' : '#cf5b57',
                        background: 'var(--panel-alt)',
                        whiteSpace: 'nowrap',
                      }}>{rowResult[m.project_slug].text}</span>
                    )}
                    <button onClick={() => void openRequestModal(m)} style={{ ...btnSmall, height: 30 }}>
                      {t('integrations.newrelic.request') || 'Request'}
                    </button>
                    <button onClick={() => void deleteMapping(m.id)} title={t('integrations.common.unmap') || 'Unmap'}
                      className='sentry-icon-btn' style={{ ...btnSmall, color: '#cf5b57', borderColor: 'var(--panel-border)' }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {aiFixIssue && typeof document !== 'undefined' && createPortal(
        <div onClick={closeAiFixPreview} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)' }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10,
            width: 'min(680px, calc(100vw - 32px))', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--acc)', display: 'inline-flex' }}><NavIcon name="zap" size={18} /></span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)' }}>{t('integrations.sentry.aiFixTitle') || 'AI Fix Preview'}</span>
                  {aiFixData?.cached && <Pill color='var(--muted)'>cached</Pill>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {aiFixIssue.title}
                </div>
              </div>
              <button onClick={closeAiFixPreview} style={{ ...btnSmall, fontSize: 16 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
              {aiFixLoading && (
                <div style={{ fontSize: 12, color: 'var(--ink-45)', textAlign: 'center', padding: 24 }}>
                  {t('integrations.sentry.aiFixThinking') || 'Analyzing the stack trace...'}
                </div>
              )}
              {aiFixError && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--panel-alt)', color: '#cf5b57', fontSize: 12, fontWeight: 600 }}>
                  {aiFixError}
                </div>
              )}
              {aiFixData && (
                <div style={{ display: 'grid', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 6 }}>
                      {t('integrations.sentry.aiFixSummary') || 'Root cause'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-90)', lineHeight: 1.55 }}>
                      {aiFixData.summary}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 6 }}>
                      {t('integrations.sentry.aiFixPlan') || 'Suggested fix'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      {aiFixData.suggested_fix || '—'}
                    </div>
                  </div>
                  {aiFixData.files_to_change.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 6 }}>
                        {t('integrations.sentry.aiFixFiles') || 'Likely files'}
                      </div>
                      <div style={{ display: 'grid', gap: 3 }}>
                        {aiFixData.files_to_change.map((f, idx) => (
                          <div key={idx} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-78)', background: 'var(--panel)', padding: '4px 8px', borderRadius: 6 }}>
                            {f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-35)', textTransform: 'uppercase' }}>
                      {t('integrations.sentry.aiFixConfidence') || 'Confidence'}
                    </div>
                    <div style={{ flex: 1, height: 6, background: 'var(--panel-border)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${aiFixData.confidence}%`, height: '100%', background: aiFixData.confidence >= 70 ? '#3f9d6a' : aiFixData.confidence >= 40 ? '#c98a2b' : 'var(--muted)' }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-90)', minWidth: 30, textAlign: 'right' }}>
                      {aiFixData.confidence}%
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--panel-border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closeAiFixPreview} style={btnSmall}>{t('integrations.common.cancel') || 'Close'}</button>
              {aiFixData && !aiFixIssue.imported_task_id && (
                <button onClick={() => { void importIssues(selectedProject); closeAiFixPreview(); }} style={btnPrimary}>
                  {t('integrations.sentry.aiFixImport') || 'Import as task → Let AI fix it'}
                </button>
              )}
              {aiFixData && aiFixIssue.imported_task_id && (
                <a href={`/tasks/${aiFixIssue.imported_task_id}`} style={{ ...btnPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                  {(t('integrations.sentry.aiFixOpenTask') || 'Open task #{id}').replace('{id}', String(aiFixIssue.imported_task_id))}
                </a>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {modalMapping && typeof document !== 'undefined' && createPortal(
        <div
          onClick={closeRequestModal}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
          }}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10,
              width: 'min(760px, calc(100vw - 32px))',
              maxWidth: 'calc(100vw - 32px)',
              height: 'min(80vh, 720px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.25)', color: 'var(--ink-90)',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ flex: '0 0 auto', padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {modalMapping.project_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {modalLoading
                    ? (t('integrations.newrelic.fetchingAll') || 'Fetching issues...')
                    : `${modalIssues.length} ${t('integrations.newrelic.errors') || 'issues'}`}
                  {modalSelected.size > 0 && (
                    <span style={{ marginLeft: 8, color: 'var(--acc)', fontWeight: 600 }}>
                      · {(t('integrations.newrelic.selectedCount') || '{n} selected').replace('{n}', String(modalSelected.size))}
                    </span>
                  )}
                </div>
              </div>
              <select
                value={modalPeriod}
                onChange={(ev) => {
                  setModalPeriod(ev.target.value);
                  if (modalMapping) void fetchModalIssues(modalMapping, ev.target.value);
                }}
                disabled={modalLoading}
                style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11, flex: '0 0 auto' }}
              >
                <option value='1h'>{t('integrations.newrelic.range1h') || 'Last 1 hour'}</option>
                <option value='24h'>{t('integrations.newrelic.range24h') || 'Last 24 hours'}</option>
                <option value='7d'>{t('integrations.newrelic.range7d') || 'Last 7 days'}</option>
                <option value='14d'>{t('integrations.sentry.range14d') || 'Last 14 days'}</option>
                <option value='30d'>{t('integrations.sentry.range30d') || 'Last 30 days'}</option>
              </select>
              <button onClick={closeRequestModal} aria-label='Close' style={{ ...btnSmall, fontSize: 16, padding: '2px 10px', flex: '0 0 auto' }}>×</button>
            </div>

            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 14 }}>
              {modalLoading ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-35)' }}>
                  {t('integrations.newrelic.fetchingAll') || 'Fetching issues...'}
                </div>
              ) : modalIssues.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-35)' }}>
                  {t('integrations.newrelic.noErrorsAll') || 'No issues found'}
                </div>
              ) : (
                modalIssues.map((i) => {
                  const isSelected = modalSelected.has(i.id);
                  const isImported = Boolean(i.imported_task_id);
                  return (
                    <label
                      key={i.id}
                      style={{
                        display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 10,
                        alignItems: 'start',
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                        background: isSelected ? 'var(--acc-soft)' : 'var(--panel-alt)',
                        border: `1px solid ${isSelected ? 'var(--acc)' : 'var(--panel-border)'}`,
                        cursor: isImported ? 'not-allowed' : 'pointer',
                        opacity: isImported ? 0.55 : 1,
                      }}
                    >
                      <input
                        type='checkbox'
                        checked={isSelected}
                        onChange={() => !isImported && toggleModalSelected(i.id)}
                        disabled={isImported}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                          {i.title}
                        </div>
                        {(i.culprit || i.short_id) && (
                          <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2, overflowWrap: 'anywhere' }}>
                            {i.culprit || i.short_id}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 10, color: 'var(--ink-35)', flexWrap: 'wrap' }}>
                          {isImported && (
                            <a
                              href={`/tasks/${i.imported_task_id}`}
                              onClick={(ev) => ev.stopPropagation()}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}
                            >
                              {(t('integrations.common.alreadyImported') || 'Already imported — task #{id}').replace('{id}', String(i.imported_task_id))}
                            </a>
                          )}
                          {isImported && i.imported_work_item_url && (
                            <a
                              href={i.imported_work_item_url}
                              target='_blank'
                              rel='noreferrer'
                              onClick={(ev) => ev.stopPropagation()}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}
                            >
                              {t('integrations.common.viewWorkItem') || 'Open work item'} ↗
                            </a>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--panel-alt)', color: '#cf5b57' }}>
                            {(t('integrations.common.countX') || '{n} times').replace('{n}', i.count.toLocaleString())}
                          </span>
                          {i.level && <span style={{ textTransform: 'uppercase', color: i.level === 'fatal' || i.level === 'error' ? '#cf5b57' : '#c98a2b', fontWeight: 600 }}>{i.level}</span>}
                          {i.last_seen && (
                            <span>
                              {(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(i.last_seen).toLocaleString()}
                            </span>
                          )}
                          {i.permalink && (
                            <a href={i.permalink} target='_blank' rel='noreferrer' onClick={(ev) => ev.stopPropagation()} style={{ color: 'var(--acc)', textDecoration: 'none' }}>
                              {t('integrations.sentry.openExternal')}
                            </a>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div style={{ flex: '0 0 auto', padding: '12px 18px', borderTop: '1px solid var(--panel-border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={modalSelectAll} disabled={modalIssues.length === 0} style={btnSmall}>
                {t('integrations.newrelic.selectAll') || 'Select all'}
              </button>
              <button onClick={modalDeselectAll} disabled={modalSelected.size === 0} style={btnSmall}>
                {t('integrations.newrelic.deselectAll') || 'Deselect all'}
              </button>
              <label style={{ fontSize: 11, color: 'var(--ink-50)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('integrations.newrelic.mirrorTargetLabel') || 'Open in'}:
                <select
                  value={modalMirror}
                  onChange={(ev) => setModalMirror(ev.target.value as 'auto' | 'azure' | 'jira' | 'both' | 'none')}
                  style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }}
                >
                  <option value='auto'>{t('integrations.newrelic.mirrorAuto') || 'Auto'}</option>
                  <option value='azure'>{t('integrations.newrelic.mirrorAzure') || 'Azure DevOps'}</option>
                  <option value='jira'>{t('integrations.newrelic.mirrorJira') || 'Jira'}</option>
                  <option value='both'>{t('integrations.newrelic.mirrorBoth') || 'Azure + Jira'}</option>
                  <option value='none'>{t('integrations.newrelic.mirrorNone') || 'None'}</option>
                </select>
              </label>
              <div style={{ flex: 1 }} />
              <button onClick={closeRequestModal} style={btnSmall}>{t('integrations.common.cancel')}</button>
              <button
                onClick={async () => {
                  if (modalMirror === 'none') {
                    void importModalSelected();
                    return;
                  }
                  setModalStoryPoints(2);
                  setModalSprintPath('');
                  setConfirmOpen(true);
                  try {
                    const prefs = await apiFetch<{ azure_project?: string | null; azure_team?: string | null; azure_sprint_path?: string | null }>('/preferences');
                    const proj = (prefs?.azure_project || '').trim();
                    const team = (prefs?.azure_team || '').trim();
                    if (proj && team) {
                      const params = new URLSearchParams({ project: proj, team });
                      const sprints = await apiFetch<Array<{ path: string; name: string; is_current?: boolean }>>(`/tasks/azure/sprints?${params}`);
                      setSprintOptions(sprints || []);
                      const current = (sprints || []).find((s) => s.is_current);
                      if (current && !modalSprintPath) setModalSprintPath(current.path);
                      else if ((prefs?.azure_sprint_path || '').trim() && !modalSprintPath) setModalSprintPath(String(prefs.azure_sprint_path));
                    }
                  } catch { /* ignore */ }
                }}
                disabled={modalSelected.size === 0 || modalImporting}
                style={{ ...btnPrimary, opacity: modalSelected.size === 0 || modalImporting ? 0.5 : 1 }}
              >
                {modalImporting ? '...' : (t('integrations.newrelic.importSelected') || 'Import selected')}
              </button>
            </div>

            {confirmOpen && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 20, borderRadius: 10,
              }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 18, width: '100%', maxWidth: 440, boxShadow: '0 20px 48px rgba(0,0,0,0.25)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>
                    {t('integrations.common.confirmImportTitle') || 'Onayla ve oluştur'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-58)', marginBottom: 12 }}>
                    {(t('integrations.common.confirmImportBody') || '{n} iş Agena’ya alınacak ve {target} üzerinde work item olarak açılacak.')
                      .replace('{n}', String(modalSelected.size))
                      .replace('{target}', modalMirror === 'none' ? 'hiçbir yer' : modalMirror)}
                  </div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
                    {t('integrations.common.storyPointsLabel') || 'Story Points'}
                  </label>
                  <input
                    type='number' min={0} step={1}
                    value={modalStoryPoints}
                    onChange={(ev) => setModalStoryPoints(parseInt(ev.target.value) || 0)}
                    style={{ ...inputStyle, marginBottom: 10 }}
                  />
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
                    {t('integrations.common.iterationPathLabel') || 'Sprint (override, boş = aktif)'}
                  </label>
                  <select
                    value={modalSprintPath}
                    onChange={(ev) => setModalSprintPath(ev.target.value)}
                    style={{ ...inputStyle, marginBottom: 14 }}
                  >
                    <option value=''>{t('integrations.common.currentSprintAuto') || 'Aktif sprint (otomatik)'}</option>
                    {sprintOptions.map((s) => (
                      <option key={s.path} value={s.path}>
                        {s.name}{s.is_current ? ' • ' + (t('integrations.common.currentMark') || 'current') : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setConfirmOpen(false)} style={btnSmall}>{t('integrations.common.cancel')}</button>
                    <button
                      onClick={() => void importModalSelected()}
                      disabled={modalImporting}
                      style={{ ...btnPrimary, opacity: modalImporting ? 0.5 : 1 }}
                    >
                      {modalImporting ? '...' : (t('integrations.common.confirmImportCta') || 'Onayla ve oluştur')}
                    </button>
                  </div>
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
