'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/i18n';

export default function UseCasesPage() {
  const { t } = useLocale();

  const useCases = [
    { icon: '⚡', key: 'uc1', keyword: 'ai-code-generation' },
    { icon: '🔄', key: 'uc2', keyword: 'pr-automation' },
    { icon: '🏃', key: 'uc3', keyword: 'sprint-acceleration' },
    { icon: '🔍', key: 'uc4', keyword: 'automated-code-review' },
    { icon: '🧠', key: 'uc5', keyword: 'vector-memory-ai' },
    { icon: '💬', key: 'uc6', keyword: 'chatops-ai' },
    { icon: '🔀', key: 'uc7', keyword: 'multi-repo-orchestration' },
  ];

  return (
    <div className='container page-container-narrow' style={{ maxWidth: 960, padding: '80px 24px' }}>
      <div style={{ marginBottom: 56, textAlign: 'center' }}>
        <div className='section-label' style={{ justifyContent: 'center' }}>{t('useCases.label')}</div>
        <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
          {t('useCases.title')}
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
          {t('useCases.subtitle')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {useCases.map((uc) => (
          <section
            key={uc.keyword}
            id={uc.keyword}
            style={{
              padding: 'clamp(24px, 4vw, 36px) clamp(20px, 4vw, 40px)',
              borderRadius: 20,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--panel)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              <span style={{ fontSize: 28 }}>{uc.icon}</span>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>{t(`useCases.${uc.key}.title`)}</h2>
                <p style={{ color: 'var(--ink-35)', fontSize: 13, margin: '2px 0 0' }}>{t(`useCases.${uc.key}.subtitle`)}</p>
              </div>
            </div>
            <p style={{ color: 'var(--ink-58)', fontSize: 15, lineHeight: 1.75, margin: '16px 0 20px' }}>
              {t(`useCases.${uc.key}.desc`)}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {[1, 2, 3, 4].map((b) => (
                <div
                  key={b}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
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
                  {t(`useCases.${uc.key}.b${b}`)}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* CTA */}
      <div style={{ marginTop: 64, textAlign: 'center', padding: '48px 32px', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
        <h2 style={{ color: 'var(--ink-90)', fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
          {t('useCases.ctaTitle')}
        </h2>
        <p style={{ color: 'var(--ink-45)', marginBottom: 24, fontSize: 16 }}>
          {t('useCases.ctaDesc')}
        </p>
        <Link href='/signup' className='button button-primary' style={{ fontSize: 16, padding: '14px 36px' }}>
          {t('useCases.ctaButton')} →
        </Link>
      </div>
    </div>
  );
}
