'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

function Pill({ children, color = 'var(--muted)', bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 6,
      color, background: bg ?? 'var(--panel-alt)',
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

interface DatadogIssue {
  id: string;
  imported_task_id?: number | null;
  imported_work_item_url?: string | null;
  attributes: {
    title?: string;
    type?: string;
    status?: string;
    service?: string;
    env?: string;
    occurrences?: number;
    impacted_users?: number;
    first_seen?: string;
    last_seen?: string;
  };
}

interface RepoMapping {
  id: number;
  provider: string;
  owner: string;
  repo_name: string;
}

export default function DatadogPage() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [issues, setIssues] = useState<DatadogIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [query, setQuery] = useState('status:open');
  const [timeFrom, setTimeFrom] = useState('-30m');
  const [mirrorTarget, setMirrorTarget] = useState<'auto' | 'azure' | 'jira' | 'both' | 'none'>('auto');
  const [storyPoints, setStoryPoints] = useState<number>(2);
  const [sprintPath, setSprintPath] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sprintOptions, setSprintOptions] = useState<Array<{ path: string; name: string; is_current?: boolean }>>([]);
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  useEffect(() => {
    void loadRepos();
    void fetchIssues();
  }, []);

  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(timer);
  }, [msg]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  async function loadRepos() {
    try {
      const data = await apiFetch<RepoMapping[]>('/repo-mappings');
      setRepos(data);
    } catch {}
  }

  async function fetchIssues() {
    setIssuesLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ query, time_from: timeFrom });
      const data = await apiFetch<DatadogIssue[]>('/datadog/issues?' + params);
      setIssues(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch issues');
    } finally {
      setIssuesLoading(false);
    }
  }

  async function importAll() {
    setImporting(true);
    setError('');
    try {
      const result = await apiFetch<{ imported: number; skipped: number; manual_azure_urls?: string[] }>('/tasks/import/datadog', {
        method: 'POST',
        body: JSON.stringify({ query, limit: 50, time_from: timeFrom, mirror_target: mirrorTarget, story_points: storyPoints, iteration_path: sprintPath || null }),
      });
      (result.manual_azure_urls || []).forEach((url) => {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      });
      setImportResult(result);
      setConfirmOpen(false);
      setMsg(`Imported ${result.imported} issues, ${result.skipped} skipped`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const totalIssues = issues.length;
  const openIssues = issues.filter((i) => (i.attributes?.status || '').toLowerCase() === 'open').length;
  const totalEvents = issues.reduce((s, i) => s + (i.attributes?.occurrences || 0), 0);
  const totalUsers = issues.reduce((s, i) => s + (i.attributes?.impacted_users || 0), 0);

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <style>{`@keyframes dd-spin { to { transform: rotate(360deg); } }`}</style>

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
          }}><NavIcon name="bug" size={22} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', letterSpacing: -0.3 }}>
              {t('integrations.datadog.title')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.5 }}>
              {t('integrations.datadog.heroSubtitle') || 'Pull Error Tracking issues straight from Datadog, AI fixes them through your repo.'}
            </div>
          </div>
        </div>
        {totalIssues > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: t('integrations.sentry.healthIssues') || 'Issues', value: totalIssues, color: 'var(--ink-90)' },
              { label: t('integrations.sentry.healthEvents') || 'Events', value: totalEvents.toLocaleString(), color: '#cf5b57' },
              { label: t('integrations.sentry.healthUsers') || 'Users', value: totalUsers.toLocaleString(), color: '#c98a2b' },
              { label: t('integrations.datadog.healthOpen') || 'Open', value: openIssues, color: '#cf5b57' },
            ].map((tile) => (
              <div key={tile.label} style={{
                flex: 1, minWidth: 130,
                padding: '10px 14px', borderRadius: 8,
                background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{tile.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: tile.color, marginTop: 4 }}>{tile.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating toast */}
      {(importing || msg || error) && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          zIndex: 9999, maxWidth: 'min(94vw, 460px)',
          padding: '12px 18px', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 700,
          color: error ? '#cf5b57' : importing ? '#c98a2b' : '#3f9d6a',
          background: 'var(--surface)',
          border: `1px solid ${error ? '#cf5b57' : importing ? '#c98a2b' : '#3f9d6a'}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}>
          {importing ? (
            <>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--panel-border)', borderTopColor: '#c98a2b', borderRadius: '50%', animation: 'dd-spin 0.7s linear infinite' }} />
              <span>{t('integrations.datadog.importing') || 'Importing…'}</span>
            </>
          ) : error ? (
            <>
              <NavIcon name="alert" size={16} />
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: '#cf5b57', cursor: 'pointer', display: 'flex', padding: 0 }}><NavIcon name="close" size={16} /></button>
            </>
          ) : (
            <>
              <NavIcon name="activity" size={16} />
              <span style={{ flex: 1 }}>{msg}</span>
              <button onClick={() => setMsg('')} style={{ background: 'transparent', border: 'none', color: '#3f9d6a', cursor: 'pointer', display: 'flex', padding: 0 }}><NavIcon name="close" size={16} /></button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Query + Fetch */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>
          {t('integrations.datadog.queryLabel') || 'Filter Datadog issues'}
        </div>
        <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('integrations.datadog.queryPlaceholder')}
          style={{ flex: 1, minWidth: 200, padding: '10px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', height: 38 }}
        />
        <select
          value={timeFrom}
          onChange={(e) => setTimeFrom(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', height: 38 }}
        >
          <option value='-30m'>{t('integrations.newrelic.range30m') || 'Last 30 min'}</option>
          <option value='-1h'>{t('integrations.newrelic.range1h') || 'Last 1 hour'}</option>
          <option value='-3h'>{t('integrations.newrelic.range3h') || 'Last 3 hours'}</option>
          <option value='-24h'>{t('integrations.newrelic.range24h') || 'Last 24 hours'}</option>
          <option value='-7d'>{t('integrations.newrelic.range7d') || 'Last 7 days'}</option>
        </select>
        <button onClick={fetchIssues} disabled={issuesLoading}
          style={{ padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', background: 'var(--acc)', color: '#fff', cursor: 'pointer' }}>
          {issuesLoading ? '…' : t('integrations.datadog.fetchIssues')}
        </button>
        <button onClick={async () => {
          if (mirrorTarget === 'none') {
            void importAll();
            return;
          }
          setStoryPoints(2);
          setSprintPath('');
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
              if (current && !sprintPath) setSprintPath(current.path);
              else if ((prefs?.azure_sprint_path || '').trim() && !sprintPath) setSprintPath(String(prefs.azure_sprint_path));
            }
          } catch { /* ignore */ }
        }} disabled={importing}
          style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid var(--acc)', background: 'transparent', color: 'var(--acc)', cursor: 'pointer' }}>
          {importing ? '…' : t('integrations.common.importAll')}
        </button>
        </div>
      </div>

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 18, width: '100%', maxWidth: 440, boxShadow: '0 20px 48px rgba(0,0,0,0.22)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>
              {t('integrations.common.confirmImportTitle') || 'Onayla ve oluştur'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginBottom: 12 }}>
              {(t('integrations.common.confirmImportBody') || '{n} iş Agena’ya alınacak ve {target} üzerinde work item olarak açılacak.')
                .replace('{n}', String(issues.length || '?'))
                .replace('{target}', mirrorTarget === 'none' ? 'hiçbir yer' : mirrorTarget)}
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
              {t('integrations.common.storyPointsLabel') || 'Story Points'}
            </label>
            <input type='number' min={0} step={1} value={storyPoints} onChange={(e) => setStoryPoints(parseInt(e.target.value) || 0)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', marginBottom: 10 }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
              {t('integrations.common.iterationPathLabel') || 'Sprint (override, boş = aktif)'}
            </label>
            <select value={sprintPath} onChange={(e) => setSprintPath(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }}>
              <option value=''>{t('integrations.common.currentSprintAuto') || 'Aktif sprint (otomatik)'}</option>
              {sprintOptions.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.name}{s.is_current ? ' • ' + (t('integrations.common.currentMark') || 'current') : ''}
                </option>
              ))}
            </select>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
              {t('integrations.newrelic.mirrorTargetLabel') || 'Open in'}
            </label>
            <select value={mirrorTarget} onChange={(e) => setMirrorTarget(e.target.value as typeof mirrorTarget)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }}>
              <option value='auto'>{t('integrations.newrelic.mirrorAuto') || 'Auto'}</option>
              <option value='azure'>{t('integrations.newrelic.mirrorAzure') || 'Azure DevOps'}</option>
              <option value='jira'>{t('integrations.newrelic.mirrorJira') || 'Jira'}</option>
              <option value='both'>{t('integrations.newrelic.mirrorBoth') || 'Azure + Jira'}</option>
              <option value='none'>{t('integrations.newrelic.mirrorNone') || 'None'}</option>
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmOpen(false)} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--ink-58)', cursor: 'pointer' }}>
                {t('integrations.common.cancel')}
              </button>
              <button onClick={importAll} disabled={importing}
                style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: 'none', background: 'var(--acc)', color: '#fff', cursor: 'pointer', opacity: importing ? 0.5 : 1 }}>
                {importing ? '...' : (t('integrations.common.confirmImportCta') || 'Onayla ve oluştur')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issues list — premium cards */}
      {issues.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 10 }}>
            {(t('integrations.datadog.issuesCount') || '{n} Issues').replace('{n}', String(issues.length))}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {issues.map((issue) => {
              const a = issue.attributes || {};
              const isImported = Boolean(issue.imported_task_id);
              const isOpen = (a.status || '').toLowerCase() === 'open';
              return (
                <div key={issue.id} style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
                  opacity: isImported ? 0.6 : 1,
                }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Pill color={isOpen ? '#cf5b57' : '#3f9d6a'}>{(a.status || '?').toUpperCase()}</Pill>
                    {a.service && <Pill color='var(--acc)'>{a.service}</Pill>}
                    {a.env && <Pill color='var(--muted)'>{a.env}</Pill>}
                    {a.type && <Pill color='var(--muted)'>{a.type}</Pill>}
                    {isImported && (
                      <a href={`/tasks/${issue.imported_task_id}`} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}>
                        TASK #{issue.imported_task_id}
                      </a>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title || issue.id}
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 10, color: 'var(--ink-45)', flexWrap: 'wrap' }}>
                    {(a.occurrences ?? 0) > 0 && <span><strong style={{ color: '#cf5b57' }}>{a.occurrences!.toLocaleString()}</strong> {(t('integrations.sentry.healthEvents') || 'events').toLowerCase()}</span>}
                    {(a.impacted_users ?? 0) > 0 && <span><strong style={{ color: '#c98a2b' }}>{a.impacted_users!.toLocaleString()}</strong> {(t('integrations.sentry.usersAffected') || 'users')}</span>}
                    {a.last_seen && <span>{(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(a.last_seen).toLocaleString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {issues.length === 0 && !issuesLoading && (
        <div style={{
          padding: '32px 18px', textAlign: 'center', borderRadius: 10,
          background: 'var(--panel-alt)', border: '1px dashed var(--panel-border)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--muted)' }}><NavIcon name="bug" size={32} /></div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>
            {t('integrations.datadog.emptyTitle') || 'No issues yet'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4 }}>
            {t('integrations.datadog.emptyHint') || 'Adjust the query or pick a wider time range and hit Fetch.'}
          </div>
        </div>
      )}

      {/* Repo mappings info */}
      {repos.length > 0 && (
        <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-35)', marginBottom: 8 }}>{t('integrations.availableRepoMappings')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {repos.map((r) => (
              <span key={r.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                {r.provider}:{r.owner}/{r.repo_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
