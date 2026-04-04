'use client';

import Link from 'next/link';
import ContactForm from '@/components/ContactForm';
import { useLocale } from '@/lib/i18n';

export default function ContactPage() {
  const { t } = useLocale();

  return (
    <div className='container' style={{ maxWidth: 800, padding: '80px 16px 60px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div className='section-label'>{t('contact.label')}</div>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 12px' }}>
          {t('contact.title')}
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 15, lineHeight: 1.6 }}>
          {t('contact.subtitle')}
        </p>
      </div>

      {/* Form */}
      <div style={{ padding: 'clamp(16px, 3vw, 32px)', borderRadius: 16, background: 'rgba(13,148,136,0.04)', border: '1px solid rgba(13,148,136,0.1)', marginBottom: 32 }}>
        <ContactForm />
      </div>

      {/* Info cards - horizontal on desktop, stack on mobile */}
      <div className='contact-info-row' style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 48 }}>
        <div style={{ padding: '20px', borderRadius: 14, background: 'rgba(13,148,136,0.04)', border: '1px solid rgba(13,148,136,0.1)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 10 }}>{t('contact.quickLinks')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link href='/docs' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>Docs</Link>
            <Link href='/blog' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>Blog</Link>
            <Link href='/changelog' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none' }}>Changelog</Link>
          </div>
        </div>

        <div style={{ padding: '20px', borderRadius: 14, background: 'rgba(13,148,136,0.04)', border: '1px solid rgba(13,148,136,0.1)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 10 }}>{t('contact.openSource')}</h3>
          <p style={{ color: 'var(--ink-45)', fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>{t('contact.openSourceDesc')}</p>
          <a href='https://github.com/aozyildirim/Agena' target='_blank' rel='noopener noreferrer' style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none', fontWeight: 600 }}>
            GitHub →
          </a>
        </div>

        <div style={{ padding: '20px', borderRadius: 14, background: 'rgba(13,148,136,0.04)', border: '1px solid rgba(13,148,136,0.1)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 10 }}>{t('contact.enterprise')}</h3>
          <p style={{ color: 'var(--ink-45)', fontSize: 12, lineHeight: 1.5 }}>{t('contact.enterpriseDesc')}</p>
        </div>
      </div>

      {/* FAQ */}
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 16 }}>{t('contact.faq.title')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <details key={i} style={{ padding: '14px 18px', borderRadius: 12, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', cursor: 'pointer' }}>
              <summary style={{ color: 'var(--ink-90)', fontWeight: 600, fontSize: 14, lineHeight: 1.5, listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>{t(`contact.faq${i}Q`)}</span>
                <span style={{ color: 'var(--ink-35)', fontSize: 16, flexShrink: 0 }}>+</span>
              </summary>
              <p style={{ color: 'var(--ink-50)', fontSize: 13, lineHeight: 1.7, marginTop: 10 }}>{t(`contact.faq${i}A`)}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
