'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type RepoMapping = { id: number; provider: string; owner: string; repo_name: string; display_name: string };
type OpenPr = { id: string; title: string; author: string; source_branch: string; target_branch: string; created: string; url: string };
type Finding = { file: string; line: number; severity: string; category?: string; comment: string };
type PrReview = {
  id: number; provider: string; repo: string; pr_number: string; pr_url: string | null; title: string | null;
  status: string; severity: string | null; score: number | null; findings_count: number;
  threads_posted: number; threads_open: number; reviewer_provider: string | null; reviewer_model: string | null;
  error_message: string | null; created_at: string; completed_at: string | null;
  severity_breakdown?: Record<string, number>; category_breakdown?: Record<string, number>;
};
type ReviewDetail = PrReview & { findings: Finding[]; reviewed_files: string[]; duration_sec: number | null };

const SEV_ORDER = ['critical', 'high', 'medium', 'low'] as const;
const CAT_ORDER = ['security', 'bug', 'error-handling', 'performance', 'tests', 'other'] as const;
const sevColor = (s: string | null | undefined): string =>
  ({ critical: '#ff5c57', high: '#ff9f43', medium: '#f5c518', low: '#3fd07f', clean: '#3fd07f' }[(s || '').toLowerCase()] || 'var(--ink-45)');

const PrGlyph = ({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke={color} strokeWidth={2.2} strokeLinecap='round' strokeLinejoin='round'>
    <circle cx={6} cy={6} r={3} /><circle cx={6} cy={18} r={3} /><path d='M6 9v6' /><path d='M13 6h3a2 2 0 0 1 2 2v7' /><path d='M16 16l2 3 2-3' />
  </svg>
);

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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, ReviewDetail | 'loading'>>({});
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
    try { setPrs(await apiFetch<OpenPr[]>(`/pr-reviewer/open?repo_mapping_id=${repoId}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load PRs'); }
    finally { setLoadingPrs(false); }
  }, [repoId]);

  const review = useCallback(async (pr: OpenPr, provider: string, language: string) => {
    setReviewingId(pr.id); setError('');
    try {
      await apiFetch('/pr-reviewer/review', {
        method: 'POST',
        body: JSON.stringify({
          repo_mapping_id: Number(repoId), pr_id: pr.id, source_branch: pr.source_branch,
          target_branch: pr.target_branch, pr_url: pr.url, title: pr.title,
          provider: provider || undefined,
          language: language && language !== 'auto' ? language : undefined,
        }),
      });
      setToast(t('prReviewer.started'));
      setTimeout(() => setToast(''), 3500);
      await loadHistory();
    } catch (e) { setError(e instanceof Error ? e.message : 'Review failed to start'); }
    finally { setReviewingId(''); }
  }, [repoId, loadHistory, t]);

  const openReviewModal = useCallback((pr: OpenPr) => {
    setPickProvider(agents?.default_provider || 'claude_cli'); setPickLang('auto'); setModalPr(pr);
  }, [agents]);

  const confirmReview = useCallback(() => {
    if (!modalPr) return;
    const pr = modalPr; setModalPr(null); void review(pr, pickProvider, pickLang);
  }, [modalPr, pickProvider, pickLang, review]);

  // Inline expand — never navigates away. Lazily fetch findings the first time.
  const toggleExpand = useCallback(async (h: PrReview) => {
    if (expandedId === h.id) { setExpandedId(null); return; }
    setExpandedId(h.id);
    if (!details[h.id] && h.status === 'completed') {
      setDetails((d) => ({ ...d, [h.id]: 'loading' }));
      try {
        const full = await apiFetch<ReviewDetail>(`/pr-reviewer/${h.id}`);
        setDetails((d) => ({ ...d, [h.id]: full }));
      } catch { setDetails((d) => { const n = { ...d }; delete n[h.id]; return n; }); }
    }
  }, [expandedId, details]);

  const selectedRepoName = repos.find((r) => String(r.id) === repoId)?.repo_name || '';
  const catLabel = (c: string): string => { const k = `prReviewer.cat.${c}` as Parameters<typeof t>[0]; const v = t(k); return v === k ? c : v; };
  const sevLabel = (s: string): string => { const k = `prReviewer.sev.${s}` as Parameters<typeof t>[0]; const v = t(k); return v === k ? s : v; };

  const agg = useMemo(() => {
    const sev: Record<string, number> = {}; const cat: Record<string, number> = {};
    let findings = 0;
    for (const h of history) {
      findings += h.findings_count || 0;
      for (const [k, v] of Object.entries(h.severity_breakdown || {})) sev[k] = (sev[k] || 0) + v;
      for (const [k, v] of Object.entries(h.category_breakdown || {})) cat[k] = (cat[k] || 0) + v;
    }
    return { sev, cat, findings, reviews: history.length };
  }, [history]);

  const orderedCats = (cat: Record<string, number>): [string, number][] =>
    Object.entries(cat).filter(([, n]) => n > 0).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a[0] as typeof CAT_ORDER[number]); const ib = CAT_ORDER.indexOf(b[0] as typeof CAT_ORDER[number]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  const SevSwatches = ({ b }: { b: Record<string, number> }) => {
    const items = SEV_ORDER.filter((s) => (b[s] || 0) > 0);
    if (!items.length) return null;
    return (
      <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
        {items.map((s) => (
          <span key={s} title={sevLabel(s)} className='pgx-mono' style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-72)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: sevColor(s), boxShadow: `0 0 7px ${sevColor(s)}80` }} />{b[s]}
          </span>
        ))}
      </span>
    );
  };

  const TypeChips = ({ b }: { b: Record<string, number> }) => {
    const items = orderedCats(b);
    if (!items.length) return null;
    return (
      <span style={{ display: 'inline-flex', gap: 7, flexWrap: 'wrap' }}>
        {items.map(([c, n]) => (
          <span key={c} className='pgx-chip'>{catLabel(c)}<span className='pgx-mono' style={{ opacity: 0.5, marginLeft: 5 }}>{n}</span></span>
        ))}
      </span>
    );
  };

  const SevBar = ({ b, h = 8 }: { b: Record<string, number>; h?: number }) => {
    const total = SEV_ORDER.reduce((s, k) => s + (b[k] || 0), 0);
    if (!total) return <div style={{ height: h, borderRadius: 999, background: 'var(--panel-alt)' }} />;
    return (
      <div style={{ display: 'flex', height: h, borderRadius: 999, overflow: 'hidden', gap: 2, background: 'transparent' }}>
        {SEV_ORDER.filter((s) => b[s]).map((s) => (
          <div key={s} title={`${sevLabel(s)} · ${b[s]}`} style={{ width: `${(b[s] / total) * 100}%`, background: sevColor(s), borderRadius: 2, minWidth: 4 }} />
        ))}
      </div>
    );
  };

  const kpis: [string, string, string][] = [
    [t('prReviewer.openPrsCount'), prs.length ? String(prs.length) : '0', 'var(--ink-90)'],
    [t('prReviewer.totalReviews'), String(agg.reviews), 'var(--ink-90)'],
    [t('prReviewer.totalFindings'), String(agg.findings), 'var(--ink-90)'],
    [`${t('prReviewer.sev.critical')} · ${t('prReviewer.sev.high')}`, String((agg.sev.critical || 0) + (agg.sev.high || 0)), (agg.sev.critical || agg.sev.high) ? sevColor('high') : 'var(--ink-90)'],
  ];

  return (
    <div className='pgx' style={{ display: 'grid', gap: 20, maxWidth: 1100 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        .pgx { --crit:#ff5c57; --acc2:#5b9bd5; }
        .pgx-display { font-family: 'Archivo', var(--font-sans, sans-serif); }
        .pgx-mono { font-family: 'JetBrains Mono', var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
        @keyframes pgxUp { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
        @keyframes pgxGlow { 0%,100% { opacity:.55; } 50% { opacity:.85; } }
        @keyframes pgxPulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
        @keyframes pgxSpin { to { transform: rotate(360deg); } }

        /* Header band with atmosphere */
        .pgx-hero { position: relative; overflow: hidden; border:1px solid var(--panel-border); border-radius:16px;
          background: linear-gradient(135deg, rgba(91,155,213,0.05), transparent 55%), var(--surface); padding: 26px 28px; }
        .pgx-hero::before { content:''; position:absolute; inset:0; pointer-events:none;
          background:
            radial-gradient(420px 220px at 88% -30%, rgba(91,155,213,0.18), transparent 70%),
            radial-gradient(360px 200px at 102% 120%, rgba(255,92,87,0.10), transparent 70%); animation: pgxGlow 7s ease-in-out infinite; }
        .pgx-hero::after { content:''; position:absolute; inset:0; pointer-events:none; opacity:.5;
          background-image: linear-gradient(var(--panel-border) 1px, transparent 1px), linear-gradient(90deg, var(--panel-border) 1px, transparent 1px);
          background-size: 40px 40px; mask-image: linear-gradient(180deg, rgba(0,0,0,0.25), transparent 65%); -webkit-mask-image: linear-gradient(180deg, rgba(0,0,0,0.25), transparent 65%); }
        .pgx-kicker { position:relative; display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; color: var(--acc2); }
        .pgx-title { position: relative; font-size: 34px; font-weight: 800; letter-spacing: -1.2px; color: var(--ink-90); margin-top: 12px; line-height: 1; }
        .pgx-sub { position: relative; font-size: 13.5px; color: var(--ink-50); margin-top: 10px; max-width: 560px; line-height: 1.55; }

        /* KPI ribbon */
        .pgx-ribbon { position: relative; margin-top: 24px; display:flex; flex-wrap:wrap; gap: 0; border:1px solid var(--panel-border); border-radius:12px; background: rgba(0,0,0,0.12); overflow:hidden; }
        .pgx-stat { flex:1; min-width: 130px; padding: 16px 20px; border-left:1px solid var(--panel-border); }
        .pgx-stat:first-child { border-left:none; }
        .pgx-stat-num { font-size: 30px; font-weight: 700; line-height: 1; letter-spacing:-1px; }
        .pgx-stat-label { font-size: 10px; font-weight:700; letter-spacing:1px; text-transform:uppercase; color: var(--ink-42); margin-top: 9px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

        .pgx-panel { border:1px solid var(--panel-border); border-radius:14px; background: var(--surface); }
        .pgx-chip { display:inline-flex; align-items:center; font-size:11px; font-weight:600; color: var(--ink-72);
          background: var(--panel-alt); border:1px solid var(--panel-border); padding:4px 10px; border-radius:999px; }

        /* Timeline */
        .pgx-entry { position: relative; display:flex; gap: 0; animation: pgxUp .4s ease both; }
        .pgx-rail { position: relative; flex-shrink:0; width: 46px; }
        .pgx-rail::before { content:''; position:absolute; left:50%; top:0; bottom:0; width:1px; background: var(--panel-border); transform: translateX(-0.5px); }
        .pgx-entry:first-child .pgx-rail::before { top: 22px; }
        .pgx-entry:last-child .pgx-rail::before { bottom: calc(100% - 22px); }
        .pgx-node { position:absolute; left:50%; top:22px; width:13px; height:13px; border-radius:50%; transform: translate(-50%,-50%);
          border:2px solid var(--surface); z-index:1; transition: box-shadow .2s ease, transform .2s ease; }
        .pgx-entry:hover .pgx-node { transform: translate(-50%,-50%) scale(1.18); }
        .pgx-body { flex:1; min-width:0; padding-bottom: 14px; }
        .pgx-head { width:100%; text-align:left; background:transparent; border:1px solid transparent; border-radius:12px; padding: 12px 14px; cursor:pointer;
          display:flex; gap:14px; align-items:center; transition: background .15s ease, border-color .15s ease; }
        .pgx-head:hover { background: var(--panel-alt); border-color: var(--panel-border); }
        .pgx-head.open { background: var(--panel-alt); border-color: var(--panel-border); border-bottom-left-radius:0; border-bottom-right-radius:0; }
        .pgx-caret { flex-shrink:0; width:11px; color: var(--ink-35); font-size:10px; transition: transform .22s ease; }
        .pgx-caret.open { transform: rotate(90deg); }
        .pgx-icon { flex-shrink:0; width:32px; height:32px; border-radius:9px; background: var(--panel-alt); border:1px solid var(--panel-border); display:inline-flex; align-items:center; justify-content:center; color: var(--ink-50); }
        .pgx-expand { display:grid; grid-template-rows: 0fr; transition: grid-template-rows .3s cubic-bezier(.4,0,.2,1); border:1px solid var(--panel-border); border-top:none; border-bottom-left-radius:12px; border-bottom-right-radius:12px; background: rgba(0,0,0,0.10); }
        .pgx-expand.open { grid-template-rows: 1fr; }
        .pgx-expand > div { overflow:hidden; }
        .pgx-finding { border:1px solid var(--panel-border); border-radius:10px; background: var(--surface); overflow:hidden; display:flex; }
        .pgx-finding-spine { width:4px; flex-shrink:0; }
        .pgx-sevtag { font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.6px; padding:3px 8px; border-radius:5px; }
        .pgx-cattag { font-size:10px; font-weight:600; color: var(--ink-65); background: var(--panel-alt); border:1px solid var(--panel-border); padding:3px 8px; border-radius:5px; }

        .pgx-spin { display:inline-block; width:13px; height:13px; border:2px solid var(--panel-border); border-top-color: var(--acc2); border-radius:50%; animation: pgxSpin .7s linear infinite; }
        .pgx-live { display:inline-block; width:7px; height:7px; border-radius:50%; background:#5b9bd5; animation: pgxPulse 1.1s ease-in-out infinite; }
        .pgx-btn { transition: background .14s, border-color .14s, color .14s; }
        .pgx-field { height:40px; border-radius:9px; border:1px solid var(--panel-border); background: var(--surface); color: var(--ink-90); padding:0 12px; font-size:13px; min-width:280px; }
      `}</style>

      {/* HERO + KPI ribbon */}
      <div className='pgx-hero'>
        <div className='pgx-kicker'><PrGlyph size={13} color='var(--acc2)' /> {t('nav.prReviewer')}</div>
        <h1 className='pgx-title pgx-display'>{t('prReviewer.title')}</h1>
        <p className='pgx-sub'>{t('prReviewer.subtitle')}</p>
        <div className='pgx-ribbon'>
          {kpis.map(([label, value, color], i) => (
            <div key={i} className='pgx-stat'>
              <div className='pgx-stat-num pgx-mono' style={{ color }}>{value}</div>
              <div className='pgx-stat-label'>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {error && <div className='pgx-panel' style={{ padding: 13, color: '#ff5c57', fontSize: 13, borderColor: 'rgba(255,92,87,0.35)', background: 'rgba(255,92,87,0.07)' }}>{error}</div>}
      {toast && <div className='pgx-panel' style={{ padding: 13, color: '#3fd07f', fontSize: 13, borderColor: 'rgba(63,208,127,0.35)', background: 'rgba(63,208,127,0.07)' }}>{toast}</div>}

      {/* Severity distribution + issue types */}
      {agg.findings > 0 && (
        <div className='pgx-panel' style={{ padding: '18px 20px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{t('prReviewer.severityLabel')}</span>
            <SevSwatches b={agg.sev} />
          </div>
          <SevBar b={agg.sev} h={10} />
          {orderedCats(agg.cat).length > 0 && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid var(--panel-border)' }}>
              <span style={{ fontSize: 10.5, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, flexShrink: 0 }}>{t('prReviewer.issueTypes')}</span>
              <TypeChips b={agg.cat} />
            </div>
          )}
        </div>
      )}

      {/* Repo picker */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={repoId} onChange={(e) => { setRepoId(e.target.value); setPrs([]); }} className='pgx-field'>
          {repos.length === 0 && <option value=''>{t('prReviewer.noRepos')}</option>}
          {repos.map((r) => <option key={r.id} value={r.id}>{r.display_name || `${r.owner}/${r.repo_name}`}</option>)}
        </select>
        <button onClick={() => void loadPrs()} className='button button-primary pgx-btn' style={{ height: 40, padding: '0 18px' }} disabled={!repoId || loadingPrs}>
          {loadingPrs ? '…' : t('prReviewer.loadPrs')}
        </button>
      </div>

      {/* Open PRs */}
      {prs.length > 0 && (
        <div className='pgx-panel' style={{ overflow: 'hidden' }}>
          {prs.map((pr, i) => {
            const rec = history.find((h) => String(h.pr_number) === String(pr.id) && (!selectedRepoName || h.repo === selectedRepoName));
            const running = reviewingId === pr.id || rec?.status === 'running';
            const done = rec?.status === 'completed';
            const failed = rec?.status === 'failed';
            return (
            <div key={pr.id} style={{ display: 'flex', gap: 13, alignItems: 'center', padding: '14px 18px', borderTop: i ? '1px solid var(--panel-border)' : 'none' }}>
              <span className='pgx-icon'><PrGlyph /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <a href={pr.url} target='_blank' rel='noreferrer' style={{ color: 'var(--ink-90)', textDecoration: 'none' }}><span className='pgx-mono' style={{ color: 'var(--ink-42)' }}>#{pr.id}</span> {pr.title}</a>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-42)', marginTop: 4, display: 'flex', gap: 11, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{pr.author}</span>
                  <span className='pgx-mono'>{pr.source_branch} → {pr.target_branch}</span>
                  {running && <span style={{ color: '#5b9bd5', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}><span className='pgx-live' /> {t('prReviewer.reviewing')}</span>}
                  {done && <span style={{ color: sevColor(rec!.severity), fontWeight: 700 }}>✓ {rec!.findings_count} {t('prReviewer.findingsShort')}</span>}
                  {failed && <span style={{ color: '#ff5c57', fontWeight: 700 }} title={rec?.error_message || ''}>✕ {t('prReviewer.errorLabel')}</span>}
                </div>
              </div>
              <button onClick={() => openReviewModal(pr)} className='button button-outline pgx-btn' style={{ height: 35, padding: '0 15px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 7, ...(done || failed ? {} : { borderColor: 'var(--acc)', color: 'var(--acc)' }) }} disabled={running}>
                {running ? <><span className='pgx-spin' /> {t('prReviewer.reviewing')}</> : (done || failed) ? `↻ ${t('prReviewer.rereview')}` : `✨ ${t('prReviewer.review')}`}
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* History timeline */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 14, marginLeft: 4 }}>{t('prReviewer.history')}</div>
        {history.length === 0 ? (
          <div className='pgx-panel' style={{ padding: 28, color: 'var(--ink-45)', fontSize: 13, textAlign: 'center' }}>{t('prReviewer.noHistory')}</div>
        ) : (
          <div>
            {history.map((h, i) => {
              const hColor = h.status === 'failed' ? '#ff5c57' : h.status === 'running' ? '#5b9bd5' : sevColor(h.severity);
              const isOpen = expandedId === h.id;
              const sevB = h.severity_breakdown || {};
              const catB = h.category_breakdown || {};
              const det = details[h.id];
              return (
              <div key={h.id} className='pgx-entry' style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
                <div className='pgx-rail'>
                  <span className='pgx-node' style={{ background: hColor, boxShadow: `0 0 0 4px ${hColor}22, 0 0 12px ${hColor}80` }} />
                </div>
                <div className='pgx-body'>
                  <button className={`pgx-head${isOpen ? ' open' : ''}`} onClick={() => void toggleExpand(h)}>
                    <span className={`pgx-caret${isOpen ? ' open' : ''}`}>▶</span>
                    <span className='pgx-icon'><PrGlyph /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--ink-90)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className='pgx-mono' style={{ color: 'var(--ink-42)' }}>#{h.pr_number}</span> {h.title || ''}
                      </span>
                      <span style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, color: 'var(--ink-42)', marginTop: 5 }}>
                        <span className='pgx-mono'>{h.repo}</span>
                        <span style={{ color: hColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {h.status === 'running' && <span className='pgx-live' />}
                          {h.status === 'completed' ? `${sevLabel(h.severity || 'clean')}` : h.status === 'failed' ? `✕ ${t('prReviewer.errorLabel')}` : t('prReviewer.reviewing')}
                        </span>
                        <SevSwatches b={sevB} />
                        {h.status === 'completed' && h.findings_count > 0 && <span>{h.findings_count} {t('prReviewer.findingsShort')}</span>}
                        {h.status === 'completed' && h.score != null && <span className='pgx-mono' style={{ color: 'var(--ink-50)' }}>{h.score}/100</span>}
                      </span>
                    </span>
                    {h.pr_url && (
                      <a href={h.pr_url} target='_blank' rel='noreferrer' onClick={(e) => e.stopPropagation()} className='button button-outline pgx-btn' title={t('prReviewer.openPr')} style={{ height: 30, padding: '0 11px', whiteSpace: 'nowrap', color: 'var(--ink-65)', textDecoration: 'none', fontSize: 11.5, display: 'inline-flex', alignItems: 'center' }}>
                        {t('prReviewer.openPr')} ↗
                      </a>
                    )}
                    <span className='pgx-mono' style={{ color: 'var(--ink-35)', whiteSpace: 'nowrap', fontSize: 11, flexShrink: 0 }}>{new Date(h.created_at).toLocaleDateString()}</span>
                  </button>

                  <div className={`pgx-expand${isOpen ? ' open' : ''}`}>
                    <div>
                      <div style={{ padding: '14px 16px', display: 'grid', gap: 11 }}>
                        {orderedCats(catB).length > 0 && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{t('prReviewer.issueTypes')}</span>
                            <TypeChips b={catB} />
                          </div>
                        )}
                        {h.status === 'failed' ? (
                          <div className='pgx-panel' style={{ padding: 13, fontSize: 12.5, color: '#ff5c57', borderColor: 'rgba(255,92,87,0.3)' }}>{h.error_message || t('prReviewer.errorLabel')}</div>
                        ) : h.status === 'running' ? (
                          <div style={{ padding: 12, color: 'var(--ink-50)', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className='pgx-spin' /> {t('prReviewer.reviewing')}…</div>
                        ) : det === 'loading' || det === undefined ? (
                          <div style={{ padding: 12, color: 'var(--ink-45)', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className='pgx-spin' /> …</div>
                        ) : det.findings.length === 0 ? (
                          <div style={{ padding: 14, color: 'var(--ink-50)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3fd07f' }} /> {t('prReviewer.noFindings')}
                          </div>
                        ) : (
                          det.findings.map((f, idx) => (
                            <div key={idx} className='pgx-finding'>
                              <div className='pgx-finding-spine' style={{ background: sevColor(f.severity) }} />
                              <div style={{ padding: '13px 15px', flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                                  <span className='pgx-sevtag' style={{ color: sevColor(f.severity), background: `${sevColor(f.severity)}22` }}>{sevLabel(f.severity)}</span>
                                  {f.category && <span className='pgx-cattag'>{catLabel(f.category)}</span>}
                                  <span className='pgx-mono' style={{ fontSize: 12, color: 'var(--ink-58)' }}>{f.file}:{f.line}</span>
                                </div>
                                <div style={{ fontSize: 13, color: 'var(--ink-85)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{f.comment}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Review-config modal */}
      {modalPr && (
        <div onClick={() => setModalPr(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className='pgx-panel' style={{ background: 'var(--panel-solid)', width: 'min(440px, 100%)', padding: 24 }}>
            <h3 className='pgx-display' style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)', margin: 0, letterSpacing: -0.4 }}>✨ {t('prReviewer.review')}</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-42)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span className='pgx-mono'>#{modalPr.id}</span> {modalPr.title}</div>
            <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('prReviewer.agentLabel')}</span>
                <select value={pickProvider} onChange={(e) => setPickProvider(e.target.value)} className='pgx-field' style={{ minWidth: 0, width: '100%' }}>
                  {(agents?.options || ['claude_cli']).map((o) => (
                    <option key={o} value={o}>{o}{o === agents?.default_provider ? ` (${t('prReviewer.defaultTag')})` : ''}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('prReviewer.langLabel')}</span>
                <select value={pickLang} onChange={(e) => setPickLang(e.target.value)} className='pgx-field' style={{ minWidth: 0, width: '100%' }}>
                  {(agents?.languages || ['auto']).map((l) => (
                    <option key={l} value={l}>{l === 'auto' ? t('prReviewer.langAuto') : (LANG_NAMES[l] || l)}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button onClick={() => setModalPr(null)} className='button button-outline' style={{ height: 38, padding: '0 16px' }}>{t('prReviewer.cancel')}</button>
              <button onClick={confirmReview} className='button button-primary' style={{ height: 38, padding: '0 20px' }}>✨ {t('prReviewer.review')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const LANG_NAMES: Record<string, string> = { tr: 'Türkçe', en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', ja: '日本語', zh: '中文' };
