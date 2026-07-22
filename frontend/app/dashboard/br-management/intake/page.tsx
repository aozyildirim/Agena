'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type Question = { id: string; text: string; examples?: string[] };
type Msg = { role: 'user' | 'assistant'; text: string; ts?: string; questions?: Question[] };
type Check = { section: string; status: 'ok' | 'partial' | 'missing'; note?: string };
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

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)',
  color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

function scoreColor(score: number): string {
  if (score >= 70) return '#3f9d6a';
  if (score >= 40) return '#d99a2b';
  return '#cf5b57';
}

/** Enterprise KPI dial: readiness ring with a tick at the submit gate. */
function ScoreDial({ score, threshold }: { score: number | null; threshold: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const color = score != null ? scoreColor(pct) : 'var(--panel-border-3)';
  const a = ((threshold / 100) * 360 - 90) * (Math.PI / 180);
  const tick = {
    x1: 60 + Math.cos(a) * (r + 7), y1: 60 + Math.sin(a) * (r + 7),
    x2: 60 + Math.cos(a) * (r - 8), y2: 60 + Math.sin(a) * (r - 8),
  };
  return (
    <svg width={130} height={130} viewBox="0 0 120 120" role="img" aria-label={`${score ?? 0}/100`}>
      <circle cx={60} cy={60} r={r} stroke="var(--panel-alt)" strokeWidth={9} fill="none" />
      {score != null && (
        <circle cx={60} cy={60} r={r} stroke={color} strokeWidth={9} fill="none"
          strokeDasharray={`${(c * pct) / 100} ${c}`} strokeLinecap="round"
          transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray .8s ease, stroke .4s ease' }} />
      )}
      <line {...tick} stroke="var(--ink-35)" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
      <text x={60} y={58} textAnchor="middle" fontSize={30} fontWeight={800}
        fill={score != null ? color : 'var(--ink-30)'}>{score != null ? score : '—'}</text>
      <text x={60} y={76} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--ink-35)">/ 100</text>
    </svg>
  );
}

function StatusPill({ status }: { status: Check['status'] }) {
  const map = {
    ok: { color: '#3f9d6a', ch: '✓' },
    partial: { color: '#d99a2b', ch: '~' },
    missing: { color: '#cf5b57', ch: '•' },
  } as const;
  const m = map[status] || map.missing;
  return (
    <span style={{
      width: 16, height: 16, borderRadius: 8, flexShrink: 0, marginTop: 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: m.color, color: '#fff', fontSize: 10, fontWeight: 800,
    }}>{m.ch}</span>
  );
}

function AnalystAvatar() {
  return (
    <span style={{
      width: 28, height: 28, borderRadius: 14, flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--acc)', color: '#fff',
      boxShadow: '0 3px 10px -3px var(--acc)',
    }}>
      <NavIcon name="agents" size={15} />
    </span>
  );
}

export default function BRIntakePage() {
  const { t } = useLocale();
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [active, setActive] = useState<Intake | null>(null);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPack, setShowPack] = useState(false);
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingUserMsg = useRef<string | null>(null);

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
    try {
      const s = await apiFetch<{ br_emails?: string[] }>('/br-management/settings');
      setAssignees(s.br_emails || []);
    } catch { /* free-text assignee input still works */ }
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

  const sendAnswers = async (questions: Question[]) => {
    const parts = questions
      .filter((q) => (qAnswers[q.id] || '').trim())
      .map((q) => `${q.text}\n→ ${qAnswers[q.id].trim()}`);
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
    setActive(null); setInput(''); setError(''); setShowSubmit(false); setQAnswers({});
    composerRef.current?.focus();
  };

  const score = active?.readiness_score ?? null;
  const threshold = active?.submit_threshold ?? 70;
  const canSubmit = active?.status === 'draft' && (score ?? 0) >= threshold;
  const displayMsgs: Msg[] = [
    ...(active?.messages || []),
    ...(pendingUserMsg.current ? [{ role: 'user' as const, text: pendingUserMsg.current }] : []),
  ];
  const starters = [t('br.intake.start1'), t('br.intake.start2'), t('br.intake.start3')];

  if (loading) {
    return <div style={{ color: 'var(--ink-30)', fontSize: 14, padding: '40px 0' }}>{t('br.loading')}</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 14, height: 'calc(100vh - 130px)', minHeight: 520 }}>
      <div>
        <div className="section-label">{t('br.sectionLabel')}</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 2 }}>
          {t('br.intake.title')}
        </h1>
        <p style={{ color: 'var(--ink-35)', fontSize: 13.5, margin: 0 }}>{t('br.intake.subtitle')}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '232px minmax(0, 1fr) 304px', gap: 14, minHeight: 0 }}>

        {/* ── Conversations rail ─────────────────────────────── */}
        <div className="brkcard" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: 10 }}>
          <button onClick={startNew} className="brkstart"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-90)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
            <NavIcon name="plus" size={13} /> {t('br.intake.newChat')}
          </button>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-30)', textTransform: 'uppercase', letterSpacing: 0.7, padding: '6px 6px 0' }}>
            {t('br.intake.drafts')}
          </div>
          <div style={{ overflowY: 'auto', overflowX: 'hidden', display: 'grid', gap: 4, alignContent: 'start' }}>
            {intakes.map((it) => {
              const isActive = active?.id === it.id;
              return (
                <div key={it.id} onClick={() => { setActive(it); setError(''); setShowSubmit(false); setQAnswers({}); }}
                  className={isActive ? 'brki brki-on' : 'brki'}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 22, lineHeight: 1.4 }}>
                    {it.title || t('br.intake.untitled')}
                  </div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 3 }}>
                    {it.readiness_score != null && (
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: scoreColor(it.readiness_score), background: 'var(--panel-alt)', borderRadius: 5, padding: '1px 6px' }}>
                        {it.readiness_score}
                      </span>
                    )}
                    <span style={{ fontSize: 10.5, color: it.status === 'submitted' ? '#3f9d6a' : 'var(--ink-35)', fontWeight: 600 }}>
                      {it.status === 'submitted' ? t('br.intake.statusSubmitted') : t('br.intake.statusDraft')}
                    </span>
                  </div>
                  {it.status === 'draft' && (
                    <button onClick={(e) => { e.stopPropagation(); void removeDraft(it.id); }}
                      title={t('br.intake.delete')} className="brki-del"
                      style={{ position: 'absolute', top: 9, right: 7, border: 'none', background: 'transparent', color: 'var(--ink-30)', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
                      <NavIcon name="close" size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Chat column ───────────────────────────────────── */}
        <div className="brkcard" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '22px 22px 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {displayMsgs.length === 0 && (
                <div style={{ margin: '48px auto 0', textAlign: 'center', maxWidth: 480, display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}><AnalystAvatar /></div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-90)' }}>{t('br.intake.emptyTitle')}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink-35)' }}>{t('br.intake.emptyHint')}</div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10, textAlign: 'left' }}>
                    {starters.map((s) => (
                      <button key={s} onClick={() => { setInput(s); composerRef.current?.focus(); }} className="brkstart"
                        style={{ padding: '12px 15px', borderRadius: 11, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-78)', fontSize: 12.5, lineHeight: 1.55, cursor: 'pointer', textAlign: 'left' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {displayMsgs.map((m, i) => (
                m.role === 'user' ? (
                  <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ maxWidth: '76%', padding: '10px 15px', borderRadius: 16, borderBottomRightRadius: 5, background: 'var(--acc)', color: '#fff', fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', boxShadow: '0 6px 16px -8px var(--acc)' }}>
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <AnalystAvatar />
                    <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-35)' }}>{t('br.intake.analystName')}</div>
                      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-90)', whiteSpace: 'pre-wrap' }}>
                        {m.text}
                      </div>
                    </div>
                  </div>
                )
              ))}

              {(() => {
                const last = displayMsgs[displayMsgs.length - 1];
                if (!last || last.role !== 'assistant' || !last.questions?.length || thinking || active?.status !== 'draft') return null;
                const qs = last.questions;
                const anyAnswered = qs.some((q) => (qAnswers[q.id] || '').trim());
                return (
                  <div className="brkcard" style={{ marginLeft: 38, display: 'grid', gap: 14, padding: '15px 16px 14px', borderRadius: 14, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', borderTop: '2px solid var(--acc)' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                      {t('br.intake.questionsTitle')}
                    </div>
                    {qs.map((q, qi) => (
                      <div key={q.id} style={{ display: 'grid', gap: 7 }}>
                        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                          <span style={{ width: 19, height: 19, borderRadius: 6, flexShrink: 0, marginTop: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid var(--acc)', color: 'var(--acc)', fontSize: 10.5, fontWeight: 800 }}>
                            {qi + 1}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.55 }}>{q.text}</span>
                        </div>
                        {!!q.examples?.length && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 28 }}>
                            {q.examples.map((ex) => {
                              const selected = qAnswers[q.id] === ex;
                              return (
                                <button key={ex} onClick={() => setQAnswers((s) => ({ ...s, [q.id]: ex }))}
                                  className={selected ? 'brkchip brkchip-on' : 'brkchip'}>
                                  {ex}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <input value={qAnswers[q.id] || ''}
                          onChange={(e) => setQAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
                          placeholder={t('br.intake.answerPlaceholder')}
                          style={{ ...inputStyle, background: 'var(--panel)', padding: '8px 11px', fontSize: 12.5, marginLeft: 28, width: 'calc(100% - 28px)' }} />
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => void sendAnswers(qs)} disabled={!anyAnswered} className="brkbtn"
                        style={{ padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--acc)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: anyAnswered ? 'pointer' : 'default', opacity: anyAnswered ? 1 : 0.45, display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: anyAnswered ? '0 6px 14px -6px var(--acc)' : 'none' }}>
                        <NavIcon name="send" size={13} /> {t('br.intake.answersSend')}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {thinking && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <AnalystAvatar />
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {[0, 1, 2].map((d) => (
                      <span key={d} style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--ink-35)', display: 'inline-block', animation: `brDot 1.2s ${d * 0.18}s infinite` }} />
                    ))}
                  </span>
                  <span style={{ color: 'var(--ink-35)', fontSize: 12 }}>{t('br.intake.thinking')}</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>

          {active?.status === 'submitted' ? (
            <div style={{ borderTop: '1px solid var(--panel-border)', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10, color: '#3f9d6a', fontSize: 13, fontWeight: 600 }}>
              <NavIcon name="user-check" size={16} /> {t('br.intake.submitted')} #{active.azure_work_item_id}
              {active.azure_url && (
                <a href={active.azure_url} target="_blank" rel="noreferrer" style={{ color: 'var(--acc)', fontWeight: 700, marginLeft: 'auto', textDecoration: 'none' }}>
                  {t('br.intake.openAzure')} ↗
                </a>
              )}
            </div>
          ) : (
            <div style={{ padding: '10px 22px 16px' }}>
              <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 6 }}>
                {error && <div style={{ color: '#cf5b57', fontSize: 12 }}>{error}</div>}
                <div className="brkcomposer">
                  <textarea ref={composerRef} value={input} rows={1}
                    onChange={(e) => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px';
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    placeholder={t('br.intake.placeholder')}
                    disabled={thinking}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--ink-90)', fontSize: 13.5, lineHeight: 1.6, resize: 'none', padding: '6px 0', maxHeight: 140, fontFamily: 'inherit' }} />
                  <button onClick={() => void send()} disabled={thinking || !input.trim()} aria-label={t('br.intake.send')} className="brkbtn"
                    style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, border: 'none', background: input.trim() && !thinking ? 'var(--acc)' : 'var(--panel-border-3)', color: '#fff', cursor: input.trim() && !thinking ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s', boxShadow: input.trim() && !thinking ? '0 6px 14px -6px var(--acc)' : 'none' }}>
                    <NavIcon name="send" size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Inspector rail ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflowY: 'auto' }}>

          <div className="brkcard" style={{ padding: '18px 18px 16px', borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)', display: 'grid', gap: 8, justifyItems: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7, justifySelf: 'start' }}>
              {t('br.intake.score')}
            </div>
            <ScoreDial score={score} threshold={threshold} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {active?.br_type && (
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--panel-border-3)', color: 'var(--ink-65)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {active.br_type === 'not_br' ? 'Not BR' : active.br_type}
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--ink-35)' }}>{t('br.intake.gateHint')} {threshold}</span>
            </div>
            {active?.status === 'draft' && (
              <button onClick={() => void openSubmitPanel()} disabled={!canSubmit} className="brkbtn"
                style={{ width: '100%', marginTop: 4, padding: '12px 14px', borderRadius: 11, border: 'none', background: canSubmit ? '#3f9d6a' : 'var(--panel-alt)', color: canSubmit ? '#fff' : 'var(--ink-30)', fontWeight: 700, fontSize: 13, cursor: canSubmit ? 'pointer' : 'default', transition: 'background .3s', boxShadow: canSubmit ? '0 8px 18px -8px #3f9d6a' : 'none' }}>
                {t('br.intake.submit')}
              </button>
            )}
            {active?.status === 'submitted' && active.azure_url && (
              <a href={active.azure_url} target="_blank" rel="noreferrer"
                style={{ width: '100%', marginTop: 4, padding: '11px 14px', borderRadius: 10, background: 'var(--panel-alt)', color: 'var(--acc)', fontWeight: 700, fontSize: 13, textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
                {t('br.intake.openAzure')} ↗
              </a>
            )}
          </div>

          {showSubmit && active?.status === 'draft' && (
            <div className="brkcard" style={{ padding: 16, borderRadius: 16, border: '1px solid var(--acc)', background: 'var(--panel)', display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-90)' }}>{t('br.intake.submit')}</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitTitleField')}</div>
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={250} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{t('br.intake.submitPackField')}</div>
                <textarea value={editPack} onChange={(e) => setEditPack(e.target.value)} rows={8}
                  style={{ ...inputStyle, resize: 'vertical', fontSize: 11.5, lineHeight: 1.55 }} />
                <div style={{ fontSize: 10.5, color: 'var(--ink-35)', marginTop: 3, lineHeight: 1.5 }}>{t('br.intake.submitPackHint')}</div>
              </div>
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
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowSubmit(false)}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-65)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {t('br.intake.cancel')}
                </button>
                <button onClick={() => void submit()} disabled={submitting || !project.trim()}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#3f9d6a', color: '#fff', fontSize: 12, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting || !project.trim() ? 0.6 : 1 }}>
                  {submitting ? '…' : t('br.intake.submitConfirm')}
                </button>
              </div>
            </div>
          )}

          <div className="brkcard" style={{ padding: 16, borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)', display: 'grid', gap: 9, alignContent: 'start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-35)', textTransform: 'uppercase', letterSpacing: 0.7 }}>
                {t('br.intake.checklist')}
              </div>
              {active?.pack_markdown && (
                <button onClick={() => setShowPack((v) => !v)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--acc)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                  {showPack ? t('br.intake.checklist') : t('br.intake.pack')}
                </button>
              )}
            </div>
            {!active?.checklist?.length && (
              <div style={{ fontSize: 12, color: 'var(--ink-30)', lineHeight: 1.6 }}>—</div>
            )}
            {!showPack && (active?.checklist || []).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <StatusPill status={c.status} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.45 }}>
                    {c.section.split('(')[0].trim()}
                  </div>
                  {c.note && c.status !== 'ok' && (
                    <div style={{ fontSize: 11, color: 'var(--ink-35)', lineHeight: 1.5 }}>{c.note}</div>
                  )}
                </div>
              </div>
            ))}
            {showPack && active?.pack_markdown && (
              <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--ink-78)', fontFamily: 'inherit', maxHeight: 420, overflowY: 'auto' }}>
                {active.pack_markdown}
              </pre>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes brDot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
        .brkcard { box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 16px 40px -28px rgba(15,23,42,.22); }
        .brki { padding: 9px 10px; border-radius: 9px; cursor: pointer; position: relative;
                border: 1px solid transparent; transition: background .15s ease; }
        .brki:hover { background: var(--panel-alt); }
        .brki-on { background: var(--panel-alt); border-color: var(--panel-border-3);
                   box-shadow: inset 3px 0 0 var(--acc); }
        .brki-del { opacity: 0; transition: opacity .15s ease; }
        .brki:hover .brki-del { opacity: 1; }
        .brkchip { padding: 5px 12px; border-radius: 999px; font-size: 11.5px; cursor: pointer;
                   font-weight: 600; line-height: 1.4; border: 1px solid var(--panel-border-3);
                   background: var(--panel); color: var(--ink-65);
                   transition: border-color .15s ease, color .15s ease, background .15s ease, transform .1s ease; }
        .brkchip:hover { border-color: var(--acc); color: var(--acc); }
        .brkchip:active { transform: scale(.96); }
        .brkchip-on, .brkchip-on:hover { border-color: var(--acc); background: var(--acc); color: #fff; }
        .brkstart { transition: border-color .15s ease, transform .1s ease; }
        .brkstart:hover { border-color: var(--acc); }
        .brkcomposer { display: flex; align-items: flex-end; gap: 8px; padding: 9px 9px 9px 18px;
                       border-radius: 18px; border: 1px solid var(--panel-border-3); background: var(--panel-alt);
                       transition: border-color .2s ease, box-shadow .2s ease; }
        .brkcomposer:focus-within { border-color: var(--acc);
                                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 13%, transparent); }
        .brkbtn { transition: filter .15s ease, transform .1s ease; }
        .brkbtn:hover:not(:disabled) { filter: brightness(1.07); }
        .brkbtn:active:not(:disabled) { transform: translateY(1px); }
      `}</style>
    </div>
  );
}
