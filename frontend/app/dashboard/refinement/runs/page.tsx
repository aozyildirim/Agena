'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

// ── Types ───────────────────────────────────────────────────────────────

type RecordPhase = 'analysis' | 'writeback';
type RecordStatus = 'completed' | 'failed' | string;

interface RefinementHistoryItem {
  id: number;
  provider: string;
  external_item_id: string;
  sprint_name: string | null;
  item_title: string | null;
  item_url: string | null;
  phase: RecordPhase;
  status: RecordStatus;
  suggested_story_points: number | null;
  confidence: number | null;
  summary: string | null;
  estimation_rationale: string | null;
  comment: string | null;
  error_message: string | null;
  created_at: string;
}

interface RefinementHistoryResponse {
  items: RefinementHistoryItem[];
  total: number;
  page: number;
  page_size: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function PhaseBadge({ phase, status }: { phase: RecordPhase; status: RecordStatus }) {
  const failed = status === 'failed';
  const isWb = phase === 'writeback';
  const color = failed ? '#fca5a5' : isWb ? '#86efac' : '#7dd3fc';
  const bg = failed ? 'rgba(239,68,68,0.12)' : isWb ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)';
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
      background: bg, color, textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {failed ? 'failed' : phase}
    </span>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function RefinementRunsPage() {
  const { lang, t } = useLocale();
  const [items, setItems] = useState<RefinementHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSprint, setActiveSprint] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Backend caps page_size at 50. Walk pages until we've fetched
      // them all (or hit a 1000-row safety net — keeps the UI from
      // hanging on a runaway dataset).
      const pageSize = 50;
      const pageCap = 20;
      let acc: RefinementHistoryItem[] = [];
      let totalSeen = 0;
      for (let p = 1; p <= pageCap; p += 1) {
        const data = await apiFetch<RefinementHistoryResponse>(
          `/refinement/history?page=${p}&page_size=${pageSize}`,
        );
        const batch = data.items || [];
        acc = acc.concat(batch);
        totalSeen = data.total || acc.length;
        if (batch.length < pageSize || acc.length >= totalSeen) break;
      }
      setItems(acc);
      setTotal(totalSeen);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Group by sprint_name. Records without a sprint go into "Bilinmiyor".
  const sprintGroups = useMemo(() => {
    const map = new Map<string, RefinementHistoryItem[]>();
    for (const it of items) {
      const key = (it.sprint_name || '').trim() || t('refinement.runs.pickSprint' as Parameters<typeof t>[0]);
      const arr = map.get(key) || [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([sprint, recs]) => ({
        sprint,
        records: recs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
        latest: recs[0]?.created_at || '',
      }))
      .sort((a, b) => (b.latest || '').localeCompare(a.latest || ''));
  }, [items, lang]);

  // Auto-select the first sprint when loading lands.
  useEffect(() => {
    if (!activeSprint && sprintGroups.length > 0) {
      setActiveSprint(sprintGroups[0].sprint);
    }
  }, [sprintGroups, activeSprint]);

  const activeRecords = useMemo(() => {
    return sprintGroups.find((g) => g.sprint === activeSprint)?.records || [];
  }, [sprintGroups, activeSprint]);

  const deleteComment = useCallback(async (rec: RefinementHistoryItem) => {
    const sigGuess = 'AGENA AI';
    setDeleting(rec.id);
    try {
      const resp = await apiFetch<{ deleted: number }>('/refinement/delete-comment', {
        method: 'POST',
        body: JSON.stringify({
          provider: rec.provider,
          work_item_id: rec.external_item_id,
          signature: sigGuess,
          // For Azure, project comes from sprint_path (org/project/iteration). Best-effort:
          // pull from item_url or fall back to current azure project setting later. Here we
          // try to extract from item_url.
          project: extractProject(rec.item_url || '') || undefined,
        }),
      });
      setToast('✓ ' + t('refinement.commentsDeletedToast' as Parameters<typeof t>[0]).replace('{count}', String(resp.deleted)));
      setTimeout(() => setToast(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }, [lang]);

  // Delete the refinement RECORD from history (so the item can be re-refined).
  // This does NOT remove the Azure/Jira comment — that's deleteComment above.
  const deleteRecord = useCallback(async (rec: RefinementHistoryItem) => {
    setDeleting(rec.id);
    try {
      await apiFetch(`/refinement/records/${rec.id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((r) => r.id !== rec.id));
      setTotal((tt) => Math.max(0, tt - 1));
      // Tombstone: tell the Refinement page to drop this item's cached
      // suggestion badge (its localStorage snapshot is independent of the
      // server record we just deleted).
      try {
        if (typeof window !== 'undefined' && rec.external_item_id) {
          const TK = 'refinement:deleted-items';
          const prev: string[] = JSON.parse(localStorage.getItem(TK) || '[]');
          const next = Array.from(new Set([...prev, String(rec.external_item_id)])).slice(-200);
          localStorage.setItem(TK, JSON.stringify(next));
        }
      } catch { /* non-fatal */ }
      setToast('✓ ' + t('refinement.runs.recordDeletedToast' as Parameters<typeof t>[0]));
      setTimeout(() => setToast(''), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }, [lang]);

  // Open the in-app confirm modal (no native window.confirm).
  const askDelete = useCallback((kind: 'comment' | 'record', rec: RefinementHistoryItem) => {
    if (kind === 'comment') {
      setConfirmState({
        title: t('refinement.deleteCommentTitle' as Parameters<typeof t>[0]),
        message: t('refinement.runs.deleteConfirm' as Parameters<typeof t>[0]).replace('{signature}', 'AGENA AI').replace('{itemId}', rec.external_item_id),
        confirmLabel: t('refinement.deleteCommentTitle' as Parameters<typeof t>[0]),
        onConfirm: () => { setConfirmState(null); void deleteComment(rec); },
      });
    } else {
      setConfirmState({
        title: t('refinement.runs.deleteRecord' as Parameters<typeof t>[0]),
        message: t('refinement.runs.deleteRecordConfirm' as Parameters<typeof t>[0]).replace('{itemId}', rec.external_item_id),
        confirmLabel: t('refinement.runs.deleteRecord' as Parameters<typeof t>[0]),
        onConfirm: () => { setConfirmState(null); void deleteRecord(rec); },
      });
    }
  }, [deleteComment, deleteRecord, t]);

  return (
    <div>
      {/* Header */}
      <div style={{
        marginBottom: 20, display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Link href='/dashboard/refinement' style={{ fontSize: 12, color: 'var(--ink-50)', textDecoration: 'none' }}>
              ← Refinement
            </Link>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
            {t('refinement.runs.title' as Parameters<typeof t>[0])}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            {t('refinement.runs.subtitle' as Parameters<typeof t>[0]).replace('{total}', String(total))}
          </p>
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {toast && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)',
          color: '#86efac', fontSize: 13,
        }}>
          {toast}
        </div>
      )}

      {/* Two-pane layout */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr',
        gap: 14, alignItems: 'flex-start',
      }}>
        {/* Sidebar — sprint groups */}
        <aside style={{
          borderRadius: 14, border: '1px solid var(--panel-border-2)',
          background: 'var(--panel)', overflow: 'hidden',
          position: 'sticky', top: 14,
        }}>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--panel-border)',
            fontSize: 11, fontWeight: 700, color: 'var(--ink-50)',
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>
            Sprintler · {sprintGroups.length}
          </div>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>...</div>
          ) : sprintGroups.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
              {t('refinement.runs.noRuns' as Parameters<typeof t>[0])}
            </div>
          ) : (
            <div>
              {sprintGroups.map((g) => {
                const active = g.sprint === activeSprint;
                const wbCount = g.records.filter((r) => r.phase === 'writeback').length;
                return (
                  <button
                    key={g.sprint}
                    type='button'
                    onClick={() => setActiveSprint(g.sprint)}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '10px 14px', border: 'none', cursor: 'pointer',
                      background: active ? 'rgba(94,234,212,0.08)' : 'transparent',
                      borderLeft: active ? '3px solid #5eead4' : '3px solid transparent',
                      borderBottom: '1px solid var(--panel-border)',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: active ? 'var(--ink)' : 'var(--ink-78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.sprint}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--ink-50)' }}>
                      <span>{g.records.length} run</span>
                      {wbCount > 0 && <span style={{ color: '#86efac' }}>· {wbCount} written</span>}
                      <span style={{ marginLeft: 'auto' }}>{formatDate(g.latest)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Main pane — records of selected sprint */}
        <main style={{
          borderRadius: 14, border: '1px solid var(--panel-border-2)',
          background: 'var(--panel)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--panel-border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              {activeSprint || t('refinement.runs.pickSprint' as Parameters<typeof t>[0])}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {activeRecords.length} {t('refinement.runs.records' as Parameters<typeof t>[0])}
            </div>
          </div>

          {!activeSprint ? (
            <div style={{ padding: 32, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
              {t('refinement.runs.pickSprint' as Parameters<typeof t>[0])}
            </div>
          ) : activeRecords.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
              {t('refinement.runs.noRecords' as Parameters<typeof t>[0])}
            </div>
          ) : (
            <div>
              {activeRecords.map((rec) => (
                <RecordRow
                  key={rec.id}
                  record={rec}
                  onDelete={() => askDelete('comment', rec)}
                  onDeleteRecord={() => askDelete('record', rec)}
                  deleting={deleting === rec.id}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* In-app confirm modal (replaces native window.confirm) */}
      {confirmState && (
        <div
          onClick={() => setConfirmState(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(460px, calc(100vw - 32px))', background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', fontSize: 15, fontWeight: 700, color: 'var(--ink-90)' }}>
              {confirmState.title}
            </div>
            <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--ink-72)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {confirmState.message}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type='button' onClick={() => setConfirmState(null)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-65)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {t('integrations.common.cancel' as Parameters<typeof t>[0]) || 'Cancel'}
              </button>
              <button type='button' onClick={confirmState.onConfirm}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#cf5b57', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordRow({
  record, onDelete, onDeleteRecord, deleting,
}: {
  record: RefinementHistoryItem;
  onDelete: () => void;
  onDeleteRecord: () => void;
  deleting: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const isWb = record.phase === 'writeback';

  return (
    <div style={{
      borderBottom: '1px solid var(--panel-border)',
      transition: 'background 0.1s',
    }}>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left',
          padding: '12px 16px', border: 'none', cursor: 'pointer',
          background: open ? 'var(--panel-alt)' : 'transparent',
          display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 10, alignItems: 'center',
        }}
      >
        <PhaseBadge phase={record.phase} status={record.status} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            #{record.external_item_id} {record.item_title || ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {formatDate(record.created_at)}
            {record.suggested_story_points != null && record.suggested_story_points > 0 && (
              <span style={{ color: '#5eead4', fontWeight: 700, marginLeft: 8 }}>
                {record.suggested_story_points} pts
              </span>
            )}
            {record.confidence != null && record.confidence > 0 && (
              <span style={{ marginLeft: 8 }}>{record.confidence}%</span>
            )}
          </div>
        </div>
        {record.item_url && (
          <a
            href={record.item_url}
            target='_blank'
            rel='noreferrer'
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
          >
            {t('refinement.runs.openItem' as Parameters<typeof t>[0])} ↗
          </a>
        )}
        <span style={{
          fontSize: 11, color: 'var(--ink-42)',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s',
        }}>▶</span>
      </button>

      {open && (
        <div style={{
          padding: '12px 16px 16px', background: 'var(--panel-alt)',
          borderTop: '1px solid var(--panel-border)', display: 'grid', gap: 10,
        }}>
          {record.error_message && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 12,
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
            }}>
              <strong style={{ marginRight: 6 }}>{t('refinement.runs.error' as Parameters<typeof t>[0])}:</strong>
              {record.error_message}
            </div>
          )}
          {record.summary && (
            <Section label={t('refinement.runs.section.summary' as Parameters<typeof t>[0])} text={record.summary} />
          )}
          {record.estimation_rationale && (
            <Section label={t('refinement.runs.section.rationale' as Parameters<typeof t>[0])} text={record.estimation_rationale} />
          )}
          {record.comment && (
            <Section label={t('refinement.runs.section.comment' as Parameters<typeof t>[0])} text={record.comment} mono />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            {isWb && record.status === 'completed' && (
              <button
                type='button'
                onClick={onDelete}
                disabled={deleting}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: '1px solid rgba(207,91,87,0.4)', cursor: deleting ? 'wait' : 'pointer',
                  background: 'rgba(207,91,87,0.08)', color: '#cf5b57',
                }}
              >
                {deleting ? '...' : `🗑 ${t('refinement.deleteCommentTitle' as Parameters<typeof t>[0])}`}
              </button>
            )}
            <button
              type='button'
              onClick={onDeleteRecord}
              disabled={deleting}
              title={t('refinement.runs.deleteRecordTitle' as Parameters<typeof t>[0])}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                border: '1px solid var(--panel-border-3)', cursor: deleting ? 'wait' : 'pointer',
                background: 'transparent', color: 'var(--ink-58)',
              }}
            >
              {deleting ? '...' : `🗑 ${t('refinement.runs.deleteRecord' as Parameters<typeof t>[0])}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, text, mono }: { label: string; text: string; mono?: boolean }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--ink-50)',
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 13, color: 'var(--ink-80)', whiteSpace: 'pre-wrap',
        lineHeight: 1.5,
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      }}>
        {text}
      </div>
    </div>
  );
}

function extractProject(itemUrl: string): string {
  // Azure work item URLs look like:
  //   https://dev.azure.com/{org}/{project}/_workitems/edit/12345
  // Pull the segment between the org and "_workitems".
  try {
    const u = new URL(itemUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('_workitems');
    if (idx > 1) return decodeURIComponent(parts[idx - 1]);
  } catch { /* not a parsable URL */ }
  return '';
}
