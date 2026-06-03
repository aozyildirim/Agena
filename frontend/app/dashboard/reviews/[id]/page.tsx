'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import RichDescription from '@/components/RichDescription';
import NavIcon from '@/components/NavIcon';

interface Review {
  id: number;
  task_id: number;
  task_title: string | null;
  reviewer_agent_role: string;
  reviewer_provider: string | null;
  reviewer_model: string | null;
  input_snapshot: string | null;
  output: string | null;
  score: number | null;
  findings_count: number | null;
  severity: string | null;
  status: string;
  error_message: string | null;
  requested_by_user_id: number;
  created_at: string;
  completed_at: string | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#60a5fa',
  clean: '#22c55e',
};

function severityColor(s: string | null) {
  if (!s) return 'var(--ink-35)';
  return SEVERITY_COLOR[s] || 'var(--ink-35)';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function ReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLocale();
  const reviewId = Number(params?.id);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!review) return;
    setDeleting(true);
    try {
      await apiFetch(`/reviews/${review.id}`, { method: 'DELETE' });
      router.push('/dashboard/reviews');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(reviewId)) {
      setError('Invalid review id');
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch<Review>(`/reviews/${reviewId}`);
        if (!alive) return;
        setReview(r);
        // Auto-poll while still running so the page stays live without
        // the user needing to refresh.
        if (r.status === 'running' || r.status === 'queued') {
          const poll = setInterval(async () => {
            try {
              const next = await apiFetch<Review>(`/reviews/${reviewId}`);
              if (!alive) return;
              setReview(next);
              if (next.status !== 'running' && next.status !== 'queued') clearInterval(poll);
            } catch { /* keep polling */ }
          }, 3000);
          return () => clearInterval(poll);
        }
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Failed to load review');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reviewId]);

  const sev = review?.severity || null;
  const sevColor = severityColor(sev);

  // Per-finding split. The reviewer prompt produces `**N. Title**` headings;
  // splitting on those gives one card per finding so the page reads as a
  // proper report, not a wall of text.
  const findingBlocks = useMemo(() => {
    const out = (review?.output || '').trim();
    if (!out) return [] as Array<{ title: string; body: string }>;
    // Split the output into chunks each starting with `**N. Title**`.
    const parts = out.split(/(?=^\s*\*\*\d+[.)]\s)/m);
    if (parts.length <= 1) return [];
    return parts
      .filter((p) => /^\s*\*\*\d+[.)]\s/m.test(p))
      .map((chunk) => {
        const headerMatch = chunk.match(/^\s*\*\*(\d+[.)]\s[^*]+)\*\*\s*\n([\s\S]*)$/m);
        if (headerMatch) {
          return { title: headerMatch[1].trim(), body: headerMatch[2].trim() };
        }
        return { title: chunk.split('\n', 1)[0].replace(/^\*\*|\*\*$/g, '').trim(), body: chunk.split('\n').slice(1).join('\n').trim() };
      });
  }, [review?.output]);

  const summary = useMemo(() => {
    const out = (review?.output || '').trim();
    const m = out.match(/^###\s*Summary\s*\n+([\s\S]*?)(?:\n###|\n\*\*\d+|\Z)/m);
    return m ? m[1].trim() : '';
  }, [review?.output]);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100, margin: '0 auto', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href='/dashboard/reviews' style={{ fontSize: 12, color: 'var(--ink-50)', textDecoration: 'none' }}>
          ← {t('reviews.backToList' as TranslationKey) || 'All reviews'}
        </Link>
        {review?.task_id && (
          <>
            <span style={{ color: 'var(--ink-25)' }}>·</span>
            <Link href={`/tasks/${review.task_id}`} style={{ fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
              {t('reviews.openTask' as TranslationKey) || 'Open task'} #{review.task_id} →
            </Link>
          </>
        )}
      </div>

      {loading && <div style={{ color: 'var(--ink-50)', fontSize: 13 }}>{t('reviews.loading' as TranslationKey) || 'Loading…'}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid #cf5b57', color: '#cf5b57', fontSize: 13, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{error}</div>}

      {review && (
        <>
          {/* Header card */}
          <div style={{
            padding: 22, borderRadius: 10,
            border: `1px solid ${sevColor}55`,
            background: 'var(--panel-alt)',
            display: 'grid', gap: 14, minWidth: 0,
          }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4,
                padding: '5px 12px', borderRadius: 999,
                background: `${sevColor}22`, color: sevColor, border: `1px solid ${sevColor}55`,
              }}>
                {sev || '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-50)', fontFamily: 'monospace', minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                #{review.id} · {review.reviewer_agent_role}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type='button'
                  onClick={() => setConfirmingDelete(true)}
                  disabled={deleting}
                  style={{
                    padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: '1px solid #cf5b57',
                    background: 'var(--panel)',
                    color: '#cf5b57',
                    cursor: deleting ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <NavIcon name="close" size={14} /> {t('reviews.delete' as TranslationKey) || 'Delete'}
                </button>
              </div>
            </div>
            <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', margin: 0, lineHeight: 1.3, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
              {review.task_title || `Task #${review.task_id}`}
            </h1>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
              <Stat label={t('reviews.findings' as TranslationKey) || 'Findings'} value={review.findings_count != null ? String(review.findings_count) : '—'} accent={sevColor} />
              <Stat label={t('reviews.score' as TranslationKey) || 'Score'} value={review.score != null ? `${review.score}` : '—'} accent='var(--acc)' />
              <Stat label={t('reviews.status' as TranslationKey) || 'Status'} value={review.status} accent={review.status === 'running' ? '#c98a2b' : review.status === 'failed' ? '#cf5b57' : 'var(--ink-78)'} />
              <Stat label={t('reviews.model' as TranslationKey) || 'Model'} value={`${review.reviewer_provider || '—'} / ${review.reviewer_model || '—'}`} />
              <Stat label={t('reviews.duration' as TranslationKey) || 'Duration'} value={fmtDuration(review.created_at, review.completed_at)} />
              <Stat label={t('reviews.requestedAt' as TranslationKey) || 'Requested'} value={fmtDate(review.created_at)} />
            </div>
            {summary && (
              <div style={{
                padding: '14px 16px', borderRadius: 10,
                background: 'var(--surface)',
                border: '1px solid var(--panel-border-2)',
                fontSize: 13, lineHeight: 1.6, color: 'var(--ink-78)', minWidth: 0,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>
                  {t('reviews.summary' as TranslationKey) || 'Summary'}
                </div>
                <div style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{summary}</div>
              </div>
            )}
          </div>

          {/* Findings cards */}
          {findingBlocks.length > 0 ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-35)' }}>
                {t('reviews.findings' as TranslationKey) || 'Findings'} ({findingBlocks.length})
              </div>
              {findingBlocks.map((f, i) => {
                const sevMatch = f.body.match(/severity[:=]?\W*(critical|high|medium|low|clean)/i);
                const fSev = sevMatch ? sevMatch[1].toLowerCase() : null;
                const fColor = severityColor(fSev);
                return (
                  <div key={i} style={{
                    padding: 18, borderRadius: 10,
                    border: `1px solid ${fColor}55`,
                    background: 'var(--panel)',
                    display: 'grid', gap: 10, minWidth: 0,
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      {fSev && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
                          padding: '3px 8px', borderRadius: 999,
                          background: `${fColor}22`, color: fColor, border: `1px solid ${fColor}55`,
                        }}>
                          {fSev}
                        </span>
                      )}
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                        {f.title}
                      </div>
                    </div>
                    <RichDescription
                      className='task-md'
                      style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-78)' }}
                      html={f.body}
                    />
                  </div>
                );
              })}
            </div>
          ) : review.output ? (
            <div style={{
              padding: 18, borderRadius: 10,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
              display: 'grid', gap: 10, minWidth: 0,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-35)' }}>
                {t('reviews.output' as TranslationKey) || 'Reviewer output'}
              </div>
              <RichDescription
                className='task-md'
                style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-78)' }}
                html={review.output}
              />
            </div>
          ) : null}

          {review.error_message && (
            <div style={{
              padding: 14, borderRadius: 10,
              border: '1px solid #cf5b57',
              background: 'var(--panel-alt)',
              color: '#cf5b57', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'auto', maxWidth: '100%',
            }}>
              {review.error_message}
            </div>
          )}

          {review.input_snapshot && (
            <details style={{
              padding: 14, borderRadius: 10,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)', minWidth: 0,
            }}>
              <summary style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-35)', cursor: 'pointer' }}>
                {t('reviews.inputSnapshot' as TranslationKey) || 'Input snapshot'}
              </summary>
              <pre style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-72)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', overflowX: 'auto', maxWidth: '100%', fontFamily: 'monospace' }}>
                {review.input_snapshot}
              </pre>
            </details>
          )}
        </>
      )}

      {confirmingDelete && typeof document !== 'undefined' && createPortal(
        // Portal so the overlay attaches to <body> directly — otherwise
        // a parent with `transform` / `filter` would scope the
        // position:fixed coordinates to itself and the modal would land
        // somewhere down the page instead of dead-center on the
        // viewport.
        <div onClick={() => !deleting && setConfirmingDelete(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(420px, calc(100vw - 24px))', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--panel-border-2)', padding: 24, display: 'grid', gap: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--panel-alt)', border: '1px solid #cf5b57', color: '#cf5b57', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><NavIcon name="alert" size={26} /></div>
            <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 700, color: 'var(--ink-90)' }}>
              {t('reviews.deleteConfirm' as TranslationKey) || 'Delete this review?'}
            </div>
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-50)', lineHeight: 1.5 }}>
              {t('reviews.deleteDesc' as TranslationKey) || 'This permanently removes the review and its findings. The task itself is not affected.'}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 4 }}>
              <button onClick={() => setConfirmingDelete(false)} disabled={deleting}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-50)', fontWeight: 600, fontSize: 13, cursor: deleting ? 'wait' : 'pointer' }}>
                {t('tasks.cancel' as TranslationKey) || 'Cancel'}
              </button>
              <button onClick={() => void handleDelete()} disabled={deleting}
                style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#cf5b57', color: '#fff', fontWeight: 700, fontSize: 13, cursor: deleting ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <NavIcon name={deleting ? 'clock' : 'close'} size={14} /> {t('reviews.delete' as TranslationKey) || 'Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent || 'var(--ink-90)', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}
