'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReactNode, useEffect, useState, Suspense } from 'react';
import { isLoggedIn, removeToken, apiFetch } from '@/lib/api';
import OnboardingModal from '@/components/OnboardingModal';
import { useLocale } from '@/lib/i18n';

const NAV_KEYS = [
  { href: '/dashboard', key: 'nav.overview', icon: '⬡' },
  { href: '/dashboard/tasks', key: 'nav.tasks', icon: '◈' },
  { href: '/dashboard/sprints', key: 'nav.sprints', icon: '◎' },
  { href: '/dashboard/team', key: 'nav.team', icon: '◉' },
  { href: '/dashboard/agents', key: 'nav.agents', icon: '🤖' },
  { href: '/dashboard/flows', key: 'nav.flows', icon: '⟳' },
  { href: '/dashboard/templates', key: 'nav.templates', icon: '◧' },
  { href: '/dashboard/mappings', key: 'nav.mappings', icon: '⌘' },
  { href: '/dashboard/integrations', key: 'nav.integrations', icon: '⬡' },
  { href: '/dashboard/profile', key: 'nav.profile', icon: '◐' },
] as const;

function DashboardInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [userName, setUserName] = useState('');
  const [checked, setChecked] = useState(false);
  const shouldOpenOnboarding = searchParams.get('onboarding') === '1' || searchParams.get('welcome') === '1';

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      if (!isLoggedIn()) {
        router.replace('/signin');
        return;
      }
      if (!active) return;
      setChecked(true);

      apiFetch<{ full_name?: string; email: string }>('/auth/me').then((u) => {
        if (!active) return;
        setUserName(u.full_name || u.email);
      }).catch(() => {});

      if (!shouldOpenOnboarding) {
        setShowOnboarding(false);
        return;
      }

      try {
        const integrations = await apiFetch<Array<{ has_secret: boolean; base_url?: string | null }>>('/integrations');
        if (!active) return;
        const hasIntegration = integrations.some((cfg) => cfg.has_secret || Boolean(cfg.base_url));
        setShowOnboarding(!hasIntegration);
      } catch {
        if (!active) return;
        // If integration check fails, keep onboarding visible for first-login links.
        setShowOnboarding(true);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [router, shouldOpenOnboarding]);

  function logout() {
    removeToken();
    router.push('/');
  }

  if (!checked) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', paddingTop: 72 }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(3,7,18,0.6)', backdropFilter: 'blur(20px)',
        position: 'fixed', top: 72, bottom: 0, left: 0,
        display: 'flex', flexDirection: 'column',
        padding: '24px 12px', zIndex: 50,
      }}>
        {/* User info */}
        {userName && (
          <a href="/dashboard/profile" style={{ textDecoration: 'none', padding: '10px 12px', marginBottom: 16, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'block', transition: 'border-color 0.2s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(139,92,246,0.3)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                {userName[0]?.toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{t('nav.profileHint')}</div>
              </div>
            </div>
          </a>
        )}

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', padding: '0 12px', marginBottom: 8 }}>
          {t('nav.workspace')}
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_KEYS.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 10, fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? '#5eead4' : 'rgba(255,255,255,0.45)',
                background: active ? 'rgba(13,148,136,0.12)' : 'transparent',
                border: active ? '1px solid rgba(13,148,136,0.2)' : '1px solid transparent',
                transition: 'all 0.2s', textDecoration: 'none',
              }}>
                <span style={{ fontSize: 16, opacity: active ? 1 : 0.5 }}>{item.icon}</span>
                {t(item.key)}
                {active && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#5eead4' }} />}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Link href='/dashboard/tasks?new=1' style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 10, fontSize: 13,
            background: 'linear-gradient(135deg, rgba(13,148,136,0.2), rgba(34,197,94,0.1))',
            border: '1px solid rgba(13,148,136,0.3)',
            color: '#5eead4', fontWeight: 600, textDecoration: 'none',
          }}>
            {t('nav.newTask')}
          </Link>
          <button onClick={logout} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 10, fontSize: 13,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.3)', cursor: 'pointer', width: '100%',
          }}>
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: 220, padding: '32px 40px', minWidth: 0 }}>
        {children}
      </main>

      {/* Onboarding modal */}
      {showOnboarding && (
        <OnboardingModal
          userName={userName}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DashboardInner>{children}</DashboardInner>
    </Suspense>
  );
}
