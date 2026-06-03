'use client';

import React, { useEffect, useState } from 'react';

/**
 * Shared "settings UI" primitives — kept in one component file because
 * Triage and Review-Backlog reuse the same chip patterns. If a third
 * surface adopts these we'll extract a small @agena/ui package later.
 */

type ChipOption<T> = { value: T; label: string };

export function ChipSelect<T extends string | number>({
  value,
  onChange,
  options,
  accent = '#10b981',
  allowCustom = false,
  customLabel = 'Custom',
  customPlaceholder,
  minValue,
  minHint,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ChipOption<T>[];
  accent?: string;
  allowCustom?: boolean;
  customLabel?: string;
  customPlaceholder?: string;
  /** Numeric options below this are disabled (e.g. critical must exceed warn). */
  minValue?: number;
  minHint?: string;
}) {
  const isPreset = options.some((o) => o.value === value);
  // `custom` must stay in sync with the live value: a value that matches no
  // preset (e.g. the backend bumped critical_hours to warn+1) has to show the
  // Custom chip as selected, otherwise nothing looks selected at all. So we
  // only track an explicit user toggle and OR it with "value isn't a preset".
  const [customToggled, setCustomToggled] = useState(false);
  const custom = customToggled || !isPreset;
  const setCustom = setCustomToggled;
  // Buffer the custom number input locally so the user can type freely.
  // Committing on every keystroke saved + re-validated server-side (which
  // can snap the value back, e.g. critical bumped to warn+1), making the
  // field feel un-editable. We only commit on blur / Enter, and re-sync the
  // draft whenever the upstream value changes.
  const [draft, setDraft] = useState<string>(typeof value === 'number' ? String(value) : String(value ?? ''));
  useEffect(() => {
    setDraft(typeof value === 'number' ? String(value) : String(value ?? ''));
  }, [value]);
  const commitDraft = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n)) onChange(n as T);
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {options.map((opt) => {
        const active = !custom && value === opt.value;
        const disabled = typeof opt.value === 'number' && minValue !== undefined && opt.value < minValue;
        return (
          <button
            key={String(opt.value)}
            onClick={() => { if (disabled) return; setCustom(false); onChange(opt.value); }}
            type='button'
            disabled={disabled}
            title={disabled ? minHint : undefined}
            style={{
              padding: '6px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
              border: `1px solid ${active ? accent : 'var(--panel-border)'}`,
              background: active ? `${accent}1c` : 'var(--surface)',
              color: disabled ? 'var(--ink-25)' : (active ? accent : 'var(--ink-78)'),
              opacity: disabled ? 0.5 : 1,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
      {allowCustom && (
        <>
          <button
            onClick={() => setCustom(true)}
            type='button'
            style={{
              padding: '6px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${custom ? accent : 'var(--panel-border)'}`,
              background: custom ? `${accent}1c` : 'var(--surface)',
              color: custom ? accent : 'var(--ink-78)',
            }}
          >
            {customLabel}
          </button>
          {custom && (
            <input
              type='number'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
              placeholder={customPlaceholder}
              autoFocus
              style={{
                width: 90, padding: '6px 10px', borderRadius: 8,
                border: '1px solid var(--panel-border)', background: 'var(--surface)',
                color: 'var(--ink)', fontSize: 13,
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Multi-select chips, comma-separated string in/out so we can keep the
 * existing API contract (`'jira,azure_devops'`) without a schema change. */
export function MultiChipSelect({
  value,
  onChange,
  options,
  accent = '#6366f1',
}: {
  value: string;
  onChange: (csv: string) => void;
  options: { value: string; label: string; icon?: string }[];
  accent?: string;
}) {
  const set = new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
  function toggle(v: string) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next).join(','));
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = set.has(o.value);
        return (
          <button
            key={o.value}
            onClick={() => toggle(o.value)}
            type='button'
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? accent : 'var(--panel-border)'}`,
              background: active ? `${accent}18` : 'var(--surface)',
              color: active ? accent : 'var(--ink-78)',
              whiteSpace: 'nowrap',
            }}
          >
            {o.icon && <span style={{ fontSize: 14 }}>{o.icon}</span>}
            {o.label}
            {active && <span style={{ fontSize: 11, opacity: 0.8 }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact iOS-style toggle. Accent-coloured when on, neutral when off. */
export function SwitchToggle({
  value,
  onChange,
  accent = '#10b981',
  label,
  hint,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  accent?: string;
  label?: string;
  hint?: string;
}) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', padding: '4px 0',
      }}
    >
      <div
        style={{
          width: 38, height: 22, borderRadius: 999,
          background: value ? accent : 'var(--panel-border-3)',
          position: 'relative', transition: 'background 0.18s',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: value ? 19 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.18s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        }} />
      </div>
      {(label || hint) && (
        <div style={{ flex: 1, minWidth: 0 }}>
          {label && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>{label}</div>}
          {hint && <div style={{ fontSize: 11, color: 'var(--ink-58)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
        </div>
      )}
    </div>
  );
}

/** Header for a single settings section — flat label + thin separator. */
export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gap: 8, padding: '14px 0', borderBottom: '1px solid var(--panel-border)' }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-90)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--ink-58)', marginTop: 2, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        borderRadius: 14,
        background: 'var(--panel)',
        border: '1px solid var(--panel-border)',
        padding: '6px 18px 14px',
      }}
    >
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
        color: 'var(--ink-42)', textTransform: 'uppercase',
        padding: '14px 0 10px', borderBottom: '1px solid var(--panel-border)',
        marginBottom: 4,
      }}>
        {title}
      </div>
      {children}
    </section>
  );
}
