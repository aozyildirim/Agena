import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { landingCopy, pickLang, LANGS } from '@/lib/landingI18n';

const KEY = 'insights' as const;
const URL = 'https://agena.dev/cross-source-insights';

const INSIGHTS_KEYWORDS = [
  'cross-source incident correlation', 'AI deploy root cause',
  'which deploy caused this bug', 'Sentry deploy correlation',
  'PR merge correlation Sentry', 'unified observability AI',
  'incident timeline AI', 'production incident AI', 'monitoring correlation engine',
];

export async function generateMetadata({ searchParams }: { searchParams: { lang?: string } }): Promise<Metadata> {
  const cookieLang = cookies().get('agena_lang')?.value;
  const lang = pickLang(searchParams?.lang, cookieLang);
  const c = landingCopy(KEY, lang);
  const altLang: Record<string, string> = {};
  for (const l of LANGS) altLang[l] = `${URL}?lang=${l}`;
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    keywords: INSIGHTS_KEYWORDS,
    alternates: { canonical: URL, languages: altLang },
    openGraph: { type: 'article', url: URL, title: c.ogTitle, description: c.ogDescription }
  };
}

export default function CrossSourceInsightsPage({ searchParams }: { searchParams: { lang?: string } }) {
  const cookieLang = cookies().get('agena_lang')?.value;
  const lang = pickLang(searchParams?.lang, cookieLang);
  const c = landingCopy(KEY, lang);
  const ldJson = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: 'AGENA — Cross-Source Insights', applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web', description: c.metaDescription,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' }
  };
  const faqJson = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  };
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px', display: 'grid', gap: 48 }}>
      <Script id='ld-app' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }} />
      <Script id='ld-faq' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }} />
      <header style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>{c.eyebrow}</div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          {c.h1A} <br />
          <span style={{ background: 'linear-gradient(90deg, #6366f1, #06b6d4)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{c.h1B}</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>{c.subtitle}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #06b6d4)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>{c.ctaPrimary}</Link>
          <Link href='/dashboard/insights' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>{c.ctaSecondary}</Link>
        </div>
      </header>
      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.sampleTitle}</h2>
        <pre style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--ink-78)', background: 'var(--panel)', border: '1px solid var(--panel-border)', borderLeft: '4px solid #ef4444', padding: 18, borderRadius: 12, overflowX: 'auto', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{c.sample}</pre>
      </section>
      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.flowTitle}</h2>
        <ol style={{ display: 'grid', gap: 12, paddingLeft: 0, listStyle: 'none' }}>
          {c.flowSteps.map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 16, padding: '14px 18px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)' }}>{step.title}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 4, lineHeight: 1.55 }}>{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.featuresTitle}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {c.features.map((f) => (
            <div key={f.title} style={{ padding: 16, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 6, lineHeight: 1.55 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>{c.faqTitle}</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {c.faq.map((f) => (
            <details key={f.q} style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.q}</summary>
              <p style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 8, lineHeight: 1.6 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>
      <RelatedLandings current='/cross-source-insights' />
      
      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>{c.footerH2}</h2>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #06b6d4)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>{c.footerCta}</Link>
      </footer>
    </main>
  );
}
