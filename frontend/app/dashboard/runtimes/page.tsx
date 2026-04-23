'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Runtime = {
  id: number;
  organization_id: number;
  name: string;
  kind: string;
  status: 'active' | 'offline' | 'disabled' | string;
  description: string | null;
  available_clis: string[];
  daemon_version: string | null;
  host: string | null;
  has_auth_token: boolean;
  last_heartbeat_at: string | null;
  last_heartbeat_age_sec: number | null;
  created_at: string;
  updated_at: string;
};

function fmtAge(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const STATUS_COLOUR: Record<string, string> = {
  active: '#22c55e',
  offline: '#94a3b8',
  disabled: '#f87171',
};

export default function RuntimesPage() {
  const { t } = useLocale();
  const tr = useCallback((k: string) => t(k as Parameters<typeof t>[0]), [t]);

  const [rows, setRows] = useState<Runtime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newRuntime, setNewRuntime] = useState({ name: '', kind: 'local', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<Runtime[]>('/runtimes');
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('runtimes.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 10s so heartbeat freshness is live
  useEffect(() => {
    const iv = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(iv);
  }, [load]);

  async function saveNew() {
    setSaving(true);
    try {
      await apiFetch('/runtimes', {
        method: 'POST',
        body: JSON.stringify({
          name: newRuntime.name.trim(),
          kind: newRuntime.kind,
          description: newRuntime.description.trim(),
        }),
      });
      setCreateOpen(false);
      setNewRuntime({ name: '', kind: 'local', description: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('runtimes.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(id: number) {
    if (!confirm(tr('runtimes.confirmDelete'))) return;
    try {
      await apiFetch(`/runtimes/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('runtimes.deleteFailed'));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1200, paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className='section-label'>{tr('runtimes.sectionLabel')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6, marginBottom: 2 }}>
            {tr('runtimes.title')}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--ink-30)', margin: 0 }}>
            {tr('runtimes.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 10,
            border: '1px solid rgba(13,148,136,0.6)',
            background: 'linear-gradient(135deg, #0d9488, #5eead4)',
            color: '#0a1815', cursor: 'pointer',
          }}
        >
          + {tr('runtimes.newRuntime')}
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
          {loading ? tr('runtimes.loading') : tr('runtimes.refresh')}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.06)', color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{
          padding: 24, borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)',
          textAlign: 'center', color: 'var(--ink-45)',
        }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>💻</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4 }}>{tr('runtimes.empty.title')}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
            {tr('runtimes.empty.hint')}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((r) => {
          const colour = STATUS_COLOUR[r.status] || '#94a3b8';
          return (
            <div key={r.id} style={{
              border: '1px solid var(--panel-border-2)',
              borderLeft: `3px solid ${colour}`,
              borderRadius: 12, background: 'var(--panel)',
              padding: '14px 18px',
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: colour, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{r.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: colour, textTransform: 'uppercase', letterSpacing: 0.6, padding: '2px 8px', borderRadius: 6, background: `${colour}1e` }}>
                    {r.status}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-50)', padding: '2px 8px', borderRadius: 6, background: 'var(--panel-alt)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    {r.kind}
                  </span>
                  {r.has_auth_token && (
                    <span style={{ fontSize: 10, color: '#a78bfa', padding: '2px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.1)' }}>
                      🔑 {tr('runtimes.enrolled')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-50)', marginTop: 4 }}>
                  <span>{tr('runtimes.col.heartbeat')}: {fmtAge(r.last_heartbeat_age_sec)}</span>
                  {r.host && <span>{tr('runtimes.col.host')}: {r.host}</span>}
                  {r.daemon_version && <span>{tr('runtimes.col.version')}: {r.daemon_version}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {(r.available_clis || []).length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--ink-42)', fontStyle: 'italic' }}>
                      {tr('runtimes.noClis')}
                    </span>
                  ) : (
                    r.available_clis.map((cli) => (
                      <span key={cli} style={{
                        fontSize: 11, fontWeight: 700,
                        padding: '3px 10px', borderRadius: 999,
                        background: 'rgba(94,234,212,0.12)', color: '#5eead4',
                      }}>
                        {cli}
                      </span>
                    ))
                  )}
                </div>
                {r.description && (
                  <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 6, lineHeight: 1.5 }}>
                    {r.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => void deleteRow(r.id)}
                style={{ fontSize: 11, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', color: '#fca5a5', cursor: 'pointer' }}
              >
                {tr('runtimes.delete')}
              </button>
            </div>
          );
        })}
      </div>

      {createOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(460px, 100%)', background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 14, padding: 22, display: 'grid', gap: 12 }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)' }}>{tr('runtimes.newRuntime')}</div>
            <input
              type='text'
              placeholder={tr('runtimes.field.name')}
              value={newRuntime.name}
              onChange={(e) => setNewRuntime({ ...newRuntime, name: e.target.value })}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)' }}
            />
            <select
              value={newRuntime.kind}
              onChange={(e) => setNewRuntime({ ...newRuntime, kind: e.target.value })}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)' }}
            >
              <option value='local'>local</option>
              <option value='cloud'>cloud</option>
            </select>
            <textarea
              placeholder={tr('runtimes.field.description')}
              value={newRuntime.description}
              onChange={(e) => setNewRuntime({ ...newRuntime, description: e.target.value })}
              rows={2}
              style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-90)', resize: 'vertical', minHeight: 60 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => setCreateOpen(false)}
                style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-65)', cursor: 'pointer' }}
              >
                {tr('runtimes.cancel')}
              </button>
              <button
                onClick={() => void saveNew()}
                disabled={saving || !newRuntime.name.trim()}
                style={{ padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 800, border: '1px solid rgba(13,148,136,0.6)', background: 'linear-gradient(135deg, #0d9488, #5eead4)', color: '#0a1815', cursor: saving ? 'wait' : 'pointer', opacity: saving || !newRuntime.name.trim() ? 0.5 : 1 }}
              >
                {saving ? tr('runtimes.saving') : tr('runtimes.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
