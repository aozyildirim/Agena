'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import Forbidden from '@/components/Forbidden';

type PermissionItem = { key: string; label: string };
type PermissionGroup = { group: string; label: string; icon: string; permissions: PermissionItem[] };
type Role = {
  id: number;
  name: string;
  description?: string | null;
  permissions: string[];
  is_builtin: boolean;
  is_default_for_new_members: boolean;
  sort_order: number;
};

export default function WorkspaceRolesPage() {
  const { t } = useLocale();
  const { orgRole, loading: permLoading } = usePermissions();
  const [catalog, setCatalog] = useState<PermissionGroup[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [pendingPerms, setPendingPerms] = useState<Set<string>>(new Set());
  const [pendingName, setPendingName] = useState<string>('');
  const [pendingDesc, setPendingDesc] = useState<string>('');
  const [pendingDefault, setPendingDefault] = useState<boolean>(false);
  const [saved, setSaved] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, rs] = await Promise.all([
        apiFetch<PermissionGroup[]>('/workspace-roles/catalog'),
        apiFetch<Role[]>('/workspace-roles'),
      ]);
      setCatalog(cat);
      setRoles(rs);
      if (activeId === null && rs.length > 0) {
        setActiveId(rs[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [activeId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = useMemo(() => roles.find((r) => r.id === activeId) || null, [roles, activeId]);

  // Sync pending state to active role
  useEffect(() => {
    if (active) {
      setPendingPerms(new Set(active.permissions));
      setPendingName(active.name);
      setPendingDesc(active.description || '');
      setPendingDefault(active.is_default_for_new_members);
    }
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePerm(key: string) {
    if (!active || active.is_builtin && active.name === 'Owner') return; // owner is locked
    const next = new Set(pendingPerms);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPendingPerms(next);
  }

  async function handleSave() {
    if (!active) return;
    setBusy(true); setError('');
    try {
      const updated = await apiFetch<Role>(`/workspace-roles/${active.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: !active.is_builtin ? pendingName.trim() : undefined,
          description: pendingDesc.trim() || null,
          permissions: Array.from(pendingPerms),
          is_default_for_new_members: pendingDefault,
        }),
      });
      setRoles(roles.map((r) => (r.id === updated.id ? updated : r)));
      setSaved(updated.id);
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setBusy(false); }
  }

  async function handleCreate() {
    setBusy(true); setError('');
    try {
      const created = await apiFetch<Role>('/workspace-roles', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          permissions: [],
        }),
      });
      setRoles([...roles, created]);
      setActiveId(created.id);
      setCreating(false);
      setNewName(''); setNewDesc('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create role');
    } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!active || active.is_builtin) return;
    if (!confirm(t('workspaceRoles.confirmDelete'))) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/workspace-roles/${active.id}`, { method: 'DELETE' });
      const remaining = roles.filter((r) => r.id !== active.id);
      setRoles(remaining);
      setActiveId(remaining[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally { setBusy(false); }
  }

  const ownerLocked = active?.is_builtin && active?.name === 'Owner';

  // Page-level guard — only org owners and admins can manage org-wide roles.
  // Show a static "loading" frame while /auth/me is in flight so non-admins
  // never see a flash of the editor before the redirect.
  if (permLoading) {
    return <div style={{ padding: 60, color: 'var(--ink-30)', fontSize: 13, textAlign: 'center' }}>…</div>;
  }
  if (orgRole !== 'owner' && orgRole !== 'admin') {
    return <Forbidden />;
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink-90)' }}>{t('workspaceRoles.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-30)', marginTop: 4 }}>{t('workspaceRoles.subtitle')}</p>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <div className="wsr-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Roles list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ padding: 12, color: 'var(--ink-30)', fontSize: 13 }}>{t('common.loading')}…</div>
          ) : (
            <>
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 12,
                    border: `1px solid ${activeId === r.id ? 'rgba(124,58,237,0.55)' : 'var(--panel-border-2)'}`,
                    background: activeId === r.id ? 'rgba(124,58,237,0.10)' : 'var(--panel)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14 }}>{r.name}</span>
                      {r.is_builtin ? <span style={pillBuiltin}>built-in</span> : null}
                      {r.is_default_for_new_members ? <span style={pillDefault}>default</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-30)', marginTop: 2 }}>{r.permissions.length} {t('workspaceRoles.perms')}</div>
                  </div>
                </button>
              ))}
              <button
                onClick={() => { setCreating(true); setError(''); }}
                style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 12,
                  border: '1px dashed var(--panel-border-3)', background: 'transparent',
                  cursor: 'pointer', color: 'var(--ink-78)', fontWeight: 600, fontSize: 13,
                }}
              >
                + {t('workspaceRoles.addCustom')}
              </button>
            </>
          )}
        </div>

        {/* Matrix editor */}
        {creating ? (
          <div style={detailPanel}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 16 }}>{t('workspaceRoles.newRoleTitle')}</h2>
            <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
              <Input label={t('workspaceRoles.nameLabel')} value={newName} onChange={setNewName} placeholder={t('workspaceRoles.namePlaceholder')} />
              <Input label={t('workspaceRoles.descLabel')} value={newDesc} onChange={setNewDesc} placeholder={t('workspaceRoles.descPlaceholder')} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setCreating(false)} style={btnSecondary}>{t('common.cancel')}</button>
                <button onClick={handleCreate} disabled={busy || !newName.trim()} style={btnPrimary}>
                  {busy ? t('common.loading') : t('workspaceRoles.createBtn')}
                </button>
              </div>
            </div>
          </div>
        ) : active ? (
          <div style={detailPanel}>
            <div style={{ marginBottom: 18 }}>
              {/* Top row: role title (with badge) on the left, action cluster on the right */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {active.is_builtin ? (
                    <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-90)', margin: 0 }}>{active.name}</h2>
                  ) : (
                    <input
                      value={pendingName}
                      onChange={(e) => setPendingName(e.target.value)}
                      style={{ fontSize: 18, fontWeight: 800, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', flex: 1, minWidth: 0, outline: 'none' }}
                    />
                  )}
                  {active.is_builtin ? <span style={pillBuiltin}>built-in</span> : null}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-78)', cursor: ownerLocked ? 'not-allowed' : 'pointer', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)' }}>
                    <input type="checkbox" checked={pendingDefault} onChange={(e) => setPendingDefault(e.target.checked)} disabled={ownerLocked} />
                    {t('workspaceRoles.defaultForNewMembers')}
                  </label>
                  {!active.is_builtin ? (
                    <button onClick={handleDelete} disabled={busy} style={btnDanger}>{t('workspaceRoles.delete')}</button>
                  ) : null}
                  <button onClick={handleSave} disabled={busy || ownerLocked} style={btnPrimary}>
                    {busy ? '...' : saved === active.id ? '✓ ' + t('workspaceRoles.saved') : t('workspaceRoles.save')}
                  </button>
                </div>
              </div>
              {/* Bottom row: description input full-width under the header */}
              <input
                value={pendingDesc}
                onChange={(e) => setPendingDesc(e.target.value)}
                placeholder={t('workspaceRoles.descPlaceholder')}
                style={{ marginTop: 10, width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-78)', fontSize: 13, outline: 'none' }}
              />
            </div>

            {ownerLocked ? (
              <div style={{ padding: 12, borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.30)', color: 'var(--ink-78)', fontSize: 13, marginBottom: 16 }}>
                {t('workspaceRoles.ownerLocked')}
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: 14 }}>
              {catalog.map((group) => (
                <div key={group.group} style={{ borderRadius: 12, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 18 }}>{group.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-58)' }}>{group.label}</span>
                    <button
                      onClick={() => {
                        if (ownerLocked) return;
                        const next = new Set(pendingPerms);
                        const allOn = group.permissions.every((p) => next.has(p.key));
                        for (const p of group.permissions) {
                          if (allOn) next.delete(p.key); else next.add(p.key);
                        }
                        setPendingPerms(next);
                      }}
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-58)', cursor: ownerLocked ? 'not-allowed' : 'pointer' }}
                    >
                      {group.permissions.every((p) => pendingPerms.has(p.key)) ? t('workspaceRoles.deselectAll') : t('workspaceRoles.selectAll')}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {group.permissions.map((p) => {
                      const on = pendingPerms.has(p.key);
                      return (
                        <button
                          type="button"
                          key={p.key}
                          onClick={() => { if (!ownerLocked) togglePerm(p.key); }}
                          disabled={ownerLocked}
                          aria-pressed={on}
                          className="wsr-perm-row"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '20px 1fr',
                            alignItems: 'center',
                            columnGap: 12,
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: on ? 'rgba(124,58,237,0.08)' : 'transparent',
                            border: `1px solid ${on ? 'rgba(124,58,237,0.30)' : 'var(--panel-border-2)'}`,
                            cursor: ownerLocked ? 'not-allowed' : 'pointer',
                            opacity: ownerLocked ? 0.6 : 1,
                            font: 'inherit',
                            color: 'inherit',
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 16, height: 16, borderRadius: 4,
                              border: `1.5px solid ${on ? '#7c3aed' : 'var(--panel-border-3)'}`,
                              background: on ? '#7c3aed' : 'transparent',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontSize: 11, lineHeight: 1, fontWeight: 800,
                            }}
                          >
                            {on ? '✓' : ''}
                          </span>
                          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 2, minWidth: 0 }}>
                            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#a78bfa', fontWeight: 700, whiteSpace: 'nowrap' }}>{p.key}</span>
                            <span style={{ fontSize: 12, color: 'var(--ink-78)', lineHeight: 1.45 }}>{p.label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: 24, color: 'var(--ink-30)', fontSize: 13 }}>{t('workspaceRoles.pickToEdit')}</div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 880px) {
          .wsr-grid { grid-template-columns: 1fr !important; }
        }
      ` }} />
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.10)', color: '#dc2626', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const errorBox: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#dc2626', fontSize: 13, marginBottom: 16 };
const detailPanel: React.CSSProperties = { padding: 20, borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)' };
const pillBuiltin: React.CSSProperties = { fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: 'rgba(124,58,237,0.15)', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1 };
const pillDefault: React.CSSProperties = { fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: 'rgba(34,197,94,0.15)', color: '#22c55e', textTransform: 'uppercase', letterSpacing: 1 };
