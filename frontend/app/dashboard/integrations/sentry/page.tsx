'use client';

import { useEffect, useState } from 'react';
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
      setMsg(`"${project.name}" mapped — select a repo from the dropdown`);
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
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
        {t('integrations.providerSentry')} — Project Browser
      </h2>
      {orgSlug && <div style={{ fontSize: 12, color: 'var(--ink-35)' }}>Organization: <strong>{orgSlug}</strong></div>}

      {msg && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, fontWeight: 600 }}>{msg}</div>}
      {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, fontWeight: 600 }}>{error}</div>}

      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='project name / slug'
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            onKeyDown={(e) => e.key === 'Enter' && void searchProjects()}
          />
          <button onClick={() => void searchProjects()} disabled={loading} style={btnPrimary}>
            {loading ? '...' : 'Search'}
          </button>
        </div>
      </div>

      {projects.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--ink-58)' }}>Projects ({projects.length})</h3>
          <div style={{ display: 'grid', gap: 4 }}>
            {projects.map((p) => {
              const mapping = mappings.find((m) => m.project_slug === p.slug);
              return (
                <div key={p.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: selectedProject === p.slug ? 'var(--glass)' : 'transparent', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 150, color: 'var(--ink)' }}>{p.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-35)', fontWeight: 500 }}>{p.slug}</span>
                  <button onClick={() => void fetchIssues(p.slug)} style={btnSmall}>Issues</button>
                  {!mapping && <button onClick={() => void addMapping(p)} style={btnSmall}>+ Map</button>}
                  {mapping && (
                    <>
                      <select
                        value={mapping.repo_mapping_id ?? ''}
                        onChange={(ev) => void updateMapping(mapping.id, { repo_mapping_id: ev.target.value ? parseInt(ev.target.value) : null })}
                        style={{ ...inputStyle, width: 160, fontSize: 11, padding: '4px 8px' }}
                      >
                        <option value="">-- Repo --</option>
                        {repos.map((r) => (
                          <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                        ))}
                      </select>
                      <button onClick={() => void importIssues(mapping.project_slug)} style={btnSmall}>Import</button>
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
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>Issues — {selectedProject}</h3>
            <button onClick={() => void importIssues(selectedProject)} style={btnPrimary}>Import as Tasks</button>
          </div>
          {issuesLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>Loading...</div>
          ) : issues.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>No issues found</div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {issues.map((i) => (
                <div key={i.id} style={{ display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 8, background: selectedIssueId === i.id ? 'var(--panel)' : 'var(--glass)', fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: '#f87171', minWidth: 64, textAlign: 'right' }}>{i.count}x</span>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{i.title}</span>
                  <span style={{ color: 'var(--ink-50)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.culprit || i.short_id || i.id}</span>
                  <button onClick={() => void fetchIssueEvents(i.id)} style={btnSmall}>Traces</button>
                  {i.permalink && (
                    <a href={i.permalink} target='_blank' rel='noreferrer' style={{ fontSize: 11, color: '#f97316', textDecoration: 'none', alignSelf: 'center' }}>
                      Open ↗
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)', marginBottom: 8 }}>Trace Events — {selectedIssueId}</h3>
          {eventsLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>Loading...</div>
          ) : events.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>No event traces found</div>
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>Project Mappings</h3>
          <button onClick={() => void importIssues()} style={btnPrimary}>Import All</button>
        </div>
        {mappings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>No project mappings yet. Search projects above and click "+ Map".</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {mappings.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--glass)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.project_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-35)' }}>{m.project_slug} • {m.repo_display_name || 'No repo'}</div>
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
                  Auto
                </label>
                <button onClick={() => void importIssues(m.project_slug)} style={btnSmall}>Import</button>
                <button onClick={() => void deleteMapping(m.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.2)' }}>x</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
