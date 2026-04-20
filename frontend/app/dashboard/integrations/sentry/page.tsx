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
  permalink: string | null;
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
    try {
      const data = await apiFetch<{ issues: SentryIssue[] }>(`/sentry/projects/${encodeURIComponent(projectSlug)}/issues?query=is:unresolved&limit=50`);
      setIssues(data.issues || []);
    } catch {
      setIssues([]);
    } finally {
      setIssuesLoading(false);
    }
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
    setModalSelected(new Set(modalIssues.map((i) => i.id)));
  }

  function modalDeselectAll() {
    setModalSelected(new Set());
  }

  async function importModalSelected() {
    if (!modalMapping || modalSelected.size === 0) return;
    setModalImporting(true);
    try {
      const res = await apiFetch<{ imported: number; skipped: number }>('/tasks/import/sentry', {
        method: 'POST',
        body: JSON.stringify({
          project_slug: modalMapping.project_slug,
          issue_ids: Array.from(modalSelected),
          stats_period: modalPeriod,
        }),
      });
      const msgTpl = t('integrations.newrelic.importResult') || '{imported} imported, {skipped} skipped';
      setMsg(msgTpl.replace('{imported}', String(res.imported)).replace('{skipped}', String(res.skipped)));
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>{t('integrations.sentry.issuesFor').replace('{name}', selectedProject)}</h3>
            <button onClick={() => void importIssues(selectedProject)} style={btnPrimary}>{t('integrations.common.importAsTasks')}</button>
          </div>
          {issuesLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.loading')}</div>
          ) : issues.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.noIssues')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {issues.map((i) => (
                <div key={i.id} style={{ display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 8, background: selectedIssueId === i.id ? 'var(--panel)' : 'var(--glass)', fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: '#f87171', minWidth: 64, textAlign: 'right' }}>{i.count}x</span>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{i.title}</span>
                  <span style={{ color: 'var(--ink-50)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.culprit || i.short_id || i.id}</span>
                  <button onClick={() => void fetchIssueEvents(i.id)} style={btnSmall}>{t('integrations.sentry.tracesBtn')}</button>
                  {i.permalink && (
                    <a href={i.permalink} target='_blank' rel='noreferrer' style={{ fontSize: 11, color: '#f97316', textDecoration: 'none', alignSelf: 'center' }}>
                      {t('integrations.sentry.openExternal')}
                    </a>
                  )}
                </div>
              ))}
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
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type='checkbox'
                        checked={isSelected}
                        onChange={() => toggleModalSelected(i.id)}
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
              <div style={{ flex: 1 }} />
              <button onClick={closeRequestModal} style={btnSmall}>{t('integrations.common.cancel')}</button>
              <button
                onClick={() => void importModalSelected()}
                disabled={modalSelected.size === 0 || modalImporting}
                style={{ ...btnPrimary, opacity: modalSelected.size === 0 || modalImporting ? 0.5 : 1 }}
              >
                {modalImporting ? '...' : (t('integrations.newrelic.importSelected') || 'Import selected')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
