import type { Metadata } from 'next';
import Link from 'next/link';
import ContactForm from '@/components/ContactForm';

export const metadata: Metadata = {
  title: 'Contact – AGENA Agentic AI Platform',
  description:
    'Get in touch with the AGENA team. Questions about agentic AI, pricing, integrations, or enterprise plans? We\'d love to hear from you.',
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact – AGENA',
    description: 'Get in touch with the AGENA team for questions about agentic AI and autonomous code generation.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Contact AGENA' }],
  },
};

export default function ContactPage() {
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
      { '@type': 'ListItem', position: 2, name: 'Contact', item: 'https://agena.dev/contact' },
    ],
  };

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      <div className='container page-container-narrow' style={{ maxWidth: 860, padding: '80px 24px' }}>
        <div style={{ marginBottom: 48 }}>
          <div className='section-label'>Contact</div>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
            Get in Touch
          </h1>
          <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7, maxWidth: 600 }}>
            Have a question about AGENA, need help with setup, or interested in enterprise plans? Drop us a message.
          </p>
        </div>

        <div className='contact-grid' style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 48, alignItems: 'start' }}>
          {/* Form */}
          <div
            className='contact-form-wrapper'
            style={{
              padding: '32px',
              borderRadius: 16,
              background: 'rgba(13,148,136,0.04)',
              border: '1px solid rgba(13,148,136,0.1)',
            }}
          >
            <ContactForm />
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div
              style={{
                padding: '24px',
                borderRadius: 14,
                background: 'rgba(13,148,136,0.04)',
                border: '1px solid rgba(13,148,136,0.1)',
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 12 }}>Quick Links</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Link href='/docs' style={{ color: 'var(--accent)', fontSize: 14, textDecoration: 'none' }}>
                  Documentation
                </Link>
                <Link href='/pricing' style={{ color: 'var(--accent)', fontSize: 14, textDecoration: 'none' }}>
                  Pricing Plans
                </Link>
                <Link href='/blog' style={{ color: 'var(--accent)', fontSize: 14, textDecoration: 'none' }}>
                  Blog
                </Link>
                <Link href='/use-cases' style={{ color: 'var(--accent)', fontSize: 14, textDecoration: 'none' }}>
                  Use Cases
                </Link>
              </div>
            </div>

            <div
              style={{
                padding: '24px',
                borderRadius: 14,
                background: 'rgba(13,148,136,0.04)',
                border: '1px solid rgba(13,148,136,0.1)',
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 12 }}>Open Source</h3>
              <p style={{ color: 'var(--ink-45)', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                AGENA is fully open source. Report bugs, request features, or contribute on GitHub.
              </p>
              <a
                href='https://github.com/aozyildirim/Agena'
                target='_blank'
                rel='noopener noreferrer'
                style={{ color: 'var(--accent)', fontSize: 14, textDecoration: 'none', fontWeight: 600 }}
              >
                github.com/aozyildirim/Agena
              </a>
            </div>

            <div
              style={{
                padding: '24px',
                borderRadius: 14,
                background: 'rgba(13,148,136,0.04)',
                border: '1px solid rgba(13,148,136,0.1)',
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 12 }}>Enterprise</h3>
              <p style={{ color: 'var(--ink-45)', fontSize: 13, lineHeight: 1.6 }}>
                Need custom models, SSO, or dedicated support? Reach out for enterprise pricing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
