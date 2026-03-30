'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle({ style }: { style?: React.CSSProperties }) {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('agena_theme');
    if (saved === 'light') {
      document.documentElement.classList.add('light');
      setLight(true);
    }
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.classList.add('light');
      localStorage.setItem('agena_theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      localStorage.setItem('agena_theme', 'dark');
    }
  }

  return (
    <button
      onClick={toggle}
      title={light ? 'Dark mode' : 'Light mode'}
      style={{
        padding: '5px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px solid var(--border)',
        background: 'var(--glass)',
        color: 'var(--muted)',
        fontSize: 15,
        lineHeight: 1,
        transition: 'all 0.2s',
        ...style,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(13,148,136,0.4)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--brand)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)';
      }}
    >
      {light ? '🌙' : '☀️'}
    </button>
  );
}
