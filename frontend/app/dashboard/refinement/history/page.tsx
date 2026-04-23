'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type IndexPreview = {
  enabled: boolean;
  total: number;
  sp_distribution: { sp: number; count: number }[];
  top_assignees: { name: string; count: number }[];
  work_item_types: { type: string; count: number }[];
  samples: {
    external_id: string;
    title: string;
    story_points: number;
    assigned_to: string;
    url: string;
    work_item_type: string;
    sprint_name?: string;
    sprint_path?: string;
    completed_at?: string;
    created_at?: string;
  }[];
};

type SortMode = 'recent' | 'sp_asc' | 'sp_desc' | 'assignee';

type Item = {
  external_id: string;
  title: string;
  story_points: number;
  assigned_to: string;
  url: string;
  work_item_type: string;
  source: string;
  sprint_name?: string;
  sprint_path?: string;
  completed_at?: string;
  created_at?: string;
  state?: string;
};

type ItemsPage = {
  items: Item[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

const PAGE_SIZE = 50;

export default function RefinementHistoryPage() {
  const { t } = useLocale();
  const tr = (k: string) => t(k as Parameters<typeof t>[0]);
  const [preview, setPreview] = useState<IndexPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [spFilter, setSpFilter] = useState<number | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('recent');
  const [page, setPage] = useState(1);
  const [itemsPage, setItemsPage] = useState<ItemsPage | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const samplesRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySpFilter = (sp: number | null) => {
    setSpFilter(sp);
    if (sp != null) samplesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const applyAssigneeFilter = (name: string | null) => {
    setAssigneeFilter(name);
    if (name) samplesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<IndexPreview>('/refinement/history/preview');
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('refinementHistory.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(); }, [load]);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
        sort,
      });
      if (spFilter != null) params.set('sp', String(spFilter));
      if (assigneeFilter) params.set('assignee', assigneeFilter);
      if (search.trim()) params.set('q', search.trim());
      const data = await apiFetch<ItemsPage>(`/refinement/history/items?${params.toString()}`);
      setItemsPage(data);
    } catch {
      setItemsPage(null);
    } finally {
      setItemsLoading(false);
    }
  }, [page, sort, spFilter, assigneeFilter, search]);

  // Reset to page 1 whenever any filter/sort changes
  useEffect(() => {
    setPage(1);
  }, [sort, spFilter, assigneeFilter, search]);

  // Debounce search, reactive for others
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => { void loadItems(); }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [loadItems]);

  const totalSp = useMemo(
    () => (preview?.sp_distribution || []).reduce((acc, x) => acc + x.sp * x.count, 0),
    [preview],
  );
  const avgSp = useMemo(
    () => (preview && preview.total > 0 ? totalSp / preview.total : 0),
    [preview, totalSp],
  );

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1200, paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link
          href='/dashboard/refinement'
          style={{
            fontSize: 12, color: 'var(--ink-45)', textDecoration: 'none',
            padding: '4px 10px', borderRadius: 8, border: '1px solid var(--panel-border)',
          }}
        >
          {tr('refinementHistory.back')}
        </Link>
        <div style={{ flex: 1 }}>
          <div className='section-label'>{tr('refinementHistory.sectionLabel')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6, marginBottom: 2 }}>
            {tr('refinementHistory.title')}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--ink-30)', margin: 0 }}>
            {tr('refinementHistory.subtitle')}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            fontSize: 12, padding: '6px 12px', borderRadius: 8,
            border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
            color: 'var(--ink-78)', cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? tr('refinementHistory.loading') : tr('refinementHistory.refresh')}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.06)', color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && preview && preview.total === 0 && (
        <div style={{
          padding: 24, borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
          textAlign: 'center', color: 'var(--ink-45)',
        }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📭</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{tr('refinementHistory.empty.title')}</div>
          <div style={{ fontSize: 12 }}>{tr('refinementHistory.empty.hint')}</div>
        </div>
      )}

      {preview && preview.total > 0 && (
        <>
          {/* Top stats */}
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {[
              { label: tr('refinementHistory.stats.total'), value: preview.total.toLocaleString() },
              { label: tr('refinementHistory.stats.totalSp'), value: totalSp.toLocaleString() },
              { label: tr('refinementHistory.stats.avgSp'), value: avgSp.toFixed(1) },
              { label: tr('refinementHistory.stats.people'), value: String(preview.top_assignees.length) },
              { label: tr('refinementHistory.stats.types'), value: String(preview.work_item_types.length) },
            ].map((s) => (
              <div key={s.label} style={{
                padding: '12px 14px', borderRadius: 12, border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 4 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* SP distribution + WIT types side by side */}
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div style={{ padding: 14, borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>
                {tr('refinementHistory.spDistribution')}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {preview.sp_distribution.map(({ sp, count }) => {
                  const max = Math.max(...preview.sp_distribution.map((x) => x.count));
                  const pct = max ? (count / max) * 100 : 0;
                  const active = spFilter === sp;
                  return (
                    <button
                      key={sp}
                      onClick={() => applySpFilter(active ? null : sp)}
                      style={{
                        minWidth: 72, padding: '10px 12px', borderRadius: 10,
                        border: active ? '1.5px solid #5eead4' : '1px solid var(--panel-border)',
                        background: active
                          ? `linear-gradient(90deg, rgba(94,234,212,0.25) ${pct}%, rgba(94,234,212,0.08) ${pct}%)`
                          : `linear-gradient(90deg, rgba(94,234,212,0.15) ${pct}%, transparent ${pct}%)`,
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <div style={{ fontSize: 11, color: active ? '#5eead4' : 'var(--ink-50)', fontWeight: 700 }}>{sp} SP</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>{count}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ padding: 14, borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>
                {tr('refinementHistory.workItemTypes')}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {preview.work_item_types.map((t) => {
                  const max = preview.work_item_types[0]?.count || 1;
                  const pct = (t.count / max) * 100;
                  return (
                    <div key={t.type} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 48px', gap: 10, alignItems: 'center', fontSize: 12 }}>
                      <div style={{ color: 'var(--ink-78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.type}
                      </div>
                      <div style={{ height: 5, background: 'var(--panel-border)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #0d9488, #38bdf8)' }} />
                      </div>
                      <div style={{ textAlign: 'right', color: 'var(--ink-85)', fontWeight: 700 }}>{t.count}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Top assignees */}
          {preview.top_assignees.length > 0 && (
            <div style={{ padding: 14, borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>
                {tr('refinementHistory.topAssignees')}
              </div>
              <div style={{ display: 'grid', gap: 5 }}>
                {preview.top_assignees.map((a) => {
                  const max = preview.top_assignees[0]?.count || 1;
                  const pct = (a.count / max) * 100;
                  const active = assigneeFilter === a.name;
                  return (
                    <button
                      key={a.name}
                      onClick={() => applyAssigneeFilter(active ? null : a.name)}
                      style={{
                        display: 'grid', gridTemplateColumns: '260px 1fr 60px', gap: 10, alignItems: 'center',
                        fontSize: 12, padding: '4px 6px', borderRadius: 6,
                        background: active ? 'rgba(94,234,212,0.08)' : 'transparent',
                        border: active ? '1px solid rgba(94,234,212,0.35)' : '1px solid transparent',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <div style={{ color: active ? '#5eead4' : 'var(--ink-78)', fontWeight: active ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.name}
                      </div>
                      <div style={{ height: 6, background: 'var(--panel-border)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #0d9488, #5eead4)' }} />
                      </div>
                      <div style={{ textAlign: 'right', color: 'var(--ink-85)', fontWeight: 700 }}>{a.count}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Items — paginated, server-side filter/sort */}
          <div ref={samplesRef} style={{
            padding: 14, borderRadius: 14,
            border: (spFilter != null || assigneeFilter) ? '1px solid rgba(94,234,212,0.45)' : '1px solid var(--panel-border-2)',
            background: 'var(--panel)',
            boxShadow: (spFilter != null || assigneeFilter) ? '0 0 0 3px rgba(94,234,212,0.08)' : 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}>
            {(spFilter != null || assigneeFilter || search) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '8px 10px', borderRadius: 10, marginBottom: 10,
                background: 'rgba(94,234,212,0.08)',
                border: '1px solid rgba(94,234,212,0.25)',
                fontSize: 12,
              }}>
                <span style={{ color: '#5eead4', fontWeight: 700 }}>{tr('refinementHistory.items.activeFilter')}:</span>
                {spFilter != null && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(94,234,212,0.2)', color: '#5eead4', fontWeight: 700 }}>
                    {spFilter} SP
                    <button onClick={() => setSpFilter(null)} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#5eead4', cursor: 'pointer', fontSize: 13 }}>×</button>
                  </span>
                )}
                {assigneeFilter && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(94,234,212,0.2)', color: '#5eead4', fontWeight: 700 }}>
                    👤 {assigneeFilter}
                    <button onClick={() => setAssigneeFilter(null)} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#5eead4', cursor: 'pointer', fontSize: 13 }}>×</button>
                  </span>
                )}
                {search && (
                  <span style={{ padding: '3px 10px', borderRadius: 999, background: 'rgba(94,234,212,0.2)', color: '#5eead4', fontWeight: 700 }}>
                    "{search}"
                    <button onClick={() => setSearch('')} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#5eead4', cursor: 'pointer', fontSize: 13 }}>×</button>
                  </span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 }}>
                {tr('refinementHistory.items.title')} {itemsPage ? `(${itemsPage.total.toLocaleString()} ${tr('refinementHistory.items.resultSuffix')})` : ''}
              </div>
              {(spFilter != null || assigneeFilter) && (
                <button
                  onClick={() => { setSpFilter(null); setAssigneeFilter(null); setSearch(''); }}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-45)', cursor: 'pointer' }}
                >
                  {tr('refinementHistory.items.clearFilters')}
                </button>
              )}
              <input
                type='search'
                placeholder={tr('refinementHistory.items.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', color: 'var(--ink-90)', minWidth: 200 }}
              />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', color: 'var(--ink-78)' }}
              >
                <option value='recent'>{tr('refinementHistory.items.sort.recent')}</option>
                <option value='sp_desc'>{tr('refinementHistory.items.sort.spDesc')}</option>
                <option value='sp_asc'>{tr('refinementHistory.items.sort.spAsc')}</option>
                <option value='assignee'>{tr('refinementHistory.items.sort.assignee')}</option>
              </select>
            </div>
            {/* Column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '60px 86px 100px 1fr 150px 170px', gap: 10,
              padding: '6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 0.6,
              borderBottom: '1px solid var(--panel-border-2)',
            }}>
              <span>{tr('refinementHistory.col.sp')}</span>
              <span>{tr('refinementHistory.col.type')}</span>
              <span>{tr('refinementHistory.col.completed')}</span>
              <span>{tr('refinementHistory.col.title')}</span>
              <span>{tr('refinementHistory.col.sprint')}</span>
              <span>{tr('refinementHistory.col.assignee')}</span>
            </div>
            <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', marginTop: 6 }}>
              {itemsLoading && !itemsPage ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-45)', fontSize: 12 }}>{tr('refinementHistory.loading')}</div>
              ) : !itemsPage || itemsPage.items.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-45)', fontSize: 12 }}>{tr('refinementHistory.items.noMatch')}</div>
              ) : (
                itemsPage.items.map((s, i) => {
                  const when = s.completed_at || s.created_at || '';
                  let dateLabel = '';
                  let fullDate = '';
                  if (when) {
                    const d = new Date(when);
                    if (!isNaN(d.getTime())) {
                      dateLabel = d.toLocaleDateString('tr-TR', { year: '2-digit', month: 'short', day: '2-digit' });
                      fullDate = d.toLocaleString('tr-TR');
                    }
                  }
                  const sprintLabel = s.sprint_name || (s.sprint_path ? s.sprint_path.split(/[\\/]/).pop() || '' : '');
                  return (
                    <div key={s.external_id || i} style={{
                      padding: '8px 12px',
                      borderBottom: i < itemsPage.items.length - 1 ? '1px solid var(--panel-border)' : 'none',
                      display: 'grid', gridTemplateColumns: '60px 86px 100px 1fr 150px 170px', gap: 10, alignItems: 'center', fontSize: 12,
                      opacity: itemsLoading ? 0.55 : 1,
                      transition: 'opacity 0.15s',
                    }}>
                      <span style={{
                        fontWeight: 800, color: '#5eead4', textAlign: 'center',
                        padding: '3px 8px', borderRadius: 6, background: 'rgba(94,234,212,0.1)',
                        fontSize: 11,
                      }}>
                        {s.story_points} SP
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--ink-45)' }}>
                        {s.work_item_type || '—'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-50)', whiteSpace: 'nowrap' }} title={fullDate}>
                        {dateLabel || '—'}
                      </span>
                      <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ color: 'var(--ink-85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.url ? (
                            <a href={s.url} target='_blank' rel='noreferrer' style={{ color: 'var(--ink-85)', textDecoration: 'none' }}>
                              #{s.external_id} {s.title}
                            </a>
                          ) : (
                            <span>#{s.external_id} {s.title}</span>
                          )}
                        </div>
                      </div>
                      <span
                        style={{ fontSize: 11, color: sprintLabel ? '#7dd3fc' : 'var(--ink-35)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={s.sprint_path || sprintLabel}
                      >
                        {sprintLabel || '—'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-58)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.assigned_to || '—'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            {itemsPage && itemsPage.total_pages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                <button
                  onClick={() => setPage(1)}
                  disabled={page <= 1 || itemsLoading}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}
                >{tr('refinementHistory.pager.first')}</button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || itemsLoading}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}
                >{tr('refinementHistory.pager.prev')}</button>
                <span style={{ fontSize: 12, color: 'var(--ink-78)', minWidth: 120, textAlign: 'center' }}>
                  {tr('refinementHistory.pager.page')} <b>{itemsPage.page}</b> / {itemsPage.total_pages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(itemsPage.total_pages, p + 1))}
                  disabled={page >= itemsPage.total_pages || itemsLoading}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page >= itemsPage.total_pages ? 'default' : 'pointer', opacity: page >= itemsPage.total_pages ? 0.4 : 1 }}
                >{tr('refinementHistory.pager.next')}</button>
                <button
                  onClick={() => setPage(itemsPage.total_pages)}
                  disabled={page >= itemsPage.total_pages || itemsLoading}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-78)', cursor: page >= itemsPage.total_pages ? 'default' : 'pointer', opacity: page >= itemsPage.total_pages ? 0.4 : 1 }}
                >{tr('refinementHistory.pager.last')}</button>
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 8, textAlign: 'center' }}>
              {tr('refinementHistory.items.footer')
                .replace('{total}', String(itemsPage?.total ?? 0))
                .replace('{pageSize}', String(PAGE_SIZE))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
