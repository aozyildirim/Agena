type Props = { status: string };

const statusMap: Record<string, { color: string; bg: string; border: string }> = {
  queued:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)' },
  running:   { color: '#38bdf8', bg: 'rgba(56,189,248,0.12)',  border: 'rgba(56,189,248,0.3)' },
  completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)' },
  failed:    { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)' },
};

export default function StatusBadge({ status }: Props) {
  const s = statusMap[status] ?? { color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.3)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      textTransform: 'capitalize',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', background: s.color,
        animation: status === 'running' ? 'pulse-brand 1.5s infinite' : 'none',
      }} />
      {status}
    </span>
  );
}
