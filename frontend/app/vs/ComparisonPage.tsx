'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n';

const SITE_URL = 'https://agena.dev';

type FeatureKey = 'approach' | 'prCreation' | 'codeReview' | 'multiRepo' | 'dependencies' | 'sprint' | 'chatops' | 'office' | 'selfHosted' | 'pricing';

interface ComparisonRow {
  feature: FeatureKey;
  agena: string;
  competitor: string;
}

interface ComparisonPageProps {
  slug: string;
  competitorName: string;
  rows: ComparisonRow[];
}

export default function ComparisonPage({ slug, competitorName, rows }: ComparisonPageProps) {
  const { t } = useLocale();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: t(`vs.${slug}.metaTitle`),
        description: t(`vs.${slug}.metaDesc`),
        url: `${SITE_URL}/vs/${slug}`,
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: t('vs.breadcrumb.home'), item: SITE_URL },
            { '@type': 'ListItem', position: 2, name: t('vs.breadcrumb.compare'), item: `${SITE_URL}/vs` },
            { '@type': 'ListItem', position: 3, name: `vs ${competitorName}`, item: `${SITE_URL}/vs/${slug}` },
          ],
        },
      },
      {
        '@type': 'Product',
        name: 'AGENA',
        description: 'Agentic AI platform for autonomous code generation, PR automation, and sprint management.',
        url: SITE_URL,
        brand: { '@type': 'Brand', name: 'AGENA' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free tier available, Pro at $49/month' },
      },
      {
        '@type': 'Product',
        name: competitorName,
        description: t(`vs.${slug}.subtitle`),
      },
    ],
  };

  return (
    <div className='container page-container-narrow' style={{ maxWidth: 960, padding: '80px 24px' }}>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb */}
      <nav style={{ marginBottom: 32, fontSize: 13, color: 'var(--ink-35)' }}>
        <Link href='/' style={{ color: 'var(--ink-35)', textDecoration: 'none' }}>{t('vs.breadcrumb.home')}</Link>
        {' / '}
        <Link href='/vs' style={{ color: 'var(--ink-35)', textDecoration: 'none' }}>{t('vs.breadcrumb.compare')}</Link>
        {' / '}
        <span style={{ color: 'var(--ink-65)' }}>vs {competitorName}</span>
      </nav>

      {/* Hero */}
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '0 0 16px' }}>
          {t(`vs.${slug}.title`)}
        </h1>
        <p style={{ color: 'var(--accent)', fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>
          {t(`vs.${slug}.subtitle`)}
        </p>
        <p style={{ color: 'var(--ink-45)', fontSize: 15, lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
          {t(`vs.${slug}.hook`)}
        </p>
      </div>

      {/* Comparison Table */}
      <div style={{
        borderRadius: 16,
        border: '1px solid var(--panel-border-2)',
        background: 'var(--panel)',
        overflow: 'hidden',
        marginBottom: 48,
      }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 0,
          padding: '16px 20px',
          background: 'rgba(13,148,136,0.06)',
          borderBottom: '1px solid var(--panel-border-2)',
          fontWeight: 700,
          fontSize: 14,
        }}>
          <span style={{ color: 'var(--ink-45)' }}>{t('vs.feature')}</span>
          <span style={{ color: 'var(--accent)' }}>{t('vs.agena')}</span>
          <span style={{ color: 'var(--ink-65)' }}>{competitorName}</span>
        </div>

        {/* Table Rows */}
        {rows.map((row, i) => (
          <div
            key={row.feature}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 0,
              padding: '14px 20px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--panel-border)' : 'none',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <span style={{ color: 'var(--ink-65)', fontWeight: 600 }}>
              {t(`vs.feature.${row.feature}`)}
            </span>
            <span style={{ color: 'var(--ink-80)' }}>{row.agena}</span>
            <span style={{ color: 'var(--ink-45)' }}>{row.competitor}</span>
          </div>
        ))}
      </div>

      {/* Why AGENA */}
      <section style={{
        padding: 'clamp(24px, 4vw, 36px) clamp(20px, 4vw, 40px)',
        borderRadius: 20,
        border: '1px solid var(--panel-border-2)',
        background: 'var(--panel)',
        marginBottom: 48,
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', margin: '0 0 20px' }}>
          {t('vs.whyAgena')}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                border: '1px solid var(--panel-border)',
                background: 'rgba(13,148,136,0.04)',
                color: 'var(--ink-65)',
                fontSize: 14,
                lineHeight: 1.7,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
              {t(`vs.${slug}.why${n}`)}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div style={{ textAlign: 'center', padding: '48px 32px', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
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
