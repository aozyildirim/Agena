import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '404 – Page Not Found | AGENA',
  description: 'The page you are looking for does not exist. Explore AGENA — the agentic AI platform for autonomous code generation.',
};

export default function NotFound() {
  return (
    <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 72, fontWeight: 800, marginBottom: 8 }}>
        <span className='gradient-text'>404</span>
      </h1>
      <h2 style={{ color: 'var(--ink-90)', fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        Page Not Found
      </h2>
      <p style={{ color: 'var(--ink-45)', fontSize: 16, marginBottom: 36, maxWidth: 400 }}>
        The page you are looking for doesn&apos;t exist or has been moved.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href='/' className='button button-primary' style={{ padding: '12px 28px', fontSize: 15 }}>
          Go Home
        </Link>
        <Link href='/blog' className='button button-outline' style={{ padding: '12px 28px', fontSize: 15 }}>
          Read Blog
        </Link>
        <Link href='/use-cases' className='button button-outline' style={{ padding: '12px 28px', fontSize: 15 }}>
          Use Cases
        </Link>
        <Link href='/pricing' className='button button-outline' style={{ padding: '12px 28px', fontSize: 15 }}>
          Pricing
        </Link>
      </div>
    </div>
  );
}
