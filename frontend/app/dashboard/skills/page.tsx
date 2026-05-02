'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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
  'fix-bug': '#f87171',
  'refactor': '#a78bfa',
  'add-feature': '#5eead4',
  'config': '#7dd3fc',
  'migration': '#fde68a',
  'perf': '#fb923c',
  'test': '#86efac',
  'docs': '#94a3b8',
  'other': '#cbd5e1',
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className='section-label'>{tr('skills.sectionLabel')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6, marginBottom: 2 }}>
            {tr('skills.title')}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--ink-30)', margin: 0 }}>
            {tr('skills.subtitle')}
          </p>
        </div>
        <button
          onClick={() => { setImportError(''); setImportResult(null); setImportStage('confirm'); }}
          style={{
            fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 10,
            border: '1px solid rgba(167,139,250,0.5)',
            background: 'rgba(167,139,250,0.12)',
            color: '#a78bfa', cursor: 'pointer',
          }}
        >
          ✨ {tr('skills.importDefaults' as Parameters<typeof tr>[0])}
        </button>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 10,
            border: '1px solid rgba(13,148,136,0.6)',
            background: 'linear-gradient(135deg, #0d9488, #5eead4)',
            color: '#0a1815', cursor: 'pointer',
          }}
        >
          + {tr('skills.newSkill')}
        </button>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            fontSize: 12, padding: '8px 12px', borderRadius: 10,
            border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
            color: 'var(--ink-78)', cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? tr('skills.loading') : tr('skills.refresh')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type='search'
          placeholder={tr('skills.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 13, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', minWidth: 280 }}
        />
        <select
          value={patternFilter}
          onChange={(e) => setPatternFilter(e.target.value)}
          style={{ fontSize: 13, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)' }}
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

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.06)', color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && data && data.items.length === 0 && (
        <div style={{
          padding: 24, borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
          textAlign: 'center', color: 'var(--ink-45)',
        }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{tr('skills.empty.title')}</div>
          <div style={{ fontSize: 12 }}>{tr('skills.empty.hint')}</div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {(data?.items || []).map((s) => {
          const isOpen = expanded === s.id;
          const color = PATTERN_COLOURS[s.pattern_type] || PATTERN_COLOURS['other'];
          return (
            <div key={s.id} style={{
              border: `1px solid ${isOpen ? color + '66' : 'var(--panel-border-2)'}`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 12, background: 'var(--panel)',
              boxShadow: isOpen ? `0 0 0 3px ${color}14` : 'none',
              transition: 'border-color 0.15s, box-shadow 0.15s',
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
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', padding: '2px 8px', borderRadius: 999, background: 'rgba(94,234,212,0.1)' }}>
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
                    style={{ fontSize: 11, color: '#7dd3fc', textDecoration: 'none', padding: '2px 6px', borderRadius: 4 }}
                  >
                    ← #{s.source_task_id}
                  </a>
                )}
                <span style={{ fontSize: 11, color: 'var(--ink-42)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
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
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', color: '#fca5a5', cursor: 'pointer' }}
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

      {/* Pagination */}
      {data && data.total_pages > 1 && (
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
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(560px, 100%)', background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 14, padding: 22, display: 'grid', gap: 12 }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)' }}>{tr('skills.newSkill')}</div>
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
                style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-65)', cursor: 'pointer' }}
              >
                {tr('skills.cancel')}
              </button>
              <button
                onClick={() => void saveNew()}
                disabled={saving || !newSkill.name.trim()}
                style={{ padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(13,148,136,0.6)', background: 'linear-gradient(135deg, #0d9488, #5eead4)', color: '#0a1815', cursor: saving ? 'wait' : 'pointer', opacity: saving || !newSkill.name.trim() ? 0.5 : 1 }}
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
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => importStage !== 'running' && setImportStage('idle')}
        >
          <div
            style={{
              width: 'min(440px, 92vw)', borderRadius: 16, padding: '20px 22px',
              background: 'var(--surface)', border: '1px solid var(--panel-border-2)',
              display: 'grid', gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 22 }}>✨</div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
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
                      flex: 1, padding: '10px 16px', borderRadius: 10,
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
                      flex: 2, padding: '10px 16px', borderRadius: 10,
                      border: '1px solid rgba(167,139,250,0.5)',
                      background: 'rgba(167,139,250,0.15)', color: '#c4b5fd',
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    ✨ {tr('skills.importDefaults' as Parameters<typeof tr>[0])}
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
                    padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#fca5a5', fontSize: 13,
                  }}>
                    {importError}
                  </div>
                ) : importResult ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)',
                    color: '#86efac', fontSize: 13, lineHeight: 1.5,
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
                      padding: '8px 16px', borderRadius: 10,
                      border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
                      color: 'var(--ink-78)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
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
