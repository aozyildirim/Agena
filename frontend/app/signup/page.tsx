'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, isLoggedIn, setToken, setOrgSlug, setOrgName } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import LangToggle from '@/components/LangToggle';

type AuthResponse = { access_token: string; org_slug: string; org_name: string };
type CheckSlugResponse = { available: boolean; slug: string };

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63) || '';
}

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgNameVal] = useState('');
  const [orgSlug, setOrgSlugVal] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoggedIn()) router.replace('/dashboard');
  }, [router]);

  const checkSlug = useCallback(async (slug: string) => {
    if (!slug || slug.length < 2) { setSlugStatus('idle'); return; }
    setSlugStatus('checking');
    try {
      const res = await apiFetch<CheckSlugResponse>(`/org/check-slug?slug=${encodeURIComponent(slug)}`, undefined, false);
      setSlugStatus(res.available ? 'available' : 'taken');
    } catch {
      setSlugStatus('idle');
    }
  }, []);

  function handleOrgNameChange(val: string) {
    setOrgNameVal(val);
    if (!slugEdited) {
      const auto = toSlug(val);
      setOrgSlugVal(auto);
      // Debounce slug check
      if (slugTimer.current) clearTimeout(slugTimer.current);
      slugTimer.current = setTimeout(() => void checkSlug(auto), 400);
    }
  }

  function handleSlugChange(val: string) {
    const clean = val.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
    setOrgSlugVal(clean);
    setSlugEdited(true);
    if (slugTimer.current) clearTimeout(slugTimer.current);
    slugTimer.current = setTimeout(() => void checkSlug(clean), 400);
  }

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
      const res = await apiFetch<AuthResponse>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, full_name: fullName, organization_name: orgName, org_slug: orgSlug, password }),
      }, false);
      setToken(res.access_token);
      setOrgSlug(res.org_slug);
      setOrgName(res.org_name);
      router.push(resolveNextUrl());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('signup.error'));
    } finally {
      setLoading(false);
    }
  }

  const slugColor = slugStatus === 'available' ? '#22c55e' : slugStatus === 'taken' ? '#f87171' : 'var(--ink-30)';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'radial-gradient(circle at 82% 18%, rgba(139,92,246,0.10), transparent 34%), radial-gradient(circle at 16% 86%, rgba(13,148,136,0.10), transparent 36%)' }} />
      <div style={{ position: 'fixed', top: 16, right: 16 }}><LangToggle /></div>

      <div style={{ width: '100%', maxWidth: 440, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <Link href='/' style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <img src='/media/tiqr-logo.svg' alt='Tiqr' loading='lazy' style={{ width: 138, height: 'auto', display: 'block' }} />
          </Link>
          <p style={{ marginTop: 16, fontSize: 14, color: 'var(--ink-35)' }}>{t('signup.tagline')}</p>
        </div>

        <div style={{ borderRadius: 20, border: '1px solid var(--panel-border)', background: 'var(--panel)', boxShadow: '0 18px 40px rgba(2,8,23,0.14)', padding: '34px 30px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.45), transparent)' }} />

          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 6 }}>{t('signup.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-30)', marginBottom: 28 }}>{t('signup.subtitle')}</p>

          <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 14 }}>
            <AuthInput label={t('signup.fullName')} type='text' value={fullName} onChange={setFullName} placeholder={t('signup.fullNamePlaceholder')} />
            <AuthInput label={t('signup.email')} type='email' value={email} onChange={setEmail} placeholder={t('signup.emailPlaceholder')} />

            {/* Organization Name */}
            <AuthInput label={t('signup.orgName')} type='text' value={orgName} onChange={handleOrgNameChange} placeholder={t('signup.orgPlaceholder')} />

            {/* Organization Slug */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 6 }}>{t('signup.orgSlug')}</label>
              <input
                type='text' value={orgSlug} onChange={(e) => handleSlugChange(e.target.value)}
                placeholder='acme' required
                style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border-3)'; }}
              />
              {/* Slug preview */}
              <div style={{ marginTop: 6, fontSize: 12, color: slugColor, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--ink-30)' }}>{t('signup.slugPreview')}:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{orgSlug || '...'}.tiqr.app</span>
                {slugStatus === 'checking' && <span style={{ color: 'var(--ink-30)' }}>...</span>}
                {slugStatus === 'available' && <span>{t('signup.slugAvailable')}</span>}
                {slugStatus === 'taken' && <span>{t('signup.slugTaken')}</span>}
              </div>
            </div>

            <AuthInput label={t('signup.password')} type='password' value={password} onChange={setPassword} placeholder={t('signup.passwordPlaceholder')} />

            {error ? (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', color: '#dc2626', fontSize: 13 }}>{error}</div>
            ) : null}

            <button type='submit' disabled={loading || slugStatus === 'taken'} style={{ marginTop: 4, padding: '13px', borderRadius: 12, border: 'none', background: loading ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: loading || slugStatus === 'taken' ? 'not-allowed' : 'pointer', letterSpacing: 0.3 }}>
              {loading ? t('signup.loading') : t('signup.submit')}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: 'var(--ink-30)' }}>
            {t('signup.hasAccount')}{' '}
            <Link href={`/signin${searchParams.get('next') ? `?next=${encodeURIComponent(searchParams.get('next') || '')}` : ''}`} style={{ color: 'var(--ink-78)', fontWeight: 700, textDecoration: 'none' }}>{t('signup.signin')}</Link>
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
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.5)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border-3)'; }}
      />
    </div>
  );
}
