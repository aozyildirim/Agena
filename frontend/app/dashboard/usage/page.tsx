'use client';

import { useEffect, useMemo, useState } from 'react';
import { listUsageEvents, UsageEventsResponse } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const box: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--panel-border-2)',
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

  return (
    <div className='usage-page' style={{ display: 'grid', gap: 16, maxWidth: '100%', overflow: 'hidden' }}>
      <div>
        <div className='section-label'>{t('nav.usage')}</div>
        <h1 className='usage-title' style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6 }}>{t('usage.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 4 }}>{t('usage.subtitle')}</p>
      </div>

      <div className='usage-filters' style={{ ...box, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
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
        <button onClick={() => void load(1)} className='button button-primary' style={{ height: 40 }}>{t('usage.refresh')}</button>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-72)', fontSize: 12 }}>
          <input type='checkbox' checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          {t('usage.mineOnly')}
        </label>
      </div>

      <div className='usage-stats' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <Metric label={t('usage.totalEvents')} value={String(data?.summary.count ?? 0)} />
        <Metric label={t('usage.totalTokens')} value={String(data?.summary.total_tokens ?? 0)} />
        <Metric label={t('usage.totalCost')} value={`$${(data?.summary.cost_usd ?? 0).toFixed(4)}`} />
        <Metric label={t('usage.avgDuration')} value={`${data?.summary.avg_duration_ms ?? 0} ms`} />
      </div>

      <div className='usage-table-wrap' style={{ ...box, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div className='usage-table-header' style={{ display: 'grid', gridTemplateColumns: '140px 190px 180px 100px 80px 110px 90px 1fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--panel-border-2)', fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'var(--ink-45)', textTransform: 'uppercase', minWidth: 960 }}>
            <span>{t('usage.colWhen')}</span>
            <span>{t('usage.colOperation')}</span>
            <span>{t('usage.colProvider')}</span>
            <span>{t('usage.colStatus')}</span>
            <span>{t('usage.colTask')}</span>
            <span>{t('usage.colTokens')}</span>
            <span>{t('usage.colCost')}</span>
            <span>{t('usage.colDetails')}</span>
          </div>
          {loading ? (
            <div style={{ padding: 14, color: 'var(--ink-50)' }}>{t('usage.loading')}</div>
          ) : error ? (
            <div style={{ padding: 14, color: '#f87171' }}>{error}</div>
          ) : !data || data.items.length === 0 ? (
            <div style={{ padding: 14, color: 'var(--ink-50)' }}>{t('usage.empty')}</div>
          ) : (
            data.items.map((x) => (
              <div key={x.id} className='usage-table-row' style={{ display: 'grid', gridTemplateColumns: '140px 190px 180px 100px 80px 110px 90px 1fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--panel-alt)', fontSize: 12, alignItems: 'center', minWidth: 960 }}>
                <span style={{ color: 'var(--ink-50)' }}>{new Date(x.created_at).toLocaleString()}</span>
                <span style={{ color: '#93c5fd', fontFamily: 'monospace' }}>{x.operation_type}</span>
                <span style={{ color: 'var(--ink-78)' }}>{x.provider} / {x.model || '-'}</span>
                <span style={{ color: x.status === 'failed' ? '#ef4444' : '#22c55e' }}>{x.status}</span>
                <span style={{ color: 'var(--ink-78)' }}>{x.task_id ?? '-'}</span>
                <span style={{ color: 'var(--ink-78)' }}>{x.total_tokens}</span>
                <span style={{ color: 'var(--ink-78)' }}>${x.cost_usd.toFixed(4)}</span>
                <span style={{ color: 'var(--ink-50)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {x.error_message || x.local_repo_path || '-'}
                </span>
              </div>
            ))
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='usage-metric' style={{ ...box, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--ink-45)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div className='usage-metric-value' style={{ marginTop: 4, fontSize: 'clamp(14px, 2vw, 16px)', fontWeight: 800, color: 'var(--ink-90)', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

const field: React.CSSProperties = {
  width: '100%',
  height: 40,
  borderRadius: 10,
  border: '1px solid var(--panel-border-3)',
  background: 'var(--glass)',
  color: 'var(--ink-90)',
  padding: '0 10px',
  fontSize: 12,
  outline: 'none',
};
