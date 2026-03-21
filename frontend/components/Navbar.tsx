'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { isLoggedIn } from '@/lib/api';

export default function Navbar() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  return (
    <header className='navbar-shell'>
      <div className='container navbar-inner'>
        <Link href='/' style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.95)', textDecoration: 'none' }}>
          <span className='brand-mark' />
          Tiqr
        </Link>
        <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className='chip' style={{ marginRight: 8 }}>AI Orchestration</span>
          <Link href='/pricing' style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, padding: '6px 12px', borderRadius: 8, textDecoration: 'none' }}>
            Pricing
          </Link>
          {loggedIn ? (
            <Link href='/dashboard' className='button button-primary' style={{ padding: '8px 16px', fontSize: 13 }}>
              Dashboard →
            </Link>
          ) : (
            <>
              <Link href='/signin' style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, padding: '6px 12px', borderRadius: 8, textDecoration: 'none' }}>
                Sign In
              </Link>
              <Link href='/signup' className='button button-primary' style={{ padding: '8px 16px', fontSize: 13 }}>
                Start Free →
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
