'use client';

import { useEffect, useMemo, useState } from 'react';
import { listUsageEvents, UsageEventsResponse } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const card: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--panel-border)',
  background: 'var(--panel)',
};

export default function UsagePage() {
  const { t } = useLocale();
  const [operationType, setOperationType] = useState('all');
  const [provider, setProvider] = useState('all');
  const [status, setStatus] = useState('all');
  const [taskId, setTaskId] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<UsageEventsResponse | null>(null);

  async function load(currentPage = page) {
    setLoading(true);
    setError('');
    try {
      const res = await listUsageEvents({
        operation_type: operationType,
        provider,
        status,
        task_id: taskId.trim() ? Number(taskId) : undefined,
        created_from: createdFrom || undefined,
        created_to: createdTo || undefined,
        mine_only: mineOnly,
        page: currentPage,
        page_size: 20,
      });
      setData(res);
      setPage(res.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('usage.errorDefault'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  const s = data?.summary;

  return (
    <div className='usage-page' style={{ display: 'grid', gap: 16, maxWidth: '100%', overflow: 'hidden' }}>
      <div>
        <div className='section-label'>{t('nav.usage')}</div>
        <h1 className='usage-title' style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6 }}>{t('usage.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 4 }}>{t('usage.subtitle')}</p>
      </div>

      {/* ── Filters ── */}
      <div className='usage-filters' style={{ ...card, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <select value={operationType} onChange={(e) => setOperationType(e.target.value)} style={field}>
            <option value='all'>{t('usage.all')}</option>
            <option value='task_orchestration_run'>{t('usage.operation.taskOrchestrationRun')}</option>
            <option value='repo_profile_scan'>{t('usage.operation.repoProfileScan')}</option>
          </select>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} style={field}>
            <option value='all'>{t('usage.all')}</option>
            <option value='openai'>{t('usage.provider.openai')}</option>
            <option value='gemini'>{t('usage.provider.gemini')}</option>
            <option value='local'>{t('usage.provider.local')}</option>
            <option value='codex-cli'>{t('usage.provider.codexCli')}</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
            <option value='all'>{t('usage.all')}</option>
            <option value='completed'>{t('usage.status.completed')}</option>
            <option value='failed'>{t('usage.status.failed')}</option>
          </select>
          <input value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder={t('usage.taskId')} style={field} />
          <input value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} type='date' style={field} />
          <input value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} type='date' style={field} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ink-72)', fontSize: 12, cursor: 'pointer' }}>
            <input type='checkbox' checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            {t('usage.mineOnly')}
          </label>
          <button onClick={() => void load(1)} className='button button-primary' style={{ height: 36, padding: '0 18px' }} disabled={loading}>
            {loading ? '…' : t('usage.refresh')}
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className='usage-stats' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Metric label={t('usage.totalEvents')} value={(s?.count ?? 0).toLocaleString()} />
        <Metric label={t('usage.totalTokens')} value={(s?.total_tokens ?? 0).toLocaleString()} />
        <Metric label={t('usage.totalCost')} value={`$${(s?.cost_usd ?? 0).toFixed(2)}`} />
        <Metric label={t('usage.cachedTokens')} value={(s?.cached_tokens ?? 0).toLocaleString()} accent='#3f9d6a' />
        <Metric label={t('usage.cacheSavings')} value={`$${(s?.cache_savings_usd ?? 0).toFixed(2)}`} accent='#3f9d6a' />
        <Metric label={t('usage.avgDuration')} value={`${Math.round((s?.avg_duration_ms ?? 0) / 100) / 10}s`} />
      </div>

      {/* ── Table ── */}
      <div className='usage-table-wrap' style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div className='usage-table-header' style={{ ...rowGrid, padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: 'var(--ink-42)', textTransform: 'uppercase', background: 'var(--panel-alt)', minWidth: 980 }}>
            <span>{t('usage.colWhen')}</span>
            <span>{t('usage.colOperation')}</span>
            <span>{t('usage.colProvider')}</span>
            <span>{t('usage.colStatus')}</span>
            <span>{t('usage.colTask')}</span>
            <span style={{ textAlign: 'right' }}>{t('usage.colTokens')}</span>
            <span style={{ textAlign: 'right' }}>{t('usage.colCost')}</span>
            <span>{t('usage.colDetails')}</span>
          </div>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('usage.loading')}</div>
          ) : error ? (
            <div style={{ padding: 24, color: '#cf5b57', textAlign: 'center', fontSize: 13 }}>{error}</div>
          ) : !data || data.items.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('usage.empty')}</div>
          ) : (
            data.items.map((x) => {
              const failed = x.status === 'failed';
              const statusColor = failed ? '#cf5b57' : '#3f9d6a';
              return (
                <div key={x.id} className='usage-table-row ent-table-row' style={{ ...rowGrid, padding: '11px 14px', borderBottom: '1px solid var(--panel-alt)', fontSize: 12, alignItems: 'center', minWidth: 980 }}>
                  <span style={{ color: 'var(--ink-50)', whiteSpace: 'nowrap' }}>{new Date(x.created_at).toLocaleString()}</span>
                  <span style={{ color: 'var(--ink-72)', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.operation_type}>{x.operation_type}</span>
                  <span style={{ color: 'var(--ink-65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${x.provider} / ${x.model || '-'}`}>{x.provider} / {x.model || '-'}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: statusColor, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    {x.status}
                  </span>
                  {x.subject_href ? (
                    <a href={x.subject_href} style={{ color: 'var(--acc)', textDecoration: 'none', fontWeight: 600 }} title={t('usage.openTask')}>
                      {x.subject_label || '→'} ↗
                    </a>
                  ) : <span style={{ color: 'var(--ink-25)' }}>—</span>}
                  <span style={{ textAlign: 'right', color: 'var(--ink-78)', fontVariantNumeric: 'tabular-nums' }}>
                    {x.total_tokens.toLocaleString()}
                    {x.cached_tokens ? (
                      <div style={{ color: '#3f9d6a', fontWeight: 600, fontSize: 11 }} title={t('taskDetail.cachedHint')}>
                        {x.cached_tokens.toLocaleString()} {t('taskDetail.cached')}
                      </div>
                    ) : null}
                  </span>
                  <span style={{ textAlign: 'right', color: 'var(--ink-90)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>${x.cost_usd.toFixed(4)}</span>
                  <span style={{ color: failed ? '#cf5b57' : 'var(--ink-42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }} title={x.error_message || x.local_repo_path || ''}>
                    {x.error_message || x.local_repo_path || '—'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className='usage-pagination' style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => void load(Math.max(1, page - 1))} disabled={page <= 1 || loading} className='button button-outline'>{t('usage.prev')}</button>
        <span style={{ fontSize: 12, color: 'var(--ink-50)' }}>{t('usage.page')} {page} / {totalPages}</span>
        <button onClick={() => void load(Math.min(totalPages, page + 1))} disabled={page >= totalPages || loading} className='button button-outline'>{t('usage.next')}</button>
      </div>
    </div>
  );
}

const rowGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px 165px 150px 100px 130px 1fr 90px 150px',
  gap: 10,
};

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className='usage-metric' style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{label}</div>
      <div className='usage-metric-value' style={{ marginTop: 6, fontSize: 'clamp(15px, 2vw, 19px)', fontWeight: 700, color: accent || 'var(--ink-90)', wordBreak: 'break-word', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

const field: React.CSSProperties = {
  width: '100%',
  height: 38,
  borderRadius: 8,
  border: '1px solid var(--panel-border)',
  background: 'var(--surface)',
  color: 'var(--ink-90)',
  padding: '0 10px',
  fontSize: 12,
  outline: 'none',
};
