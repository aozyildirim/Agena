'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, type RepoMapping } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const LS_REPO_MAPPINGS = 'agena_repo_mappings';

interface RepoSelectorProps {
  value: string | null;
  onSelect: (repoMappingId: string | null) => void;
}

function ProviderIcon({ provider }: { provider?: string }) {
  if (provider === 'github') {
    return (
      <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  if (provider === 'azure') {
    return (
      <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d="M7.47 1L1 6.47 4.4 15h5.13l.87-2H6.33l5.2-4.87L7.47 1zm1.06 0L14 5.53 11.6 15H16L8.53 1z" />
      </svg>
    );
  }
  return (
    <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--panel-border)', display: 'inline-block', flexShrink: 0 }} />
  );
}

export default function RepoSelector({ value, onSelect }: RepoSelectorProps) {
  const { t } = useLocale();
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    // Load from localStorage cache first
    try {
      const cached = localStorage.getItem(LS_REPO_MAPPINGS);
      if (cached) {
        const parsed = JSON.parse(cached) as RepoMapping[];
        if (Array.isArray(parsed)) setRepos(parsed);
      }
    } catch {}
  }, []);

  const handleSync = useCallback(async () => {
    if (!value) return;
    setSyncing(true);
    try {
      await apiFetch(`/analytics/dora/sync`, {
        method: 'POST',
        body: JSON.stringify({ repo_mapping_id: value }),
      });
      setLastSync(new Date().toLocaleTimeString());
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  }, [value]);

  const selectedRepo = repos.find((r) => r.id === value);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 0',
      flexWrap: 'wrap',
    }}>
      {/* Dropdown */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('dora.repoSelector.label')}
        </span>
        <select
          value={value ?? '__all__'}
          onChange={(e) => onSelect(e.target.value === '__all__' ? null : e.target.value)}
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'var(--glass)',
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            padding: '5px 28px 5px 10px',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--ink)',
            cursor: 'pointer',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
            minWidth: 160,
          }}
        >
          <option value="__all__">{t('dora.repoSelector.allRepos')}</option>
          {repos.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.provider === 'github' ? '\u{E0A0} ' : repo.provider === 'azure' ? '\u25C6 ' : ''}{repo.name}
            </option>
          ))}
        </select>
      </div>

      {/* Provider icon for selected */}
      {selectedRepo && (
        <ProviderIcon provider={selectedRepo.provider} />
      )}

      {/* Sync button */}
      {value && (
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--panel-border)',
            background: syncing ? 'var(--panel-border)' : 'var(--glass)',
            color: syncing ? 'var(--muted)' : 'var(--ink)',
            fontSize: 11,
            fontWeight: 600,
            cursor: syncing ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}>
            <path d="M1 1v5h5" /><path d="M15 15v-5h-5" />
            <path d="M13.51 5A7 7 0 003.22 3.22L1 6m14 4l-2.22 2.78A7 7 0 012.49 11" />
          </svg>
          {syncing ? t('dora.repoSelector.syncing') : t('dora.repoSelector.sync')}
        </button>
      )}

      {/* Last sync time */}
      {lastSync && (
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          {t('dora.repoSelector.lastSync')}: {lastSync}
        </span>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
