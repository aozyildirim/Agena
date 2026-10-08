'use client';

import { useEffect, useState } from 'react';
import {
  createWebhookEndpoint, deleteWebhookEndpoint, listWebhookDeliveries, listWebhookEndpoints, listWebhookEventTypes,
  rotateWebhookSecret, testWebhookEndpoint, updateWebhookEndpoint,
  type WebhookDelivery, type WebhookEndpoint, type WebhookEndpointWithSecret,
} from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const card: React.CSSProperties = { borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)' };
const field: React.CSSProperties = { width: '100%', height: 38, borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--surface)', color: 'var(--ink-90)', padding: '0 10px', fontSize: 12, outline: 'none' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: 11 };
const labelSt: React.CSSProperties = { fontSize: 11, color: 'var(--ink-42)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 };
const btn = (color?: string): React.CSSProperties => ({ height: 30, padding: '0 10px', fontSize: 11, color });

function statusColor(s: string | null, enabled: boolean): string {
  if (!enabled) return 'var(--ink-35)';
  if (s === 'ok') return '#3f9d6a';
  if (s === 'failing' || s === 'disabled') return '#cf5b57';
  return 'var(--ink-42)';
}

export default function WebhookEndpointsPage() {
  const { t } = useLocale();
  const [rows, setRows] = useState<WebhookEndpoint[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [allEvents, setAllEvents] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<number | 'create' | null>(null);
  const [secretFor, setSecretFor] = useState<WebhookEndpointWithSecret | null>(null);
  const [copied, setCopied] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deliveries, setDeliveries] = useState<Record<number, WebhookDelivery[]>>({});
  const [testResult, setTestResult] = useState<Record<number, WebhookDelivery>>({});

  async function load() {
    setLoading(true);
    try {
      setRows(await listWebhookEndpoints());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('webhooksOut.errorDefault'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    listWebhookEventTypes().then(setEventTypes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    setBusy('create');
    setError('');
    try {
      const row = await createWebhookEndpoint({ name: name.trim(), url: url.trim(), events: allEvents ? ['*'] : picked });
      setSecretFor(row);
      setCopied(false);
      setName(''); setUrl(''); setAllEvents(true); setPicked([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('webhooksOut.errorDefault'));
    } finally {
      setBusy(null);
    }
  }

  async function act(id: number, fn: () => Promise<unknown>) {
    setBusy(id);
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : t('webhooksOut.errorDefault')); } finally { setBusy(null); }
  }

  async function openDeliveries(id: number) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    try { setDeliveries((d) => ({ ...d, [id]: [] })); const list = await listWebhookDeliveries(id); setDeliveries((d) => ({ ...d, [id]: list })); } catch { /* shown as empty */ }
  }

  async function copySecret() {
    if (!secretFor) return;
    try { await navigator.clipboard.writeText(secretFor.secret); setCopied(true); } catch { /* key stays visible */ }
  }

  const fmt = (v: string | null) => (v ? new Date(v.endsWith('Z') ? v : `${v}Z`).toLocaleString() : '—');

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: '100%', overflow: 'hidden' }}>
      <div>
        <div className='section-label'>{t('nav.outboundWebhooks')}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6 }}>{t('webhooksOut.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 4, maxWidth: 780 }}>{t('webhooksOut.subtitle')}</p>
      </div>

      {/* ── Create ── */}
      <div style={{ ...card, padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(260px, 2fr) auto', gap: 8, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4, ...labelSt }}>{t('webhooksOut.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('webhooksOut.namePlaceholder')} style={field} />
          </label>
          <label style={{ display: 'grid', gap: 4, ...labelSt }}>{t('webhooksOut.url')}
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder='https://example.com/agena-webhook' style={{ ...field, ...mono, fontSize: 12 }} />
          </label>
          <button onClick={() => void create()} className='button button-primary' style={{ height: 38, padding: '0 18px' }} disabled={busy === 'create' || !name.trim() || !url.trim() || (!allEvents && picked.length === 0)}>
            {busy === 'create' ? t('webhooksOut.creating') : t('webhooksOut.create')}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={labelSt}>{t('webhooksOut.events')}</span>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--ink-72)', cursor: 'pointer' }}>
            <input type='checkbox' checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} /> {t('webhooksOut.allEvents')}
          </label>
          {!allEvents && eventTypes.map((ev) => (
            <label key={ev} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11, color: 'var(--ink-65)', cursor: 'pointer', padding: '3px 8px', borderRadius: 999, border: '1px solid var(--panel-border)' }}>
              <input type='checkbox' checked={picked.includes(ev)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))} />
              <span style={mono}>{ev}</span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-42)' }}>{t('webhooksOut.signingNote')}</div>
        {error && <div style={{ fontSize: 12, color: '#cf5b57' }}>{error}</div>}

        {secretFor && (
          <div style={{ padding: 14, borderRadius: 10, border: '1px solid rgba(94,234,212,0.4)', background: 'rgba(13,148,136,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>{t('webhooksOut.secretCreated')} — {secretFor.name}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ ...mono, fontSize: 13, padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--panel-border)', color: 'var(--ink-90)', wordBreak: 'break-all', flex: 1, minWidth: 260 }}>{secretFor.secret}</code>
              <button onClick={() => void copySecret()} className='button button-outline' style={{ height: 36 }}>{copied ? t('webhooksOut.copied') : t('webhooksOut.copy')}</button>
              <button onClick={() => setSecretFor(null)} className='button button-outline' style={{ height: 36 }}>{t('webhooksOut.done')}</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-50)' }}>{t('webhooksOut.secretHint')}</div>
          </div>
        )}
      </div>

      {/* ── List ── */}
      <div style={{ ...card, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('webhooksOut.empty')}</div>
        ) : rows.map((r) => {
          const color = statusColor(r.last_status, r.enabled);
          const open = openId === r.id;
          const tr = testResult[r.id];
          return (
            <div key={r.id} style={{ borderBottom: '1px solid var(--panel-alt)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 150px auto', gap: 10, padding: '11px 14px', fontSize: 12, alignItems: 'center', opacity: r.enabled ? 1 : 0.6 }}>
                <span style={{ display: 'grid', gap: 2 }}>
                  <span style={{ color: 'var(--ink-90)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</span>
                  <span style={{ ...mono, color: 'var(--ink-42)' }}>{(r.events && !r.events.includes('*')) ? r.events.join(', ') : t('webhooksOut.allEvents')}</span>
                </span>
                <span style={{ ...mono, color: 'var(--ink-65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.url}>{r.url}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  {!r.enabled ? t('webhooksOut.statusDisabled') : r.last_status === 'ok' ? t('webhooksOut.statusOk') : r.last_status ? t('webhooksOut.statusFailing') : t('webhooksOut.statusNew')}
                  {r.failure_count > 0 && <span style={{ color: 'var(--ink-42)', fontWeight: 400 }}>· {r.failure_count}✕</span>}
                </span>
                <span style={{ color: 'var(--ink-50)' }}>{fmt(r.last_delivery_at)}</span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button disabled={busy === r.id} onClick={() => void act(r.id, async () => { const d = await testWebhookEndpoint(r.id); setTestResult((m) => ({ ...m, [r.id]: d })); })} className='button button-outline' style={btn('var(--acc)')}>{t('webhooksOut.test')}</button>
                  <button disabled={busy === r.id} onClick={() => void openDeliveries(r.id)} className='button button-outline' style={btn()}>{open ? t('webhooksOut.hideDeliveries') : t('webhooksOut.deliveries')}</button>
                  <button disabled={busy === r.id} onClick={() => void act(r.id, () => updateWebhookEndpoint(r.id, { enabled: !r.enabled }))} className='button button-outline' style={btn()}>{r.enabled ? t('webhooksOut.disable') : t('webhooksOut.enable')}</button>
                  <button disabled={busy === r.id} onClick={() => { if (window.confirm(t('webhooksOut.confirmRotate'))) void act(r.id, async () => { const row = await rotateWebhookSecret(r.id); setSecretFor(row); setCopied(false); }); }} className='button button-outline' style={btn()}>{t('webhooksOut.rotate')}</button>
                  <button disabled={busy === r.id} onClick={() => { if (window.confirm(t('webhooksOut.confirmDelete'))) void act(r.id, () => deleteWebhookEndpoint(r.id)); }} className='button button-outline' style={btn('#cf5b57')}>{t('webhooksOut.delete')}</button>
                </span>
              </div>
              {tr && (
                <div style={{ padding: '0 14px 10px', fontSize: 11, color: tr.status === 'delivered' ? '#3f9d6a' : '#cf5b57' }}>
                  {t('webhooksOut.testResult')}: {tr.status} {tr.response_status ? `· HTTP ${tr.response_status}` : ''} {tr.last_error ? `· ${tr.last_error}` : ''}
                </div>
              )}
              {open && (
                <div style={{ padding: '4px 14px 12px', background: 'var(--panel-alt)' }}>
                  {(deliveries[r.id] || []).length === 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--ink-45)' }}>{t('webhooksOut.noDeliveries')}</div>
                  ) : (deliveries[r.id] || []).map((d) => (
                    <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '140px 160px 90px 70px 1fr', gap: 8, fontSize: 11, padding: '5px 0', borderBottom: '1px solid var(--panel-border)', alignItems: 'center' }}>
                      <span style={{ color: 'var(--ink-50)' }}>{fmt(d.created_at)}</span>
                      <span style={{ ...mono, color: 'var(--ink-78)' }}>{d.event_type}</span>
                      <span style={{ color: d.status === 'delivered' ? '#3f9d6a' : d.status === 'failed' ? '#cf5b57' : '#d99a2b', fontWeight: 600 }}>{d.status}</span>
                      <span style={{ color: 'var(--ink-50)' }}>{d.attempts}× {d.response_status ? `(${d.response_status})` : ''}</span>
                      <span style={{ color: 'var(--ink-42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.last_error || ''}>{d.last_error || (d.next_attempt_at && d.status === 'pending' ? `${t('webhooksOut.retryAt')} ${fmt(d.next_attempt_at)}` : '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
