'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type RepoMapping = { id: number; provider: string; owner: string; repo_name: string; display_name: string };
type OpenPr = { id: string; title: string; author: string; source_branch: string; target_branch: string; created: string; url: string };
type PrReview = {
  id: number; provider: string; repo: string; pr_number: string; pr_url: string | null; title: string | null;
  status: string; severity: string | null; score: number | null; findings_count: number;
  threads_posted: number; threads_open: number; reviewer_provider: string | null; reviewer_model: string | null;
  error_message: string | null; created_at: string; completed_at: string | null;
};

const card: React.CSSProperties = { borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)' };
const sevColor = (s: string | null): string =>
  ({ critical: '#cf5b57', high: '#c98a2b', medium: '#c98a2b', low: '#3f9d6a', clean: '#3f9d6a' }[(s || '').toLowerCase()] || 'var(--ink-50)');

export default function PrReviewerPage() {
  const { t } = useLocale();
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [repoId, setRepoId] = useState<string>('');
  const [prs, setPrs] = useState<OpenPr[]>([]);
  const [loadingPrs, setLoadingPrs] = useState(false);
  const [reviewingId, setReviewingId] = useState('');
  const [history, setHistory] = useState<PrReview[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiFetch<RepoMapping[]>('/repo-mappings')
      .then((rows) => {
        const azure = rows.filter((r) => (r.provider || '').toLowerCase() === 'azure');
        setRepos(azure);
        if (azure.length && !repoId) setRepoId(String(azure[0].id));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = useCallback(async () => {
    try { setHistory(await apiFetch<PrReview[]>('/pr-reviewer/history')); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadHistory]);

  // Poll while any review is running.
  useEffect(() => {
    const anyRunning = history.some((h) => h.status === 'running');
    if (anyRunning && !pollRef.current) {
      pollRef.current = setInterval(() => void loadHistory(), 5000);
    } else if (!anyRunning && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
  }, [history, loadHistory]);

  const loadPrs = useCallback(async () => {
    if (!repoId) return;
    setLoadingPrs(true); setError('');
    try {
      setPrs(await apiFetch<OpenPr[]>(`/pr-reviewer/open?repo_mapping_id=${repoId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PRs');
    } finally {
      setLoadingPrs(false);
    }
  }, [repoId]);

  const review = useCallback(async (pr: OpenPr) => {
    setReviewingId(pr.id); setError('');
    try {
      await apiFetch('/pr-reviewer/review', {
        method: 'POST',
        body: JSON.stringify({ repo_mapping_id: Number(repoId), pr_id: pr.id, source_branch: pr.source_branch, pr_url: pr.url, title: pr.title }),
      });
      setToast(t('prReviewer.started'));
      setTimeout(() => setToast(''), 3500);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed to start');
    } finally {
      setReviewingId('');
    }
  }, [repoId, loadHistory, t]);

  const field: React.CSSProperties = { height: 38, borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--surface)', color: 'var(--ink-90)', padding: '0 10px', fontSize: 13, minWidth: 280 };

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: '100%' }}>
      <div>
        <div className='section-label'>{t('nav.prReviewer')}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6 }}>{t('prReviewer.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 4 }}>{t('prReviewer.subtitle')}</p>
      </div>

      {error && <div style={{ ...card, padding: 12, color: '#cf5b57', fontSize: 13 }}>{error}</div>}
      {toast && <div style={{ ...card, padding: 12, color: '#3f9d6a', fontSize: 13 }}>{toast}</div>}

      {/* Pick repo -> load open PRs (live) */}
      <div style={{ ...card, padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={repoId} onChange={(e) => { setRepoId(e.target.value); setPrs([]); }} style={field}>
          {repos.length === 0 && <option value=''>{t('prReviewer.noRepos')}</option>}
          {repos.map((r) => <option key={r.id} value={r.id}>{r.display_name || `${r.owner}/${r.repo_name}`}</option>)}
        </select>
        <button onClick={() => void loadPrs()} className='button button-primary' style={{ height: 38, padding: '0 16px' }} disabled={!repoId || loadingPrs}>
          {loadingPrs ? '…' : t('prReviewer.loadPrs')}
        </button>
      </div>

      {/* Open PRs */}
      {prs.length > 0 && (
        <div style={{ ...card, overflow: 'hidden' }}>
          {prs.map((pr) => (
            <div key={pr.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--panel-alt)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <a href={pr.url} target='_blank' rel='noreferrer' style={{ color: 'var(--acc)', textDecoration: 'none' }}>#{pr.id} {pr.title} ↗</a>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-42)', marginTop: 2 }}>{pr.author} · {pr.source_branch} → {pr.target_branch}</div>
              </div>
              <button onClick={() => void review(pr)} className='button button-outline' style={{ height: 32, padding: '0 12px', whiteSpace: 'nowrap' }} disabled={reviewingId === pr.id}>
                {reviewingId === pr.id ? '…' : t('prReviewer.review')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '4px 2px 8px' }}>{t('prReviewer.history')}</div>
        <div style={{ ...card, overflow: 'hidden' }}>
          {history.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--ink-50)', fontSize: 13, textAlign: 'center' }}>{t('prReviewer.noHistory')}</div>
          ) : history.map((h) => (
            <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 90px 70px 120px 150px', gap: 10, alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--panel-alt)', fontSize: 12 }}>
              <div style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {h.pr_url ? <a href={h.pr_url} target='_blank' rel='noreferrer' style={{ color: 'var(--acc)', textDecoration: 'none', fontWeight: 600 }}>#{h.pr_number} {h.title || ''} ↗</a> : <span>#{h.pr_number} {h.title || ''}</span>}
                <div style={{ fontSize: 10, color: 'var(--ink-35)' }}>{h.repo}</div>
              </div>
              <span style={{ color: h.status === 'failed' ? '#cf5b57' : h.status === 'running' ? '#5b9bd5' : '#3f9d6a', fontWeight: 600 }}>{h.status}</span>
              <span style={{ color: sevColor(h.severity), fontWeight: 700, textTransform: 'capitalize' }}>{h.severity || '—'}</span>
              <span style={{ color: 'var(--ink-78)', fontVariantNumeric: 'tabular-nums' }}>{h.score != null ? `${h.score}` : '—'}</span>
              <span style={{ color: 'var(--ink-78)' }} title={t('prReviewer.threadsHint')}>{h.findings_count} / {h.threads_posted} thr</span>
              <span style={{ color: 'var(--ink-42)', whiteSpace: 'nowrap' }} title={h.error_message || ''}>{new Date(h.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
