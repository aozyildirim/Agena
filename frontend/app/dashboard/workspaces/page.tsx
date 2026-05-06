'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Workspace = {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  invite_code: string;
  is_default: boolean;
  created_at: string;
};

type WorkspaceMember = {
  user_id: number;
  email: string;
  full_name: string;
  role: string;
  title?: string | null;
  joined_at: string;
};

const GRADIENTS = [
  ['#7c3aed', '#a78bfa'],
  ['#0d9488', '#22c55e'],
  ['#0ea5e9', '#38bdf8'],
  ['#f59e0b', '#fb923c'],
  ['#ec4899', '#f472b6'],
  ['#14b8a6', '#06b6d4'],
];
const gradFor = (name: string) => {
  const g = GRADIENTS[Math.abs(name.charCodeAt(0) || 0) % GRADIENTS.length];
  return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
};

export default function WorkspacesPage() {
  const { t } = useLocale();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinTitle, setJoinTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiFetch<Workspace[]>('/workspaces');
      setWorkspaces(list);
      if (activeId === null && list.length > 0) setActiveId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  const loadMembers = useCallback(async (id: number) => {
    try {
      const list = await apiFetch<WorkspaceMember[]>(`/workspaces/${id}/members`);
      setMembers(list);
    } catch (e) {
      setMembers([]);
    }
  }, []);

  useEffect(() => { void loadWorkspaces(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeId !== null) void loadMembers(activeId); }, [activeId, loadMembers]);

  const active = useMemo(() => workspaces.find((w) => w.id === activeId) || null, [workspaces, activeId]);

  async function handleCreate() {
    setBusy(true); setError('');
    try {
      const ws = await apiFetch<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: createName.trim(), description: createDesc.trim() || undefined }),
      });
      setWorkspaces([...workspaces, ws]);
      setActiveId(ws.id);
      setCreateOpen(false);
      setCreateName(''); setCreateDesc('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setBusy(true); setError('');
    try {
      const ws = await apiFetch<Workspace>('/workspaces/join', {
        method: 'POST',
        body: JSON.stringify({ invite_code: joinCode.trim().toUpperCase(), title: joinTitle.trim() || undefined }),
      });
      // Refresh listing — joined ws may already be visible
      await loadWorkspaces();
      setActiveId(ws.id);
      setJoinOpen(false);
      setJoinCode(''); setJoinTitle('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join workspace');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerateCode() {
    if (!active) return;
    setBusy(true); setError('');
    try {
      const ws = await apiFetch<Workspace>(`/workspaces/${active.id}/regenerate-code`, { method: 'POST' });
      setWorkspaces(workspaces.map((w) => (w.id === ws.id ? ws : w)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate code');
    } finally { setBusy(false); }
  }

  async function handleUpdateTitle(memberUserId: number, title: string) {
    if (!active) return;
    try {
      await apiFetch(`/workspaces/${active.id}/members/${memberUserId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: title || null }),
      });
      await loadMembers(active.id);
    } catch (e) { /* ignore */ }
  }

  async function handleRemoveMember(memberUserId: number) {
    if (!active) return;
    if (!confirm(t('workspaces.confirmRemoveMember'))) return;
    try {
      await apiFetch(`/workspaces/${active.id}/members/${memberUserId}`, { method: 'DELETE' });
      await loadMembers(active.id);
    } catch (e) { /* ignore */ }
  }

  function copy(text: string, id: number) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink-90)' }}>{t('workspaces.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-30)', marginTop: 4 }}>{t('workspaces.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setJoinOpen(true); setError(''); }} style={btnSecondary}>
            {t('workspaces.join')}
          </button>
          <button onClick={() => { setCreateOpen(true); setError(''); }} style={btnPrimary}>
            + {t('workspaces.create')}
          </button>
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 20, alignItems: 'start' }}>
        {/* Left column: workspace list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ color: 'var(--ink-30)', fontSize: 13, padding: 12 }}>{t('common.loading')}…</div>
          ) : workspaces.length === 0 ? (
            <div style={{ color: 'var(--ink-30)', fontSize: 13, padding: 12 }}>{t('workspaces.empty')}</div>
          ) : (
            workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => setActiveId(w.id)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: `1px solid ${activeId === w.id ? 'rgba(124,58,237,0.55)' : 'var(--panel-border-2)'}`,
                  background: activeId === w.id ? 'rgba(124,58,237,0.08)' : 'var(--panel)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 10, background: gradFor(w.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>
                  {(w.name[0] || 'W').toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                    {w.is_default ? <span style={defaultPill}>default</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-30)', marginTop: 2, fontFamily: 'monospace' }}>{w.slug}</div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right column: workspace detail */}
        {active ? (
          <div style={detailPanel}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: gradFor(active.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 22 }}>
                {(active.name[0] || 'W').toUpperCase()}
              </div>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-90)' }}>{active.name}</h2>
                <div style={{ fontSize: 13, color: 'var(--ink-30)', marginTop: 2 }}>{active.description || ''}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 22 }}>
              <div style={statCard}>
                <div style={statLabel}>{t('workspaces.inviteCode')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <code style={inviteCodeBox}>{active.invite_code}</code>
                  <button onClick={() => copy(active.invite_code, active.id)} style={btnGhost}>
                    {copied === active.id ? t('workspaces.copied') : t('workspaces.copy')}
                  </button>
                </div>
                <button onClick={handleRegenerateCode} disabled={busy} style={{ ...btnGhost, marginTop: 8, fontSize: 12 }}>
                  ↻ {t('workspaces.regenerate')}
                </button>
              </div>
              <div style={statCard}>
                <div style={statLabel}>{t('workspaces.members')}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6 }}>{members.length}</div>
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{t('workspaces.membersTitle')}</h3>
              {members.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-30)' }}>{t('workspaces.noMembers')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {members.map((m) => (
                    <div key={m.user_id} style={memberRow}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: gradFor(m.full_name || m.email), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                        {((m.full_name || m.email)[0] || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 13 }}>{m.full_name || m.email}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-30)' }}>{m.email} · {m.role}</div>
                      </div>
                      <input
                        type="text"
                        defaultValue={m.title || ''}
                        placeholder={t('workspaces.titlePlaceholder')}
                        onBlur={(e) => { if (e.target.value !== (m.title || '')) void handleUpdateTitle(m.user_id, e.target.value); }}
                        style={titleInput}
                      />
                      <button onClick={() => handleRemoveMember(m.user_id)} style={btnDanger} title={t('workspaces.remove')}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Create modal */}
      {createOpen ? (
        <Modal title={t('workspaces.createTitle')} onClose={() => setCreateOpen(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Input label={t('workspaces.nameLabel')} value={createName} onChange={setCreateName} placeholder={t('workspaces.namePlaceholder')} />
            <Input label={t('workspaces.descLabel')} value={createDesc} onChange={setCreateDesc} placeholder={t('workspaces.descPlaceholder')} />
            <button onClick={handleCreate} disabled={busy || !createName.trim()} style={btnPrimary}>
              {busy ? t('common.loading') : t('workspaces.create')}
            </button>
          </div>
        </Modal>
      ) : null}

      {/* Join modal */}
      {joinOpen ? (
        <Modal title={t('workspaces.joinTitle')} onClose={() => setJoinOpen(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Input label={t('workspaces.codeLabel')} value={joinCode} onChange={(v) => setJoinCode(v.toUpperCase())} placeholder='ABC123' mono />
            <Input label={t('workspaces.titleLabel')} value={joinTitle} onChange={setJoinTitle} placeholder={t('workspaces.titlePlaceholder')} />
            <button onClick={handleJoin} disabled={busy || !joinCode.trim()} style={btnPrimary}>
              {busy ? t('common.loading') : t('workspaces.join')}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,8,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--panel)', borderRadius: 16, padding: 24, border: '1px solid var(--panel-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--ink-30)', cursor: 'pointer', fontSize: 22 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, mono = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: mono ? 'monospace' : undefined, letterSpacing: mono ? 2 : undefined }}
      />
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: '10px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '10px 16px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-78)', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.10)', color: '#dc2626', fontWeight: 700, fontSize: 12, cursor: 'pointer' };
const errorBox: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#dc2626', fontSize: 13, marginBottom: 16 };
const detailPanel: React.CSSProperties = { padding: 24, borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)' };
const statCard: React.CSSProperties = { padding: 14, borderRadius: 12, border: '1px solid var(--panel-border-2)', background: 'var(--glass)' };
const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' };
const inviteCodeBox: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.30)', color: 'var(--ink-90)', fontWeight: 800, fontSize: 14, letterSpacing: 2, fontFamily: 'monospace' };
const memberRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--glass)' };
const titleInput: React.CSSProperties = { width: 140, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--panel)', color: 'var(--ink-90)', fontSize: 12, outline: 'none' };
const defaultPill: React.CSSProperties = { fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: 'rgba(34,197,94,0.15)', color: '#22c55e', textTransform: 'uppercase', letterSpacing: 1 };
