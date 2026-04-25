'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isLoggedIn } from '@/lib/api';
import LangToggle from '@/components/LangToggle';
import ThemeToggle from '@/components/ThemeToggle';
import { useLocale } from '@/lib/i18n';

export default function Navbar() {
  const { t } = useLocale();
  const pathname = usePathname();
  const [loggedIn, setLoggedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The marketing nav (Use Cases / Integrations / Docs / Blog / …) is
  // irrelevant inside the dashboard and was stacking on top of the
  // dashboard's own topbar. /dashboard owns its own header now.
  if (pathname?.startsWith('/dashboard')) return null;

  return (
    <header className='navbar-shell'>
      <div className='container navbar-inner'>
        <Link href='/' title={t('tooltip.nav.home')} style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink)', textDecoration: 'none', flexShrink: 0 }}>
          <img src='/media/agena-logo.svg' alt='AGENA' className='navbar-wordmark logo-dark' />
          <img src='/media/agena-logo-light.svg' alt='AGENA' className='navbar-wordmark logo-light' style={{ display: 'none' }} />
        </Link>

        {/* Desktop nav */}
        <nav className='navbar-desktop' style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
          {/* Page links */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginRight: 12 }}>
            <Link href='/use-cases' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>{t('nav.useCases')}</Link>
            <Link href='/integrations' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>{t('nav.integrations')}</Link>
            <Link href='/docs' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>{t('nav.docs')}</Link>
            <Link href='/blog' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>{t('nav.blog')}</Link>
            <Link href='/changelog' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>{t('nav.changelog')}</Link>
            <Link href='/contact' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>{t('nav.contact')}</Link>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--panel-border)', marginRight: 12 }} />

          {/* Utils */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <LangToggle />
            <ThemeToggle />
            <a
              href='https://github.com/aozyildirim/Agena'
              target='_blank'
              rel='noopener noreferrer'
              title={t('tooltip.nav.githubRepo')}
              style={{ color: 'var(--muted)', padding: '6px 8px', borderRadius: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                <path d='M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.38 6.84 9.73.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.31.1-2.74 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.52.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.43.2 2.48.1 2.74.64.71 1.03 1.62 1.03 2.74 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .28.18.6.69.5A10.24 10.24 0 0 0 22 12.25C22 6.59 17.52 2 12 2z' />
              </svg>
            </a>
            <a
              href='https://www.producthunt.com/products/agena'
              target='_blank'
              rel='noopener noreferrer'
              title='Product Hunt'
              style={{ color: 'var(--muted)', padding: '6px 8px', borderRadius: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              <svg width='16' height='16' viewBox='0 0 40 40' fill='none' aria-hidden='true'>
                <circle cx='20' cy='20' r='20' fill='currentColor' fillOpacity='0.15'/>
                <path d='M22.667 18.667h-4v-5.334h4a2.667 2.667 0 0 1 0 5.334ZM15.333 10v20h3.334v-8h4a6 6 0 0 0 0-12h-7.334Z' fill='currentColor'/>
              </svg>
            </a>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--panel-border)', margin: '0 12px' }} />

          {/* Auth */}
          {loggedIn ? (
            <Link href='/dashboard' title={t('tooltip.nav.dashboard')} className='button button-primary' style={{ padding: '8px 18px', fontSize: 13 }}>
              {t('nav.dashboard')} →
            </Link>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Link href='/signin' title={t('tooltip.nav.signIn')} style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 12px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>
                {t('nav.signIn')}
              </Link>
              <Link href='/signup' title={t('tooltip.nav.startFree')} className='button button-primary' style={{ padding: '8px 18px', fontSize: 13 }}>
                {t('nav.startFree')} →
              </Link>
            </div>
          )}
        </nav>

        {/* Mobile controls */}
        <div className='navbar-mobile-controls'>
          <LangToggle />
          <ThemeToggle />
          <button
            className='navbar-hamburger'
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label='Toggle menu'
          >
            <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
              {menuOpen ? (
                <><line x1='18' y1='6' x2='6' y2='18' /><line x1='6' y1='6' x2='18' y2='18' /></>
              ) : (
                <><line x1='3' y1='6' x2='21' y2='6' /><line x1='3' y1='12' x2='21' y2='12' /><line x1='3' y1='18' x2='21' y2='18' /></>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div className='navbar-mobile-menu'>
          <Link href='/use-cases' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>{t('nav.useCases')}</Link>
          <Link href='/integrations' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>{t('nav.integrations')}</Link>
          <Link href='/docs' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>{t('nav.docs')}</Link>
          <Link href='/blog' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>{t('nav.blog')}</Link>
          <Link href='/changelog' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>{t('nav.changelog')}</Link>
          <Link href='/contact' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>{t('nav.contact')}</Link>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '6px 16px' }}>
            <a
              href='https://github.com/aozyildirim/Agena'
              target='_blank'
              rel='noopener noreferrer'
              title={t('tooltip.nav.githubRepo')}
              style={{ color: 'var(--muted)', padding: '8px', borderRadius: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--panel-border-2)' }}
            >
              <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                <path d='M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.38 6.84 9.73.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.31.1-2.74 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.52.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.43.2 2.48.1 2.74.64.71 1.03 1.62 1.03 2.74 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .28.18.6.69.5A10.24 10.24 0 0 0 22 12.25C22 6.59 17.52 2 12 2z' />
              </svg>
            </a>
            <a
              href='https://www.producthunt.com/products/agena'
              target='_blank'
              rel='noopener noreferrer'
              title='Product Hunt'
              style={{ color: 'var(--muted)', padding: '8px', borderRadius: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--panel-border-2)' }}
            >
              <svg width='18' height='18' viewBox='0 0 40 40' fill='none' aria-hidden='true'>
                <circle cx='20' cy='20' r='20' fill='currentColor' fillOpacity='0.15'/>
                <path d='M22.667 18.667h-4v-5.334h4a2.667 2.667 0 0 1 0 5.334ZM15.333 10v20h3.334v-8h4a6 6 0 0 0 0-12h-7.334Z' fill='currentColor'/>
              </svg>
            </a>
          </div>
          <div style={{ height: 1, background: 'var(--panel-border-2)', margin: '4px 0' }} />
          {loggedIn ? (
            <Link href='/dashboard' className='button button-primary' style={{ padding: '10px 16px', fontSize: 13, textAlign: 'center' }}>
              {t('nav.dashboard')} →
            </Link>
          ) : (
            <>
              <Link href='/signin' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>
                {t('nav.signIn')}
              </Link>
              <Link href='/signup' className='button button-primary' style={{ padding: '10px 16px', fontSize: 13, textAlign: 'center' }}>
                {t('nav.startFree')} →
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
