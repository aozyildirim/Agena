'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, isLoggedIn, setToken } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LangToggle from '@/components/LangToggle';

type AuthResponse = { access_token: string };

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) router.replace('/dashboard/tasks');
  }, [router]);

  function resolveNextUrl(): string {
    const raw = searchParams.get('next') || '';
    if (!raw.startsWith('/')) return '/dashboard?onboarding=1';
    if (raw.startsWith('//')) return '/dashboard?onboarding=1';
    return raw;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await apiFetch<AuthResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, full_name: fullName, organization_name: orgName, password }),
      }, false);
      setToken(res.access_token);
      router.push(resolveNextUrl());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signup.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#030712', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', top: '10%', right: '10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '10%', left: '10%', width: 350, height: 350, borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,148,136,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: 16, right: 16 }}><LangToggle /></div>

      <div style={{ width: '100%', maxWidth: 440, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Link href='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#fff' }}>T</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.95)' }}>Tiqr</span>
          </Link>
          <p style={{ marginTop: 16, fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>{t('signup.tagline')}</p>
        </div>

        <div style={{ borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', padding: '36px 32px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.5), transparent)' }} />

          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginBottom: 6 }}>{t('signup.title')}</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', marginBottom: 28 }}>{t('signup.subtitle')}</p>

          <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <AuthInput label={t('signup.fullName')} type='text' value={fullName} onChange={setFullName} placeholder={t('signup.fullNamePlaceholder')} />
              <AuthInput label={t('signup.org')} type='text' value={orgName} onChange={setOrgName} placeholder={t('signup.orgPlaceholder')} />
            </div>
            <AuthInput label={t('signup.email')} type='email' value={email} onChange={setEmail} placeholder={t('signup.emailPlaceholder')} />
            <AuthInput label={t('signup.password')} type='password' value={password} onChange={setPassword} placeholder={t('signup.passwordPlaceholder')} />

            {error ? (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{error}</div>
            ) : null}

            <button type='submit' disabled={loading} style={{ marginTop: 4, padding: '13px', borderRadius: 12, border: 'none', background: loading ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer', letterSpacing: 0.3 }}>
              {loading ? t('signup.loading') : t('signup.submit')}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
            {t('signup.hasAccount')}{' '}
            <Link href={`/signin${searchParams.get('next') ? `?next=${encodeURIComponent(searchParams.get('next') || '')}` : ''}`} style={{ color: '#a78bfa', fontWeight: 600, textDecoration: 'none' }}>{t('signup.signin')}</Link>
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
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.9)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      />
    </div>
  );
}
