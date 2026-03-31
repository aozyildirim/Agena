import PricingCard from '@/components/PricingCard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pricing – AGENA Agentic AI Platform',
  description:
    'AGENA fiyatlandırma planları. Ücretsiz başlayın, AI agent destekli otonom kod üretimi ve PR oluşturma ile geliştirme sürecinizi hızlandırın.',
  openGraph: {
    title: 'Pricing – AGENA Agentic AI Platform',
    description: 'Start free with AGENA. AI-powered autonomous code generation and pull request automation for development teams.',
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

  return (
    <>
    <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
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
