'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Finding = { file: string; line: number; severity: string; category?: string; comment: string };
type ReviewDetail = {
  id: number; provider: string; repo: string; pr_number: string; pr_url: string | null; title: string | null;
  status: string; severity: string | null; score: number | null; findings_count: number;
  threads_posted: number; threads_open: number; reviewer_provider: string | null; reviewer_model: string | null;
  error_message: string | null; created_at: string; completed_at: string | null; duration_sec: number | null;
  findings: Finding[]; reviewed_files: string[]; tokens: number; cost_usd: number | null; stage?: string | null;
};

const STAGES = ['fetching_files', 'reviewing', 'verifying', 'posting'] as const;

const card: React.CSSProperties = { borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)' };
const sevColor = (s: string | null | undefined): string =>
  ({ critical: '#cf5b57', high: '#c98a2b', medium: '#c98a2b', low: '#3f9d6a', clean: '#3f9d6a' }[(s || '').toLowerCase()] || 'var(--ink-50)');
const fmtDur = (s: number | null): string => s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

export default function PrReviewDetailPage() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');
  const [d, setD] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setD(await apiFetch<ReviewDetail>(`/pr-reviewer/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
  }, [id]);

  useEffect(() => {
    void load();
    const iv = setInterval(() => { if (d?.status === 'running') void load(); }, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div style={{ ...card, padding: 16, color: '#cf5b57', fontSize: 13 }}>{error}</div>;
  if (!d) return <div style={{ padding: 40, color: 'var(--ink-40)', fontSize: 13 }}>…</div>;

  const metrics: [string, string, string][] = [
    [t('usage.colStatus'), d.status, d.status === 'failed' ? '#cf5b57' : d.status === 'running' ? '#5b9bd5' : '#3f9d6a'],
    [t('prReviewer.severityLabel'), d.severity || '—', sevColor(d.severity)],
    [t('prReviewer.scoreLabel'), d.score != null ? `${d.score}/100` : '—', 'var(--ink-90)'],
    [t('prReviewer.duration'), fmtDur(d.duration_sec), 'var(--ink-90)'],
    [t('prReviewer.findingsShort'), String(d.findings_count), 'var(--ink-90)'],
    [t('prReviewer.threadsPosted'), `${d.threads_posted}`, 'var(--ink-90)'],
    ['Token', d.tokens ? d.tokens.toLocaleString() : '—', 'var(--ink-90)'],
    [t('usage.totalCost'), d.cost_usd != null ? `$${d.cost_usd.toFixed(4)}` : '—', '#3f9d6a'],
  ];

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1000 }}>
      <style>{`@keyframes prvSpin { to { transform: rotate(360deg); } } .prv-spin { display:inline-block; width:13px; height:13px; border:2px solid var(--panel-border); border-top-color: var(--acc); border-radius:50%; animation: prvSpin .7s linear infinite; }`}</style>
      <button onClick={() => router.push('/dashboard/pr-reviewer')} style={{ background: 'transparent', border: 'none', color: 'var(--ink-50)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, width: 'fit-content' }}>← {t('prReviewer.back')}</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className='section-label'>{t('nav.prReviewer')}</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6 }}>
            <span style={{ color: 'var(--ink-42)', fontFamily: 'var(--font-mono, monospace)' }}>#{d.pr_number}</span> {d.title || ''}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--ink-42)', marginTop: 4 }}>{d.repo} · {d.reviewer_provider || '—'} / {d.reviewer_model || '—'} · {new Date(d.created_at).toLocaleString()}</div>
        </div>
        {d.pr_url && (
          <a href={d.pr_url} target='_blank' rel='noreferrer' className='button button-primary' style={{ height: 38, lineHeight: '38px', padding: '0 18px', textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('prReviewer.openPr')} ↗</a>
        )}
      </div>

      {d.error_message && <div style={{ ...card, padding: 12, color: '#cf5b57', fontSize: 12, borderColor: 'rgba(207,91,87,0.3)', background: 'rgba(207,91,87,0.06)' }}><strong>{t('prReviewer.errorLabel')}:</strong> {d.error_message}</div>}

      {/* Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {metrics.map(([label, value, color], i) => (
          <div key={i} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 5, textTransform: 'capitalize', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Live progress while running */}
      {d.status === 'running' && (
        <div style={{ ...card, padding: '16px 18px', display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {STAGES.map((s) => {
            const cur = STAGES.indexOf(d.stage as typeof STAGES[number]);
            const idx = STAGES.indexOf(s);
            const active = s === d.stage;
            const done = cur > idx;
            const color = active ? 'var(--acc)' : done ? '#3f9d6a' : 'var(--ink-30)';
            return (
              <div key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color, fontSize: 13, fontWeight: active ? 700 : 500 }}>
                {active ? <span className='prv-spin' /> : <span>{done ? '✓' : '○'}</span>}
                {t(`prReviewer.stage.${s}` as Parameters<typeof t>[0])}
              </div>
            );
          })}
        </div>
      )}

      {/* Findings */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '4px 2px 8px' }}>{t('prReviewer.findingsTitle')} ({d.findings.length})</div>
        {d.findings.length === 0 ? (
          <div style={{ ...card, padding: 20, color: 'var(--ink-50)', fontSize: 13, textAlign: 'center' }}>
            {d.status === 'running' ? `… ${t('prReviewer.reviewing')}` : t('prReviewer.noFindings')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {d.findings.map((f, i) => (
              <div key={i} style={{ ...card, padding: '14px 16px', borderLeft: `3px solid ${sevColor(f.severity)}` }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: sevColor(f.severity), background: `${sevColor(f.severity)}1c`, padding: '3px 8px', borderRadius: 999 }}>{f.severity}</span>
                  {f.category && <span style={{ fontSize: 10, color: 'var(--ink-42)', background: 'var(--panel-alt)', padding: '3px 8px', borderRadius: 999 }}>{f.category}</span>}
                  <span style={{ fontSize: 12, color: 'var(--ink-65)', fontFamily: 'var(--font-mono, monospace)' }}>{f.file}:{f.line}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-85)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{f.comment}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviewed files */}
      {d.reviewed_files.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '4px 2px 8px' }}>{t('prReviewer.reviewedFiles')} ({d.reviewed_files.length})</div>
          <div style={{ ...card, padding: '12px 16px', display: 'grid', gap: 6 }}>
            {d.reviewed_files.map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--ink-65)', fontFamily: 'var(--font-mono, monospace)' }}>{p}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
