'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [repoId, setRepoId] = useState<string>('');
  const [prs, setPrs] = useState<OpenPr[]>([]);
  const [loadingPrs, setLoadingPrs] = useState(false);
  const [reviewingId, setReviewingId] = useState('');
  const [history, setHistory] = useState<PrReview[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Review-config modal (agent + comment language).
  const [agents, setAgents] = useState<{ options: string[]; languages: string[]; default_provider: string; default_model: string | null } | null>(null);
  const [modalPr, setModalPr] = useState<OpenPr | null>(null);
  const [pickProvider, setPickProvider] = useState('');
  const [pickLang, setPickLang] = useState('auto');

  useEffect(() => {
    apiFetch<RepoMapping[]>('/repo-mappings')
      .then((rows) => {
        const supported = rows.filter((r) => ['azure', 'github'].includes((r.provider || '').toLowerCase()));
        setRepos(supported);
        if (supported.length && !repoId) setRepoId(String(supported[0].id));
      })
      .catch(() => {});
    apiFetch<{ options: string[]; languages: string[]; default_provider: string; default_model: string | null }>('/pr-reviewer/agents')
      .then((a) => { setAgents(a); setPickProvider(a.default_provider); })
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

  const review = useCallback(async (pr: OpenPr, provider: string, language: string) => {
    setReviewingId(pr.id); setError('');
    try {
      await apiFetch('/pr-reviewer/review', {
        method: 'POST',
        body: JSON.stringify({
          repo_mapping_id: Number(repoId), pr_id: pr.id, source_branch: pr.source_branch,
          target_branch: pr.target_branch,
          pr_url: pr.url, title: pr.title,
          provider: provider || undefined,
          language: language && language !== 'auto' ? language : undefined,
        }),
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

  const openReviewModal = useCallback((pr: OpenPr) => {
    setPickProvider(agents?.default_provider || 'claude_cli');
    setPickLang('auto');
    setModalPr(pr);
  }, [agents]);

  const confirmReview = useCallback(() => {
    if (!modalPr) return;
    const pr = modalPr;
    setModalPr(null);
    void review(pr, pickProvider, pickLang);
  }, [modalPr, pickProvider, pickLang, review]);

  const field: React.CSSProperties = { height: 38, borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--surface)', color: 'var(--ink-90)', padding: '0 10px', fontSize: 13, minWidth: 280 };
  const selectedRepoName = repos.find((r) => String(r.id) === repoId)?.repo_name || '';

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: '100%' }}>
      <style>{`
        @keyframes prvFade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        @keyframes prvPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
        @keyframes prvSpin { to { transform: rotate(360deg); } }
        .prv-row { animation: prvFade .28s ease both; transition: background .15s ease, box-shadow .15s ease; border-left: 3px solid transparent; }
        .prv-row:hover { background: var(--panel-alt); }
        .prv-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #5b9bd5; animation: prvPulse 1.1s ease-in-out infinite; }
        .prv-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--panel-border); border-top-color: var(--acc); border-radius: 50%; animation: prvSpin .7s linear infinite; }
        .prv-act { transition: transform .12s ease, background .15s ease, border-color .15s ease; }
        .prv-act:hover:not(:disabled) { transform: translateY(-1px); }
      `}</style>
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
          {prs.map((pr) => {
            // Latest review of this PR in the selected repo (history is desc).
            const rec = history.find((h) => String(h.pr_number) === String(pr.id) && (!selectedRepoName || h.repo === selectedRepoName));
            const running = reviewingId === pr.id || rec?.status === 'running';
            const done = rec?.status === 'completed';
            const failed = rec?.status === 'failed';
            const accent = running ? '#5b9bd5' : done ? sevColor(rec!.severity) : failed ? '#cf5b57' : 'transparent';
            return (
            <div key={pr.id} className='prv-row' style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--panel-alt)', borderLeftColor: accent }}>
              <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, background: 'var(--panel-alt)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🔀</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <a href={pr.url} target='_blank' rel='noreferrer' style={{ color: 'var(--ink-90)', textDecoration: 'none' }}><span style={{ color: 'var(--ink-42)', fontFamily: 'var(--font-mono, monospace)' }}>#{pr.id}</span> {pr.title} <span style={{ color: 'var(--acc)' }}>↗</span></a>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-42)', marginTop: 3, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{pr.author}</span>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{pr.source_branch} → {pr.target_branch}</span>
                  {running && <span style={{ color: '#5b9bd5', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}><span className='prv-dot' /> {t('prReviewer.reviewing')}</span>}
                  {done && <span style={{ color: sevColor(rec!.severity), fontWeight: 700 }}>✓ {t('prReviewer.reviewed')} · {rec!.findings_count} {t('prReviewer.findingsShort')}{rec!.threads_posted ? ` · ${rec!.threads_posted} thr` : ''}</span>}
                  {failed && <span style={{ color: '#cf5b57', fontWeight: 700 }} title={rec?.error_message || ''}>✕ {t('prReviewer.errorLabel')}</span>}
                </div>
              </div>
              <a href={pr.url} target='_blank' rel='noreferrer' className='button button-outline prv-act' title={t('prReviewer.openPr')} style={{ height: 34, padding: '0 12px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-65)', textDecoration: 'none', fontSize: 12 }}>
                {t('prReviewer.openPr')} ↗
              </a>
              <button onClick={() => openReviewModal(pr)} className='button button-outline prv-act' style={{ height: 34, padding: '0 14px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7, opacity: running ? 0.8 : 1, ...(done ? { borderColor: 'var(--panel-border)' } : { borderColor: 'var(--acc)', color: 'var(--acc)' }) }} disabled={running}>
                {running ? <><span className='prv-spin' /> {t('prReviewer.reviewing')}</> : (done || failed) ? `↻ ${t('prReviewer.rereview')}` : `✨ ${t('prReviewer.review')}`}
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* History */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '4px 2px 8px' }}>{t('prReviewer.history')}</div>
        <div style={{ ...card, overflow: 'hidden' }}>
          {history.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--ink-50)', fontSize: 13, textAlign: 'center' }}>{t('prReviewer.noHistory')}</div>
          ) : history.map((h) => {
            const hAccent = h.status === 'failed' ? '#cf5b57' : h.status === 'running' ? '#5b9bd5' : sevColor(h.severity);
            return (
            <div key={h.id} className='prv-row' onClick={() => router.push(`/dashboard/pr-reviewer/${h.id}`)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '13px 16px', borderBottom: '1px solid var(--panel-alt)', fontSize: 12, cursor: 'pointer', borderLeftColor: hAccent }}>
              <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, background: 'var(--panel-alt)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🔀</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: 'var(--ink-42)', fontFamily: 'var(--font-mono, monospace)' }}>#{h.pr_number}</span> {h.title || ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-42)', marginTop: 3, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{h.repo}</span>
                  <span style={{ color: hAccent, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {h.status === 'running' && <span className='prv-dot' />}
                    {h.status === 'completed' ? `✓ ${(h.severity || 'clean')}` : h.status === 'failed' ? `✕ ${t('prReviewer.errorLabel')}` : t('prReviewer.reviewing')}
                  </span>
                  {h.status === 'completed' && <span style={{ color: 'var(--ink-50)' }}>{h.findings_count} {t('prReviewer.findingsShort')} · {h.threads_posted} thr{h.score != null ? ` · ${h.score}/100` : ''}</span>}
                </div>
              </div>
              {h.pr_url && (
                <a href={h.pr_url} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()} className='button button-outline prv-act' title={t('prReviewer.openPr')} style={{ height: 30, padding: '0 10px', whiteSpace: 'nowrap', color: 'var(--ink-65)', textDecoration: 'none', fontSize: 11, display: 'inline-flex', alignItems: 'center' }}>
                  {t('prReviewer.openPr')} ↗
                </a>
              )}
              <span style={{ color: 'var(--ink-42)', whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(h.created_at).toLocaleString()}</span>
            </div>
            );
          })}
        </div>
      </div>

      {/* Review-config modal: pick agent + comment language */}
      {modalPr && (
        <div onClick={() => setModalPr(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(440px, 100%)', padding: 22 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>✨ {t('prReviewer.review')}</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-42)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{modalPr.id} {modalPr.title}</div>

            <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('prReviewer.agentLabel')}</span>
                <select value={pickProvider} onChange={(e) => setPickProvider(e.target.value)} style={{ ...field, minWidth: 0, width: '100%' }}>
                  {(agents?.options || ['claude_cli']).map((o) => (
                    <option key={o} value={o}>{o}{o === agents?.default_provider ? ` (${t('prReviewer.defaultTag')})` : ''}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('prReviewer.langLabel')}</span>
                <select value={pickLang} onChange={(e) => setPickLang(e.target.value)} style={{ ...field, minWidth: 0, width: '100%' }}>
                  {(agents?.languages || ['auto']).map((l) => (
                    <option key={l} value={l}>{l === 'auto' ? t('prReviewer.langAuto') : (LANG_NAMES[l] || l)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button onClick={() => setModalPr(null)} className='button button-outline' style={{ height: 36, padding: '0 14px' }}>{t('prReviewer.cancel')}</button>
              <button onClick={confirmReview} className='button button-primary' style={{ height: 36, padding: '0 18px' }}>✨ {t('prReviewer.review')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const LANG_NAMES: Record<string, string> = { tr: 'Türkçe', en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', ja: '日本語', zh: '中文' };
