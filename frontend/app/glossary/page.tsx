'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { useLocale, type TranslationKey } from '@/lib/i18n';

const TERM_KEYS = Array.from({ length: 20 }, (_, i) => `term${i + 1}`);

export default function GlossaryPage() {
  const { t } = useLocale();
  const [search, setSearch] = useState('');
  const [sortAlpha, setSortAlpha] = useState(false);

  const terms = useMemo(() => {
    let list = TERM_KEYS.map((key) => ({
      key,
      word: t(`glossary.${key}.word` as TranslationKey),
      short: t(`glossary.${key}.short` as TranslationKey),
      full: t(`glossary.${key}.full` as TranslationKey),
    }));

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (tm) =>
          tm.word.toLowerCase().includes(q) ||
          tm.short.toLowerCase().includes(q) ||
          tm.full.toLowerCase().includes(q)
      );
    }

    if (sortAlpha) {
      list = [...list].sort((a, b) => a.word.localeCompare(b.word));
    }

    return list;
  }, [search, sortAlpha, t]);

  const jsonLdTerms = TERM_KEYS.map((key) => ({
    '@type': 'DefinedTerm',
    name: t(`glossary.${key}.word` as TranslationKey),
    description: t(`glossary.${key}.short` as TranslationKey),
  }));

  const jsonLdDefinedTermSet = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: t('glossary.title'),
    description: t('glossary.subtitle'),
    hasDefinedTerm: jsonLdTerms,
  };

  const jsonLdBreadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
      { '@type': 'ListItem', position: 2, name: t('glossary.label'), item: 'https://agena.dev/glossary' },
    ],
  };

  return (
    <>
      <Head>
        <title>{t('glossary.title')} | AGENA</title>
        <meta name="description" content={t('glossary.subtitle')} />
      </Head>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdDefinedTermSet) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBreadcrumb) }}
      />

      <div className="container page-container-narrow" style={{ maxWidth: 960, padding: '80px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <div className="section-label" style={{ justifyContent: 'center' }}>
            {t('glossary.label')}
          </div>
          <h1
            style={{
              fontSize: 'clamp(32px, 4vw, 48px)',
              fontWeight: 800,
              color: 'var(--ink-90)',
              margin: '8px 0 16px',
            }}
          >
            {t('glossary.title')}
          </h1>
          <p
            style={{
              color: 'var(--ink-45)',
              fontSize: 16,
              lineHeight: 1.7,
              maxWidth: 640,
              margin: '0 auto',
            }}
          >
            {t('glossary.subtitle')}
          </p>
        </div>

        {/* Search & Sort */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginBottom: 32,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('glossary.searchPlaceholder')}
            style={{
              flex: '1 1 280px',
              maxWidth: 480,
              padding: '12px 18px',
              borderRadius: 12,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
              color: 'var(--ink-80)',
              fontSize: 15,
              outline: 'none',
            }}
          />
          <button
            onClick={() => setSortAlpha((v) => !v)}
            style={{
              padding: '12px 20px',
              borderRadius: 12,
              border: '1px solid var(--panel-border-2)',
              background: sortAlpha ? 'var(--accent)' : 'var(--panel)',
              color: sortAlpha ? '#fff' : 'var(--ink-65)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all .2s',
            }}
          >
            A-Z
          </button>
        </div>

        {/* Term Grid */}
        {terms.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--ink-35)', fontSize: 15, padding: 48 }}>
            {t('glossary.noResults')}
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))',
              gap: 20,
            }}
          >
            {terms.map((tm) => (
              <GlossaryCard key={tm.key} word={tm.word} short={tm.short} full={tm.full} />
            ))}
          </div>
        )}

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
            {t('glossary.ctaTitle')}
          </h2>
          <p style={{ color: 'var(--ink-45)', marginBottom: 24, fontSize: 16 }}>
            {t('glossary.ctaDesc')}
          </p>
          <Link
            href="/signup"
            className="button button-primary"
            style={{ fontSize: 16, padding: '14px 36px' }}
          >
            {t('glossary.ctaButton')} &rarr;
          </Link>
        </div>
      </div>
    </>
  );
}

function GlossaryCard({ word, short, full }: { word: string; short: string; full: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        padding: 'clamp(20px, 3vw, 28px)',
        borderRadius: 16,
        border: '1px solid var(--panel-border-2)',
        background: 'var(--panel)',
        cursor: 'pointer',
        transition: 'border-color .2s, box-shadow .2s',
      }}
      onClick={() => setExpanded((v) => !v)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--panel-border-2)';
      }}
    >
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: 'var(--ink-90)',
          margin: '0 0 6px',
        }}
      >
        {word}
      </h3>
      <p style={{ color: 'var(--ink-58)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{short}</p>
      {expanded && (
        <p
          style={{
            color: 'var(--ink-45)',
            fontSize: 13,
            lineHeight: 1.75,
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--panel-border)',
          }}
        >
          {full}
        </p>
      )}
      <span
        style={{
          display: 'inline-block',
          marginTop: 10,
          fontSize: 12,
          color: 'var(--accent)',
          fontWeight: 600,
        }}
      >
        {expanded ? '- Less' : '+ More'}
      </span>
    </div>
  );
}
