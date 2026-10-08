'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadAuditLogCsv, listAuditActions, listAuditLogs, type AuditLogItem, type AuditLogsResponse } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const PAGE_SIZE = 50;

const card: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid var(--panel-border)',
  background: 'var(--panel)',
};

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

const rowGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px 200px 190px 120px 1fr 70px 120px',
  gap: 10,
};

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function statusColor(code: number): string {
  if (code >= 500) return '#cf5b57';
  if (code >= 400) return '#d99a2b';
  return '#3f9d6a';
}

export default function AuditLogPage() {
  const { t } = useLocale();
  const [action, setAction] = useState('all');
  const [actor, setActor] = useState('');
  const [targetType, setTargetType] = useState('');
  const [q, setQ] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  function currentFilters() {
    return {
      action,
      actor: actor.trim() || undefined,
      target_type: targetType.trim() || undefined,
      q: q.trim() || undefined,
      created_from: createdFrom || undefined,
      created_to: createdTo || undefined,
    };
  }

  async function load(currentPage = page) {
    setLoading(true);
    setError('');
    try {
      const res = await listAuditLogs({ ...currentFilters(), page: currentPage, page_size: PAGE_SIZE });
      setData(res);
      setPage(res.page);
      setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('audit.errorDefault'));
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError('');
    try {
      const blob = await downloadAuditLogCsv(currentFilters());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('audit.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    void load(1);
    listAuditActions().then(setActions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: '100%', overflow: 'hidden' }}>
      <div>
        <div className='section-label'>{t('nav.auditLog')}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6 }}>{t('audit.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 4 }}>{t('audit.subtitle')}</p>
      </div>

      {/* ── Filters ── */}
      <div style={{ ...card, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
          <select value={action} onChange={(e) => setAction(e.target.value)} style={field}>
            <option value='all'>{t('audit.allActions')}</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder={t('audit.filterActor')} style={field} />
          <input value={targetType} onChange={(e) => setTargetType(e.target.value)} placeholder={t('audit.filterTarget')} style={field} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('audit.filterSearch')} style={field}
            onKeyDown={(e) => { if (e.key === 'Enter') void load(1); }} />
          <input value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} type='date' style={field} />
          <input value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} type='date' style={field} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-42)' }}>{t('audit.notice')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void exportCsv()} className='button button-outline' style={{ height: 36, padding: '0 14px' }} disabled={exporting || loading}>
              {exporting ? t('audit.exporting') : t('audit.exportCsv')}
            </button>
            <button onClick={() => void load(1)} className='button button-primary' style={{ height: 36, padding: '0 18px' }} disabled={loading}>
              {loading ? '…' : t('audit.refresh')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ ...rowGrid, padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: 'var(--ink-42)', textTransform: 'uppercase', minWidth: 1000 }}>
            <span>{t('audit.colWhen')}</span>
            <span>{t('audit.colActor')}</span>
            <span>{t('audit.colAction')}</span>
            <span>{t('audit.colTarget')}</span>
            <span>{t('audit.colRequest')}</span>
            <span>{t('audit.colStatus')}</span>
            <span>{t('audit.colIp')}</span>
          </div>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('common.loading')}</div>
          ) : error ? (
            <div style={{ padding: 24, color: '#cf5b57', textAlign: 'center', fontSize: 13 }}>{error}</div>
          ) : !data || data.items.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('audit.empty')}</div>
          ) : (
            data.items.map((x) => <AuditRow key={x.id} item={x} open={openId === x.id} onToggle={() => setOpenId(openId === x.id ? null : x.id)} />)
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-50)' }}>{data ? `${data.total.toLocaleString()} ${t('audit.entries')}` : ''}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => void load(Math.max(1, page - 1))} disabled={page <= 1 || loading} className='button button-outline'>{t('audit.prev')}</button>
          <span style={{ fontSize: 12, color: 'var(--ink-50)' }}>{t('audit.page')} {page} / {totalPages}</span>
          <button onClick={() => void load(Math.min(totalPages, page + 1))} disabled={page >= totalPages || loading} className='button button-outline'>{t('audit.next')}</button>
        </div>
      </div>
    </div>
  );
}

function AuditRow({ item: x, open, onToggle }: { item: AuditLogItem; open: boolean; onToggle: () => void }) {
  const { t } = useLocale();
  const color = statusColor(x.status_code);
  const target = x.target_type ? `${x.target_type}${x.target_id ? ` #${x.target_id}` : ''}` : null;
  return (
    <div>
      <div
        className='ent-table-row'
        onClick={onToggle}
        style={{ ...rowGrid, padding: '11px 14px', borderBottom: open ? 'none' : '1px solid var(--panel-alt)', fontSize: 12, alignItems: 'center', cursor: 'pointer', minWidth: 1000 }}
      >
        <span style={{ color: 'var(--ink-50)', whiteSpace: 'nowrap' }}>{new Date(x.created_at).toLocaleString()}</span>
        <span style={{ overflow: 'hidden' }}>
          <div style={{ color: 'var(--ink-78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.actor_email || ''}>{x.actor_email || t('audit.system')}</div>
          {x.actor_role && <div style={{ fontSize: 10, color: 'var(--ink-42)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{x.actor_role}</div>}
        </span>
        <span style={{ ...mono, color: 'var(--ink-90)', fontWeight: 600 }} title={x.action}>{x.action}</span>
        <span style={{ color: target ? 'var(--ink-65)' : 'var(--ink-25)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={target || ''}>{target || '—'}</span>
        <span style={{ ...mono, color: 'var(--ink-65)' }} title={`${x.method} ${x.path}`}>
          <span style={{ color: 'var(--ink-42)', fontWeight: 700, marginRight: 6 }}>{x.method}</span>{x.path}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
          {x.status_code}
        </span>
        <span style={{ ...mono, color: 'var(--ink-50)' }} title={x.ip_address || ''}>{x.ip_address || '—'}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 14px 14px 164px', borderBottom: '1px solid var(--panel-alt)', background: 'var(--panel-alt)', fontSize: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '6px 18px' }}>
            <Detail label={t('audit.detailRequestId')} value={x.request_id} />
            <Detail label={t('audit.detailRoute')} value={x.route} />
            <Detail label={t('audit.detailWorkspace')} value={x.workspace_id != null ? String(x.workspace_id) : null} />
            <Detail label={t('audit.detailUserAgent')} value={x.user_agent} />
          </div>
          {x.details && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--ink-42)', marginBottom: 4 }}>{t('audit.detailData')}</div>
              <pre style={{ margin: 0, padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--panel-border)', fontSize: 11, color: 'var(--ink-72)', overflowX: 'auto' }}>
                {JSON.stringify(x.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--ink-42)' }}>{label}</div>
      <div style={{ ...mono, color: value ? 'var(--ink-72)' : 'var(--ink-25)', whiteSpace: 'normal', wordBreak: 'break-all' }}>{value || '—'}</div>
    </div>
  );
}
