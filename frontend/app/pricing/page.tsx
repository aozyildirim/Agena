import PricingCard from '@/components/PricingCard';

export default function PricingPage() {
  return (
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
  );
}
