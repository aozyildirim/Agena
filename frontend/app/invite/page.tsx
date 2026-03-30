'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, isLoggedIn, setToken } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LangToggle from '@/components/LangToggle';

type InviteInfo = {
  email: string;
  status: string;
  organization_name: string;
  organization_id: number;
  inviter_name: string | null;
};

type AuthResponse = { access_token: string };

export default function InvitePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const token = searchParams.get('token') || '';

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Signup form state (for users not logged in)
  const [showSignup, setShowSignup] = useState(false);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signingUp, setSigningUp] = useState(false);

  useEffect(() => {
    if (!token) {
      setError(t('invite.noToken'));
      setLoading(false);
      return;
    }
    apiFetch<InviteInfo>(`/org/invite/validate?token=${encodeURIComponent(token)}`, undefined, false)
      .then((data) => {
        setInvite(data);
        if (data.status !== 'pending') {
          setError(t('invite.alreadyUsed'));
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('invite.invalid'));
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true);
    setError('');
    try {
      await apiFetch('/org/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setAccepted(true);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invite.acceptError'));
    } finally {
      setAccepting(false);
    }
  }

  async function handleSignupAndAccept(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setSignupError('');
    setSigningUp(true);
    try {
      // Sign up with a dummy org name (user will be added to inviter's org)
      const res = await apiFetch<AuthResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: invite.email,
          full_name: fullName,
          organization_name: `${fullName}'s Org`,
          password,
        }),
      }, false);
      setToken(res.access_token);

      // Now accept the invite
      await apiFetch('/org/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setAccepted(true);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : t('invite.signupError'));
    } finally {
      setSigningUp(false);
    }
  }

  const loggedIn = isLoggedIn();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#030712', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', top: '15%', right: '10%', width: 450, height: 450, borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,148,136,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '15%', left: '10%', width: 350, height: 350, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 16, right: 16 }}><LangToggle /></div>

      <div style={{ width: '100%', maxWidth: 460, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Link href='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#fff' }}>T</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)' }}>AGENA</span>
          </Link>
        </div>

        <div style={{ borderRadius: 24, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', backdropFilter: 'blur(20px)', padding: '36px 32px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.5), transparent)' }} />

          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--ink-35)' }}>{t('invite.validating')}</div>
            </div>
          ) : error && !invite ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>{t('invite.invalidTitle')}</h2>
              <p style={{ fontSize: 13, color: '#f87171', marginBottom: 20 }}>{error}</p>
              <Link href='/signin' style={{ color: '#5eead4', fontWeight: 600, textDecoration: 'none', fontSize: 13 }}>{t('invite.goSignin')}</Link>
            </div>
          ) : accepted ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 28, color: '#22c55e' }}>&#10003;</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>{t('invite.accepted')}</h2>
              <p style={{ fontSize: 13, color: 'var(--ink-35)' }}>{t('invite.redirecting')}</p>
            </div>
          ) : invite ? (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 6 }}>{t('invite.title')}</h1>
              <p style={{ fontSize: 13, color: 'var(--ink-30)', marginBottom: 24 }}>{t('invite.subtitle')}</p>

              {/* Invite details card */}
              <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--glass)', padding: '18px 20px', marginBottom: 24 }}>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4 }}>{t('invite.organization')}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-90)' }}>{invite.organization_name}</div>
                  </div>
                  {invite.inviter_name && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4 }}>{t('invite.invitedBy')}</div>
                      <div style={{ fontSize: 14, color: 'var(--ink-90)' }}>{invite.inviter_name}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4 }}>{t('invite.email')}</div>
                    <div style={{ fontSize: 14, color: 'var(--ink-90)' }}>{invite.email}</div>
                  </div>
                </div>
              </div>

              {invite.status !== 'pending' ? (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>
                  {t('invite.alreadyUsed')}
                </div>
              ) : loggedIn ? (
                <>
                  {error && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13, marginBottom: 14 }}>{error}</div>
                  )}
                  <button
                    onClick={() => void handleAccept()}
                    disabled={accepting}
                    style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: accepting ? 'rgba(13,148,136,0.4)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: accepting ? 'not-allowed' : 'pointer', letterSpacing: 0.3 }}
                  >
                    {accepting ? t('invite.accepting') : t('invite.acceptButton')}
                  </button>
                </>
              ) : showSignup ? (
                <form onSubmit={(e) => void handleSignupAndAccept(e)} style={{ display: 'grid', gap: 14 }}>
                  <AuthInput label={t('signup.fullName')} type='text' value={fullName} onChange={setFullName} placeholder={t('signup.fullNamePlaceholder')} />
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 6 }}>{t('signup.email')}</label>
                    <input
                      type='email' value={invite.email} disabled
                      style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-50)', fontSize: 14, outline: 'none', boxSizing: 'border-box', opacity: 0.7 }}
                    />
                  </div>
                  <AuthInput label={t('signup.password')} type='password' value={password} onChange={setPassword} placeholder={t('signup.passwordPlaceholder')} />

                  {signupError && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{signupError}</div>
                  )}

                  <button type='submit' disabled={signingUp} style={{ marginTop: 4, padding: '13px', borderRadius: 12, border: 'none', background: signingUp ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: signingUp ? 'not-allowed' : 'pointer', letterSpacing: 0.3 }}>
                    {signingUp ? t('invite.signingUp') : t('invite.signupAndAccept')}
                  </button>

                  <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-30)' }}>
                    {t('invite.hasAccount')}{' '}
                    <Link href={`/signin?next=${encodeURIComponent(`/invite?token=${token}`)}`} style={{ color: '#5eead4', fontWeight: 600, textDecoration: 'none' }}>{t('invite.signinLink')}</Link>
                  </p>
                </form>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {error && (
                    <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{error}</div>
                  )}
                  <button
                    onClick={() => setShowSignup(true)}
                    style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', letterSpacing: 0.3 }}
                  >
                    {t('invite.createAccount')}
                  </button>
                  <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-30)' }}>
                    {t('invite.hasAccount')}{' '}
                    <Link href={`/signin?next=${encodeURIComponent(`/invite?token=${token}`)}`} style={{ color: '#5eead4', fontWeight: 600, textDecoration: 'none' }}>{t('invite.signinLink')}</Link>
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AuthInput({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 6 }}>{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border-3)'; }}
      />
    </div>
  );
}
