'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiFetch, apiUpload } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type Question = { id: string; text: string; section?: string; examples?: string[] };
type Msg = { role: 'user' | 'assistant'; text: string; ts?: string; questions?: Question[] };
type Check = { section: string; status: 'ok' | 'partial' | 'missing'; note?: string };
type PackSection = { title: string; critical: boolean };
type Attachment = {
  id: number; filename: string; content_type: string;
  size_bytes: number; azure_url?: string | null;
};
type Intake = {
  id: number;
  title: string | null;
  status: 'draft' | 'submitted';
  messages: Msg[];
  checklist: Check[] | null;
  pack_markdown: string | null;
  br_type: string | null;
  readiness_score: number | null;
  azure_work_item_id: string | null;
  azure_url: string | null;
  submit_threshold: number;
  updated_at: string | null;
};

const WORK_ITEM_TYPES = ['Product Backlog Item', 'User Story', 'Feature', 'Epic', 'Task'];

const LS_SPLIT = 'br_intake_split';   // conversation width, % of the workspace
const MIN_PCT = 28;
const MAX_PCT = 68;

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)',
  color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const STATUS = {
  ok: { color: '#3f9d6a', key: 'br.intake.secOk' },
  partial: { color: '#d99a2b', key: 'br.intake.secPartial' },
  missing: { color: '#cf5b57', key: 'br.intake.secMissing' },
} as const;

function scoreColor(score: number): string {
  if (score >= 70) return '#3f9d6a';
  if (score >= 40) return '#d99a2b';
  return '#cf5b57';
}

/** Loose match so an LLM heading like "## 6. Scope — Out-of-Scope" still finds
 *  its checklist row. Punctuation, numbering and case all get dropped. */
const norm = (s: string) =>
  (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/^\s*\d+\s*/, '').trim();

/** Split the composed pack into `## heading → body` blocks, in document order. */
function parsePack(md: string | null): { heading: string; body: string }[] {
  if (!md) return [];
  const blocks: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of md.split('\n')) {
    const m = /^#{1,4}\s+(.*)$/.exec(line.trim());
    if (m) {
      if (current) blocks.push({ heading: current.heading, body: current.body.join('\n').trim() });
      current = { heading: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) blocks.push({ heading: current.heading, body: current.body.join('\n').trim() });
  return blocks;
}

export default function BRIntakePage() {
  const { t } = useLocale();
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [active, setActive] = useState<Intake | null>(null);
  const [packSections, setPackSections] = useState<PackSection[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [wiType, setWiType] = useState('Product Backlog Item');
  const [assignee, setAssignee] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editPack, setEditPack] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [qAnswers, setQAnswers] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingUserMsg = useRef<string | null>(null);

  // Document vs conversation is a personal preference — drag the divider,
  // and the split is remembered.
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [chatPct, setChatPct] = useState(46);
  useEffect(() => {
    const saved = Number(localStorage.getItem(LS_SPLIT));
    if (saved >= MIN_PCT && saved <= MAX_PCT) setChatPct(saved);
  }, []);
  const applyPct = (pct: number) => setChatPct(Math.max(MIN_PCT, Math.min(MAX_PCT, pct)));
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragging.current || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    applyPct(((r.right - e.clientX) / r.width) * 100);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    localStorage.setItem(LS_SPLIT, String(Math.round(chatPct)));
  };

  const refreshList = useCallback(async () => {
    try {
      const rows = await apiFetch<Intake[]>('/br-management/intakes');
      setIntakes(rows);
      return rows;
    } catch { return []; }
  }, []);

  useEffect(() => {
    const run = async () => {
      await refreshList();
      try {
        const s = await apiFetch<{ decision_pack_sections?: PackSection[]; br_emails?: string[] }>(
          '/br-management/settings',
        );
        setPackSections(s.decision_pack_sections || []);
        setAssignees(s.br_emails || []);
      } catch { /* the document falls back to whatever the checklist carries */ }
      setLoading(false);
    };
    void run();
  }, [refreshList]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages?.length, thinking]);

  const openSubmitPanel = async () => {
    setShowSubmit(true);
    setEditTitle(active?.title || '');
    setEditPack(active?.pack_markdown || '');
    if (active?.br_type === 'epic') setWiType('Epic');
    try {
      const list = await apiFetch<{ id: string; name: string }[]>('/br-management/azure/projects');
      setProjects(list.map((p) => p.name));
      if (list.length === 1) setProject(list[0].name);
    } catch { /* free-text project input still works */ }
  };

  const sendText = async (text: string) => {
    if (!text || thinking) return;
    setError('');
    setThinking(true);
    pendingUserMsg.current = text;
    try {
      let row = active;
      if (!row) {
        row = await apiFetch<Intake>('/br-management/intakes', { method: 'POST' });
        setActive(row);
      }
      // The interview turn is a synchronous LLM call (25-120s via the
      // CLI bridge) — override apiFetch's default 45s abort.
      const updated = await apiFetch<Intake>(`/br-management/intakes/${row.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(240_000),
      });
      setActive(updated);
      setQAnswers({});
      void refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('br.error'));
      setInput(text); // give the message back so nothing is lost
    } finally {
      pendingUserMsg.current = null;
      setThinking(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendText(text);
  };

  const loadAttachments = useCallback(async (intakeId: number) => {
    try {
      setAttachments(await apiFetch<Attachment[]>(`/br-management/intakes/${intakeId}/attachments`));
    } catch { setAttachments([]); }
  }, []);

  useEffect(() => {
    if (active?.id) void loadAttachments(active.id);
    else setAttachments([]);
  }, [active?.id, loadAttachments]);

  /** Files need an intake to hang off, so an empty conversation creates one
   *  first — attaching a screenshot is a legitimate way to start. */
  const attachFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    setUploading(true);
    setError('');
    try {
      let row = active;
      if (!row) {
        row = await apiFetch<Intake>('/br-management/intakes', { method: 'POST' });
        setActive(row);
        void refreshList();
      }
      const form = new FormData();
      files.slice(0, 10).forEach((f) => form.append('files', f, f.name));
      // apiFetch forces a JSON content-type, which breaks multipart boundaries.
      setAttachments(await apiUpload<Attachment[]>(
        `/br-management/intakes/${row.id}/attachments`, form,
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('br.error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeAttachment = async (id: number) => {
    if (!active) return;
    try {
      await apiFetch(`/br-management/intakes/${active.id}/attachments/${id}`, { method: 'DELETE' });
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch { /* the list refreshes on the next load */ }
  };

  /** Answers are written into the document, so they are sent as
   *  "section → answer" pairs rather than loose chat lines. */
  const sendAnswers = async () => {
    const parts = openQuestions
      .filter((q) => (qAnswers[q.id] || '').trim())
      .map((q) => `${q.section ? q.section + '\n' : ''}${q.text}\n→ ${qAnswers[q.id].trim()}`);
    if (!parts.length) return;
    await sendText(parts.join('\n\n'));
  };

  const submit = async () => {
    if (!active || !project.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const updated = await apiFetch<Intake>(`/br-management/intakes/${active.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          project: project.trim(),
          work_item_type: wiType,
          assignee_email: assignee.trim() || null,
          title: editTitle.trim() || null,
          pack_markdown: editPack.trim() || null,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      setActive(updated);
      setShowSubmit(false);
      void refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('br.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const removeDraft = async (id: number) => {
    try {
      await apiFetch(`/br-management/intakes/${id}`, { method: 'DELETE' });
      if (active?.id === id) setActive(null);
      void refreshList();
    } catch { /* ignore */ }
  };

  const startNew = () => {
    setActive(null); setInput(''); setError(''); setShowSubmit(false);
    setQAnswers({}); setShowDrafts(false);
    composerRef.current?.focus();
  };

  const score = active?.readiness_score ?? null;
  const threshold = active?.submit_threshold ?? 70;
  const canSubmit = active?.status === 'draft' && (score ?? 0) >= threshold;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a ref feeds this list, so memoising it would hide a just-sent message until the server replies
  const displayMsgs: Msg[] = [
    ...(active?.messages || []),
    ...(pendingUserMsg.current ? [{ role: 'user' as const, text: pendingUserMsg.current }] : []),
  ];

  // Questions from the newest analyst turn — the only ones still open.
  const openQuestions: Question[] = useMemo(() => {
    if (thinking || active?.status !== 'draft') return [];
    const last = displayMsgs[displayMsgs.length - 1];
    return last?.role === 'assistant' ? (last.questions || []) : [];
  }, [displayMsgs, thinking, active?.status]);

  /** The document: one row per Decision Pack section, carrying its status,
   *  whatever the analyst has written into it, and any open question. */
  const docRows = useMemo(() => {
    const checklist = active?.checklist || [];
    const base: { title: string; status: Check['status']; note?: string }[] =
      checklist.length
        ? checklist.map((c) => ({ title: c.section, status: c.status, note: c.note }))
        : packSections.map((s) => ({ title: s.title, status: 'missing' as const }));
    const blocks = parsePack(active?.pack_markdown || null);
    const usedQ = new Set<string>();
    return base.map((row, i) => {
      const key = norm(row.title);
      const block =
        blocks.find((b) => {
          const h = norm(b.heading);
          return h && key && (h.includes(key) || key.includes(h));
        })
        // The pack is written in section order, so position is a sound
        // fallback when the model reworded a heading.
        || (blocks.length === base.length ? blocks[i] : undefined);
      const question = openQuestions.find((q) => {
        if (usedQ.has(q.id)) return false;
        const qs = norm(q.section || '');
        if (!qs || !key) return false;
        if (qs.includes(key) || key.includes(qs)) { usedQ.add(q.id); return true; }
        return false;
      });
      const critical = packSections.find((s) => norm(s.title) === key)?.critical ?? false;
      let body = (block?.body || '').replace(/^_\(eksik\)_$/im, '').trim();
      if (row.status === 'missing') body = '';
      return { ...row, critical, body, question };
    });
  }, [active?.checklist, active?.pack_markdown, packSections, openQuestions]);

  const orphanQuestions = useMemo(() => {
    const placed = new Set(docRows.map((r) => r.question?.id).filter(Boolean));
    return openQuestions.filter((q) => !placed.has(q.id));
  }, [docRows, openQuestions]);

  const answeredCount = openQuestions.filter((q) => (qAnswers[q.id] || '').trim()).length;
  const okCount = docRows.filter((r) => r.status === 'ok').length;
  const partialCount = docRows.filter((r) => r.status === 'partial').length;
  const missingCount = docRows.filter((r) => r.status === 'missing').length;

  if (loading) {
    return <div style={{ color: 'var(--ink-30)', fontSize: 14, padding: '40px 0' }}>{t('br.loading')}</div>;
  }

  const questionBlock = (q: Question) => (
    <div className="brqbox">
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.55 }}>
        {q.text}
      </div>
      {!!q.examples?.length && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {q.examples.map((ex) => (
            <button key={ex} type="button"
              onClick={() => setQAnswers((s) => ({ ...s, [q.id]: ex }))}
              className={qAnswers[q.id] === ex ? 'brchip brchip-on' : 'brchip'}>
              {ex}
            </button>
          ))}
        </div>
      )}
      <textarea value={qAnswers[q.id] || ''} rows={2}
        onChange={(e) => setQAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendAnswers(); }
        }}
        placeholder={t('br.intake.answerPlaceholder')}
        style={{ ...inputStyle, background: 'var(--panel)', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }} />
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 14, height: 'calc(100vh - 130px)', minHeight: 560 }}>

      {/* ── Page head: identity + draft switcher ─────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="section-label">{t('br.sectionLabel')}</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 2 }}>
            {t('br.intake.title')}
          </h1>
          <p style={{ color: 'var(--ink-35)', fontSize: 13.5, margin: 0 }}>{t('br.intake.subtitle')}</p>
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
          <button onClick={() => setShowDrafts((v) => !v)} className="brghost">
            {t('br.intake.drafts')} · {intakes.length}
          </button>
          <button onClick={startNew} className="brghost">
            <NavIcon name="plus" size={12} /> {t('br.intake.newChat')}
          </button>
          {showDrafts && (
            <div className="brcard" style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40, width: 300,
              maxHeight: 340, overflowY: 'auto', padding: 6, borderRadius: 14,
              border: '1px solid var(--panel-border-3)', background: 'var(--surface)',
              display: 'grid', gap: 2, alignContent: 'start',
            }}>
              {intakes.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-30)' }}>{t('br.intake.noDrafts')}</div>
              )}
              {intakes.map((it) => (
                <div key={it.id} className={active?.id === it.id ? 'brdraft brdraft-on' : 'brdraft'}
                  onClick={() => {
                    setActive(it); setError(''); setShowSubmit(false);
                    setQAnswers({}); setShowDrafts(false);
                  }}>
                  <div style={{
                    fontSize: 12.5, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.4,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 20,
                  }}>{it.title || t('br.intake.untitled')}</div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 3 }}>
                    {it.readiness_score != null && (
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: scoreColor(it.readiness_score) }}>
                        {it.readiness_score}
                      </span>
                    )}
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: it.status === 'submitted' ? '#3f9d6a' : 'var(--ink-35)' }}>
                      {it.status === 'submitted' ? t('br.intake.statusSubmitted') : t('br.intake.statusDraft')}
                    </span>
                  </div>
                  {it.status === 'draft' && (
                    <button onClick={(e) => { e.stopPropagation(); void removeDraft(it.id); }}
                      title={t('br.intake.delete')} className="brdraft-del">
                      <NavIcon name="close" size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div ref={wrapRef} className="brwrap" style={{
        display: 'grid', gridTemplateColumns: `minmax(0, 1fr) 12px ${chatPct}%`,
        gap: 0, minHeight: 0,
      }}>

        {/* ── The document ─────────────────────────────────── */}
        <div className="brcard" style={{
          display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRadius: 16,
          border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden',
        }}>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '26px 30px 20px' }}>

              <div style={{ marginBottom: 22 }}>
                <div style={{
                  fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, textTransform: 'uppercase',
                  color: 'var(--ink-30)',
                }}>{t('br.intake.docLabel')}</div>
                <h2 style={{
                  fontSize: 22, fontWeight: 700, color: active?.title ? 'var(--ink-90)' : 'var(--ink-25)',
                  margin: '6px 0 0', lineHeight: 1.35, letterSpacing: -0.2,
                }}>{active?.title || t('br.intake.docUntitled')}</h2>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  {active?.br_type && (
                    <span className="brchip brchip-on" style={{ cursor: 'default' }}>
                      {active.br_type === 'epic' ? t('br.type.epic')
                        : active.br_type === 'improvement' ? t('br.type.improvement')
                          : t('br.type.not_br')}
                    </span>
                  )}
                  <span style={{ fontSize: 11.5, color: 'var(--ink-35)' }}>
                    {t('br.intake.docProgress', { ok: okCount, total: docRows.length })}
                  </span>
                </div>
                <div style={{ height: 1, background: 'var(--panel-border)', marginTop: 16 }} />
              </div>

              {docRows.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', display: 'grid', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-90)' }}>{t('br.intake.emptyTitle')}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink-35)', maxWidth: 420, margin: '0 auto' }}>
                    {t('br.intake.emptyHint')}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gap: 2 }}>
                {docRows.map((row, i) => {
                  const meta = STATUS[row.status] || STATUS.missing;
                  const open = Boolean(row.question);
                  return (
                    <section key={i} className="brsec" style={{
                      display: 'grid', gridTemplateColumns: '30px 1fr', gap: 12,
                      padding: '12px 12px 12px 4px', borderRadius: 10,
                      background: open ? 'var(--panel-alt)' : 'transparent',
                    }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, color: 'var(--ink-25)', textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums', paddingTop: 1,
                      }}>{i + 1}</span>
                      <div style={{ minWidth: 0, display: 'grid', gap: 7 }}>
                        <div style={{ display: 'flex', gap: 9, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', lineHeight: 1.45 }}>
                            {row.title.split('(')[0].trim()}
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
                        {row.body && (
                          <p style={{
                            margin: 0, fontSize: 12.5, lineHeight: 1.75, color: 'var(--ink-72)',
                            whiteSpace: 'pre-wrap',
                          }}>{row.body}</p>
                        )}
                        {!row.body && !open && (
                          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-25)', fontStyle: 'italic' }}>
                            {row.note || t('br.intake.secEmpty')}
                          </p>
                        )}
                        {row.question && questionBlock(row.question)}
                      </div>
                    </section>
                  );
                })}
              </div>

              {orphanQuestions.length > 0 && (
                <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
                  <div style={{
                    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase',
                    color: 'var(--ink-30)',
                  }}>{t('br.intake.questionsTitle')}</div>
                  {orphanQuestions.map((q) => <div key={q.id}>{questionBlock(q)}</div>)}
                </div>
              )}

              {openQuestions.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button onClick={() => void sendAnswers()} disabled={!answeredCount} className="brbtn"
                    style={{
                      padding: '10px 20px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                      background: answeredCount ? 'var(--acc)' : 'var(--panel-alt)',
                      color: answeredCount ? '#fff' : 'var(--ink-30)', fontWeight: 700, fontSize: 12.5,
                      cursor: answeredCount ? 'pointer' : 'default',
                      boxShadow: answeredCount ? '0 6px 14px -6px var(--acc)' : 'none',
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                    }}>
                    <NavIcon name="send" size={13} />
                    {answeredCount
                      ? t('br.intake.answersSendN', { count: answeredCount })
                      : t('br.intake.answersSend')}
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

        <div role="separator" aria-orientation="vertical" tabIndex={0}
          aria-label={t('br.intake.splitHandle')}
          aria-valuenow={Math.round(chatPct)} aria-valuemin={MIN_PCT} aria-valuemax={MAX_PCT}
          className="brsplit"
          onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = chatPct + (e.key === 'ArrowLeft' ? 2 : -2);
            applyPct(next);
            localStorage.setItem(LS_SPLIT, String(Math.round(Math.max(MIN_PCT, Math.min(MAX_PCT, next)))));
          }}>
          <span />
        </div>

        {/* ── The analyst ──────────────────────────────────── */}
        <div className="brcard" style={{
          display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 16,
          border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden',
        }}>
          {/* Readiness, in the column you are actually looking at while you talk. */}
          <div style={{ padding: '14px 16px 13px', borderBottom: '1px solid var(--panel-border)', display: 'grid', gap: 11 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <span style={{
                  fontSize: 32, fontWeight: 800, lineHeight: 0.95, letterSpacing: -1,
                  color: score != null ? scoreColor(score) : 'var(--ink-25)',
                }}>{score != null ? score : '—'}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-30)', fontWeight: 700 }}>/ 100</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--ink-35)', lineHeight: 1.5, paddingBottom: 2 }}>
                {score == null ? t('br.intake.stateNew')
                  : canSubmit ? t('br.intake.stateReady')
                    : t('br.intake.stateGap', { points: Math.max(0, threshold - (score ?? 0)) })}
              </span>
              {active?.br_type && (
                <span className="brchip brchip-on" style={{ cursor: 'default', flexShrink: 0 }}>
                  {active.br_type === 'epic' ? t('br.type.epic')
                    : active.br_type === 'improvement' ? t('br.type.improvement')
                      : t('br.type.not_br')}
                </span>
              )}
            </div>

            <div>
              <div style={{ position: 'relative', height: 7, borderRadius: 4, background: 'var(--panel-alt)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${Math.max(0, Math.min(100, score ?? 0))}%`,
                  background: score != null ? scoreColor(score) : 'transparent',
                  borderRadius: 4, transition: 'width .8s ease, background .4s ease',
                }} />
              </div>
              <div style={{ position: 'relative', height: 13 }}>
                <span style={{ position: 'absolute', left: `${threshold}%`, top: -7, width: 1, height: 11, background: 'var(--ink-30)' }} />
                <span style={{
                  position: 'absolute', left: `${threshold}%`, top: 3, fontSize: 9.5, color: 'var(--ink-30)',
                  transform: 'translateX(-50%)', whiteSpace: 'nowrap',
                }}>{t('br.intake.gateHint')} {threshold}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, fontWeight: 600 }}>
              {([['ok', okCount], ['partial', partialCount], ['missing', missingCount]] as const).map(([k, n]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: n ? 'var(--ink-65)' : 'var(--ink-25)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: n ? STATUS[k].color : 'var(--panel-border-3)' }} />
                  {n} {t(STATUS[k].key)}
                </span>
              ))}
              {openQuestions.length > 0 && (
                <span style={{ color: 'var(--acc)', marginInlineStart: 'auto' }}>
                  {t('br.intake.openQuestions', { count: openQuestions.length })}
                </span>
              )}
            </div>

            {active?.status === 'draft' && (
              <button onClick={() => void openSubmitPanel()} disabled={!canSubmit} className="brbtn"
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
                  background: canSubmit ? '#3f9d6a' : 'var(--panel-alt)',
                  color: canSubmit ? '#fff' : 'var(--ink-30)', fontWeight: 700, fontSize: 12.5,
                  cursor: canSubmit ? 'pointer' : 'default',
                  boxShadow: canSubmit ? '0 8px 18px -8px #3f9d6a' : 'none', transition: 'background .3s',
                }}>
                {t('br.intake.submit')}
              </button>
            )}
            {active?.status === 'submitted' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3f9d6a', fontSize: 12.5, fontWeight: 700 }}>
                <NavIcon name="user-check" size={15} /> {t('br.intake.submitted')} #{active.azure_work_item_id}
                {active.azure_url && (
                  <a href={active.azure_url} target="_blank" rel="noreferrer"
                    style={{ color: 'var(--acc)', textDecoration: 'none', marginInlineStart: 'auto' }}>
                    {t('br.intake.openAzure')} ↗
                  </a>
                )}
              </div>
            )}
          </div>

          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--panel-border)',
            display: 'flex', alignItems: 'center', gap: 9,
          }}>
            <span style={{
              width: 24, height: 24, borderRadius: 12, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--acc)', color: '#fff',
            }}><NavIcon name="agents" size={13} /></span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-90)' }}>
              {t('br.intake.analystName')}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '14px 15px', display: 'grid', gap: 12, alignContent: 'start' }}>
            {displayMsgs.length === 0 && (
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-35)' }}>
                {t('br.intake.railEmpty')}
              </div>
            )}
            {displayMsgs.map((m, i) => (
              m.role === 'user' ? (
                <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{
                    maxWidth: '92%', padding: '8px 12px', borderRadius: 13, borderBottomRightRadius: 4,
                    background: 'var(--acc)', color: '#fff', fontSize: 12.5, lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}>{m.text}</div>
                </div>
              ) : (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--ink-78)', whiteSpace: 'pre-wrap' }}>
                  {m.text}
                </div>
              )
            ))}
            {thinking && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  {[0, 1, 2].map((d) => (
                    <span key={d} style={{
                      width: 5, height: 5, borderRadius: 3, background: 'var(--ink-35)',
                      display: 'inline-block', animation: `brDot 1.2s ${d * 0.18}s infinite`,
                    }} />
                  ))}
                </span>
                <span style={{ color: 'var(--ink-35)', fontSize: 11.5 }}>{t('br.intake.thinking')}</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {active?.status !== 'submitted' && (
            <div style={{ padding: '10px 12px 12px', display: 'grid', gap: 6 }}>
              {error && <div style={{ color: '#cf5b57', fontSize: 11.5, lineHeight: 1.5 }}>{error}</div>}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {attachments.map((a) => (
                    <span key={a.id} className="bratt" title={`${a.filename} · ${Math.max(1, Math.round(a.size_bytes / 1024))} KB`}>
                      <NavIcon name={a.content_type.startsWith('image/') ? 'box' : 'clipboard'} size={11} />
                      <span style={{
                        maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{a.filename}</span>
                      <button type="button" onClick={() => void removeAttachment(a.id)}
                        aria-label={t('br.intake.attachRemove')} className="bratt-del">
                        <NavIcon name="close" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input ref={fileRef} type="file" multiple hidden
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={(e) => void attachFiles(Array.from(e.target.files || []))} />
              <div className="brcomposer"
                onPaste={(e) => {
                  // Pasting a screenshot is how most people will attach one.
                  const files = Array.from(e.clipboardData?.files || []);
                  if (files.length) { e.preventDefault(); void attachFiles(files); }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const files = Array.from(e.dataTransfer?.files || []);
                  if (files.length) { e.preventDefault(); void attachFiles(files); }
                }}>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  aria-label={t('br.intake.attach')} title={t('br.intake.attachHint')}
                  className="brattbtn">
                  <NavIcon name={uploading ? 'clock' : 'plus'} size={14} />
                </button>
                <textarea ref={composerRef} value={input} rows={1}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder={t('br.intake.placeholder')}
                  disabled={thinking}
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    color: 'var(--ink-90)', fontSize: 12.5, lineHeight: 1.6, resize: 'none',
                    padding: '5px 0', maxHeight: 120, fontFamily: 'inherit',
                  }} />
                <button onClick={() => void send()} disabled={thinking || !input.trim()}
                  aria-label={t('br.intake.send')} className="brbtn"
                  style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0, border: 'none',
                    background: input.trim() && !thinking ? 'var(--acc)' : 'var(--panel-border-3)',
                    color: '#fff', cursor: input.trim() && !thinking ? 'pointer' : 'default',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .2s',
                  }}>
                  <NavIcon name="send" size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Submit panel ───────────────────────────────────── */}
      {showSubmit && active?.status === 'draft' && (
        <div onClick={() => setShowSubmit(false)} style={{
          position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(2,6,23,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} className="brcard" style={{
            width: 'min(560px, 100%)', maxHeight: '86vh', overflowY: 'auto', padding: 20,
            borderRadius: 16, border: '1px solid var(--panel-border-3)', background: 'var(--surface)',
            display: 'grid', gap: 12,
          }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-90)' }}>{t('br.intake.submit')}</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitTitleField')}</div>
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={250} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitPackField')}</div>
              <textarea value={editPack} onChange={(e) => setEditPack(e.target.value)} rows={10}
                style={{ ...inputStyle, resize: 'vertical', fontSize: 11.5, lineHeight: 1.6 }} />
              <div style={{ fontSize: 10.5, color: 'var(--ink-35)', marginTop: 3, lineHeight: 1.5 }}>{t('br.intake.submitPackHint')}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitProject')}</div>
                <input value={project} onChange={(e) => setProject(e.target.value)} list="br-intake-projects" style={inputStyle} />
                <datalist id="br-intake-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitType')}</div>
                <select value={wiType} onChange={(e) => setWiType(e.target.value)} style={inputStyle}>
                  {WORK_ITEM_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitAssignee')}</div>
                {assignees.length > 0 ? (
                  <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={inputStyle}>
                    <option value="">—</option>
                    {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                ) : (
                  <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ornek@flo.com.tr" style={inputStyle} />
                )}
              </div>
            </div>
            {error && <div style={{ color: '#cf5b57', fontSize: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSubmit(false)} className="brghost">{t('br.intake.cancel')}</button>
              <button onClick={() => void submit()} disabled={submitting || !project.trim()} className="brbtn"
                style={{
                  padding: '9px 18px', borderRadius: 9, border: 'none', background: '#3f9d6a',
                  color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                  cursor: submitting ? 'default' : 'pointer',
                  opacity: submitting || !project.trim() ? 0.6 : 1,
                }}>
                {submitting ? '…' : t('br.intake.submitConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes brDot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
        .brcard { box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 16px 40px -28px rgba(15,23,42,.22); }
        .brsec { transition: background .2s ease; }
        .brsec + .brsec { border-top: 1px solid var(--panel-border); }
        .brqbox { display: grid; gap: 8px; padding: 12px; border-radius: 11px;
                  background: var(--panel); border: 1px solid var(--panel-border-3);
                  border-inline-start: 2px solid var(--acc); }
        .brchip { padding: 5px 11px; border-radius: 999px; font-size: 11px; cursor: pointer;
                  font-weight: 600; line-height: 1.4; font-family: inherit;
                  border: 1px solid var(--panel-border-3); background: var(--panel-alt);
                  color: var(--ink-65); transition: border-color .15s ease, color .15s ease,
                  background .15s ease, transform .1s ease; }
        .brchip:hover { border-color: var(--acc); color: var(--acc); }
        .brchip:active { transform: scale(.96); }
        .brchip-on, .brchip-on:hover { border-color: transparent; background: var(--acc-soft); color: var(--acc); }
        .brghost { display: inline-flex; align-items: center; gap: 6px; padding: 8px 13px;
                   border-radius: 9px; font-size: 12px; font-weight: 600; font-family: inherit;
                   cursor: pointer; border: 1px solid var(--panel-border-3);
                   background: var(--panel); color: var(--ink-65);
                   transition: border-color .15s ease, color .15s ease; }
        .brghost:hover { border-color: var(--acc); color: var(--acc); }
        .brdraft { padding: 9px 10px; border-radius: 9px; cursor: pointer; position: relative;
                   transition: background .15s ease; }
        .brdraft:hover { background: var(--panel-alt); }
        .brdraft-on { background: var(--panel-alt); box-shadow: inset 2px 0 0 var(--acc); }
        .brdraft-del { position: absolute; top: 8px; right: 6px; border: none; background: transparent;
                       color: var(--ink-30); cursor: pointer; padding: 2px; line-height: 0;
                       opacity: 0; transition: opacity .15s ease; }
        .brdraft:hover .brdraft-del { opacity: 1; }
        .bratt { display: inline-flex; align-items: center; gap: 5px; padding: 4px 6px 4px 9px;
                 border-radius: 8px; font-size: 11px; font-weight: 600; color: var(--ink-65);
                 background: var(--panel-alt); border: 1px solid var(--panel-border-3); }
        .bratt-del { border: none; background: transparent; color: var(--ink-30); cursor: pointer;
                     padding: 2px; line-height: 0; border-radius: 4px; }
        .bratt-del:hover { color: #cf5b57; }
        .brattbtn { width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0; border: none;
                    background: transparent; color: var(--ink-35); cursor: pointer;
                    display: inline-flex; align-items: center; justify-content: center;
                    transition: background .15s ease, color .15s ease; }
        .brattbtn:hover:not(:disabled) { background: var(--panel-border-2); color: var(--acc); }
        .brattbtn:disabled { opacity: .5; cursor: default; }
        .brcomposer { display: flex; align-items: flex-end; gap: 7px; padding: 7px 7px 7px 7px;
                      border-radius: 15px; border: 1px solid var(--panel-border-3);
                      background: var(--panel-alt);
                      transition: border-color .2s ease, box-shadow .2s ease; }
        .brcomposer:focus-within { border-color: var(--acc);
                      box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 13%, transparent); }
        .brbtn { transition: filter .15s ease, transform .1s ease; }
        .brbtn:hover:not(:disabled) { filter: brightness(1.07); }
        .brbtn:active:not(:disabled) { transform: translateY(1px); }
        .brsplit { display: flex; align-items: center; justify-content: center;
                   cursor: col-resize; touch-action: none; }
        .brsplit span { width: 3px; height: 46px; border-radius: 2px;
                        background: var(--panel-border-3); transition: background .15s ease, height .15s ease; }
        .brsplit:hover span, .brsplit:focus-visible span { background: var(--acc); height: 84px; }
        .brsplit:focus-visible { outline: none; }
        @media (max-width: 1000px) {
          .brwrap { grid-template-columns: minmax(0, 1fr) !important; grid-auto-rows: minmax(0, 1fr); }
          .brsplit { display: none; }
        }
      `}</style>
    </div>
  );
}
