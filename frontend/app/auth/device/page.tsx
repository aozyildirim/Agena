'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

type CodeInfo = {
  found: boolean;
  status?: 'pending' | 'approved' | 'expired' | 'denied';
  client_name?: string;
  expires_in?: number;
};

type OrgOption = {
  id: number;
  slug: string;
  name: string;
};

export default function DeviceApprovePage() {
  const params = useSearchParams();
  const qsCode = (params?.get('user_code') || '').toUpperCase();
  const [code, setCode] = useState(qsCode);
  const [info, setInfo] = useState<CodeInfo | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);

  // Load the user's orgs so they can pick which one the CLI enrolls into.
  useEffect(() => {
    void (async () => {
      try {
        const me = await apiFetch<{ organizations?: OrgOption[] }>('/auth/me');
        const list = me?.organizations || [];
        setOrgs(list);
        if (list.length > 0) setSelectedSlug(list[0].slug);
      } catch {
        // Fallback — user can type tenant slug manually
      }
    })();
  }, []);

  // Validate a code once the user finishes typing (or from the URL)
  useEffect(() => {
    const clean = (code || '').replace(/\s+/g, '').toUpperCase();
    if (clean.length < 8) { setInfo(null); return; }
    void (async () => {
      try {
        const data = await apiFetch<CodeInfo>(`/auth/device/lookup/${encodeURIComponent(clean)}`);
        setInfo(data);
      } catch {
        setInfo({ found: false });
      }
    })();
  }, [code]);

  const canApprove = useMemo(
    () => info?.found && info?.status === 'pending' && selectedSlug.trim().length > 0 && !approved,
    [info, selectedSlug, approved],
  );

  async function approve() {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/auth/device/approve', {
        method: 'POST',
        body: JSON.stringify({
          user_code: code.replace(/\s+/g, '').toUpperCase(),
          tenant_slug: selectedSlug.trim().toLowerCase(),
        }),
      });
      setApproved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg-1, #0b1220)',
    }}>
      <div style={{
        width: 'min(520px, 100%)',
        background: 'var(--surface, #111827)',
        border: '1px solid var(--panel-border, rgba(148,163,184,0.2))',
        borderRadius: 16,
        padding: 28,
        display: 'grid',
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#5eead4', letterSpacing: 1, textTransform: 'uppercase' }}>
            Device login
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90, #e2e8f0)', margin: '4px 0 0' }}>
            Authorise the CLI
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink-50, #94a3b8)', margin: '6px 0 0' }}>
            Enter the code shown by <code>agena login</code> to link your terminal to this workspace.
          </p>
        </div>

        {approved ? (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)',
            color: '#86efac', fontSize: 14, fontWeight: 700,
          }}>
            ✅ Approved. You can close this tab — your CLI will pick up the token within a few seconds.
          </div>
        ) : (
          <>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50, #94a3b8)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                User code
              </span>
              <input
                type='text'
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder='AAAA-BBBB'
                style={{
                  fontSize: 22, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  textAlign: 'center', letterSpacing: 4,
                  padding: '12px 14px', borderRadius: 10,
                  border: '1px solid var(--panel-border-2, rgba(148,163,184,0.35))',
                  background: 'var(--panel, #0f172a)', color: 'var(--ink-90, #e2e8f0)',
                }}
                autoFocus
              />
              {info && !info.found && code.length >= 8 && (
                <span style={{ fontSize: 12, color: '#fca5a5' }}>Unknown or expired code.</span>
              )}
              {info?.found && info.status === 'pending' && (
                <span style={{ fontSize: 12, color: '#86efac' }}>
                  ✓ Waiting on you — client: {info.client_name || 'agena-cli'}
                  {info.expires_in != null && <> · expires in {Math.floor(info.expires_in / 60)}m {info.expires_in % 60}s</>}
                </span>
              )}
              {info?.found && info.status === 'expired' && (
                <span style={{ fontSize: 12, color: '#fca5a5' }}>This code has expired. Run <code>agena login</code> again.</span>
              )}
              {info?.found && info.status === 'approved' && (
                <span style={{ fontSize: 12, color: 'var(--ink-50)' }}>Already approved.</span>
              )}
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Organization
              </span>
              {orgs.length > 0 ? (
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  style={{
                    fontSize: 14, padding: '10px 12px', borderRadius: 10,
                    border: '1px solid var(--panel-border-2, rgba(148,163,184,0.35))',
                    background: 'var(--panel, #0f172a)', color: 'var(--ink-90, #e2e8f0)',
                  }}
                >
                  {orgs.map((o) => (
                    <option key={o.slug} value={o.slug}>{o.name} ({o.slug})</option>
                  ))}
                </select>
              ) : (
                <input
                  type='text'
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  placeholder='tenant-slug'
                  style={{
                    fontSize: 14, padding: '10px 12px', borderRadius: 10,
                    border: '1px solid var(--panel-border-2, rgba(148,163,184,0.35))',
                    background: 'var(--panel, #0f172a)', color: 'var(--ink-90, #e2e8f0)',
                  }}
                />
              )}
            </label>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              onClick={() => void approve()}
              disabled={!canApprove || busy}
              style={{
                padding: '12px 16px', borderRadius: 12, fontSize: 14, fontWeight: 800,
                border: '1px solid rgba(13,148,136,0.6)',
                background: 'linear-gradient(135deg, #0d9488, #5eead4)',
                color: '#0a1815', cursor: canApprove && !busy ? 'pointer' : 'default',
                opacity: (!canApprove || busy) ? 0.5 : 1,
              }}
            >
              {busy ? 'Approving...' : 'Approve + link CLI'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
