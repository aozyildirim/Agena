import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className='card' style={{ padding: 28 }}>
      <p style={{ color: '#115e59', fontWeight: 700, margin: 0 }}>AI Delivery Copilot for Engineering Teams</p>
      <h1 style={{ fontSize: 42, margin: '12px 0 8px', lineHeight: 1.1 }}>
        From backlog ticket to reviewed GitHub PR automatically
      </h1>
      <p style={{ color: '#475467', maxWidth: 750 }}>
        AGENA orchestrates Product Manager, Developer, and Reviewer AI agents with tenant-safe pipelines, usage
        controls, and payment-ready SaaS billing.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Link href='/signup' className='button button-primary'>
          Start Free
        </Link>
        <Link href='/tasks' className='button button-outline'>
          Open Demo Dashboard
        </Link>
      </div>
    </section>
  );
}
