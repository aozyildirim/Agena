'use client';

import Link from 'next/link';
import { useLocale, type TranslationKey } from '@/lib/i18n';

interface Integration {
  key: string;
  docsId?: string;
  comingSoon?: boolean;
}

interface Category {
  icon: string;
  catKey: string;
  items: Integration[];
}

export default function IntegrationsPage() {
  const { t } = useLocale();

  const categories: Category[] = [
    {
      icon: '\u{1F517}',
      catKey: 'cat1',
      items: [
        { key: 'github', docsId: 'github-integration' },
        { key: 'azure', docsId: 'azure-devops-integration' },
      ],
    },
    {
      icon: '\u{1F4CB}',
      catKey: 'cat2',
      items: [
        { key: 'jira', docsId: 'jira-integration' },
        { key: 'azureBoards', docsId: 'azure-boards-integration' },
      ],
    },
    {
      icon: '\u{1F916}',
      catKey: 'cat3',
      items: [
        { key: 'openai', docsId: 'ai-providers' },
        { key: 'gemini', docsId: 'ai-providers' },
      ],
    },
    {
      icon: '\u{1F4CA}',
      catKey: 'cat7',
      items: [
        { key: 'newrelic', docsId: 'newrelic-integration' },
      ],
    },
    {
      icon: '\u{1F4AC}',
      catKey: 'cat4',
      items: [
        { key: 'slack', docsId: 'notifications' },
        { key: 'teams', docsId: 'notifications' },
        { key: 'telegram', docsId: 'notifications' },
      ],
    },
    {
      icon: '\u{1F6E0}\uFE0F',
      catKey: 'cat5',
      items: [
        { key: 'vscode', comingSoon: true },
        { key: 'cli', docsId: 'sdk-install' },
      ],
    },
    {
      icon: '\u2601\uFE0F',
      catKey: 'cat6',
      items: [
        { key: 'qdrant', docsId: 'vector-memory' },
        { key: 'redis', docsId: 'architecture' },
      ],
    },
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AGENA Integrations',
    description: t('integrations.subtitle'),
    numberOfItems: categories.reduce((sum, c) => sum + c.items.length, 0),
    itemListElement: categories.flatMap((cat, ci) =>
      cat.items.map((item, ii) => ({
        '@type': 'ListItem',
        position: ci * 10 + ii + 1,
        item: {
          '@type': 'SoftwareApplication',
          name: t(`integrations.${item.key}.name` as TranslationKey),
          description: t(`integrations.${item.key}.desc` as TranslationKey),
          applicationCategory: t(`integrations.${cat.catKey}` as TranslationKey),
        },
      }))
    ),
  };

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
      { '@type': 'ListItem', position: 2, name: t('integrations.label'), item: 'https://agena.dev/integrations' },
    ],
  };

  return (
    <div className="container page-container-narrow" style={{ maxWidth: 1080, padding: '80px 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      {/* Hero */}
      <div style={{ marginBottom: 64, textAlign: 'center' }}>
        <div className="section-label" style={{ justifyContent: 'center' }}>
          {t('integrations.label')}
        </div>
        <h1
          style={{
            fontSize: 'clamp(32px, 4vw, 48px)',
            fontWeight: 800,
            color: 'var(--ink-90)',
            margin: '8px 0 16px',
          }}
        >
          {t('integrations.title')}
        </h1>
        <p
          style={{
            color: 'var(--ink-45)',
            fontSize: 16,
            lineHeight: 1.7,
            maxWidth: 680,
            margin: '0 auto',
          }}
        >
          {t('integrations.subtitle')}
        </p>
      </div>

      {/* Categories */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
        {categories.map((cat) => (
          <section key={cat.catKey}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 26 }}>{cat.icon}</span>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>
                {t(`integrations.${cat.catKey}` as TranslationKey)}
              </h2>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 20,
              }}
            >
              {cat.items.map((item) => (
                <div
                  key={item.key}
                  style={{
                    padding: 'clamp(20px, 3vw, 28px)',
                    borderRadius: 16,
                    border: '1px solid var(--panel-border-2)',
                    background: 'var(--panel)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>
                      {t(`integrations.${item.key}.name` as TranslationKey)}
                    </h3>
                    {item.comingSoon && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '3px 10px',
                          borderRadius: 20,
                          background: 'rgba(13,148,136,0.10)',
                          color: 'var(--accent)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t('integrations.comingSoon')}
                      </span>
                    )}
                  </div>

                  <p style={{ color: 'var(--ink-58)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                    {t(`integrations.${item.key}.desc` as TranslationKey)}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {[1, 2, 3, 4].map((f) => (
                      <div
                        key={f}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid var(--panel-border)',
                          background: 'rgba(13,148,136,0.04)',
                          color: 'var(--ink-65)',
                          fontSize: 13,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                        }}
                      >
                        <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                        {t(`integrations.${item.key}.f${f}` as TranslationKey)}
                      </div>
                    ))}
                  </div>

                  {item.docsId && (
                    <Link
                      href={`/docs?id=${item.docsId}`}
                      style={{
                        marginTop: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--accent)',
                        textDecoration: 'none',
                      }}
                    >
                      {t('integrations.setupGuide')}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* CTA */}
      <div
        style={{
          marginTop: 64,
          textAlign: 'center',
          padding: '48px 32px',
          borderRadius: 20,
          border: '1px solid var(--panel-border-2)',
          background: 'var(--panel)',
        }}
      >
        <h2 style={{ color: 'var(--ink-90)', fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
          {t('integrations.ctaTitle')}
        </h2>
        <p style={{ color: 'var(--ink-45)', marginBottom: 24, fontSize: 16 }}>
          {t('integrations.ctaDesc')}
        </p>
        <Link href="/signup" className="button button-primary" style={{ fontSize: 16, padding: '14px 36px' }}>
          {t('integrations.ctaButton')} &rarr;
        </Link>
      </div>
    </div>
  );
}
