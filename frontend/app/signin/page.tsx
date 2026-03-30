'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, isLoggedIn, setToken, setOrgSlug, setOrgName } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LangToggle from '@/components/LangToggle';

type AuthResponse = { access_token: string; org_slug: string; org_name: string };

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) router.replace('/dashboard');
  }, [router]);

  function resolveNextUrl(): string {
    const raw = searchParams.get('next') || '';
    if (!raw.startsWith('/')) return '/dashboard';
    if (raw.startsWith('//')) return '/dashboard';
    return raw;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }, false);
      setToken(res.access_token);
      if (res.org_slug) setOrgSlug(res.org_slug);
      if (res.org_name) setOrgName(res.org_name);
      router.push(resolveNextUrl());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signin.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(circle at 18% 22%, rgba(13,148,136,0.10), transparent 32%), radial-gradient(circle at 84% 78%, rgba(59,130,246,0.10), transparent 34%)' }} />
      <div style={{ position: 'fixed', top: 16, right: 16 }}><LangToggle /></div>

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Link href='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <img src='/media/agena-logo.svg' alt='AGENA' loading='lazy' style={{ width: 138, height: 'auto', display: 'block' }} />
          </Link>
          <p style={{ marginTop: 16, fontSize: 14, color: 'var(--ink-35)' }}>AI-powered sprint management</p>
        </div>

        <div style={{ borderRadius: 20, border: '1px solid var(--panel-border)', background: 'var(--panel)', boxShadow: '0 18px 40px rgba(2,8,23,0.14)', padding: '34px 30px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.45), transparent)' }} />

          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 6 }}>{t('signin.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-30)', marginBottom: 28 }}>{t('signin.subtitle')}</p>

          <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 14 }}>
            <AuthInput label={t('signup.email')} type='email' value={email} onChange={setEmail} placeholder='you@company.com' />
            <AuthInput label={t('signup.password')} type='password' value={password} onChange={setPassword} placeholder='••••••••' />

            {error ? (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#dc2626', fontSize: 13 }}>{error}</div>
            ) : null}

            <button type='submit' disabled={loading} style={{ marginTop: 4, padding: '13px', borderRadius: 12, border: 'none', background: loading ? 'rgba(13,148,136,0.4)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer', transition: 'opacity 0.2s', letterSpacing: 0.3 }}>
              {loading ? t('signin.loading') : t('signin.submit')}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'var(--ink-30)' }}>
            {t('signin.noAccount')}{' '}
            <Link href={`/signup${searchParams.get('next') ? `?next=${encodeURIComponent(searchParams.get('next') || '')}` : ''}`} style={{ color: 'var(--ink-78)', fontWeight: 700, textDecoration: 'none' }}>{t('signin.startFree')}</Link>
          </p>
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
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 14, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(13,148,136,0.5)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border-3)'; }}
      />
    </div>
  );
}
