'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, isLoggedIn } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LangToggle from '@/components/LangToggle';

type InvitePreview = {
  workspace_id: number;
  workspace_name: string;
  workspace_slug: string;
  organization_id: number;
  organization_name: string;
  organization_slug: string;
  role_id: number | null;
  role_name: string | null;
  expires_at: string | null;
  uses: number;
  max_uses: number | null;
};

export default function InviteTokenPage() {
  const router = useRouter();
  const { t } = useLocale();
  const params = useParams<{ token: string }>();
  const token = params?.token || '';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
    if (!token) { setError(t('invite.invalid')); setLoading(false); return; }
    apiFetch<InvitePreview>(`/invites/${encodeURIComponent(token)}/preview`, undefined, false)
      .then(setPreview)
      .catch(() => setError(t('invite.invalid')))
      .finally(() => setLoading(false));
  }, [token, t]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true); setError('');
    try {
      await apiFetch(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('invite.acceptError'));
    } finally { setAccepting(false); }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(circle at 82% 18%, rgba(139,92,246,0.10), transparent 34%), radial-gradient(circle at 16% 86%, rgba(13,148,136,0.10), transparent 36%)' }} />
      <div style={{ position: 'fixed', top: 16, right: 16 }}><LangToggle /></div>

      <div style={{ width: '100%', maxWidth: 460, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Link href='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <img src='/media/agena-logo.svg' alt='AGENA' loading='lazy' style={{ width: 138, height: 'auto', display: 'block' }} />
          </Link>
        </div>

        <div style={{ borderRadius: 20, border: '1px solid var(--panel-border)', background: 'var(--panel)', boxShadow: '0 18px 40px rgba(2,8,23,0.14)', padding: '34px 30px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.45), transparent)' }} />

          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-30)' }}>{t('common.loading')}…</div>
          ) : preview ? (
            <>
              <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-58)', marginBottom: 8 }}>{t('invite.title')}</p>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 6 }}>
                {t('invite.joinWorkspace', { workspace: preview.workspace_name })}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--ink-30)', marginBottom: 18 }}>
                {t('invite.partOfOrg', { org: preview.organization_name })}
              </p>

              {preview.role_name ? (
                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.20)', color: 'var(--ink-78)', fontSize: 13, marginBottom: 22 }}>
                  {t('invite.asRole', { role: preview.role_name })}
                </div>
              ) : null}

              {error ? (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
              ) : null}

              {loggedIn ? (
                <button
                  onClick={() => void handleAccept()}
                  disabled={accepting}
                  style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: accepting ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: accepting ? 'not-allowed' : 'pointer' }}
                >
                  {accepting ? `${t('common.loading')}…` : t('invite.acceptCta')}
                </button>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  <Link
                    href={`/signup?invite=${encodeURIComponent(token)}`}
                    style={{ display: 'block', textAlign: 'center', padding: '13px', borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}
                  >
                    {t('invite.signUpCta')}
                  </Link>
                  <Link
                    href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}`}
                    style={{ display: 'block', textAlign: 'center', padding: '11px', borderRadius: 12, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-78)', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
                  >
                    {t('invite.signInCta')}
                  </Link>
                </div>
              )}
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 6 }}>{t('invite.invalid')}</h1>
              <p style={{ fontSize: 13, color: 'var(--ink-30)' }}>{t('invite.invalidHint')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
