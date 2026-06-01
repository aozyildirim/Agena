'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type Skill = {
  id: number;
  organization_id: number;
  source_task_id: number | null;
  name: string;
  description: string;
  pattern_type: string;
  tags: string[];
  touched_files: string[];
  approach_summary: string;
  prompt_fragment: string;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

type Page = {
  items: Skill[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

const PAGE_SIZE = 20;
const PATTERN_TYPES = ['all', 'fix-bug', 'refactor', 'add-feature', 'config', 'migration', 'perf', 'test', 'docs', 'other'];

const PATTERN_COLOURS: Record<string, string> = {
  'fix-bug': '#cf5b57',
  'refactor': '#5b9bd5',
  'add-feature': '#5b9bd5',
  'config': '#5b9bd5',
  'migration': '#c98a2b',
  'perf': '#c98a2b',
  'test': '#3f9d6a',
  'docs': '#94a3b8',
  'other': '#94a3b8',
};

export default function SkillsPage() {
  const { t } = useLocale();
  const tr = useCallback((k: string) => t(k as Parameters<typeof t>[0]), [t]);

  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [patternFilter, setPatternFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<'team' | 'public'>('team');
  // Import-defaults flow state. Two stages: confirm → result. We keep
  // it modal-based instead of window.confirm + alert so the rest of
  // the dashboard's portal-modal style stays consistent.
  const [importStage, setImportStage] = useState<'idle' | 'confirm' | 'running' | 'result'>('idle');
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string>('');
  const [newSkill, setNewSkill] = useState<{ name: string; description: string; pattern_type: string; tags: string; approach_summary: string; prompt_fragment: string }>(
    { name: '', description: '', pattern_type: 'other', tags: '', approach_summary: '', prompt_fragment: '' }
  );
  const [saving, setSaving] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (patternFilter && patternFilter !== 'all') params.set('pattern_type', patternFilter);
      if (search.trim()) params.set('q', search.trim());
      const resp = await apiFetch<Page>(`/skills?${params.toString()}`);
      setData(resp);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('skills.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, patternFilter, search, tr]);

  // Reset to page 1 on filter/search change
  useEffect(() => { setPage(1); }, [patternFilter, search]);

  // Debounce search, react to other filters
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => { void load(); }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [load]);

  async function deleteSkill(id: number) {
    if (!confirm(tr('skills.confirmDelete'))) return;
    try {
      await apiFetch(`/skills/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('skills.deleteFailed'));
    }
  }

  async function saveNew() {
    setSaving(true);
    try {
      await apiFetch('/skills', {
        method: 'POST',
        body: JSON.stringify({
          name: newSkill.name.trim(),
          description: newSkill.description.trim(),
          pattern_type: newSkill.pattern_type,
          tags: newSkill.tags.split(',').map((x) => x.trim()).filter(Boolean),
          approach_summary: newSkill.approach_summary.trim(),
          prompt_fragment: newSkill.prompt_fragment.trim(),
        }),
      });
      setCreateOpen(false);
      setNewSkill({ name: '', description: '', pattern_type: 'other', tags: '', approach_summary: '', prompt_fragment: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('skills.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1200, paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div className='section-label'>{tr('skills.sectionLabel')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6, marginBottom: 2 }}>
            {tr('skills.title')}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--ink-30)', margin: 0 }}>
            {tr('skills.subtitle')}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {[{ id: 'team' as const, label: tr('skills.tab.team' as Parameters<typeof tr>[0]) || 'Team Skills' }, { id: 'public' as const, label: tr('skills.tab.public' as Parameters<typeof tr>[0]) || 'Public Library' }].map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${view === t.id ? 'var(--acc)' : 'var(--panel-border)'}`,
                  background: view === t.id ? 'var(--acc-soft)' : 'var(--surface)',
                  color: view === t.id ? 'var(--acc)' : 'var(--ink-78)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => { setImportError(''); setImportResult(null); setImportStage('confirm'); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--panel)',
            color: 'var(--ink-78)', cursor: 'pointer',
          }}
        >
          <NavIcon name="zap" size={16} /> {tr('skills.importDefaults' as Parameters<typeof tr>[0])}
        </button>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--acc)',
            background: 'var(--acc)',
            color: '#fff', cursor: 'pointer',
          }}
        >
          <NavIcon name="plus" size={16} /> {tr('skills.newSkill')}
        </button>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            fontSize: 12, padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
            color: 'var(--ink-78)', cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? tr('skills.loading') : tr('skills.refresh')}
        </button>
      </div>

      {view === 'team' && (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type='search'
          placeholder={tr('skills.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', minWidth: 280 }}
        />
        <select
          value={patternFilter}
          onChange={(e) => setPatternFilter(e.target.value)}
          style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)' }}
        >
          {PATTERN_TYPES.map((pt) => (
            <option key={pt} value={pt}>{pt === 'all' ? tr('skills.allTypes') : pt}</option>
          ))}
        </select>
        {data && (
          <span style={{ fontSize: 12, color: 'var(--ink-45)' }}>
            {data.total.toLocaleString()} {tr('skills.resultSuffix')}
          </span>
        )}
      </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(207,91,87,0.35)', background: 'rgba(207,91,87,0.06)', color: '#cf5b57', fontSize: 13 }}>
          {error}
        </div>
      )}

      {view === 'public' && <PublicSkillsLibrary />}

      {view === 'team' && !loading && data && data.items.length === 0 && (
        <div style={{
          padding: 24, borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
          textAlign: 'center', color: 'var(--ink-45)',
        }}>
          <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center', color: 'var(--ink-35)' }}><NavIcon name="clipboard" size={28} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{tr('skills.empty.title')}</div>
          <div style={{ fontSize: 12 }}>{tr('skills.empty.hint')}</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {view === 'team' && (() => {
          const teamItems = data?.items || [];
          // Group team skills by pattern_type so similar patterns surface
          // together — much easier to scan a 50-skill catalog at a glance.
          const groups: Record<string, typeof teamItems> = {};
          for (const s of teamItems) {
            const k = s.pattern_type || 'other';
            (groups[k] = groups[k] || []).push(s);
          }
          // Stable order: most populated buckets first, then alphabetical.
          const sortedKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
          return sortedKeys.map((groupKey) => (
            <div key={groupKey}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>{groupKey}</span>
                <span style={{ color: 'var(--ink-25)' }}>{groups[groupKey].length}</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {groups[groupKey].map((s) => {
          const isOpen = expanded === s.id;
          const color = PATTERN_COLOURS[s.pattern_type] || PATTERN_COLOURS['other'];
          return (
            <div key={s.id} style={{
              border: `1px solid ${isOpen ? color + '66' : 'var(--panel-border-2)'}`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 10, background: 'var(--panel)',
              transition: 'border-color 0.15s',
            }}>
              <div
                onClick={() => setExpanded(isOpen ? null : s.id)}
                style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 6,
                  background: `${color}1e`, color, textTransform: 'uppercase', letterSpacing: 0.6,
                  flexShrink: 0,
                }}>
                  {s.pattern_type}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: 1.35 }}>
                  {s.name}
                </span>
                {s.usage_count > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--acc)', padding: '2px 8px', borderRadius: 999, background: 'var(--acc-soft)' }}>
                    ↻ {s.usage_count}
                  </span>
                )}
                {(s.tags || []).slice(0, 3).map((tag) => (
                  <span key={tag} style={{ fontSize: 11, color: 'var(--ink-58)', padding: '2px 8px', borderRadius: 999, background: 'var(--panel-alt)' }}>
                    #{tag}
                  </span>
                ))}
                {s.source_task_id && (
                  <a
                    href={`/tasks/${s.source_task_id}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ fontSize: 11, color: '#5b9bd5', textDecoration: 'none', padding: '2px 6px', borderRadius: 6 }}
                  >
                    ← #{s.source_task_id}
                  </a>
                )}
                <span style={{ display: 'inline-flex', color: 'var(--ink-42)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><NavIcon name="chevron-right" size={14} /></span>
              </div>
              {isOpen && (
                <div style={{ padding: '0 12px 12px', display: 'grid', gap: 10 }}>
                  {s.description && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                        {tr('skills.col.description')}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{s.description}</div>
                    </div>
                  )}
                  {s.approach_summary && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                        {tr('skills.col.approach')}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{s.approach_summary}</div>
                    </div>
                  )}
                  {s.prompt_fragment && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                        {tr('skills.col.promptFragment')}
                      </div>
                      <div style={{
                        fontSize: 12, color: 'var(--ink-78)', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                        padding: '10px 12px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}>
                        {s.prompt_fragment}
                      </div>
                    </div>
                  )}
                  {s.touched_files && s.touched_files.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                        {tr('skills.col.touchedFiles')}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-65)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {s.touched_files.map((f, i) => (
                          <div key={i} style={{ padding: '2px 0' }}>· {f}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--ink-45)', flexWrap: 'wrap', marginTop: 4 }}>
                    <span>{tr('skills.col.created')}: {new Date(s.created_at).toLocaleDateString()}</span>
                    {s.last_used_at && (
                      <span>{tr('skills.col.lastUsed')}: {new Date(s.last_used_at).toLocaleDateString()}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteSkill(s.id); }}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(207,91,87,0.35)', background: 'transparent', color: '#cf5b57', cursor: 'pointer' }}
                    >
                      {tr('skills.delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
                })}
              </div>
            </div>
          ));
        })()}
      </div>

      {/* Pagination */}
      {view === 'team' && data && data.total_pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 }}>
          <button onClick={() => setPage(1)} disabled={page <= 1} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}>« {tr('skills.pager.first')}</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}>‹ {tr('skills.pager.prev')}</button>
          <span style={{ fontSize: 12, color: 'var(--ink-78)', minWidth: 100, textAlign: 'center' }}>
            {tr('skills.pager.page')} <b>{data.page}</b> / {data.total_pages}
          </span>
          <button onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))} disabled={page >= data.total_pages} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page >= data.total_pages ? 'default' : 'pointer', opacity: page >= data.total_pages ? 0.4 : 1 }}>{tr('skills.pager.next')} ›</button>
          <button onClick={() => setPage(data.total_pages)} disabled={page >= data.total_pages} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page >= data.total_pages ? 'default' : 'pointer', opacity: page >= data.total_pages ? 0.4 : 1 }}>{tr('skills.pager.last')} »</button>
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(560px, 100%)', background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 22, display: 'grid', gap: 12 }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-90)' }}>{tr('skills.newSkill')}</div>
            <input
              type='text'
              placeholder={tr('skills.field.name')}
              value={newSkill.name}
              onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)' }}
            />
            <select
              value={newSkill.pattern_type}
              onChange={(e) => setNewSkill({ ...newSkill, pattern_type: e.target.value })}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)' }}
            >
              {PATTERN_TYPES.filter((p) => p !== 'all').map((pt) => (
                <option key={pt} value={pt}>{pt}</option>
              ))}
            </select>
            <input
              type='text'
              placeholder={tr('skills.field.tags')}
              value={newSkill.tags}
              onChange={(e) => setNewSkill({ ...newSkill, tags: e.target.value })}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)' }}
            />
            <textarea
              placeholder={tr('skills.field.description')}
              value={newSkill.description}
              onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })}
              rows={2}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', minHeight: 60 }}
            />
            <textarea
              placeholder={tr('skills.field.approach')}
              value={newSkill.approach_summary}
              onChange={(e) => setNewSkill({ ...newSkill, approach_summary: e.target.value })}
              rows={3}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', minHeight: 80 }}
            />
            <textarea
              placeholder={tr('skills.field.promptFragment')}
              value={newSkill.prompt_fragment}
              onChange={(e) => setNewSkill({ ...newSkill, prompt_fragment: e.target.value })}
              rows={3}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', minHeight: 80, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => setCreateOpen(false)}
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-65)', cursor: 'pointer' }}
              >
                {tr('skills.cancel')}
              </button>
              <button
                onClick={() => void saveNew()}
                disabled={saving || !newSkill.name.trim()}
                style={{ padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid var(--acc)', background: 'var(--acc)', color: '#fff', cursor: saving ? 'wait' : 'pointer', opacity: saving || !newSkill.name.trim() ? 0.5 : 1 }}
              >
                {saving ? tr('skills.saving') : tr('skills.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import defaults modal — confirm + result in the same dialog. */}
      {importStage !== 'idle' && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.7)',
            zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => importStage !== 'running' && setImportStage('idle')}
        >
          <div
            style={{
              width: 'min(440px, 92vw)', borderRadius: 10, padding: '20px 22px',
              background: 'var(--surface)', border: '1px solid var(--panel-border-2)',
              display: 'grid', gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', color: 'var(--acc)' }}><NavIcon name="zap" size={22} /></div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>
              {tr('skills.importDefaults' as Parameters<typeof tr>[0])}
            </h3>

            {importStage === 'confirm' && (
              <>
                <p style={{ fontSize: 13, color: 'var(--ink-65)', lineHeight: 1.6, margin: 0 }}>
                  {tr('skills.importDefaultsConfirm' as Parameters<typeof tr>[0])}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type='button'
                    onClick={() => setImportStage('idle')}
                    style={{
                      flex: 1, padding: '10px 16px', borderRadius: 8,
                      border: '1px solid var(--panel-border-2)', background: 'transparent',
                      color: 'var(--ink-50)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {tr('skills.cancel' as Parameters<typeof tr>[0])}
                  </button>
                  <button
                    type='button'
                    onClick={async () => {
                      setImportStage('running');
                      try {
                        const r = await apiFetch<{ inserted: number; skipped: number; total: number }>(
                          '/skills/import-defaults', { method: 'POST' },
                        );
                        setImportResult(r);
                        setImportStage('result');
                        void load();
                      } catch (e) {
                        setImportError(e instanceof Error ? e.message : 'Import failed');
                        setImportStage('result');
                      }
                    }}
                    style={{
                      flex: 2, padding: '10px 16px', borderRadius: 8,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      border: '1px solid var(--acc)',
                      background: 'var(--acc)', color: '#fff',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    <NavIcon name="zap" size={16} /> {tr('skills.importDefaults' as Parameters<typeof tr>[0])}
                  </button>
                </div>
              </>
            )}

            {importStage === 'running' && (
              <p style={{ fontSize: 13, color: 'var(--ink-65)', margin: 0 }}>
                {tr('skills.loading')}
              </p>
            )}

            {importStage === 'result' && (
              <>
                {importError ? (
                  <div style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: 'rgba(207,91,87,0.08)', border: '1px solid rgba(207,91,87,0.3)',
                    color: '#cf5b57', fontSize: 13,
                  }}>
                    {importError}
                  </div>
                ) : importResult ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 8,
                    background: 'rgba(63,157,106,0.08)', border: '1px solid rgba(63,157,106,0.35)',
                    color: '#3f9d6a', fontSize: 13, lineHeight: 1.5,
                  }}>
                    {tr('skills.importDefaultsResult' as Parameters<typeof tr>[0])
                      .replace('{inserted}', String(importResult.inserted))
                      .replace('{skipped}', String(importResult.skipped))
                      .replace('{total}', String(importResult.total))}
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type='button'
                    onClick={() => setImportStage('idle')}
                    style={{
                      padding: '8px 16px', borderRadius: 8,
                      border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
                      color: 'var(--ink-78)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {tr('skills.close' as Parameters<typeof tr>[0])}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Public Skills Library ─────────────────────────────────────────────
type PublicSkill = {
  id: number;
  name: string;
  description: string;
  pattern_type: string;
  tags: string[];
  is_active: boolean;
  publisher: string | null;
  external_url: string | null;
  usage_count: number;
};

function PublicSkillsLibrary() {
  const [items, setItems] = useState<PublicSkill[] | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const params = new URLSearchParams({ page: '1', page_size: '500' });
      if (search.trim()) params.set('q', search.trim());
      const r = await apiFetch<{ items: PublicSkill[]; total: number }>(`/skills/public/list?${params.toString()}`);
      setItems(r.items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function toggle(id: number) {
    try {
      const r = await apiFetch<{ id: number; is_active: boolean }>(`/skills/public/${id}/toggle`, { method: 'POST' });
      setItems((prev) => prev?.map((it) => it.id === id ? { ...it, is_active: r.is_active } : it) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runImport() {
    setImporting(true); setMsg(''); setError('');
    try {
      const r = await apiFetch<{ results: Record<string, { found: number; inserted: number; updated: number; skipped: number }> }>(
        '/skills/public/import', { method: 'POST' }
      );
      const total = Object.values(r.results).reduce((s, v) => s + (v.inserted || 0) + (v.updated || 0), 0);
      setMsg(`${total} skill imported / updated. Refreshing…`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  // Group by publisher for an at-a-glance catalog feel.
  const grouped = (items || []).reduce<Record<string, PublicSkill[]>>((acc, s) => {
    const k = s.publisher || 'Unknown';
    (acc[k] = acc[k] || []).push(s);
    return acc;
  }, {});

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <input
          placeholder='Search public skills…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)' }}
        />
        <button
          onClick={() => void runImport()}
          disabled={importing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--acc)', background: 'var(--acc)', color: '#fff', cursor: importing ? 'wait' : 'pointer' }}
        >
          {importing ? 'Importing…' : <><NavIcon name="plus" size={16} /> Import / refresh public library</>}
        </button>
        {items !== null && (
          <span style={{ fontSize: 12, color: 'var(--ink-45)' }}>
            {items.filter((s) => s.is_active).length} active / {items.length} total
          </span>
        )}
      </div>
      {msg && <div style={{ fontSize: 12, color: '#3f9d6a', padding: '8px 12px', borderRadius: 8, background: 'rgba(63,157,106,0.08)', border: '1px solid rgba(63,157,106,0.25)' }}>{msg}</div>}
      {error && <div style={{ fontSize: 12, color: '#cf5b57', padding: '8px 12px', borderRadius: 8, background: 'rgba(207,91,87,0.06)', border: '1px solid rgba(207,91,87,0.35)' }}>{error}</div>}

      {items === null ? (
        <div style={{ padding: 24, color: 'var(--ink-45)', fontSize: 13 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', textAlign: 'center' }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', color: 'var(--ink-35)' }}><NavIcon name="book" size={28} /></div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>Public library is empty</div>
          <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 4 }}>Click <em>Import / refresh public library</em> above to pull skills from awesome-agent-skills.</div>
        </div>
      ) : (
        Object.entries(grouped).map(([publisher, list]) => (
          <div key={publisher}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-35)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span>{publisher}</span>
              <span style={{ color: 'var(--ink-25)' }}>{list.length}</span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map((s) => {
                // Mirrors the Team Skills card layout — same border-left
                // colour-coded by pattern_type, same name + tag chips +
                // wrap behaviour. Adds a right-aligned active toggle (and
                // delete for admins) instead of an expand arrow.
                const color = PATTERN_COLOURS[s.pattern_type] || PATTERN_COLOURS['other'];
                return (
                  <div key={s.id} style={{
                    border: `1px solid ${s.is_active ? color + '55' : 'var(--panel-border-2)'}`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 10,
                    background: s.is_active ? `${color}06` : 'var(--panel)',
                    transition: 'border-color 0.15s, background 0.15s',
                    opacity: s.is_active ? 1 : 0.7,
                  }}>
                    <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 6,
                        background: `${color}1e`, color, textTransform: 'uppercase', letterSpacing: 0.6,
                        flexShrink: 0,
                      }}>
                        {s.pattern_type}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: 1.35 }}>
                        {s.name}
                      </span>
                      {(s.tags || []).slice(0, 3).map((tag) => (
                        <span key={tag} style={{ fontSize: 11, color: 'var(--ink-58)', padding: '2px 8px', borderRadius: 999, background: 'var(--panel-alt)' }}>
                          #{tag}
                        </span>
                      ))}
                      {s.external_url && (
                        <a
                          href={s.external_url}
                          target='_blank' rel='noreferrer'
                          onClick={(e) => e.stopPropagation()}
                          title='View source SKILL.md'
                          style={{ fontSize: 11, color: '#5b9bd5', textDecoration: 'none', padding: '2px 7px', borderRadius: 6, background: 'rgba(91,155,213,0.08)' }}
                        >
                          ↗ source
                        </a>
                      )}
                      <div
                        onClick={() => void toggle(s.id)}
                        title={s.is_active ? 'Aktif — devre dışı bırak' : 'Pasif — aktif et'}
                        style={{
                          width: 36, height: 20, borderRadius: 999,
                          background: s.is_active ? '#3f9d6a' : 'var(--panel-border-3)',
                          position: 'relative', cursor: 'pointer', transition: 'background 0.18s', flexShrink: 0,
                        }}
                      >
                        <div style={{ position: 'absolute', top: 2, left: s.is_active ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.18s' }} />
                      </div>
                    </div>
                    {s.description && (
                      <div style={{
                        padding: '0 12px 10px',
                        fontSize: 12, color: 'var(--ink-58)', lineHeight: 1.5,
                        overflowWrap: 'anywhere', wordBreak: 'break-word',
                      }}>
                        {s.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
