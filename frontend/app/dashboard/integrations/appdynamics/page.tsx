'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

interface RepoMapping {
  id: number;
  provider: string;
  owner: string;
  repo_name: string;
}

export default function AppDynamicsPage() {
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [appName, setAppName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);

  useEffect(() => {
    apiFetch<RepoMapping[]>('/repo-mappings').then(setRepos).catch(() => {});
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

  async function importErrors() {
    setImporting(true);
    setError('');
    try {
      const result = await apiFetch<{ imported: number; skipped: number }>('/tasks/import/appdynamics', {
        method: 'POST',
        body: JSON.stringify({ app_name: appName || undefined, limit: 50, duration_minutes: durationMinutes }),
      });
      setImportResult(result);
      let summary = '';
      if (result.imported === 0 && result.skipped > 0) {
        summary = (t('integrations.sentry.allAlreadyImported') || 'All {n} already imported').replace('{n}', String(result.skipped));
      } else if (result.imported > 0 && result.skipped > 0) {
        summary = (t('integrations.sentry.importedSomeSkipped') || '+{i} imported, {s} skipped').replace('{i}', String(result.imported)).replace('{s}', String(result.skipped));
      } else if (result.imported > 0) {
        summary = (t('integrations.sentry.importedN') || '+{n} imported').replace('{n}', String(result.imported));
      } else {
        summary = t('integrations.sentry.noNewIssues') || 'No new errors';
      }
      setMsg(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <style>{`@keyframes ad-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Hero header — AppDynamics */}
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
            width: 44, height: 44, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--acc-soft)', border: '1px solid var(--border)',
            color: 'var(--acc)',
          }}><NavIcon name="chart" size={22} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', letterSpacing: -0.3 }}>
              {t('integrations.appdynamics.title')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-65)', marginTop: 3, lineHeight: 1.5 }}>
              {t('integrations.appdynamics.heroSubtitle') || 'Pull APM errors from AppDynamics into Agena, AI fixes them through your repo.'}
            </div>
          </div>
        </div>
      </div>

      {/* Floating toast */}
      {(importing || msg || error) && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          zIndex: 9999, maxWidth: 'min(94vw, 460px)',
          padding: '12px 18px', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 600,
          color: '#fff',
          background: error ? '#cf5b57' : importing ? '#c98a2b' : '#3f9d6a',
          border: `1px solid ${error ? '#cf5b57' : importing ? '#c98a2b' : '#3f9d6a'}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}>
          {importing ? (
            <>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'ad-spin 0.7s linear infinite' }} />
              <span>{t('integrations.appdynamics.importing') || 'Importing…'}</span>
            </>
          ) : error ? (
            <>
              <NavIcon name="alert" size={16} />
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </>
          ) : (
            <>
              <NavIcon name="activity" size={16} />
              <span style={{ flex: 1 }}>{msg}</span>
              <button onClick={() => setMsg('')} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Import settings */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>
          {t('integrations.appdynamics.importSettings')}
        </div>
        <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder={t('integrations.appdynamics.appPlaceholder')}
            style={{ flex: 1, minWidth: 180, padding: '10px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', height: 38 }}
          />
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(parseInt(e.target.value))}
            style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink)', outline: 'none', height: 38 }}
          >
            <option value={30}>{t('integrations.newrelic.range30m') || 'Last 30 min'}</option>
            <option value={60}>{t('integrations.newrelic.range1h') || 'Last 1 hour'}</option>
            <option value={180}>{t('integrations.newrelic.range3h') || 'Last 3 hours'}</option>
            <option value={1440}>{t('integrations.newrelic.range24h') || 'Last 24 hours'}</option>
            <option value={10080}>{t('integrations.newrelic.range7d') || 'Last 7 days'}</option>
          </select>
          <button onClick={importErrors} disabled={importing}
            style={{ padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none', background: 'var(--acc)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {importing ? '…' : t('integrations.appdynamics.importErrorsBtn')}
          </button>
        </div>
      </div>

      {/* Last result */}
      {importResult && !importing && (
        <div style={{
          padding: '14px 16px', borderRadius: 10,
          background: 'var(--acc-soft)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--acc)', display: 'inline-flex' }}><NavIcon name="chart" size={24} /></span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>
              {(t('integrations.datadog.importedSkipped') || '{imported} imported, {skipped} skipped')
                .replace('{imported}', String(importResult.imported))
                .replace('{skipped}', String(importResult.skipped))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2 }}>
              {t('integrations.appdynamics.lastImportFromBatch') || 'Last batch'}
            </div>
          </div>
          <a href='/dashboard/tasks?source=appdynamics' style={{ fontSize: 12, fontWeight: 600, color: 'var(--acc)', textDecoration: 'none', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
            {t('integrations.appdynamics.viewImportedTasks') || 'View imported tasks ↗'}
          </a>
        </div>
      )}

      {/* Repo mappings hint */}
      {repos.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-35)', marginBottom: 8 }}>{t('integrations.appdynamics.availableRepos')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {repos.map((r) => (
              <span key={r.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', color: 'var(--ink-65)' }}>
                {r.provider}:{r.owner}/{r.repo_name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: '16px', borderRadius: 10, border: '1px dashed var(--panel-border)', textAlign: 'center', color: 'var(--ink-50)', fontSize: 12 }}>
        <p>{t('integrations.appdynamics.configHint').split('{link}').reduce<React.ReactNode[]>((acc, part, i, arr) => {
          acc.push(part);
          if (i < arr.length - 1) acc.push(<a key='link' href='/dashboard/integrations' style={{ color: 'var(--acc)' }}>Integrations</a>);
          return acc;
        }, [])}</p>
        <p style={{ fontSize: 11, marginTop: 4 }}>{t('integrations.appdynamics.configRequired')}</p>
      </div>
    </div>
  );
}
