'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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

const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1, clean: 0,
};

function severityColor(s: string | null) {
  if (!s) return 'var(--ink-35)';
  return SEVERITY_COLOR[s] || 'var(--ink-35)';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function bucketFor(iso: string): 'today' | 'week' | 'older' {
  const diff = Date.now() - new Date(iso).getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 1) return 'today';
  if (days < 7) return 'week';
  return 'older';
}

type SortKey = 'newest' | 'oldest' | 'severity' | 'score-asc' | 'score-desc' | 'findings';

export default function ReviewsPage() {
  const { t } = useLocale();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [openId, setOpenId] = useState<number | null>(null);
  const [running, setRunning] = useState<number | null>(null);

  // Read URL params (e.g. /dashboard/reviews?agent_role=security_developer)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const role = params.get('agent_role');
    if (role) setFilterRole(role);
  }, []);

  useEffect(() => {
    void load();
  }, [filterRole, filterSeverity, filterStatus]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filterRole) params.set('agent_role', filterRole);
      if (filterSeverity) params.set('severity', filterSeverity);
      const data = await apiFetch<Review[]>(`/reviews?${params}`);
      setReviews(filterStatus ? data.filter((r) => r.status === filterStatus) : data);
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo(() => {
    const byRole: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalScore = 0, scoreCount = 0;
    for (const r of reviews) {
      byRole[r.reviewer_agent_role] = (byRole[r.reviewer_agent_role] ?? 0) + 1;
      if (r.severity) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.score != null) { totalScore += r.score; scoreCount++; }
    }
    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : null;
    const cleanRate = reviews.length > 0 ? Math.round(100 * (bySeverity['clean'] || 0) / reviews.length) : null;
    return { byRole, bySeverity, byStatus, avgScore, cleanRate };
  }, [reviews]);

  const allRoles = useMemo(() => Array.from(new Set(reviews.map((r) => r.reviewer_agent_role))).sort(), [reviews]);

  const filteredAndSorted = useMemo(() => {
    let list = reviews;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) =>
        (r.task_title || '').toLowerCase().includes(q)
        || (r.output || '').toLowerCase().includes(q)
        || String(r.task_id).includes(q),
      );
    }
    const sorted = [...list];
    switch (sortKey) {
      case 'newest':
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'oldest':
        sorted.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'severity':
        sorted.sort((a, b) => (SEVERITY_RANK[b.severity || 'clean'] ?? -1) - (SEVERITY_RANK[a.severity || 'clean'] ?? -1));
        break;
      case 'score-asc':
        sorted.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
        break;
      case 'score-desc':
        sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        break;
      case 'findings':
        sorted.sort((a, b) => (b.findings_count ?? 0) - (a.findings_count ?? 0));
        break;
    }
    return sorted;
  }, [reviews, searchQuery, sortKey]);

  const grouped = useMemo(() => {
    if (sortKey !== 'newest') return null; // only group by date when sorting by newest
    const buckets: Record<'today' | 'week' | 'older', Review[]> = { today: [], week: [], older: [] };
    for (const r of filteredAndSorted) {
      buckets[bucketFor(r.created_at)].push(r);
    }
    return buckets;
  }, [filteredAndSorted, sortKey]);

  const activeFilterCount = (filterRole ? 1 : 0) + (filterSeverity ? 1 : 0) + (filterStatus ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

  async function rerunReview(taskId: number, role: string, reviewId: number) {
    setRunning(reviewId);
    try {
      await apiFetch('/reviews', { method: 'POST', body: JSON.stringify({ task_id: taskId, reviewer_agent_role: role }) });
      await load();
    } catch { /* ignore */ }
    finally { setRunning(null); }
  }

  function clearFilters() {
    setFilterRole('');
    setFilterSeverity('');
    setFilterStatus('');
    setSearchQuery('');
  }

  const cardStyle: React.CSSProperties = { background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 16 };
  const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, fontSize: 12, border: '1px solid var(--panel-border)', background: 'var(--glass)', color: 'var(--ink)', height: 36 };

  function renderReview(r: Review) {
    const isOpen = openId === r.id;
    const sevColor = severityColor(r.severity);
    const isRunning = running === r.id;
    return (
      <div key={r.id} style={{
        borderRadius: 12,
        background: 'var(--glass)',
        border: `1px solid ${isOpen ? 'rgba(168,85,247,0.5)' : 'var(--panel-border)'}`,
        borderLeft: `3px solid ${sevColor}`,
        overflow: 'hidden',
      }}>
        <div onClick={() => setOpenId(isOpen ? null : r.id)} style={{ cursor: 'pointer', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${sevColor}1f`, border: `1px solid ${sevColor}66`, fontSize: 16,
          }}>
            {r.severity === 'critical' ? '🚨' : r.severity === 'clean' ? '✅' : r.status === 'failed' ? '✗' : '🔎'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.task_title || `Task #${r.task_id}`}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>{r.reviewer_agent_role}</span>
              {r.severity && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: `${sevColor}1f`, color: sevColor, textTransform: 'uppercase' }}>{r.severity}</span>
              )}
              {r.status === 'failed' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>FAILED</span>}
              {r.status === 'running' && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>RUNNING…</span>}
            </div>
            {/* Score progress bar */}
            {r.score != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, maxWidth: 180, height: 4, background: 'var(--panel-border)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${r.score}%`, height: '100%', background: r.score >= 70 ? '#22c55e' : r.score >= 40 ? '#eab308' : '#ef4444' }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-78)', minWidth: 40 }}>{r.score}/100</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--ink-50)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>#{r.id}</span>
              {r.findings_count != null && <span><strong style={{ color: sevColor }}>{r.findings_count}</strong> findings</span>}
              <span title={new Date(r.created_at).toLocaleString()}>{timeAgo(r.created_at)}</span>
              {r.reviewer_model && <span style={{ fontFamily: 'monospace', color: 'var(--ink-35)' }}>{r.reviewer_model}</span>}
            </div>
          </div>
          <div className='reviews-row-actions' style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
            <button
              onClick={(e) => { e.stopPropagation(); void rerunReview(r.task_id, r.reviewer_agent_role, r.id); }}
              disabled={isRunning || r.status === 'running'}
              title={t('reviews.rerun') || 'Re-run'}
              style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--ink-58)', cursor: 'pointer', fontSize: 13, opacity: isRunning ? 0.5 : 1 }}>
              {isRunning ? '…' : '↻'}
            </button>
            <Link href={`/tasks/${r.task_id}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.08)', whiteSpace: 'nowrap' }}>
              Task →
            </Link>
            <span style={{ fontSize: 14, color: 'var(--ink-35)', minWidth: 14 }}>{isOpen ? '▾' : '▸'}</span>
          </div>
        </div>
        {isOpen && (
          <div style={{ padding: '0 14px 14px', borderTop: '1px dashed var(--panel-border)' }}>
            {r.input_snapshot && (
              <div style={{ marginTop: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4 }}>{t('reviews.inputSnapshot') || 'Input snapshot'}</div>
                <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', color: 'var(--ink-78)', background: 'var(--panel)', padding: '8px 10px', borderRadius: 6, whiteSpace: 'pre-wrap' }}>{r.input_snapshot}</pre>
              </div>
            )}
            {r.error_message && (
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>
                {r.error_message}
              </div>
            )}
            {r.output ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4 }}>{t('reviews.output') || 'Reviewer output'}</div>
                <pre style={{ margin: 0, fontSize: 12, fontFamily: 'inherit', color: 'var(--ink-78)', background: 'var(--panel)', padding: '12px 14px', borderRadius: 8, whiteSpace: 'pre-wrap', maxHeight: 480, overflowY: 'auto', lineHeight: 1.55 }}>{r.output}</pre>
              </div>
            ) : r.status === 'completed' ? (
              <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 10 }}>(empty output)</div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1080, margin: '0 auto' }}>
      <style>{`
        @media (max-width: 700px) {
          /* On mobile: search takes the full first row, the four dropdowns
             pack into a 2-column grid below it. Flex shorthand from desktop
             would otherwise hand the dropdowns absurd 220px heights. */
          .reviews-filters { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
          .reviews-filters > input { grid-column: 1 / -1; height: 36px !important; flex: none !important; }
          .reviews-filters > select { width: 100% !important; flex: none !important; height: 36px !important; }
          .reviews-row-actions { width: 100%; justify-content: flex-end; padding-top: 6px; }
        }
      `}</style>

      {/* Hero */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 16,
        border: '1px solid var(--panel-border)', background: 'var(--panel)',
        backgroundImage: 'linear-gradient(135deg, rgba(168,85,247,0.22), rgba(99,102,241,0.12) 60%, rgba(56,189,248,0.06))',
        padding: '20px 22px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #a855f7, #6366f1, #38bdf8)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.4)', fontSize: 22 }}>🔎</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', letterSpacing: -0.3 }}>{t('reviews.title') || 'Code Reviews'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.5 }}>
              {t('reviews.heroSubtitle') || 'AI-driven adversarial code reviews. Track findings, severities, and per-agent verdict history without touching the code.'}
            </div>
          </div>
        </div>

        {reviews.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: t('reviews.statTotal') || 'Reviews', value: reviews.length, color: 'var(--ink)' },
              { label: t('reviews.statAgents') || 'Reviewer agents', value: Object.keys(stats.byRole).length, color: '#60a5fa' },
              { label: t('reviews.statAvgScore') || 'Avg score', value: stats.avgScore != null ? `${stats.avgScore}` : '—', color: stats.avgScore != null && stats.avgScore >= 70 ? '#22c55e' : '#eab308' },
              { label: t('reviews.statCritical') || 'Critical', value: stats.bySeverity['critical'] ?? 0, color: '#ef4444' },
              { label: t('reviews.statCleanRate') || 'Clean rate', value: stats.cleanRate != null ? `${stats.cleanRate}%` : '—', color: '#22c55e' },
            ].map((tile) => (
              <div key={tile.label} style={{ flex: '1 1 130px', minWidth: 110, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--panel-border)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{tile.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: tile.color, marginTop: 4 }}>{tile.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Severity distribution bar — quick visual when reviews exist */}
      {reviews.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>
            {t('reviews.severityDist') || 'Severity distribution'}
          </div>
          <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', background: 'var(--panel-border)' }}>
            {(['critical', 'high', 'medium', 'low', 'clean'] as const).map((sev) => {
              const count = stats.bySeverity[sev] || 0;
              const pct = (count / reviews.length) * 100;
              if (pct === 0) return null;
              return (
                <div key={sev} title={`${sev}: ${count} (${pct.toFixed(0)}%)`} style={{ width: `${pct}%`, background: SEVERITY_COLOR[sev] }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            {(['critical', 'high', 'medium', 'low', 'clean'] as const).map((sev) => {
              const count = stats.bySeverity[sev] || 0;
              if (count === 0) return null;
              return (
                <button key={sev} onClick={() => setFilterSeverity(filterSeverity === sev ? '' : sev)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '4px 10px',
                  borderRadius: 999, background: filterSeverity === sev ? `${SEVERITY_COLOR[sev]}25` : 'var(--glass)',
                  color: SEVERITY_COLOR[sev], border: `1px solid ${SEVERITY_COLOR[sev]}55`, cursor: 'pointer',
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLOR[sev] }} />
                  {sev} <span style={{ color: 'var(--ink-50)' }}>({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>
            {t('reviews.filtersLabel') || 'Filter reviews'}
            {activeFilterCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 7px', borderRadius: 999, background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>{activeFilterCount}</span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', background: 'transparent', border: '1px solid var(--panel-border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
              {t('reviews.clearFilters') || 'Clear filters'}
            </button>
          )}
        </div>
        <div className='reviews-filters' style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('reviews.searchPlaceholder') || 'Search task title, output, or task #…'}
            style={{ ...inputStyle, flex: '2 1 220px' }}
          />
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)} style={{ ...inputStyle, flex: '1 1 130px' }}>
            <option value=''>{t('reviews.allRoles') || 'All reviewers'}</option>
            {allRoles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} style={{ ...inputStyle, flex: '1 1 130px' }}>
            <option value=''>{t('reviews.allSeverities') || 'All severities'}</option>
            {['critical', 'high', 'medium', 'low', 'clean'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inputStyle, flex: '1 1 110px' }}>
            <option value=''>{t('reviews.allStatuses') || 'All statuses'}</option>
            <option value='completed'>completed</option>
            <option value='running'>running</option>
            <option value='failed'>failed</option>
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ ...inputStyle, flex: '1 1 130px' }}>
            <option value='newest'>{t('reviews.sortNewest') || 'Newest first'}</option>
            <option value='oldest'>{t('reviews.sortOldest') || 'Oldest first'}</option>
            <option value='severity'>{t('reviews.sortSeverity') || 'Severity ↓'}</option>
            <option value='findings'>{t('reviews.sortFindings') || 'Most findings'}</option>
            <option value='score-desc'>{t('reviews.sortScoreDesc') || 'Score ↓'}</option>
            <option value='score-asc'>{t('reviews.sortScoreAsc') || 'Score ↑'}</option>
          </select>
        </div>
      </div>

      {/* Reviews list */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 12 }}>
          {(t('reviews.count') || '{n} reviews').replace('{n}', String(filteredAndSorted.length))}
        </div>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 16, textAlign: 'center' }}>{t('integrations.common.loading') || 'Loading...'}</div>
        ) : filteredAndSorted.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', borderRadius: 12, background: 'var(--glass)', border: '1px dashed var(--panel-border)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔎</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
              {activeFilterCount > 0 ? (t('reviews.noFilterMatch') || 'No reviews match the filter') : (t('reviews.emptyTitle') || 'No reviews yet')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4 }}>
              {activeFilterCount > 0 ? (t('reviews.noFilterHint') || 'Clear filters or pick a different combo.') : (t('reviews.emptyHint') || 'Hit the 🔎 Review button on any task to run a reviewer agent against it.')}
            </div>
          </div>
        ) : grouped ? (
          <div style={{ display: 'grid', gap: 14 }}>
            {(['today', 'week', 'older'] as const).map((b) => {
              const list = grouped[b];
              if (list.length === 0) return null;
              const labels: Record<typeof b, string> = {
                today: t('reviews.bucketToday') || 'Today',
                week: t('reviews.bucketWeek') || 'This week',
                older: t('reviews.bucketOlder') || 'Older',
              };
              return (
                <div key={b}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-50)', marginBottom: 6 }}>
                    {labels[b]} <span style={{ color: 'var(--ink-35)', fontWeight: 600 }}>({list.length})</span>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {list.map(renderReview)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filteredAndSorted.map(renderReview)}
          </div>
        )}
      </div>
    </div>
  );
}
