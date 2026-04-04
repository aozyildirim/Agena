'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n';

export default function SdkPage() {
  const { t } = useLocale();

  const features = [
    { icon: '🚀', key: 'sdk.feat1' },
    { icon: '🧠', key: 'sdk.feat2' },
    { icon: '📡', key: 'sdk.feat3' },
    { icon: '🔌', key: 'sdk.feat4' },
    { icon: '🔷', key: 'sdk.feat5' },
  ];

  return (
    <div className='container' style={{ maxWidth: 800, padding: '80px 24px 60px' }}>
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <div className='section-label' style={{ justifyContent: 'center' }}>{t('sdk.label')}</div>
        <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
          {t('sdk.title')}
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7, maxWidth: 560, margin: '0 auto' }}>
          {t('sdk.subtitle')}
        </p>
      </div>

      {/* Install */}
      <div style={{ padding: 24, borderRadius: 14, background: 'var(--terminal-bg)', border: '1px solid var(--panel-border-2)', marginBottom: 32 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-35)', marginBottom: 8, fontWeight: 600 }}>{t('sdk.install')}</div>
        <pre style={{ margin: 0, fontSize: 15, color: '#5eead4', fontFamily: 'monospace' }}>npm install @agena/sdk</pre>
      </div>

      {/* Quick example */}
      <div style={{ padding: 24, borderRadius: 14, background: 'var(--terminal-bg)', border: '1px solid var(--panel-border-2)', marginBottom: 40, overflow: 'auto' }}>
        <pre style={{ margin: 0, fontSize: 13, color: 'var(--ink-65)', fontFamily: 'monospace', lineHeight: 1.7 }}>{`import { AgenaClient } from '@agena/sdk';

const agena = new AgenaClient({
  apiKey: 'your-token',
});

// Create a task → AI generates code → PR opens
const task = await agena.tasks.create({
  title: 'Add user avatar upload',
  description: 'Allow users to upload profile images',
});

console.log(task.pr_url);
// → https://github.com/you/repo/pull/42`}</pre>
      </div>

      {/* Features */}
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 20 }}>{t('sdk.features')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {features.map((f) => (
            <div key={f.key} style={{ padding: '14px 18px', borderRadius: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>{f.icon}</span>
              <span style={{ color: 'var(--ink-78)', fontSize: 14 }}>{t(f.key as any)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
        <Link href='/docs#sdk-install' className='button button-primary' style={{ padding: '12px 28px', fontSize: 15 }}>
          {t('sdk.docsLink')} →
        </Link>
        <a href='https://github.com/aozyildirim/Agena/tree/main/packages/sdk' target='_blank' rel='noopener noreferrer' className='button button-outline' style={{ padding: '12px 28px', fontSize: 15 }}>
          GitHub →
        </a>
        <Link href='/api-docs' className='button button-outline' style={{ padding: '12px 28px', fontSize: 15 }}>
          API Docs →
        </Link>
      </div>

      <p style={{ color: 'var(--ink-35)', fontSize: 13, textAlign: 'center' }}>
        {t('sdk.openSource')}
      </p>
    </div>
  );
}
