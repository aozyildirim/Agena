import Link from 'next/link';

export default function UpgradeBanner({ tasksUsed }: { tasksUsed: number }) {
  if (tasksUsed < 4) return null;
  return (
    <div style={{
      borderRadius: 14, padding: '14px 20px',
      background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
    }}>
      <span style={{ color: '#fbbf24', fontSize: 14 }}>
        ⚠ Free plan: <strong>{tasksUsed}/5</strong> tasks used this month
      </span>
      <Link href='/pricing' className='button button-primary' style={{ padding: '7px 16px', fontSize: 13 }}>
        Upgrade to Pro →
      </Link>
    </div>
  );
}
