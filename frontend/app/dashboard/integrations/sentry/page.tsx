'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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

function Sparkline({ values, width = 80, height = 22, color = '#f87171' }: { values: number[]; width?: number; height?: number; color?: string }) {
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

function Pill({ children, color = '#94a3b8', bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 4,
      color, background: bg ?? `${color}1f`,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function FixabilityBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#eab308' : '#94a3b8';
  return <Pill color={color}>AI {pct}%</Pill>;
}

function RegressionBadge({ substatus }: { substatus: string | null }) {
  if (!substatus) return null;
  const s = substatus.toLowerCase();
  if (s === 'regressed') return <Pill color='#ef4444'>REGRESSION</Pill>;
  if (s === 'new') return <Pill color='#3b82f6'>NEW</Pill>;
  if (s === 'escalating') return <Pill color='#f97316'>ESCALATING</Pill>;
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

  useEffect(() => {
    void loadMappings();
    void loadRepos();
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
    try {
      const body: Record<string, unknown> = {};
      if (projectSlug) body.project_slug = projectSlug;
      const res = await apiFetch<{ imported: number; skipped: number }>('/tasks/import/sentry', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.imported === 0 && res.skipped > 0) {
        setMsg(`No new issues to import — ${res.skipped} already imported before`);
      } else if (res.imported > 0 && res.skipped > 0) {
        setMsg(`${res.imported} new issue(s) imported as tasks, ${res.skipped} skipped (already exists)`);
      } else if (res.imported > 0) {
        setMsg(`${res.imported} issue(s) imported as tasks`);
      } else {
        setMsg('No issues found to import');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
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
    background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)',
    background: 'var(--glass)', color: 'var(--ink)', fontSize: 13,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1CE783', color: '#000',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  };
  const btnSmall: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border)',
    background: 'transparent', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer',
  };

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
        {t('integrations.providerSentry')} — {t('integrations.sentry.projectBrowser')}
      </h2>
      {orgSlug && <div style={{ fontSize: 12, color: 'var(--ink-35)' }}>{t('integrations.sentry.organization')}: <strong>{orgSlug}</strong></div>}

      {msg && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, fontWeight: 600 }}>{msg}</div>}
      {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, fontWeight: 600 }}>{error}</div>}

      <div style={cardStyle}>
        <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('integrations.sentry.searchPlaceholder')}
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            onKeyDown={(e) => e.key === 'Enter' && void searchProjects()}
          />
          <button onClick={() => void searchProjects()} disabled={loading} style={btnPrimary}>
            {loading ? '...' : t('integrations.common.search')}
          </button>
        </div>
      </div>

      {projects.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--ink-58)' }}>{t('integrations.sentry.projectsCount').replace('{n}', String(projects.length))}</h3>
          <div style={{ display: 'grid', gap: 4 }}>
            {projects.map((p) => {
              const mapping = mappings.find((m) => m.project_slug === p.slug);
              return (
                <div key={p.slug} className='int-row' style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: selectedProject === p.slug ? 'var(--glass)' : 'transparent', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 150, color: 'var(--ink)' }}>{p.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-35)', fontWeight: 500 }}>{p.slug}</span>
                  <button onClick={() => void fetchIssues(p.slug)} style={btnSmall}>{t('integrations.sentry.issuesBtn')}</button>
                  {!mapping && <button onClick={() => void addMapping(p)} style={btnSmall}>{t('integrations.common.map')}</button>}
                  {mapping && (
                    <>
                      <select
                        value={mapping.repo_mapping_id ?? ''}
                        onChange={(ev) => void updateMapping(mapping.id, { repo_mapping_id: ev.target.value ? parseInt(ev.target.value) : null })}
                        style={{ ...inputStyle, width: 160, fontSize: 11, padding: '4px 8px' }}
                      >
                        <option value="">{t('integrations.common.selectRepo')}</option>
                        {repos.map((r) => (
                          <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                        ))}
                      </select>
                      <button onClick={() => void importIssues(mapping.project_slug)} style={btnSmall}>{t('integrations.common.import')}</button>
                      <button onClick={() => void deleteMapping(mapping.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.2)', fontSize: 10 }}>x</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedProject && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>{t('integrations.sentry.issuesFor').replace('{name}', selectedProject)}</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => void importFiltered()} disabled={issues.length === 0}
                style={{ ...btnSmall, color: '#1CE783', borderColor: 'rgba(28,231,131,0.4)', opacity: issues.length === 0 ? 0.5 : 1 }}>
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
            const tile = (label: string, value: string | number, color = 'var(--ink)') => (
              <div style={{ flex: 1, minWidth: 110, padding: '8px 10px', borderRadius: 8, background: 'var(--glass)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
              </div>
            );
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {tile(t('integrations.sentry.healthIssues') || 'Issues', issues.length)}
                {tile(t('integrations.sentry.healthEvents') || 'Events', totalEvents.toLocaleString(), '#f87171')}
                {tile(t('integrations.sentry.healthUsers') || 'Users', totalUsers.toLocaleString(), '#fbbf24')}
                {regressed > 0 && tile(t('integrations.sentry.healthRegressed') || 'Regressed', regressed, '#ef4444')}
                {newCount > 0 && tile(t('integrations.sentry.healthNew') || 'New', newCount, '#3b82f6')}
                {unhandled > 0 && tile(t('integrations.sentry.healthUnhandled') || 'Unhandled', unhandled, '#ef4444')}
                {importedDone > 0 && tile(t('integrations.sentry.healthFixed') || 'AI-fixed', importedDone, '#22c55e')}
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
                const levelColor = i.level === 'fatal' || i.level === 'error' ? '#f87171' : i.level === 'warning' ? '#f59e0b' : '#94a3b8';
                return (
                  <div key={i.id} style={{
                    padding: '10px 12px', borderRadius: 10,
                    background: selectedIssueId === i.id ? 'var(--panel)' : 'var(--glass)',
                    border: '1px solid var(--panel-border)',
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                          <Pill color={levelColor}>{i.level.toUpperCase()}</Pill>
                          <RegressionBadge substatus={i.substatus} />
                          {i.is_unhandled && <Pill color='#ef4444'>UNHANDLED</Pill>}
                          <FixabilityBadge score={i.fixability_score} />
                          {i.platform && <Pill color='#64748b'>{i.platform}</Pill>}
                          {i.imported_task_id && (
                            <a href={`/tasks/${i.imported_task_id}`} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.18)', color: '#60a5fa', textDecoration: 'none' }}>
                              TASK #{i.imported_task_id}
                            </a>
                          )}
                          {i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'completed' && (
                            <Pill color='#22c55e'>✓ {t('integrations.sentry.aiResolved') || 'AI RESOLVED'}</Pill>
                          )}
                          {i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'running' && (
                            <Pill color='#3b82f6'>⏵ {t('integrations.sentry.aiRunning') || 'AI WORKING'}</Pill>
                          )}
                          {i.imported_task_id && (i.imported_task_status || '').toLowerCase() === 'failed' && (
                            <Pill color='#ef4444'>✗ {t('integrations.sentry.aiFailed') || 'AI FAILED'}</Pill>
                          )}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {i.title}
                        </div>
                        {(i.culprit || i.short_id) && (
                          <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {i.culprit || i.short_id}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 10, color: 'var(--ink-45)', flexWrap: 'wrap' }}>
                          <span><strong style={{ color: '#f87171' }}>{i.count.toLocaleString()}</strong> events</span>
                          {i.user_count > 0 && <span><strong style={{ color: '#fbbf24' }}>{i.user_count.toLocaleString()}</strong> {(t('integrations.sentry.usersAffected') || 'users')}</span>}
                          {i.last_seen && <span>{(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(i.last_seen).toLocaleString()}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                        {i.stats_24h && i.stats_24h.length > 1 && (
                          <Sparkline values={i.stats_24h} color={levelColor} />
                        )}
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => void togglePreview(i.id)} style={btnSmall}>
                            {expanded ? '▾' : '▸'} {t('integrations.sentry.preview') || 'Preview'}
                          </button>
                          <button onClick={() => void openAiFixPreview(i)} style={{ ...btnSmall, color: '#1CE783', borderColor: 'rgba(28,231,131,0.4)' }}>
                            ✦ {t('integrations.sentry.aiFix') || 'AI Fix'}
                          </button>
                          {i.permalink && (
                            <a href={i.permalink} target='_blank' rel='noreferrer' style={{ ...btnSmall, color: '#f97316', textDecoration: 'none', borderColor: 'rgba(249,115,22,0.4)' }}>
                              ↗
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
                              <div style={{ fontSize: 12, fontFamily: 'monospace', background: 'rgba(248,113,113,0.08)', padding: '6px 10px', borderRadius: 6, color: '#fca5a5' }}>
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
                                  <div key={idx} style={{ background: 'var(--panel)', borderRadius: 6, padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, border: fr.in_app ? '1px solid rgba(28,231,131,0.3)' : '1px solid var(--panel-border)' }}>
                                    <div style={{ color: 'var(--ink-58)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ color: fr.in_app ? '#1CE783' : 'var(--ink-35)' }}>{fr.in_app ? '★ ' : ''}</span>
                                      <span style={{ color: 'var(--ink)' }}>{fr.filename || fr.abs_path || '<unknown>'}</span>
                                      {fr.lineno != null && <span style={{ color: '#f59e0b' }}>:{fr.lineno}</span>}
                                      {fr.function && <span style={{ color: 'var(--ink-50)' }}> in {fr.function}</span>}
                                      {fr.repo_url && (
                                        <a href={fr.repo_url} target='_blank' rel='noreferrer' style={{ marginLeft: 'auto', fontSize: 10, color: '#60a5fa', textDecoration: 'none', padding: '1px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.12)' }}>
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
                                      <span style={{ color: '#94a3b8' }}>{b.timestamp}</span>{' '}
                                      <span style={{ color: '#f59e0b' }}>{b.category}</span>{' '}
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)', marginBottom: 8 }}>{t('integrations.sentry.tracesFor').replace('{id}', selectedIssueId)}</h3>
          {eventsLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.loading')}</div>
          ) : events.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.sentry.noTraces')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {events.map((ev) => (
                <div key={ev.event_id || `${ev.title}_${ev.timestamp || ''}`} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--glass)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: '#f97316', fontWeight: 700 }}>{(ev.level || 'error').toUpperCase()}</span>
                    <span style={{ color: 'var(--ink-30)' }}>{ev.timestamp || '-'}</span>
                    <span style={{ color: 'var(--ink-35)' }}>{ev.location || '-'}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{ev.title}</div>
                  {ev.trace_preview && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-45)', whiteSpace: 'pre-wrap' }}>{ev.trace_preview}</div>}
                  {ev.message && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-50)', whiteSpace: 'pre-wrap' }}>{ev.message}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>{t('integrations.sentry.projectMappings')}</h3>
          <button onClick={() => void importIssues()} style={btnPrimary}>{t('integrations.common.importAll')}</button>
        </div>
        {mappings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.noProjectMappingsHint')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {mappings.map((m) => (
              <div key={m.id} className='int-row' style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--glass)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.project_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-35)' }}>{m.project_slug} • {m.repo_display_name || t('integrations.common.noRepo')}</div>
                </div>
                <select
                  value={m.repo_mapping_id ?? ''}
                  onChange={(e) => void updateMapping(m.id, { repo_mapping_id: e.target.value ? parseInt(e.target.value) : null })}
                  style={{ ...inputStyle, width: 160, fontSize: 11 }}
                >
                  <option value="">No repo</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: 'var(--ink-50)' }}>
                  <input type='checkbox' checked={m.auto_import} onChange={(e) => void updateMapping(m.id, { auto_import: e.target.checked })} />
                  {t('integrations.common.auto')}
                </label>
                <button onClick={() => void importIssues(m.project_slug)} style={btnSmall}>{t('integrations.common.import')}</button>
                <button onClick={() => void openRequestModal(m)} style={btnSmall}>
                  {t('integrations.newrelic.request') || 'Request'}
                </button>
                <button onClick={() => void deleteMapping(m.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.2)' }}>x</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {aiFixIssue && typeof document !== 'undefined' && createPortal(
        <div onClick={closeAiFixPreview} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)' }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 14,
            width: 'min(680px, calc(100vw - 32px))', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>✦</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{t('integrations.sentry.aiFixTitle') || 'AI Fix Preview'}</span>
                  {aiFixData?.cached && <Pill color='#94a3b8'>cached</Pill>}
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
                <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.12)', color: '#f87171', fontSize: 12, fontWeight: 600 }}>
                  {aiFixError}
                </div>
              )}
              {aiFixData && (
                <div style={{ display: 'grid', gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 6 }}>
                      {t('integrations.sentry.aiFixSummary') || 'Root cause'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
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
                      <div style={{ width: `${aiFixData.confidence}%`, height: '100%', background: aiFixData.confidence >= 70 ? '#22c55e' : aiFixData.confidence >= 40 ? '#eab308' : '#94a3b8' }} />
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)', minWidth: 30, textAlign: 'right' }}>
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
              background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 14,
              width: 'min(760px, calc(100vw - 32px))',
              maxWidth: 'calc(100vw - 32px)',
              height: 'min(80vh, 720px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.35)', color: 'var(--ink)',
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
                    <span style={{ marginLeft: 8, color: '#1CE783', fontWeight: 600 }}>
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
                        padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                        background: isSelected ? 'rgba(28,231,131,0.10)' : 'var(--glass)',
                        border: `1px solid ${isSelected ? 'rgba(28,231,131,0.4)' : 'var(--panel-border)'}`,
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
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
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
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.18)', color: '#60a5fa', textDecoration: 'none' }}
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
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.18)', color: '#a855f7', textDecoration: 'none' }}
                            >
                              {t('integrations.common.viewWorkItem') || 'Open work item'} ↗
                            </a>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
                            {(t('integrations.common.countX') || '{n} times').replace('{n}', i.count.toLocaleString())}
                          </span>
                          {i.level && <span style={{ textTransform: 'uppercase', color: i.level === 'fatal' || i.level === 'error' ? '#f87171' : '#f97316', fontWeight: 600 }}>{i.level}</span>}
                          {i.last_seen && (
                            <span>
                              {(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(i.last_seen).toLocaleString()}
                            </span>
                          )}
                          {i.permalink && (
                            <a href={i.permalink} target='_blank' rel='noreferrer' onClick={(ev) => ev.stopPropagation()} style={{ color: '#f97316', textDecoration: 'none' }}>
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
                padding: 20, borderRadius: 14,
              }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 18, width: '100%', maxWidth: 440, boxShadow: '0 20px 48px rgba(0,0,0,0.35)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
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
