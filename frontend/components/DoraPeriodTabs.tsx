'use client';

type Props = {
  value: number;
  onChange: (next: number) => void;
};

const OPTIONS: { d: number; label: string }[] = [
  { d: 30,  label: '30g' },
  { d: 90,  label: '3 ay' },
  { d: 180, label: '6 ay' },
  { d: 365, label: '1 yıl' },
];

export default function DoraPeriodTabs({ value, onChange }: Props) {
  return (
    <div
      role='tablist'
      aria-label='DORA period'
      style={{
        display: 'inline-flex', padding: 3,
        borderRadius: 999, border: '1px solid var(--panel-border-2)',
        background: 'var(--panel-alt)',
      }}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.d;
        return (
          <button
            key={opt.d}
            role='tab'
            aria-selected={active}
            onClick={() => onChange(opt.d)}
            style={{
              padding: '5px 12px', borderRadius: 999, border: 'none',
              background: active ? 'var(--surface)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--ink-50)',
              fontSize: 12, fontWeight: active ? 700 : 600, cursor: 'pointer',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
