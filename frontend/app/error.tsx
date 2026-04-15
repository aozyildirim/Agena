'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 72, fontWeight: 800, marginBottom: 8 }}>
        <span className='gradient-text'>500</span>
      </h1>
      <h2 style={{ color: 'var(--ink-90)', fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        Something went wrong
      </h2>
      <p style={{ color: 'var(--ink-45)', fontSize: 16, marginBottom: 36, maxWidth: 400 }}>
        An unexpected error occurred. Please try again.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={reset}
          className='button button-primary'
          style={{ padding: '12px 28px', fontSize: 15 }}
        >
          Try Again
        </button>
        <a href='/' className='button button-outline' style={{ padding: '12px 28px', fontSize: 15 }}>
          Go Home
        </a>
      </div>
    </div>
  );
}
