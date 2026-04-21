'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 900 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
          <span style={{ marginRight: 8 }}>🐶</span>{t('integrations.datadog.title')}
        </h1>
        <p style={{ fontSize: 12, color: 'var(--ink-40)', marginTop: 4 }}>
          {t('integrations.datadog.subtitle')}
        </p>
      </div>

      {/* Toast */}
      {(msg || error) && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          color: error ? '#fecaca' : '#86efac',
          background: error ? 'rgba(127,29,29,0.9)' : 'rgba(20,83,45,0.9)',
          border: error ? '1px solid rgba(248,113,113,0.35)' : '1px solid rgba(34,197,94,0.35)',
        }}>
          {error || msg}
        </div>
      )}

      {/* Query + Fetch */}
      <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('integrations.datadog.queryPlaceholder')}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
        />
        <select
          value={timeFrom}
          onChange={(e) => setTimeFrom(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
        >
          <option value='-30m'>{t('integrations.newrelic.range30m') || 'Last 30 min'}</option>
          <option value='-1h'>{t('integrations.newrelic.range1h') || 'Last 1 hour'}</option>
          <option value='-3h'>{t('integrations.newrelic.range3h') || 'Last 3 hours'}</option>
          <option value='-24h'>{t('integrations.newrelic.range24h') || 'Last 24 hours'}</option>
          <option value='-7d'>{t('integrations.newrelic.range7d') || 'Last 7 days'}</option>
        </select>
        <button onClick={fetchIssues} disabled={issuesLoading}
          style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', background: '#632ca6', color: '#fff', cursor: 'pointer' }}>
          {issuesLoading ? t('integrations.common.loading') : t('integrations.datadog.fetchIssues')}
        </button>
        <button onClick={async () => {
          if (mirrorTarget === 'none') {
            void importAll();
            return;
          }
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
          style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid #632ca6', background: 'transparent', color: '#632ca6', cursor: 'pointer' }}>
          {importing ? t('integrations.datadog.importing') : t('integrations.common.importAll')}
        </button>
      </div>

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 18, width: '100%', maxWidth: 440, boxShadow: '0 20px 48px rgba(0,0,0,0.45)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
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
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none', marginBottom: 10 }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
              {t('integrations.common.iterationPathLabel') || 'Sprint (override, boş = aktif)'}
            </label>
            <select value={sprintPath} onChange={(e) => setSprintPath(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }}>
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
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', outline: 'none', marginBottom: 14 }}>
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
                style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: 'none', background: '#632ca6', color: '#fff', cursor: 'pointer', opacity: importing ? 0.5 : 1 }}>
                {importing ? '...' : (t('integrations.common.confirmImportCta') || 'Onayla ve oluştur')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(99,44,166,0.08)', border: '1px solid rgba(99,44,166,0.2)', fontSize: 12 }}>
          {t('integrations.datadog.importedSkipped')
            .replace('{imported}', String(importResult.imported))
            .replace('{skipped}', String(importResult.skipped))}
        </div>
      )}

      {/* Issues list */}
      {issues.length > 0 && (
        <div style={{ borderRadius: 12, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
          <div className='int-table-header' style={{ padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', background: 'var(--panel)', display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 100px', gap: 8, fontSize: 10, fontWeight: 700, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span>{t('integrations.common.error')}</span>
            <span>{t('integrations.common.serviceColon')}</span>
            <span>{t('integrations.common.statusColon')}</span>
            <span>{t('integrations.common.countColon')}</span>
            <span>{t('integrations.datadog.colLastSeen')}</span>
          </div>
          {issues.map((issue) => {
            const a = issue.attributes || {};
            const isImported = Boolean(issue.imported_task_id);
            return (
              <div key={issue.id} className='int-table-row' style={{ padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 100px', gap: 8, alignItems: 'center', fontSize: 12, opacity: isImported ? 0.55 : 1 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-78)', fontWeight: 600 }}>
                  {a.title || issue.id}
                  {isImported && (
                    <a
                      href={`/tasks/${issue.imported_task_id}`}
                      style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.18)', color: '#60a5fa', textDecoration: 'none' }}
                    >
                      #{issue.imported_task_id}
                    </a>
                  )}
                  {isImported && issue.imported_work_item_url && (
                    <a
                      href={issue.imported_work_item_url}
                      target='_blank'
                      rel='noreferrer'
                      style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.18)', color: '#a855f7', textDecoration: 'none' }}
                    >
                      WI ↗
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-50)' }}>{a.service || '—'}</div>
                <div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
                    background: a.status === 'open' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: a.status === 'open' ? '#ef4444' : '#22c55e',
                  }}>{a.status || '?'}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-50)' }}>{a.occurrences ?? '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-35)' }}>
                  {a.last_seen ? new Date(a.last_seen).toLocaleDateString() : '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {issues.length === 0 && !issuesLoading && (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--ink-25)', fontSize: 13 }}>
          {t('integrations.datadog.fetchIssues')}
        </div>
      )}

      {/* Repo mappings info */}
      {repos.length > 0 && (
        <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-35)', marginBottom: 8 }}>Available Repo Mappings</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {repos.map((r) => (
              <span key={r.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                {r.provider}:{r.owner}/{r.repo_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
