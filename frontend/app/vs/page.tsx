'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n';

const SITE_URL = 'https://agena.dev';

const competitors = [
  { slug: 'cursor', icon: '🖱️' },
  { slug: 'copilot', icon: '🤖' },
  { slug: 'devin', icon: '🧑‍💻' },
  { slug: 'codex', icon: '⌨️' },
];

export default function VsIndexPage() {
  const { t } = useLocale();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('vs.title'),
    description: t('vs.subtitle'),
    url: `${SITE_URL}/vs`,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('vs.breadcrumb.home'), item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: t('vs.breadcrumb.compare'), item: `${SITE_URL}/vs` },
      ],
    },
  };

  return (
    <div className='container page-container-narrow' style={{ maxWidth: 960, padding: '80px 24px' }}>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div className='section-label' style={{ justifyContent: 'center' }}>{t('vs.breadcrumb.compare')}</div>
        <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
          {t('vs.title')}
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
          {t('vs.indexHero')}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        {competitors.map((c) => (
          <Link
            key={c.slug}
            href={`/vs/${c.slug}`}
            style={{
              display: 'block',
              padding: 'clamp(24px, 4vw, 36px)',
              borderRadius: 20,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
              textDecoration: 'none',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 4px 24px rgba(13,148,136,0.10)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--panel-border-2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: 36, display: 'block', marginBottom: 12 }}>{c.icon}</span>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', margin: '0 0 8px' }}>
              {t(`vs.${c.slug}.title`)}
            </h2>
            <p style={{ color: 'var(--ink-45)', fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
              {t(`vs.${c.slug}.subtitle`)}
            </p>
            <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>
              {t('vs.viewComparison')} →
            </span>
          </Link>
        ))}
      </div>

      {/* CTA */}
      <div style={{ marginTop: 64, textAlign: 'center', padding: '48px 32px', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
        <h2 style={{ color: 'var(--ink-90)', fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
          {t('vs.ctaTitle')}
        </h2>
        <p style={{ color: 'var(--ink-45)', marginBottom: 24, fontSize: 16 }}>
          {t('vs.ctaSubtitle')}
        </p>
        <Link href='/signup' className='button button-primary' style={{ fontSize: 16, padding: '14px 36px' }}>
          {t('vs.ctaButton')} →
        </Link>
      </div>
    </div>
  );
}
