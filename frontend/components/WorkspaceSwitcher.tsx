'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Workspace = {
  id: number;
  name: string;
  slug: string;
  is_default: boolean;
  invite_code: string;
};

const LS_ACTIVE_WORKSPACE = 'agena_active_workspace_id';

export function getActiveWorkspaceId(): number | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(LS_ACTIVE_WORKSPACE);
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function setActiveWorkspaceId(id: number | null): void {
  if (typeof window === 'undefined') return;
  if (id === null) window.localStorage.removeItem(LS_ACTIVE_WORKSPACE);
  else window.localStorage.setItem(LS_ACTIVE_WORKSPACE, String(id));
}

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

export default function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useLocale();
  const [list, setList] = useState<Workspace[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    apiFetch<Workspace[]>('/workspaces')
      .then((rows) => {
        if (!mounted) return;
        setList(rows);
        const stored = getActiveWorkspaceId();
        if (stored && rows.some((r) => r.id === stored)) setActive(stored);
        else if (rows.length > 0) {
          const def = rows.find((r) => r.is_default) || rows[0];
          setActive(def.id);
          setActiveWorkspaceId(def.id);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  function pick(id: number) {
    setActive(id);
    setActiveWorkspaceId(id);
    setOpen(false);
    window.dispatchEvent(new CustomEvent('agena:workspace-changed', { detail: id }));
  }

  const current = list.find((w) => w.id === active) || null;

  if (list.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          padding: collapsed ? '8px' : '10px 12px',
          borderRadius: 12,
          border: '1px solid var(--panel-border-2)',
          background: 'var(--panel-solid)',
          color: 'var(--ink-90)',
          display: 'flex', alignItems: 'center', gap: 10,
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 44,
        }}
      >
        <div style={{ width: 28, height: 28, borderRadius: 8, background: gradFor(current?.name || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>
          {(current?.name?.[0] || 'W').toUpperCase()}
        </div>
        {!collapsed ? (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-30)', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>{t('workspaces.label')}</div>
              <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.name || '—'}</div>
            </div>
            <span style={{ color: 'var(--ink-30)', fontSize: 11 }}>▾</span>
          </>
        ) : null}
      </button>

      {open ? (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, minWidth: 240, background: 'var(--panel-solid)', backgroundColor: 'var(--panel-solid)', border: '1px solid var(--panel-border)', borderRadius: 12, boxShadow: '0 18px 40px rgba(2,8,23,0.45)', overflow: 'hidden', zIndex: 9999, isolation: 'isolate' }}>
          <div style={{ maxHeight: 280, overflowY: 'auto', background: 'var(--panel-solid)' }}>
            {list.map((w) => (
              <button
                key={w.id}
                onClick={() => pick(w.id)}
                style={{ width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: w.id === active ? 'rgba(124,58,237,0.16)' : 'var(--panel-solid)', border: 'none', borderBottom: '1px solid var(--panel-border-2)', cursor: 'pointer', textAlign: 'left', color: 'var(--ink-90)' }}
              >
                <div style={{ width: 26, height: 26, borderRadius: 7, background: gradFor(w.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 11 }}>
                  {(w.name[0] || 'W').toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                    {w.is_default ? <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>def</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-30)', fontFamily: 'monospace' }}>{w.slug}</div>
                </div>
                {w.id === active ? <span style={{ color: '#22c55e', fontSize: 14 }}>✓</span> : null}
              </button>
            ))}
          </div>
          <Link href="/dashboard/workspaces" onClick={() => setOpen(false)} style={{ display: 'block', padding: '10px 12px', fontSize: 13, color: 'var(--ink-78)', textDecoration: 'none', fontWeight: 600, background: 'var(--panel-solid)', borderTop: '1px solid var(--panel-border-2)' }}>
            ⚙ {t('workspaces.manage')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
