'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isLoggedIn } from '@/lib/api';
import LangToggle from '@/components/LangToggle';
import ThemeToggle from '@/components/ThemeToggle';
import { useLocale } from '@/lib/i18n';

export default function Navbar() {
  const { t } = useLocale();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  return (
    <header className='navbar-shell'>
      <div className='container navbar-inner'>
        <Link href='/' style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink)', textDecoration: 'none' }}>
          <img src='/media/tiqr-logo.svg' alt='Tiqr' className='navbar-wordmark' />
        </Link>
        <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <LangToggle style={{ marginRight: 4 }} />
          <ThemeToggle style={{ marginRight: 4 }} />
          <span className='chip' style={{ marginRight: 8 }}>{t('nav.aiOrchestration')}</span>
          {loggedIn ? (
            <Link href='/dashboard' className='button button-primary' style={{ padding: '8px 16px', fontSize: 13 }}>
              {t('nav.dashboard')} →
            </Link>
          ) : (
            <>
              <Link href='/signin' style={{ color: 'var(--muted)', fontSize: 14, padding: '6px 12px', borderRadius: 8, textDecoration: 'none' }}>
                {t('nav.signIn')}
              </Link>
              <Link href='/signup' className='button button-primary' style={{ padding: '8px 16px', fontSize: 13 }}>
                {t('nav.startFree')} →
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
