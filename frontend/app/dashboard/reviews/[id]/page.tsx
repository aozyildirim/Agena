'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import RichDescription from '@/components/RichDescription';

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
  const router = useRouter();
  const params = useParams();
  const { t } = useLocale();
  const reviewId = Number(params?.id);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retriggering, setRetriggering] = useState(false);

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

  async function rerun() {
    if (!review) return;
    setRetriggering(true);
    try {
      const fresh = await apiFetch<Review>('/reviews', {
        method: 'POST',
        body: JSON.stringify({ task_id: review.task_id, reviewer_agent_role: review.reviewer_agent_role }),
      });
      router.push(`/dashboard/reviews/${fresh.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-run failed');
    } finally {
      setRetriggering(false);
    }
  }

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
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Link href='/dashboard/reviews' style={{ fontSize: 12, color: 'var(--ink-50)', textDecoration: 'none' }}>
          ← {t('reviews.backToList' as TranslationKey) || 'All reviews'}
        </Link>
        {review?.task_id && (
          <>
            <span style={{ color: 'var(--ink-25)' }}>·</span>
            <Link href={`/tasks/${review.task_id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
              {t('reviews.openTask' as TranslationKey) || 'Open task'} #{review.task_id} →
            </Link>
          </>
        )}
      </div>

      {loading && <div style={{ color: 'var(--ink-50)', fontSize: 13 }}>{t('reviews.loading' as TranslationKey) || 'Loading…'}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{error}</div>}

      {review && (
        <>
          {/* Header card */}
          <div style={{
            padding: 22, borderRadius: 16,
            border: `1px solid ${sevColor}55`,
            background: `linear-gradient(135deg, ${sevColor}0c, transparent)`,
            display: 'grid', gap: 14,
          }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4,
                padding: '5px 12px', borderRadius: 999,
                background: `${sevColor}22`, color: sevColor, border: `1px solid ${sevColor}55`,
              }}>
                {sev || '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-50)', fontFamily: 'monospace' }}>
                #{review.id} · {review.reviewer_agent_role}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => void rerun()}
                  disabled={retriggering}
                  style={{
                    padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                    border: '1px solid rgba(168,85,247,0.4)',
                    background: 'rgba(168,85,247,0.10)',
                    color: '#c084fc',
                    cursor: retriggering ? 'wait' : 'pointer',
                  }}
                >
                  {retriggering ? '⏳' : '↻'} {t('reviews.rerun' as TranslationKey) || 'Re-run'}
                </button>
              </div>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', margin: 0, lineHeight: 1.3 }}>
              {review.task_title || `Task #${review.task_id}`}
            </h1>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
              <Stat label={t('reviews.findings' as TranslationKey) || 'Findings'} value={review.findings_count != null ? String(review.findings_count) : '—'} accent={sevColor} />
              <Stat label={t('reviews.score' as TranslationKey) || 'Score'} value={review.score != null ? `${review.score}` : '—'} accent='var(--accent)' />
              <Stat label={t('reviews.status' as TranslationKey) || 'Status'} value={review.status} accent={review.status === 'running' ? '#fde68a' : review.status === 'failed' ? '#f87171' : 'var(--ink-78)'} />
              <Stat label={t('reviews.model' as TranslationKey) || 'Model'} value={`${review.reviewer_provider || '—'} / ${review.reviewer_model || '—'}`} />
              <Stat label={t('reviews.duration' as TranslationKey) || 'Duration'} value={fmtDuration(review.created_at, review.completed_at)} />
              <Stat label={t('reviews.requestedAt' as TranslationKey) || 'Requested'} value={fmtDate(review.created_at)} />
            </div>
            {summary && (
              <div style={{
                padding: '14px 16px', borderRadius: 12,
                background: 'var(--panel-alt)',
                border: '1px solid var(--panel-border-2)',
                fontSize: 13, lineHeight: 1.6, color: 'var(--ink-78)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>
                  {t('reviews.summary' as TranslationKey) || 'Summary'}
                </div>
                <div>{summary}</div>
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
                    padding: 18, borderRadius: 14,
                    border: `1px solid ${fColor}55`,
                    background: 'var(--panel)',
                    display: 'grid', gap: 10,
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
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>
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
              padding: 18, borderRadius: 14,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
              display: 'grid', gap: 10,
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
              padding: 14, borderRadius: 12,
              border: '1px solid rgba(248,113,113,0.3)',
              background: 'rgba(248,113,113,0.06)',
              color: '#fca5a5', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
            }}>
              {review.error_message}
            </div>
          )}

          {review.input_snapshot && (
            <details style={{
              padding: 14, borderRadius: 12,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
            }}>
              <summary style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-35)', cursor: 'pointer' }}>
                {t('reviews.inputSnapshot' as TranslationKey) || 'Input snapshot'}
              </summary>
              <pre style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-72)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                {review.input_snapshot}
              </pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent || 'var(--ink-90)' }}>{value}</div>
    </div>
  );
}
