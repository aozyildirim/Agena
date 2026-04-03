import PricingCard from '@/components/PricingCard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing – AGENA Agentic AI Platform',
  description:
    'AGENA fiyatlandırma planları. Ücretsiz başlayın, AI agent destekli otonom kod üretimi ve PR oluşturma ile geliştirme sürecinizi hızlandırın.',
  alternates: { canonical: '/pricing' },
  openGraph: {
    title: 'Pricing – AGENA Agentic AI Platform',
    description: 'Start free with AGENA. AI-powered autonomous code generation and pull request automation for development teams.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'AGENA Pricing' }],
  },
};

export default function PricingPage() {
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
      { '@type': 'ListItem', position: 2, name: 'Pricing', item: 'https://agena.dev/pricing' },
    ],
  };

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'AGENA – Agentic AI Platform',
    description: 'Autonomous AI agents that write code, review PRs, and ship features for development teams.',
    brand: { '@type': 'Organization', name: 'AGENA' },
    url: 'https://agena.dev/pricing',
    image: 'https://agena.dev/og-image.png',
    offers: [
      {
        '@type': 'Offer',
        name: 'Free',
        price: '0',
        priceCurrency: 'USD',
        description: '5 tasks/month, token usage tracking, community support',
        availability: 'https://schema.org/InStock',
        url: 'https://agena.dev/signup',
      },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: '49',
        priceCurrency: 'USD',
        description: 'Unlimited tasks, priority worker throughput, team invites, Stripe + Iyzico billing',
        availability: 'https://schema.org/InStock',
        url: 'https://agena.dev/signup',
        priceValidUntil: '2027-12-31',
      },
    ],
  };

  return (
    <>
    <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
    <div className='grid'>
      <section className='card'>
        <h1 style={{ marginTop: 0 }}>Pricing</h1>
        <p style={{ color: '#475467' }}>Clear limits. No surprises.</p>
      </section>
      <section className='grid' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <PricingCard name='Free' price='$0' items={['5 tasks/month', 'Token usage tracking', 'Community support']} />
        <PricingCard
          name='Pro'
          price='$49/mo'
          items={['Unlimited tasks', 'Priority worker throughput', 'Team invites', 'Stripe + Iyzico billing']}
          highlight
        />
      </section>
    </div>
    </>
  );
}
