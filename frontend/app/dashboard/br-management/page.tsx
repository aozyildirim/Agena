'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type BREval = {
  id: number;
  br_type?: string | null;
  readiness_score?: number | null;
  verdict?: string | null;
  reasoning?: string | null;
  checklist?: { section: string; status: string; note?: string }[] | null;
  questions?: { id: string; text: string }[] | null;
  answers?: Record<string, string> | null;
  status: string;
};
type BRItem = {
  source: string;
  external_id: string;
  title: string;
  state: string;
  work_item_type?: string;
  description: string;
  created_date?: string;
  changed_date?: string;
  assignee_email?: string | null;
  url?: string | null;
  eval: BREval | null;
};
type NamePair = { id: string; name: string };
type Sprint = { id: string; name: string; path?: string; is_current?: boolean };
type Comment = { id?: number | string; text?: string; created_by?: string; created_at?: string };
type SortKey = 'name' | 'type' | 'state' | 'score' | 'date';

const CHECK_COLOR: Record<string, string> = { ok: '#3f9d6a', partial: '#c98a2b', missing: '#cf5b57' };
const CHECK_MARK: Record<string, string> = { ok: '✓', partial: '~', missing: '✗' };
const fmtDate = (d?: string) => {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

const stripHtml = (html: string) =>
  (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim();

const TYPE_COLOR: Record<string, string> = {
  improvement: '#3f9d6a', epic: '#7c5cff', not_br: '#94a3b8',
};
const VERDICT_COLOR: Record<string, string> = {
  ready: '#3f9d6a', needs_info: '#c98a2b', not_br: '#94a3b8',
};
const scoreColor = (s: number) => (s >= 75 ? '#3f9d6a' : s >= 45 ? '#c98a2b' : '#cf5b57');

const LS_PROJECT = 'br_azure_project';
const LS_TEAM = 'br_azure_team';
const LS_SPRINT = 'br_azure_sprint';  // sprint PATH, '' = all open

const selectStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-3)',
  background: 'var(--panel-alt)', color: 'var(--ink-90)', fontSize: 13,
  outline: 'none', cursor: 'pointer', minWidth: 160,
};

export default function BRManagementPage() {
  const { t } = useLocale();
  const [brEmails, setBrEmails] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Source selectors (BR-PAT aware)
  const [projects, setProjects] = useState<NamePair[]>([]);
  const [teams, setTeams] = useState<NamePair[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [project, setProject] = useState('');
  const [team, setTeam] = useState('');
  const [sprintPath, setSprintPath] = useState('');  // '' = all open work

  const [items, setItems] = useState<BRItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evaluatingAll, setEvaluatingAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentsLoading, setCommentsLoading] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState<Record<string, Record<string, string>>>({});
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  };

  // Initial load: settings + projects + restore selection.
  useEffect(() => {
    const run = async () => {
      try {
        const s = await apiFetch<{ br_emails: string[] }>('/br-management/settings');
        setBrEmails(s.br_emails || []);
      } catch { /* ignore */ }
      finally { setSettingsLoaded(true); }
      try {
        const prj = await apiFetch<NamePair[]>('/br-management/azure/projects');
        setProjects(prj);
        const savedP = localStorage.getItem(LS_PROJECT) || '';
        if (savedP && prj.some((p) => p.name === savedP)) {
          setProject(savedP);
          setTeam(localStorage.getItem(LS_TEAM) || '');
          setSprintPath(localStorage.getItem(LS_SPRINT) || '');
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : t('br.error'));
      }
    };
    void run();
  }, [t]);

  // Project → teams
  useEffect(() => {
    if (!project) { setTeams([]); return; }
    localStorage.setItem(LS_PROJECT, project);
    let cancelled = false;
    (async () => {
      try {
        const ts = await apiFetch<NamePair[]>('/br-management/azure/teams?project=' + encodeURIComponent(project));
        if (!cancelled) setTeams(ts);
      } catch { if (!cancelled) setTeams([]); }
    })();
    return () => { cancelled = true; };
  }, [project]);

  // Team → sprints
  useEffect(() => {
    localStorage.setItem(LS_TEAM, team);
    if (!project || !team) { setSprints([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const sp = await apiFetch<Sprint[]>('/br-management/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team));
        if (!cancelled) setSprints(sp);
      } catch { if (!cancelled) setSprints([]); }
    })();
    return () => { cancelled = true; };
  }, [project, team]);

  useEffect(() => { localStorage.setItem(LS_SPRINT, sprintPath); }, [sprintPath]);

  const loadItems = useCallback(async () => {
    if (!project) { setItems([]); return; }
    setLoading(true);
    setErr('');
    try {
      const rows = await apiFetch<BRItem[]>(
        '/br-management/items?provider=azure&project=' + encodeURIComponent(project) +
        (sprintPath ? '&sprint_path=' + encodeURIComponent(sprintPath) : ''),
      );
      setItems(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('br.error'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [project, sprintPath, t]);

  // Refetch items when project or sprint changes.
  useEffect(() => { void loadItems(); }, [loadItems]);

  const stats = useMemo(() => {
    const s = { total: items.length, pending: 0, ready: 0, needs_info: 0, not_br: 0, epic: 0, improvement: 0 };
    for (const it of items) {
      if (!it.eval) { s.pending += 1; continue; }
      if (it.eval.verdict === 'ready') s.ready += 1;
      else if (it.eval.verdict === 'needs_info') s.needs_info += 1;
      else if (it.eval.verdict === 'not_br') s.not_br += 1;
      if (it.eval.br_type === 'epic') s.epic += 1;
      else if (it.eval.br_type === 'improvement') s.improvement += 1;
    }
    return s;
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = items.filter((it) => {
      if (filter === 'pending' && it.eval) return false;
      if (filter === 'ready' && it.eval?.verdict !== 'ready') return false;
      if (filter === 'needs_info' && it.eval?.verdict !== 'needs_info') return false;
      if (filter === 'not_br' && it.eval?.br_type !== 'not_br') return false;
      if (filter === 'epic' && it.eval?.br_type !== 'epic') return false;
      if (filter === 'improvement' && it.eval?.br_type !== 'improvement') return false;
      if (q) {
        const hay = (it.title + ' ' + (it.assignee_email || '') + ' ' + it.external_id).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    arr.sort((a, b) => {
      if (sortBy === 'type') return (a.work_item_type || '').localeCompare(b.work_item_type || '');
      if (sortBy === 'state') return (a.state || '').localeCompare(b.state || '');
      if (sortBy === 'score') return (b.eval?.readiness_score ?? -1) - (a.eval?.readiness_score ?? -1);
      if (sortBy === 'date') return (b.changed_date || '').localeCompare(a.changed_date || '');
      return (a.title || '').localeCompare(b.title || '');
    });
    return arr;
  }, [items, filter, search, sortBy]);

  const pending = filteredItems.filter((i) => !i.eval).length;

  const evaluate = useCallback(async (item: BRItem, answers?: Record<string, string>) => {
    setEvaluatingId(item.external_id);
    try {
      const ev = await apiFetch<BREval>('/br-management/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          source: item.source,
          external_id: item.external_id,
          title: item.title,
          description: item.description,
          assignee_email: item.assignee_email,
          ...(answers ? { answers } : {}),
        }),
      });
      setItems((prev) => prev.map((it) => it.external_id === item.external_id ? { ...it, eval: ev } : it));
      flash(t('br.evaluated'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally {
      setEvaluatingId(null);
    }
  }, [t]);

  const evaluateAll = useCallback(async () => {
    setEvaluatingAll(true);
    try {
      for (const item of filteredItems) {
        if (item.eval) continue;
        await evaluate(item);
      }
    } finally {
      setEvaluatingAll(false);
    }
  }, [filteredItems, evaluate]);

  const setStatus = useCallback(async (ev: BREval, status: 'accepted' | 'rejected') => {
    try {
      const updated = await apiFetch<BREval>('/br-management/evals/' + ev.id + '/status', {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setItems((prev) => prev.map((it) => it.eval?.id === ev.id ? { ...it, eval: updated } : it));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    }
  }, [t]);

  const openCard = useCallback(async (item: BRItem) => {
    const id = item.external_id;
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (comments[id] === undefined && project) {
      setCommentsLoading(id);
      try {
        const c = await apiFetch<Comment[]>(
          '/br-management/azure/comments?work_item_id=' + encodeURIComponent(id) +
          '&project=' + encodeURIComponent(project),
        );
        setComments((p) => ({ ...p, [id]: Array.isArray(c) ? c : [] }));
      } catch {
        setComments((p) => ({ ...p, [id]: [] }));
      } finally {
        setCommentsLoading(null);
      }
    }
  }, [expanded, comments, project]);

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="section-label">{t('br.sectionLabel')}</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
            {t('br.title')}
          </h1>
          <p style={{ color: 'var(--ink-35)', fontSize: 14, margin: 0 }}>{t('br.subtitle')}</p>
        </div>
        <a href="/dashboard/br-management/settings"
          style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-78)', fontWeight: 600, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <NavIcon name="settings" size={16} /> {t('nav.brManagementSettings')}
        </a>
      </div>

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 9999, padding: '12px 20px', borderRadius: 8, background: 'var(--surface)', border: '1px solid ' + (toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57'), color: toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57', fontSize: 13, fontWeight: 600 }}>
          {toast.msg}
        </div>
      )}

      {settingsLoaded && brEmails.length === 0 ? (
        <div style={{ padding: '20px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 600, color: '#c98a2b', fontSize: 14 }}>{t('br.noConfig')}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 4 }}>{t('br.noConfigDesc')}</div>
          </div>
          <a href="/dashboard/br-management/settings" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc)', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            {t('br.goSettings')}
          </a>
        </div>
      ) : (
        <>
          {/* Source selector bar */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)' }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('br.source.project')}</label>
              <select value={project} onChange={(e) => { setProject(e.target.value); setTeam(''); setSprintPath(''); }} style={selectStyle}>
                <option value="">{t('br.source.selectProject')}</option>
                {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('br.source.team')}</label>
              <select value={team} onChange={(e) => { setTeam(e.target.value); setSprintPath(''); }} disabled={!project} style={{ ...selectStyle, opacity: project ? 1 : 0.5 }}>
                <option value="">{t('br.source.selectTeam')}</option>
                {teams.map((tm) => <option key={tm.id} value={tm.name}>{tm.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('br.source.sprint')}</label>
              <select value={sprintPath} onChange={(e) => setSprintPath(e.target.value)} disabled={!team} style={{ ...selectStyle, opacity: team ? 1 : 0.5 }}>
                <option value="">{t('br.source.allOpen')}</option>
                {sprints.map((s) => <option key={s.id} value={s.path || s.name}>{s.name}{s.is_current ? ' ★' : ''}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('br.sort.label')}</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} style={{ ...selectStyle, minWidth: 130 }}>
                <option value="name">{t('br.sort.name')}</option>
                <option value="type">{t('br.sort.type')}</option>
                <option value="state">{t('br.sort.state')}</option>
                <option value="score">{t('br.sort.score')}</option>
                <option value="date">{t('br.sort.date')}</option>
              </select>
            </div>
            <div style={{ flex: 1 }} />
            {project && pending > 0 && (
              <button onClick={() => void evaluateAll()} disabled={evaluatingAll}
                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc)', fontWeight: 700, fontSize: 13, cursor: evaluatingAll ? 'default' : 'pointer', opacity: evaluatingAll ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <NavIcon name="zap" size={16} /> {evaluatingAll ? t('br.evaluating') : t('br.evaluateAll') + ' (' + pending + ')'}
              </button>
            )}
          </div>

          {/* Search + filter chips */}
          {project && items.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '0 1 320px', minWidth: 200 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', color: 'var(--ink-25)' }}><NavIcon name="search" size={14} /></span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('br.searchPlaceholder')}
                  style={{ width: '100%', padding: '8px 12px 8px 34px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  ['all', t('br.filter.all'), stats.total],
                  ['pending', t('br.filter.pending'), stats.pending],
                  ['ready', t('br.verdict.ready'), stats.ready],
                  ['needs_info', t('br.verdict.needs_info'), stats.needs_info],
                  ['epic', t('br.type.epic'), stats.epic],
                  ['improvement', t('br.type.improvement'), stats.improvement],
                  ['not_br', t('br.type.not_br'), stats.not_br],
                ] as [string, string, number][]).map(([key, label, count]) => {
                  const active = filter === key;
                  return (
                    <button key={key} onClick={() => setFilter(key)}
                      style={{ fontSize: 12, fontWeight: 700, padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
                        border: '1px solid ' + (active ? 'var(--acc)' : 'var(--panel-border-3)'),
                        background: active ? 'var(--acc-soft)' : 'var(--panel-alt)',
                        color: active ? 'var(--acc)' : 'var(--ink-58)' }}>
                      {label} <span style={{ opacity: 0.6 }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {err && (
            <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', color: '#cf5b57', fontSize: 13 }}>{err}</div>
          )}

          {!project ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-30)', fontSize: 14 }}>{t('br.source.pickToStart')}</div>
          ) : loading ? (
            <div style={{ color: 'var(--ink-30)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>{t('br.loading')}</div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-25)', fontSize: 14 }}>{t('br.noItems')}</div>
          ) : filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-25)', fontSize: 14 }}>{t('br.noMatch')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {filteredItems.map((item) => {
                const ev = item.eval;
                const isExpanded = expanded === item.external_id;
                const isEvaluating = evaluatingId === item.external_id;
                const draft = answerDraft[item.external_id] || {};
                return (
                  <div key={item.external_id} style={{ borderRadius: 10, border: '1px solid ' + (isExpanded ? 'var(--acc)' : 'var(--panel-border)'), background: isExpanded ? 'var(--acc-soft)' : 'var(--panel)', overflow: 'hidden' }}>
                    <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button onClick={() => void openCard(item)}
                        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14, lineHeight: 1.35 }}>{item.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-30)', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span>{item.assignee_email}</span>
                            <span style={{ padding: '1px 7px', borderRadius: 999, background: 'var(--panel-alt)', border: '1px solid var(--panel-border-2)', fontWeight: 600 }}>{item.work_item_type || '—'}</span>
                            <span>{item.state}</span>
                            <span style={{ fontFamily: 'monospace', color: 'var(--ink-25)' }}>#{item.external_id}</span>
                            {fmtDate(item.changed_date) && (
                              <span style={{ color: 'var(--ink-25)' }}>· {t('br.updatedShort')} {fmtDate(item.changed_date)}</span>
                            )}
                          </div>
                        </div>
                      </button>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer"
                          title={t('br.openInAzure')}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 13, fontWeight: 700, color: 'var(--acc)', textDecoration: 'none', padding: '2px 6px', borderRadius: 6, border: '1px solid var(--panel-border-2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          ↗
                        </a>
                      )}
                      {ev?.br_type && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: (TYPE_COLOR[ev.br_type] || '#94a3b8') + '20', border: '1px solid ' + (TYPE_COLOR[ev.br_type] || '#94a3b8') + '50', color: TYPE_COLOR[ev.br_type] || '#94a3b8', whiteSpace: 'nowrap' }}>
                          {t(('br.type.' + ev.br_type) as TranslationKey)}
                        </span>
                      )}
                      {typeof ev?.readiness_score === 'number' && (
                        <span style={{ fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: scoreColor(ev.readiness_score) + '20', color: scoreColor(ev.readiness_score), whiteSpace: 'nowrap' }}>
                          {ev.readiness_score}
                        </span>
                      )}
                      {ev?.verdict && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: VERDICT_COLOR[ev.verdict] || '#94a3b8', whiteSpace: 'nowrap' }}>
                          {t(('br.verdict.' + ev.verdict) as TranslationKey)}
                        </span>
                      )}
                      {!ev && (
                        <button onClick={() => void evaluate(item)} disabled={isEvaluating}
                          style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc)', cursor: isEvaluating ? 'default' : 'pointer', opacity: isEvaluating ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                          {isEvaluating ? t('br.evaluating') : t('br.evaluate')}
                        </button>
                      )}
                      <span style={{ fontSize: 16, color: 'var(--ink-25)', cursor: 'pointer', transform: isExpanded ? 'rotate(-90deg)' : 'rotate(90deg)', display: 'inline-flex' }} onClick={() => void openCard(item)}><NavIcon name="chevron-right" size={16} /></span>
                    </div>

                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--panel-alt)', padding: '14px 18px', display: 'grid', gap: 14 }}>
                        {/* Description (tarif) */}
                        {!!stripHtml(item.description) && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4 }}>{t('br.description')}</div>
                            <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>{stripHtml(item.description)}</div>
                          </div>
                        )}
                        {/* Comments (yorumlar) */}
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 6 }}>{t('br.comments')}</div>
                          {commentsLoading === item.external_id ? (
                            <div style={{ fontSize: 12, color: 'var(--ink-30)' }}>{t('br.loading')}</div>
                          ) : (comments[item.external_id] || []).length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--ink-25)' }}>{t('br.noComments')}</div>
                          ) : (
                            <div style={{ display: 'grid', gap: 8 }}>
                              {(comments[item.external_id] || []).map((c, i) => (
                                <div key={c.id ?? i} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border-2)' }}>
                                  <div style={{ fontSize: 11, color: 'var(--ink-35)', marginBottom: 2 }}>{c.created_by || '—'}{c.created_at ? ' · ' + String(c.created_at).slice(0, 10) : ''}</div>
                                  <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{stripHtml(c.text || '')}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {!ev && (
                          <div style={{ fontSize: 12, color: 'var(--ink-35)' }}>{t('br.notEvaluatedHint')}</div>
                        )}
                        {ev?.checklist && ev.checklist.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 8 }}>{t('br.checklist')}</div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              {ev.checklist.map((c, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                                  <span style={{ color: CHECK_COLOR[c.status] || '#94a3b8', fontWeight: 800, width: 14, flexShrink: 0, textAlign: 'center' }}>{CHECK_MARK[c.status] || '•'}</span>
                                  <span style={{ flex: 1, color: 'var(--ink-78)', lineHeight: 1.45 }}>
                                    <span style={{ fontWeight: 600 }}>{c.section}</span>
                                    {c.note && c.status !== 'ok' && <span style={{ color: 'var(--ink-45)' }}> — {c.note}</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ev?.reasoning && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4 }}>{t('br.reasoning')}</div>
                            <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.5 }}>{ev.reasoning}</div>
                          </div>
                        )}
                        {ev && ev.questions && ev.questions.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 8 }}>{t('br.questions')}</div>
                            <div style={{ display: 'grid', gap: 8 }}>
                              {ev.questions.map((q) => (
                                <div key={q.id} style={{ display: 'grid', gap: 4 }}>
                                  <div style={{ fontSize: 13, color: 'var(--ink-78)' }}>• {q.text}</div>
                                  <input
                                    value={draft[q.id] ?? (ev.answers?.[q.id] || '')}
                                    onChange={(e) => setAnswerDraft((prev) => ({ ...prev, [item.external_id]: { ...(prev[item.external_id] || {}), [q.id]: e.target.value } }))}
                                    placeholder={t('br.answerPlaceholder')}
                                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ev && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button onClick={() => void evaluate(item, { ...(ev.answers || {}), ...draft })} disabled={isEvaluating}
                              style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc)', cursor: isEvaluating ? 'default' : 'pointer', opacity: isEvaluating ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <NavIcon name="zap" size={14} /> {isEvaluating ? t('br.evaluating') : t('br.reEvaluate')}
                            </button>
                            <button onClick={() => void setStatus(ev, 'accepted')}
                              style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 8, border: '1px solid ' + (ev.status === 'accepted' ? '#3f9d6a' : 'var(--panel-border)'), background: ev.status === 'accepted' ? '#3f9d6a20' : 'transparent', color: ev.status === 'accepted' ? '#3f9d6a' : 'var(--ink-65)', cursor: 'pointer' }}>
                              {ev.status === 'accepted' ? '✓ ' + t('br.accepted') : t('br.accept')}
                            </button>
                            <button onClick={() => void setStatus(ev, 'rejected')}
                              style={{ fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 8, border: '1px solid ' + (ev.status === 'rejected' ? '#cf5b57' : 'var(--panel-border)'), background: ev.status === 'rejected' ? '#cf5b5720' : 'transparent', color: ev.status === 'rejected' ? '#cf5b57' : 'var(--ink-65)', cursor: 'pointer' }}>
                              {ev.status === 'rejected' ? '✕ ' + t('br.rejected') : t('br.reject')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
