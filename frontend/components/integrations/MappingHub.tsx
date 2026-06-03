'use client';

/**
 * MappingHub — shared, guided entity→repo mapping surface for monitoring
 * integrations (New Relic, Sentry, Datadog, AppDynamics).
 *
 * One consistent design across all four providers:
 *   • status bar (X/Y mapped · auto N)
 *   • onboarding hint + a 3-step empty state when nothing is loaded yet
 *   • instant client-side search + All / Unmapped / Mapped segmented filter
 *   • dense rows where the repo dropdown is ALWAYS visible, so picking a repo
 *     on an unmapped item maps it in ONE step (parent decides create vs update)
 *
 * The component is purely presentational + owns its own filter state. All data
 * and side effects come through props (adapter pattern), so each provider page
 * wires in its own API calls and keeps its provider-specific extras via
 * `renderActions`.
 */

import { useState } from 'react';
import NavIcon from '@/components/NavIcon';
import { useLocale } from '@/lib/i18n';

export interface MappingHubItem {
  /** stable unique key — entity guid / project slug / service name */
  id: string;
  name: string;
  /** small secondary line, e.g. "APM · live" */
  sublabel?: string;
  /** drives the status dot colour */
  live?: boolean;
  /** currently-linked repo id, or null/undefined when unmapped */
  mappedRepoId?: number | null;
  autoImport?: boolean;
}

export interface MappingHubRepo {
  id: number;
  label: string;
}

export interface MappingHubProps {
  title: string;
  /** emoji/brand mark or any node rendered in the logo tile */
  logo?: React.ReactNode;
  /** one-line onboarding hint shown above the table */
  hint?: string;
  items: MappingHubItem[];
  repos: MappingHubRepo[];
  loading?: boolean;
  searchPlaceholder?: string;
  /** numbered onboarding steps shown in the empty state */
  onboardingSteps?: string[];
  /** optional CTA in the empty state (e.g. "Connect New Relic") */
  emptyCta?: { label: string; href?: string; onClick?: () => void };
  /** select a repo for an item — parent creates the mapping if new, else updates */
  onMapRepo: (item: MappingHubItem, repoId: number | null) => void;
  /** toggle auto-import for a mapped item */
  onToggleAuto?: (item: MappingHubItem) => void;
  /** provider-specific trailing buttons (errors / import / unmap …) */
  renderActions?: (item: MappingHubItem) => React.ReactNode;
}

const inputStyle: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--surface)',
  color: 'var(--ink-90)',
  fontSize: 12,
  outline: 'none',
};

export default function MappingHub({
  title, logo, hint, items, repos, loading,
  searchPlaceholder, onboardingSteps, emptyCta,
  onMapRepo, onToggleAuto, renderActions,
}: MappingHubProps) {
  const { t } = useLocale();
  const [filter, setFilter] = useState('');
  const [mapFilter, setMapFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');

  const isMapped = (it: MappingHubItem) => it.mappedRepoId != null;
  const mappedCount = items.filter(isMapped).length;
  const autoCount = items.filter((it) => it.autoImport).length;

  const q = filter.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (q && !it.name.toLowerCase().includes(q)) return false;
    if (mapFilter === 'mapped' && !isMapped(it)) return false;
    if (mapFilter === 'unmapped' && isMapped(it)) return false;
    return true;
  });

  const segs: Array<{ k: typeof mapFilter; label: string }> = [
    { k: 'all', label: `${t('mappingHub.all')} · ${items.length}` },
    { k: 'unmapped', label: `${t('mappingHub.unmapped')} · ${items.length - mappedCount}` },
    { k: 'mapped', label: `${t('mappingHub.mapped')} · ${mappedCount}` },
  ];

  const card: React.CSSProperties = {
    borderRadius: 10,
    border: '1px solid var(--panel-border)',
    background: 'var(--surface)',
    padding: 16,
  };

  // Onboarding / empty state — shown when there is nothing to map yet.
  if (!loading && items.length === 0) {
    return (
      <div style={{ ...card, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          {logo && <span style={{ width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)' }}>{logo}</span>}
          <div style={{ fontWeight: 600, color: 'var(--ink-90)', fontSize: 15 }}>{title}</div>
        </div>
        {hint && <div style={{ fontSize: 13, color: 'var(--ink-65)', marginBottom: 16, maxWidth: 560, lineHeight: 1.5 }}>{hint}</div>}
        {onboardingSteps && onboardingSteps.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 18, maxWidth: 520 }}>
            {onboardingSteps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: 'var(--acc-soft)', color: 'var(--acc)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                <span style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.4 }}>{step}</span>
              </div>
            ))}
          </div>
        )}
        {emptyCta && (
          emptyCta.href ? (
            <a href={emptyCta.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 7, background: 'var(--acc)', color: '#fff', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              <NavIcon name='plug' size={14} /> {emptyCta.label}
            </a>
          ) : (
            <button type='button' onClick={emptyCta.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 7, background: 'var(--acc)', color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              <NavIcon name='plug' size={14} /> {emptyCta.label}
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <div style={card}>
      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {logo && <span style={{ width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', flexShrink: 0 }}>{logo}</span>}
        <div style={{ fontWeight: 600, color: 'var(--ink-90)', fontSize: 14 }}>{title}</div>
        <span style={{ fontSize: 12, color: 'var(--ink-50)' }}>
          {mappedCount}/{items.length} mapped{autoCount > 0 ? ` · ${autoCount} auto-import` : ''}
        </span>
      </div>

      {/* Onboarding hint */}
      {hint && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 7, background: 'var(--acc-soft)', marginBottom: 10 }}>
          <span style={{ color: 'var(--acc)', flexShrink: 0, marginTop: 1 }}><NavIcon name='alert' size={14} /></span>
          <span style={{ fontSize: 12, color: 'var(--ink-72)', lineHeight: 1.45 }}>{hint}</span>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={searchPlaceholder || 'Filter…'}
          style={{ ...inputStyle, flex: 1, minWidth: 200, height: 34 }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {segs.map((s) => (
            <button key={s.k} type='button' onClick={() => setMapFilter(s.k)} style={{
              height: 34, padding: '0 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
              color: mapFilter === s.k ? 'var(--acc)' : 'var(--ink-50)',
              border: `1px solid ${mapFilter === s.k ? 'var(--acc)' : 'var(--panel-border)'}`,
              background: mapFilter === s.k ? 'var(--acc-soft)' : 'transparent',
            }}>{s.label}</button>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div style={{ display: 'grid', gap: 4 }}>
        {loading && items.length === 0 ? (
          <div style={{ padding: 14, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-42)' }}>{t('mappingHub.loading')}</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 14, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-42)' }}>{t('mappingHub.noMatch')}</div>
        ) : visible.map((it) => (
          <div key={it.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 10px', borderRadius: 8,
            background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
            flexWrap: 'wrap',
          }}>
            <span className='ent-dot' style={{ background: it.live ? '#3f9d6a' : 'var(--ink-30)' }} title={it.live ? 'live' : 'inactive'} />
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
              {it.sublabel && (
                <div style={{ fontSize: 10.5, color: 'var(--ink-42)', marginTop: 1 }}>
                  {it.sublabel}{it.autoImport ? <span style={{ color: 'var(--acc)', fontWeight: 600 }}> · auto-import</span> : ''}
                </div>
              )}
            </div>
            <select
              value={it.mappedRepoId ?? ''}
              onChange={(ev) => onMapRepo(it, ev.target.value ? parseInt(ev.target.value) : null)}
              style={{ ...inputStyle, width: 190, height: 32, borderColor: isMapped(it) ? 'var(--acc)' : 'var(--panel-border)' }}
            >
              <option value=''>{isMapped(it) ? t('mappingHub.selectRepo') : t('mappingHub.mapToRepo')}</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {isMapped(it) && onToggleAuto && (
              <button onClick={() => onToggleAuto(it)} title={t('mappingHub.autoImportTitle')} style={{
                height: 32, padding: '0 10px', borderRadius: 6, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
                color: it.autoImport ? 'var(--acc)' : 'var(--ink-50)',
                border: `1px solid ${it.autoImport ? 'var(--acc)' : 'var(--panel-border)'}`,
                background: it.autoImport ? 'var(--acc-soft)' : 'transparent',
              }}><NavIcon name='zap' size={13} /> {t('mappingHub.auto')}</button>
            )}
            {renderActions && renderActions(it)}
          </div>
        ))}
      </div>
    </div>
  );
}
