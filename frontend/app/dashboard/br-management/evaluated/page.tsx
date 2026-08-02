'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type Check = { section: string; status: 'ok' | 'partial' | 'missing'; note?: string };
type Question = { id: string; text: string; section?: string; examples?: string[] };
type PackSection = { title: string; critical: boolean };
type BreakdownItem = {
  type: string; title: string; description?: string;
  azure_id?: string | null; children?: BreakdownItem[];
};
type Eval = {
  id: number;
  source: string;
  external_id: string;
  assignee_email?: string | null;
  title?: string | null;
  br_type?: string | null;
  readiness_score?: number | null;
  verdict?: string | null;
  reasoning?: string | null;
  checklist?: Check[] | null;
  questions?: Question[] | null;
  answers?: Record<string, string> | null;
  status: string;
  state?: string | null;
  pack_key?: string | null;
  breakdown?: BreakdownItem[] | null;
  breakdown_created_at?: string | null;
  evaluated_at?: string | null;
  pushed_to_source_at?: string | null;
};

const STATUS = {
  ok: { color: '#3f9d6a', key: 'br.intake.secOk' },
  partial: { color: '#d99a2b', key: 'br.intake.secPartial' },
  missing: { color: '#cf5b57', key: 'br.intake.secMissing' },
} as const;

const VERDICT_COLOR: Record<string, string> = {
  ready: '#3f9d6a', needs_info: '#d99a2b', not_br: '#94a3b8',
};

const FILTERS = [
  { key: 'all', label: 'br.evaluated.filterAll' },
  { key: 'needs_info', label: 'br.verdict.needs_info' },
  { key: 'ready', label: 'br.verdict.ready' },
  { key: 'epic', label: 'br.type.epic' },
  { key: 'improvement', label: 'br.type.improvement' },
  { key: 'not_br', label: 'br.type.not_br' },
] as const;

/** Depth-first walk so the tree renders as indented rows. */
function flattenBreakdown(
  items: BreakdownItem[] | null | undefined, depth = 0,
): { item: BreakdownItem; depth: number }[] {
  const out: { item: BreakdownItem; depth: number }[] = [];
  for (const item of items || []) {
    out.push({ item, depth });
    out.push(...flattenBreakdown(item.children, depth + 1));
  }
  return out;
}

const scoreColor = (s: number) => (s >= 70 ? '#3f9d6a' : s >= 40 ? '#d99a2b' : '#cf5b57');
const norm = (s: string) =>
  (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/^\s*\d+\s*/, '').trim();

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)',
  color: 'var(--ink-90)', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};

export default function BREvaluatedPage() {
  const { t } = useLocale();
  const [rows, setRows] = useState<Eval[]>([]);
  const [packSections, setPackSections] = useState<PackSection[]>([]);
  const [azureBase, setAzureBase] = useState('');
  const [azureProject, setAzureProject] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<'push' | 'reeval' | 'status' | 'propose' | 'create' | null>(null);
  const [azureProjects, setAzureProjects] = useState<string[]>([]);
  const [bdProject, setBdProject] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [initialThreshold, setInitialThreshold] = useState(70);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const list = await apiFetch<Eval[]>('/br-management/evals');
      setRows(list);
      return list;
    } catch { return []; }
  }, []);

  useEffect(() => {
    const run = async () => {
      const list = await load();
      setActiveId((prev) => prev ?? (list[0]?.id ?? null));
      try {
        const s = await apiFetch<{
          decision_pack_sections?: PackSection[];
          azure_base_url?: string | null; azure_project?: string | null;
          submit_threshold?: number;
        }>('/br-management/settings');
        setPackSections(s.decision_pack_sections || []);
        setAzureBase((s.azure_base_url || '').replace(/\/+$/, ''));
        setAzureProject(s.azure_project || '');
        setBdProject(s.azure_project || '');
        if (s.submit_threshold) setInitialThreshold(s.submit_threshold);
      } catch { /* the document still renders from the checklist alone */ }
      setLoading(false);
    };
    void run();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === 'ready' || filter === 'needs_info') return r.verdict === filter;
        if (filter === 'epic' || filter === 'improvement' || filter === 'not_br') return r.br_type === filter;
        return true;
      })
      .filter((r) => !q || ((r.title || '') + ' ' + (r.assignee_email || '') + ' ' + r.external_id)
        .toLowerCase().includes(q))
      .sort((a, b) => {
        // Settled work sinks; among the live ones, the weakest request needs
        // attention first.
        const settled = Number(['accepted', 'rejected'].includes(a.status))
          - Number(['accepted', 'rejected'].includes(b.status));
        if (settled) return settled;
        return (a.readiness_score ?? 101) - (b.readiness_score ?? 101);
      });
  }, [rows, filter, search]);

  const active = useMemo(
    () => filtered.find((r) => r.id === activeId) || filtered[0] || null,
    [filtered, activeId],
  );

  useEffect(() => { setDraft({}); }, [active?.id]);

  const counts = useMemo(() => ({
    all: rows.length,
    ready: rows.filter((r) => r.verdict === 'ready').length,
    needs_info: rows.filter((r) => r.verdict === 'needs_info').length,
    epic: rows.filter((r) => r.br_type === 'epic').length,
    improvement: rows.filter((r) => r.br_type === 'improvement').length,
    not_br: rows.filter((r) => r.br_type === 'not_br').length,
  }), [rows]);

  /** The evaluation as a document: one row per section, question in place. */
  const docRows = useMemo(() => {
    if (!active) return [];
    const checklist = active.checklist || [];
    const base = checklist.length
      ? checklist
      : packSections.map((s) => ({ section: s.title, status: 'missing' as const, note: '' }));
    const used = new Set<string>();
    return base.map((c) => {
      const key = norm(c.section);
      const question = (active.questions || []).find((q) => {
        if (used.has(q.id)) return false;
        const qs = norm(q.section || '');
        if (!qs || !key) return false;
        if (qs.includes(key) || key.includes(qs)) { used.add(q.id); return true; }
        return false;
      });
      const critical = packSections.find((s) => norm(s.title) === key)?.critical ?? false;
      return { ...c, critical, question };
    });
  }, [active, packSections]);

  const orphanQuestions = useMemo(() => {
    if (!active) return [];
    const placed = new Set(docRows.map((r) => r.question?.id).filter(Boolean));
    return (active.questions || []).filter((q) => !placed.has(q.id));
  }, [active, docRows]);

  const gapCount = docRows.filter((r) => r.status !== 'ok').length;
  const flatBreakdown = useMemo(() => flattenBreakdown(active?.breakdown), [active?.breakdown]);
  const pendingBreakdown = flatBreakdown.filter((n) => !n.item.azure_id).length;
  const answered = Object.values(draft).filter((v) => v.trim()).length;

  const patch = (next: Eval) => setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)));

  const reevaluate = async () => {
    if (!active) return;
    setBusy('reeval');
    try {
      patch(await apiFetch<Eval>(`/br-management/evals/${active.id}/reevaluate`, {
        method: 'POST',
        body: JSON.stringify({ answers: { ...(active.answers || {}), ...draft } }),
        signal: AbortSignal.timeout(240_000),
      }));
      setDraft({});
      flash(t('br.evaluated.reevaluated'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally { setBusy(null); }
  };

  const push = async () => {
    if (!active) return;
    setBusy('push');
    try {
      patch(await apiFetch<Eval>(`/br-management/evals/${active.id}/push-source`, { method: 'POST' }));
      flash(t('br.pushed'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally { setBusy(null); }
  };

  const proposeBreakdown = async () => {
    if (!active) return;
    setBusy('propose');
    try {
      patch(await apiFetch<Eval>(`/br-management/evals/${active.id}/breakdown`, {
        method: 'POST', signal: AbortSignal.timeout(240_000),
      }));
      if (!azureProjects.length) {
        try {
          const list = await apiFetch<{ id: string; name: string }[]>('/br-management/azure/projects');
          setAzureProjects(list.map((x) => x.name));
        } catch { /* free-text project input still works */ }
      }
      flash(t('br.breakdown.proposed'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally { setBusy(null); }
  };

  const createBreakdown = async () => {
    if (!active || !bdProject.trim()) return;
    setBusy('create');
    try {
      patch(await apiFetch<Eval>(`/br-management/evals/${active.id}/breakdown/create`, {
        method: 'POST',
        body: JSON.stringify({ project: bdProject.trim() }),
        signal: AbortSignal.timeout(180_000),
      }));
      flash(t('br.breakdown.created'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally { setBusy(null); }
  };

  const setStatus = async (status: 'accepted' | 'rejected') => {
    if (!active) return;
    setBusy('status');
    try {
      patch(await apiFetch<Eval>(`/br-management/evals/${active.id}/status`, {
        method: 'PUT', body: JSON.stringify({ status }),
      }));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally { setBusy(null); }
  };

  const azureUrl = (r: Eval) =>
    (azureBase && azureProject ? `${azureBase}/${azureProject}/_workitems/edit/${r.external_id}` : '');

  if (loading) {
    return <div style={{ color: 'var(--ink-30)', fontSize: 14, padding: '40px 0' }}>{t('br.loading')}</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 14, height: 'calc(100vh - 130px)', minHeight: 560 }}>
      <div>
        <div className="section-label">{t('br.sectionLabel')}</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 2 }}>
          {t('br.evaluated.title')}
        </h1>
        <p style={{ color: 'var(--ink-35)', fontSize: 13.5, margin: 0 }}>{t('br.evaluated.subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <div className="brecard" style={{
          borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)',
          display: 'grid', placeContent: 'center', gap: 8, textAlign: 'center', padding: 40,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-90)' }}>{t('br.evaluated.emptyTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-35)', lineHeight: 1.65, maxWidth: 460 }}>
            {t('br.evaluated.emptyHint')}
          </div>
          <a href="/dashboard/br-management" className="breghost" style={{ justifySelf: 'center', textDecoration: 'none' }}>
            {t('br.evaluated.goQueue')}
          </a>
        </div>
      ) : (
        <div className="brewrap" style={{ display: 'grid', gridTemplateColumns: '312px minmax(0, 1fr)', gap: 14, minHeight: 0 }}>

          {/* ── The list ───────────────────────────────────── */}
          <div className="brecard" style={{
            display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 16,
            border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden',
          }}>
            <div style={{ padding: 12, display: 'grid', gap: 9, borderBottom: '1px solid var(--panel-border)' }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('br.searchPlaceholder')} style={inputStyle} />
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {FILTERS.map((f) => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={filter === f.key ? 'brechip brechip-on' : 'brechip'}>
                    {t(f.label)} {counts[f.key as keyof typeof counts]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 6, display: 'grid', gap: 3, alignContent: 'start' }}>
              {filtered.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-30)' }}>{t('br.evaluated.noMatch')}</div>
              )}
              {filtered.map((r) => {
                const settled = ['accepted', 'rejected'].includes(r.status);
                return (
                  <button key={r.id} onClick={() => setActiveId(r.id)}
                    className={active?.id === r.id ? 'breitem breitem-on' : 'breitem'}
                    style={{ opacity: settled ? 0.6 : 1 }}>
                    <span style={{
                      fontSize: 15, fontWeight: 800, minWidth: 26, textAlign: 'right',
                      color: r.readiness_score != null ? scoreColor(r.readiness_score) : 'var(--ink-25)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{r.readiness_score ?? '—'}</span>
                    <span style={{ minWidth: 0, display: 'grid', gap: 2, textAlign: 'start' }}>
                      <span style={{
                        fontSize: 12.5, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.title || '#' + r.external_id}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-35)', display: 'flex', gap: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.assignee_email || '—'}
                        </span>
                        {r.verdict && (
                          <span style={{ color: VERDICT_COLOR[r.verdict], fontWeight: 700, flexShrink: 0 }}>
                            {t(('br.verdict.' + r.verdict) as 'br.verdict.ready')}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── The evaluation, as the document it judges ──── */}
          <div className="brecard" style={{
            display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRadius: 16,
            border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden',
          }}>
            {active && (
              <>
                <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                      <span style={{
                        fontSize: 30, fontWeight: 800, lineHeight: 0.95, letterSpacing: -1,
                        color: active.readiness_score != null ? scoreColor(active.readiness_score) : 'var(--ink-25)',
                      }}>{active.readiness_score ?? '—'}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-30)', fontWeight: 700 }}>/ 100</span>
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.4 }}>
                        {active.title || '#' + active.external_id}
                      </span>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-35)' }}>
                        <span>#{active.external_id}</span>
                        <span>{active.assignee_email || '—'}</span>
                        {active.br_type && (
                          <span className="brechip brechip-on" style={{ cursor: 'default' }}>
                            {active.br_type === 'epic' ? t('br.type.epic')
                              : active.br_type === 'improvement' ? t('br.type.improvement')
                                : t('br.type.not_br')}
                          </span>
                        )}
                        <span style={{ color: 'var(--ink-45)' }}>
                          {t('br.evaluated.gaps', { count: gapCount })}
                        </span>
                        {azureUrl(active) && (
                          <a href={azureUrl(active)} target="_blank" rel="noreferrer"
                            style={{ color: 'var(--acc)', fontWeight: 700, textDecoration: 'none' }}>
                            {t('br.openInAzure')} ↗
                          </a>
                        )}
                      </span>
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                    <button onClick={() => void reevaluate()} disabled={busy !== null} className="brebtn-acc">
                      <NavIcon name="zap" size={13} />
                      {busy === 'reeval' ? t('br.evaluating')
                        : answered ? t('br.evaluated.reevalWith', { count: answered })
                          : t('br.reEvaluate')}
                    </button>
                    <button onClick={() => void push()} disabled={busy !== null} className="breghost"
                      title={active.pushed_to_source_at
                        ? t('br.pushedAt', { date: new Date(active.pushed_to_source_at + 'Z').toLocaleString() })
                        : ''}>
                      <NavIcon name="send" size={13} />
                      {busy === 'push' ? t('br.pushing') : t('br.push')}
                    </button>
                    <span style={{ flex: 1 }} />
                    <button onClick={() => void setStatus('accepted')} disabled={busy !== null}
                      className={active.status === 'accepted' ? 'breghost breghost-ok' : 'breghost'}>
                      {active.status === 'accepted' ? '✓ ' + t('br.accepted') : t('br.accept')}
                    </button>
                    <button onClick={() => void setStatus('rejected')} disabled={busy !== null}
                      className={active.status === 'rejected' ? 'breghost breghost-no' : 'breghost'}>
                      {active.status === 'rejected' ? '✕ ' + t('br.rejected') : t('br.reject')}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 24px 24px' }}>
                    {active.reasoning && (
                      <p style={{
                        margin: '0 0 18px', padding: '12px 14px', borderRadius: 11,
                        background: 'var(--panel-alt)', borderInlineStart: '2px solid var(--acc)',
                        fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-72)',
                      }}>{active.reasoning}</p>
                    )}

                    <div style={{ display: 'grid', gap: 2 }}>
                      {docRows.map((row, i) => {
                        const meta = STATUS[row.status] || STATUS.missing;
                        return (
                          <section key={i} className="bresec" style={{
                            display: 'grid', gridTemplateColumns: '28px 1fr', gap: 12,
                            padding: '12px 12px 12px 4px', borderRadius: 10,
                            background: row.question ? 'var(--panel-alt)' : 'transparent',
                          }}>
                            <span style={{
                              fontSize: 12, fontWeight: 700, color: 'var(--ink-25)', textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums', paddingTop: 1,
                            }}>{i + 1}</span>
                            <div style={{ minWidth: 0, display: 'grid', gap: 7 }}>
                              <div style={{ display: 'flex', gap: 9, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.45 }}>
                                  {row.section.split('(')[0].trim()}
                                </span>
                                {row.critical && (
                                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--warn)', letterSpacing: 0.4 }}>
                                    {t('br.intake.secCritical')}
                                  </span>
                                )}
                                <span style={{
                                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
                                  color: meta.color, marginInlineStart: 'auto',
                                }}>{t(meta.key)}</span>
                              </div>
                              {row.note && (
                                <p style={{
                                  margin: 0, fontSize: 12.5, lineHeight: 1.7,
                                  color: row.status === 'ok' ? 'var(--ink-72)' : 'var(--ink-58)',
                                }}>{row.note}</p>
                              )}
                              {row.question && (
                                <div className="breqbox">
                                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.55 }}>
                                    {row.question.text}
                                  </div>
                                  {!!row.question.examples?.length && (
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                      {row.question.examples.map((ex) => (
                                        <button key={ex} type="button"
                                          onClick={() => setDraft((s) => ({ ...s, [row.question!.id]: ex }))}
                                          className={draft[row.question!.id] === ex ? 'brechip brechip-on' : 'brechip'}>
                                          {ex}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <textarea rows={2} value={draft[row.question.id] || active.answers?.[row.question.id] || ''}
                                    onChange={(e) => setDraft((s) => ({ ...s, [row.question!.id]: e.target.value }))}
                                    placeholder={t('br.answerPlaceholder')}
                                    style={{ ...inputStyle, background: 'var(--panel)', resize: 'vertical', lineHeight: 1.6 }} />
                                </div>
                              )}
                            </div>
                          </section>
                        );
                      })}
                    </div>

                    {orphanQuestions.length > 0 && (
                      <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                        <div style={{
                          fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7,
                          textTransform: 'uppercase', color: 'var(--ink-30)',
                        }}>{t('br.intake.questionsTitle')}</div>
                        {orphanQuestions.map((q) => (
                          <div key={q.id} className="breqbox">
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.55 }}>{q.text}</div>
                            <textarea rows={2} value={draft[q.id] || active.answers?.[q.id] || ''}
                              onChange={(e) => setDraft((s) => ({ ...s, [q.id]: e.target.value }))}
                              placeholder={t('br.answerPlaceholder')}
                              style={{ ...inputStyle, background: 'var(--panel)', resize: 'vertical', lineHeight: 1.6 }} />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Delivery breakdown ───────────────────── */}
                    <div style={{ marginTop: 26, paddingTop: 20, borderTop: '1px solid var(--panel-border)', display: 'grid', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7,
                          textTransform: 'uppercase', color: 'var(--ink-30)',
                        }}>{t('br.breakdown.title')}</span>
                        {active.breakdown_created_at && (
                          <span style={{ fontSize: 11, color: '#3f9d6a', fontWeight: 700 }}>
                            {t('br.breakdown.inAzure')}
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        <button onClick={() => void proposeBreakdown()} disabled={busy !== null}
                          className={active.breakdown?.length ? 'breghost' : 'brebtn-acc'}>
                          <NavIcon name="layers" size={13} />
                          {busy === 'propose' ? t('br.breakdown.proposing')
                            : active.breakdown?.length ? t('br.breakdown.repropose') : t('br.breakdown.propose')}
                        </button>
                      </div>

                      {!active.breakdown?.length ? (
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-35)', lineHeight: 1.65 }}>
                          {t('br.breakdown.hint', { score: initialThreshold })}
                        </p>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gap: 4 }}>
                            {flattenBreakdown(active.breakdown).map((n, i) => (
                              <div key={i} style={{
                                display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 9,
                                alignItems: 'baseline', padding: '8px 10px', borderRadius: 9,
                                marginInlineStart: n.depth * 20,
                                background: 'var(--panel-alt)',
                                border: '1px solid ' + (n.item.azure_id ? 'color-mix(in srgb, #3f9d6a 40%, transparent)' : 'var(--panel-border-2)'),
                              }}>
                                <span className="brechip" style={{ cursor: 'default' }}>{n.item.type}</span>
                                <span style={{ minWidth: 0 }}>
                                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.45 }}>
                                    {n.item.title}
                                  </span>
                                  {n.item.description && (
                                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-45)', lineHeight: 1.6, marginTop: 2 }}>
                                      {n.item.description}
                                    </span>
                                  )}
                                </span>
                                {n.item.azure_id && (
                                  azureBase && bdProject ? (
                                    <a href={`${azureBase}/${bdProject}/_workitems/edit/${n.item.azure_id}`}
                                      target="_blank" rel="noreferrer"
                                      style={{ fontSize: 11, fontWeight: 700, color: 'var(--acc)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                      #{n.item.azure_id} ↗
                                    </a>
                                  ) : (
                                    <span style={{ fontSize: 11, fontWeight: 700, color: '#3f9d6a', whiteSpace: 'nowrap' }}>
                                      #{n.item.azure_id}
                                    </span>
                                  )
                                )}
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input value={bdProject} onChange={(e) => setBdProject(e.target.value)}
                              list="bre-azure-projects" placeholder={t('br.settings.azureProjectPlaceholder')}
                              style={{ ...inputStyle, width: 190 }} />
                            <datalist id="bre-azure-projects">
                              {azureProjects.map((x) => <option key={x} value={x} />)}
                            </datalist>
                            <button onClick={() => void createBreakdown()}
                              disabled={busy !== null || !bdProject.trim() || pendingBreakdown === 0}
                              className="brebtn-acc">
                              <NavIcon name="send" size={13} />
                              {busy === 'create' ? t('br.breakdown.creating')
                                : pendingBreakdown === 0 ? t('br.breakdown.allCreated')
                                  : t('br.breakdown.create', { count: pendingBreakdown })}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {active.evaluated_at && (
                      <div style={{ marginTop: 20, fontSize: 11, color: 'var(--ink-30)' }}>
                        {t('br.evaluated.lastRun')} {new Date(active.evaluated_at + 'Z').toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, background: 'var(--surface)',
          border: '1px solid ' + (toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57'),
          color: toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57', fontSize: 13, fontWeight: 600,
          boxShadow: '0 16px 40px -20px rgba(15,23,42,.4)',
        }}>{toast.msg}</div>
      )}

      <style>{`
        .brecard { box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 16px 40px -28px rgba(15,23,42,.22); }
        .bresec { transition: background .2s ease; }
        .bresec + .bresec { border-top: 1px solid var(--panel-border); }
        .breqbox { display: grid; gap: 8px; padding: 12px; border-radius: 11px;
                   background: var(--panel); border: 1px solid var(--panel-border-3);
                   border-inline-start: 2px solid var(--acc); }
        .breitem { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center;
                   width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid transparent;
                   background: transparent; cursor: pointer; font-family: inherit;
                   transition: background .15s ease; }
        .breitem:hover { background: var(--panel-alt); }
        .breitem-on { background: var(--panel-alt); border-color: var(--panel-border-3);
                      box-shadow: inset 2px 0 0 var(--acc); }
        .brechip { padding: 4px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
                   line-height: 1.4; cursor: pointer; white-space: nowrap; font-family: inherit;
                   border: 1px solid var(--panel-border-3); background: var(--panel-alt);
                   color: var(--ink-45); transition: border-color .15s ease, color .15s ease,
                   background .15s ease; }
        .brechip:hover { border-color: var(--acc); color: var(--acc); }
        .brechip-on, .brechip-on:hover { border-color: transparent; background: var(--acc-soft); color: var(--acc); }
        .breghost { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px;
                    border-radius: 9px; font-size: 12px; font-weight: 700; font-family: inherit;
                    cursor: pointer; border: 1px solid var(--panel-border-3);
                    background: var(--panel-alt); color: var(--ink-65);
                    transition: border-color .15s ease, color .15s ease; }
        .breghost:hover:not(:disabled) { border-color: var(--acc); color: var(--acc); }
        .breghost:disabled { opacity: .5; cursor: default; }
        .breghost-ok { border-color: #3f9d6a; color: #3f9d6a; }
        .breghost-no { border-color: #cf5b57; color: #cf5b57; }
        .brebtn-acc { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px;
                      border-radius: 9px; font-size: 12px; font-weight: 700; font-family: inherit;
                      cursor: pointer; border: none; background: var(--acc); color: #fff;
                      box-shadow: 0 6px 14px -6px var(--acc);
                      transition: filter .15s ease, transform .1s ease; }
        .brebtn-acc:hover:not(:disabled) { filter: brightness(1.07); }
        .brebtn-acc:active:not(:disabled) { transform: translateY(1px); }
        .brebtn-acc:disabled { opacity: .55; cursor: default; box-shadow: none; }
        @media (max-width: 1000px) {
          .brewrap { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
