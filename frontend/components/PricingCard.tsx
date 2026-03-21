type Props = {
  name: string;
  price: string;
  items: string[];
  highlight?: boolean;
};

export default function PricingCard({ name, price, items, highlight }: Props) {
  return (
    <div
      style={{
        borderRadius: 24,
        border: highlight ? '1px solid rgba(13,148,136,0.5)' : '1px solid rgba(255,255,255,0.08)',
        background: highlight
          ? 'linear-gradient(135deg, rgba(13,148,136,0.12), rgba(34,197,94,0.06))'
          : 'rgba(255,255,255,0.03)',
        padding: 32,
        position: 'relative',
        overflow: 'hidden',
        transform: highlight ? 'translateY(-4px)' : 'none',
        boxShadow: highlight ? '0 0 40px rgba(13,148,136,0.2), 0 20px 40px rgba(0,0,0,0.3)' : 'none',
        backdropFilter: 'blur(10px)',
      }}
    >
      {highlight && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.8), rgba(34,197,94,0.6), transparent)',
        }} />
      )}
      {highlight && (
        <span style={{
          position: 'absolute', top: 16, right: 16,
          background: 'linear-gradient(135deg, #0d9488, #22c55e)',
          color: '#fff', fontSize: 11, fontWeight: 700,
          padding: '4px 10px', borderRadius: 999, letterSpacing: '0.5px',
        }}>POPULAR</span>
      )}
      <h3 style={{ marginTop: 0, color: 'rgba(255,255,255,0.9)', fontSize: 20, fontWeight: 700 }}>{name}</h3>
      <p style={{ fontSize: 40, fontWeight: 800, margin: '8px 0 20px', color: highlight ? '#5eead4' : 'rgba(255,255,255,0.9)' }}>{price}</p>
      <ul style={{ paddingLeft: 0, listStyle: 'none', marginBottom: 28 }}>
        {items.map((i) => (
          <li key={i} style={{ marginBottom: 12, color: 'rgba(255,255,255,0.55)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
            {i}
          </li>
        ))}
      </ul>
      <button className={highlight ? 'button button-primary' : 'button button-outline'} style={{ width: '100%', justifyContent: 'center' }}>
        {highlight ? 'Choose Pro' : 'Get Started'}
      </button>
    </div>
  );
}
