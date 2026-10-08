'use client';

import { useEffect, useState } from 'react';
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyCreated, type ApiKeyItem } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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
  gridTemplateColumns: '1.4fr 150px 90px 90px 150px 150px 130px 90px',
  gap: 10,
};

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontSize: 11 };

const STATUS_COLOR: Record<ApiKeyItem['status'], string> = {
  active: '#3f9d6a',
  revoked: '#cf5b57',
  expired: '#d99a2b',
};

const EXPIRY_OPTIONS = [0, 30, 90, 365] as const;

export default function ApiKeysPage() {
  const { t } = useLocale();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [expiresDays, setExpiresDays] = useState<number>(0);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setKeys(await listApiKeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('apiKeys.errorDefault'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const row = await createApiKey({ name: name.trim(), role, expires_in_days: expiresDays || undefined });
      setCreated(row);
      setCopied(false);
      setName('');
      setKeys((prev) => [row, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('apiKeys.errorDefault'));
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: number) {
    if (!window.confirm(t('apiKeys.confirmRevoke'))) return;
    setRevokingId(id);
    try {
      const row = await revokeApiKey(id);
      setKeys((prev) => prev.map((k) => (k.id === id ? row : k)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('apiKeys.errorDefault'));
    } finally {
      setRevokingId(null);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (http, permissions) — the key stays visible to select by hand.
    }
  }

  const statusLabel = (s: ApiKeyItem['status']) =>
    s === 'active' ? t('apiKeys.statusActive') : s === 'revoked' ? t('apiKeys.statusRevoked') : t('apiKeys.statusExpired');
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: '100%', overflow: 'hidden' }}>
      <div>
        <div className='section-label'>{t('nav.apiKeys')}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginTop: 6 }}>{t('apiKeys.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 4, maxWidth: 760 }}>{t('apiKeys.subtitle')}</p>
      </div>

      {/* ── Create ── */}
      <div style={{ ...card, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) 150px 150px auto', gap: 8, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--ink-42)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {t('apiKeys.name')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('apiKeys.namePlaceholder')} style={field}
              onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); }} />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--ink-42)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {t('apiKeys.role')}
            <select value={role} onChange={(e) => setRole(e.target.value)} style={field}>
              <option value='viewer'>viewer</option>
              <option value='member'>member</option>
              <option value='admin'>admin</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--ink-42)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {t('apiKeys.expires')}
            <select value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))} style={field}>
              {EXPIRY_OPTIONS.map((d) => (
                <option key={d} value={d}>{d === 0 ? t('apiKeys.never') : `${d} ${t('apiKeys.days')}`}</option>
              ))}
            </select>
          </label>
          <button onClick={() => void onCreate()} className='button button-primary' style={{ height: 38, padding: '0 18px' }} disabled={creating || !name.trim()}>
            {creating ? t('apiKeys.creating') : t('apiKeys.create')}
          </button>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-42)' }}>{t('apiKeys.notice')}</div>

        {created && (
          <div style={{ marginTop: 12, padding: 14, borderRadius: 10, border: '1px solid rgba(94,234,212,0.4)', background: 'rgba(13,148,136,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>{t('apiKeys.created')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ ...mono, fontSize: 13, padding: '8px 10px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--panel-border)', color: 'var(--ink-90)', wordBreak: 'break-all', flex: 1, minWidth: 260 }}>
                {created.key}
              </code>
              <button onClick={() => void copyKey()} className='button button-outline' style={{ height: 36 }}>{copied ? t('apiKeys.copied') : t('apiKeys.copy')}</button>
              <button onClick={() => setCreated(null)} className='button button-outline' style={{ height: 36 }}>{t('apiKeys.done')}</button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-50)', ...mono }}>{t('apiKeys.usage')}</div>
          </div>
        )}
      </div>

      {/* ── List ── */}
      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ ...rowGrid, padding: '10px 14px', borderBottom: '1px solid var(--panel-border)', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: 'var(--ink-42)', textTransform: 'uppercase', minWidth: 980 }}>
            <span>{t('apiKeys.colName')}</span>
            <span>{t('apiKeys.colKey')}</span>
            <span>{t('apiKeys.colRole')}</span>
            <span>{t('apiKeys.colStatus')}</span>
            <span>{t('apiKeys.colCreated')}</span>
            <span>{t('apiKeys.colLastUsed')}</span>
            <span>{t('apiKeys.colExpires')}</span>
            <span />
          </div>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('common.loading')}</div>
          ) : error ? (
            <div style={{ padding: 24, color: '#cf5b57', textAlign: 'center', fontSize: 13 }}>{error}</div>
          ) : keys.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--ink-50)', textAlign: 'center', fontSize: 13 }}>{t('apiKeys.empty')}</div>
          ) : (
            keys.map((k) => {
              const color = STATUS_COLOR[k.status];
              return (
                <div key={k.id} className='ent-table-row' style={{ ...rowGrid, padding: '11px 14px', borderBottom: '1px solid var(--panel-alt)', fontSize: 12, alignItems: 'center', minWidth: 980, opacity: k.status === 'active' ? 1 : 0.6 }}>
                  <span style={{ color: 'var(--ink-90)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.name}>{k.name}</span>
                  <span style={{ ...mono, color: 'var(--ink-65)' }}>{k.key_prefix}…</span>
                  <span style={{ color: 'var(--ink-65)' }}>{k.role}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    {statusLabel(k.status)}
                  </span>
                  <span style={{ color: 'var(--ink-50)' }}>{fmt(k.created_at)}</span>
                  <span style={{ color: 'var(--ink-50)' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : t('apiKeys.neverUsed')}</span>
                  <span style={{ color: 'var(--ink-50)' }}>{k.expires_at ? fmt(k.expires_at) : t('apiKeys.never')}</span>
                  <span style={{ textAlign: 'right' }}>
                    {k.status === 'active' && (
                      <button onClick={() => void onRevoke(k.id)} className='button button-outline' style={{ height: 30, padding: '0 10px', fontSize: 11, color: '#cf5b57' }} disabled={revokingId === k.id}>
                        {revokingId === k.id ? t('apiKeys.revoking') : t('apiKeys.revoke')}
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
