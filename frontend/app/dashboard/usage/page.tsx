'use client';

import { useEffect, useMemo, useState } from 'react';
import { listUsageEvents, UsageEventsResponse } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const box: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.02)',
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
      setError(e instanceof Error ? e.message : 'Failed');
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
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div className='section-label'>{t('nav.usage')}</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.94)', marginTop: 6 }}>{t('usage.title')}</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{t('usage.subtitle')}</p>
      </div>

      <div style={{ ...box, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))', gap: 8 }}>
        <select value={operationType} onChange={(e) => setOperationType(e.target.value)} style={field}>
          <option value='all'>{t('usage.all')}</option>
          <option value='task_orchestration_run'>task_orchestration_run</option>
          <option value='repo_profile_scan'>repo_profile_scan</option>
        </select>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} style={field}>
          <option value='all'>{t('usage.all')}</option>
          <option value='openai'>openai</option>
          <option value='gemini'>gemini</option>
          <option value='local'>local</option>
          <option value='codex-cli'>codex-cli</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}>
          <option value='all'>{t('usage.all')}</option>
          <option value='completed'>completed</option>
          <option value='failed'>failed</option>
        </select>
        <input value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder={t('usage.taskId')} style={field} />
        <input value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} type='date' style={field} />
        <input value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} type='date' style={field} />
        <button onClick={() => void load(1)} className='button button-primary' style={{ height: 40 }}>{t('usage.refresh')}</button>
        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
          <input type='checkbox' checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          {t('usage.mineOnly')}
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 8 }}>
        <Metric label={t('usage.totalEvents')} value={String(data?.summary.count ?? 0)} />
        <Metric label={t('usage.totalTokens')} value={String(data?.summary.total_tokens ?? 0)} />
        <Metric label={t('usage.totalCost')} value={`$${(data?.summary.cost_usd ?? 0).toFixed(4)}`} />
        <Metric label={t('usage.avgDuration')} value={`${data?.summary.avg_duration_ms ?? 0} ms`} />
      </div>

      <div style={{ ...box, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 190px 180px 100px 80px 110px 90px 1fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>
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
          <div style={{ padding: 14, color: 'rgba(255,255,255,0.5)' }}>Loading...</div>
        ) : error ? (
          <div style={{ padding: 14, color: '#f87171' }}>{error}</div>
        ) : !data || data.items.length === 0 ? (
          <div style={{ padding: 14, color: 'rgba(255,255,255,0.5)' }}>{t('usage.empty')}</div>
        ) : (
          data.items.map((x) => (
            <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '140px 190px 180px 100px 80px 110px 90px 1fr', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 12, alignItems: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,0.55)' }}>{new Date(x.created_at).toLocaleString()}</span>
              <span style={{ color: '#93c5fd', fontFamily: 'monospace' }}>{x.operation_type}</span>
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>{x.provider} / {x.model || '-'}</span>
              <span style={{ color: x.status === 'failed' ? '#ef4444' : '#22c55e' }}>{x.status}</span>
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>{x.task_id ?? '-'}</span>
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>{x.total_tokens}</span>
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>${x.cost_usd.toFixed(4)}</span>
              <span style={{ color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {x.error_message || x.local_repo_path || '-'}
              </span>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
        <button onClick={() => void load(Math.max(1, page - 1))} disabled={page <= 1 || loading} className='button button-outline'>{t('usage.prev')}</button>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{t('usage.page')} {page} / {totalPages}</span>
        <button onClick={() => void load(Math.min(totalPages, page + 1))} disabled={page >= totalPages || loading} className='button button-outline'>{t('usage.next')}</button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...box, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>{value}</div>
    </div>
  );
}

const field: React.CSSProperties = {
  width: '100%',
  height: 40,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.9)',
  padding: '0 10px',
  fontSize: 12,
  outline: 'none',
};

