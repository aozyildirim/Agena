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

  return (
    <header className='navbar-shell'>
      <div className='container navbar-inner'>
        <Link href='/' title={t('tooltip.nav.home')} style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink)', textDecoration: 'none', flexShrink: 0 }}>
          <img src='/media/agena-logo.svg' alt='AGENA' className='navbar-wordmark' />
        </Link>

        {/* Desktop nav */}
        <nav className='navbar-desktop' style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <LangToggle style={{ marginRight: 4 }} />
          <ThemeToggle style={{ marginRight: 4 }} />
          <Link href='/blog' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>Blog</Link>
          <Link href='/docs' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>Docs</Link>
          <Link href='/use-cases' style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>Use Cases</Link>
          <span className='chip' style={{ marginRight: 8 }}>{t('nav.aiOrchestration')}</span>
          <a
            href='https://github.com/aozyildirim/Agena'
            target='_blank'
            rel='noopener noreferrer'
            title={t('tooltip.nav.githubRepo')}
            className='button button-outline'
            style={{ padding: '8px 14px', fontSize: 13, marginRight: 4, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <path d='M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.38 6.84 9.73.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.31.1-2.74 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.52.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.43.2 2.48.1 2.74.64.71 1.03 1.62 1.03 2.74 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .28.18.6.69.5A10.24 10.24 0 0 0 22 12.25C22 6.59 17.52 2 12 2z' />
            </svg>
            GitHub
          </a>
          <a
            href='https://github.com/sponsors/aozyildirim'
            target='_blank'
            rel='noreferrer'
            title={t('tooltip.action.donate')}
            className='button button-outline'
            style={{ padding: '8px 14px', fontSize: 13, marginRight: 4, textDecoration: 'none' }}
          >
            {t('nav.donate')} ♡
          </a>
          {loggedIn ? (
            <Link href='/dashboard' title={t('tooltip.nav.dashboard')} className='button button-primary' style={{ padding: '8px 16px', fontSize: 13 }}>
              {t('nav.dashboard')} →
            </Link>
          ) : (
            <>
              <Link href='/signin' title={t('tooltip.nav.signIn')} style={{ color: 'var(--muted)', fontSize: 14, padding: '6px 12px', borderRadius: 8, textDecoration: 'none' }}>
                {t('nav.signIn')}
              </Link>
              <Link href='/signup' title={t('tooltip.nav.startFree')} className='button button-primary' style={{ padding: '8px 16px', fontSize: 13 }}>
                {t('nav.startFree')} →
              </Link>
            </>
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
          <Link href='/blog' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>Blog</Link>
          <Link href='/docs' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>Docs</Link>
          <Link href='/use-cases' style={{ color: 'var(--muted)', fontSize: 14, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', textAlign: 'center' }}>Use Cases</Link>
          <span className='chip' style={{ marginBottom: 8, alignSelf: 'flex-start' }}>{t('nav.aiOrchestration')}</span>
          <a
            href='https://github.com/aozyildirim/Agena'
            target='_blank'
            rel='noopener noreferrer'
            className='button button-outline'
            style={{ padding: '10px 16px', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}
          >
            <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <path d='M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.38 6.84 9.73.5.1.68-.22.68-.5 0-.24-.01-1.04-.01-1.88-2.78.62-3.37-1.22-3.37-1.22-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.31.1-2.74 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.52.35 1.91-1.32 2.75-1.05 2.75-1.05.55 1.43.2 2.48.1 2.74.64.71 1.03 1.62 1.03 2.74 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.38-.01 2.49-.01 2.83 0 .28.18.6.69.5A10.24 10.24 0 0 0 22 12.25C22 6.59 17.52 2 12 2z' />
            </svg>
            GitHub
          </a>
          <a
            href='https://github.com/sponsors/aozyildirim'
            target='_blank'
            rel='noreferrer'
            className='button button-outline'
            style={{ padding: '10px 16px', fontSize: 13, textDecoration: 'none', textAlign: 'center' }}
          >
            {t('nav.donate')} ♡
          </a>
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
