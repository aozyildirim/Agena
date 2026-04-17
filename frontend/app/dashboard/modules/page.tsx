'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type ModuleItem = {
  slug: string;
  name: string;
  description: string | null;
  icon: string;
  is_core: boolean;
  default_enabled: boolean;
  enabled: boolean;
};

export default function ModulesPage() {
  const { t } = useLocale();
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiFetch<ModuleItem[]>('/modules')
      .then(setModules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(slug: string, enabled: boolean) {
    setToggling(slug);
    try {
      const updated = await apiFetch<ModuleItem>(`/modules/${slug}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      setModules((prev) => prev.map((m) => m.slug === slug ? { ...m, enabled: updated.enabled } : m));
      setMsg(`${updated.name} ${updated.enabled ? 'enabled' : 'disabled'}`);
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('Failed to update module');
      setTimeout(() => setMsg(''), 2000);
    } finally {
      setToggling(null);
    }
  }

  const enabledCount = modules.filter((m) => m.enabled).length;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 800 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>
          Modules
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-30)', marginLeft: 10 }}>
            {enabledCount}/{modules.length} active
          </span>
        </h1>
        <p style={{ fontSize: 12, color: 'var(--ink-40)', marginTop: 4 }}>
          Enable or disable features for your organization. Core modules cannot be disabled.
        </p>
      </div>

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, color: '#86efac', background: 'rgba(20,83,45,0.9)', border: '1px solid rgba(34,197,94,0.35)' }}>
          {msg}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-25)' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
          {modules.map((m) => (
            <div key={m.slug} style={{
              borderRadius: 12,
              border: `1px solid ${m.enabled ? 'rgba(34,197,94,0.3)' : 'var(--panel-border)'}`,
              background: m.enabled ? 'rgba(34,197,94,0.04)' : 'var(--surface)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'all 0.2s',
              opacity: toggling === m.slug ? 0.5 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>{m.name}</div>
                </div>
                {m.is_core ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#38bdf8' }}>CORE</span>
                ) : (
                  <div
                    onClick={() => !toggling && toggle(m.slug, !m.enabled)}
                    style={{
                      width: 36, height: 20, borderRadius: 999,
                      background: m.enabled ? '#22c55e' : 'var(--panel-border-3)',
                      position: 'relative', cursor: toggling ? 'wait' : 'pointer',
                      transition: 'background 0.2s', flexShrink: 0,
                    }}>
                    <div style={{
                      position: 'absolute', top: 2, left: m.enabled ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s',
                    }} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.4 }}>
                {m.description}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
