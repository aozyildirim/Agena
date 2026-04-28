'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { apiFetch, fetchDoraOverview, syncDoraRepo } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

// ── Types ────────────────────────────────────────────────────────────────

interface DoraSummary {
  lead_time_hours: number | null;
  deploy_frequency: number | null;
  change_failure_rate: number | null;
  mttr_hours: number | null;
}

type RepoMappingRow = {
  id: number;
  provider: string;
  owner: string;
  repo_name: string;
  display_name?: string;
  is_active?: boolean;
};

type SyncStatusItem = {
  repo_mapping_id: string;
  commits: number;
  prs: number;
  deployments: number;
  last_sync: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────

type MetricKey = 'leadTime' | 'deployFreq' | 'changeFailRate' | 'mttr';
type Tier = 'elite' | 'high' | 'medium' | 'low';

function classifyMetric(metric: MetricKey, value: number | null): Tier {
  if (value === null) return 'low';
  switch (metric) {
    case 'leadTime':
      if (value < 24) return 'elite';
      if (value < 168) return 'high';
      if (value < 720) return 'medium';
      return 'low';
    case 'deployFreq':
      if (value >= 1) return 'elite';
      if (value >= 1 / 7) return 'high';
      if (value >= 1 / 30) return 'medium';
      return 'low';
    case 'changeFailRate':
      if (value <= 5) return 'elite';
      if (value <= 10) return 'high';
      if (value <= 15) return 'medium';
      return 'low';
    case 'mttr':
      if (value < 1) return 'elite';
      if (value < 24) return 'high';
      if (value < 168) return 'medium';
      return 'low';
  }
}

const tierColors: Record<Tier, { bg: string; border: string; text: string }> = {
  elite: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', text: '#22c55e' },
  high: { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)', text: '#3b82f6' },
  medium: { bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.4)', text: '#eab308' },
  low: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)', text: '#ef4444' },
};

function formatValue(metric: MetricKey, value: number | null): string {
  if (value === null) return '—';
  switch (metric) {
    case 'leadTime': return value < 1 ? `${Math.round(value * 60)}m` : `${value.toFixed(1)}h`;
    case 'deployFreq': return value >= 1 ? `${value.toFixed(1)}/d` : `${(value * 7).toFixed(1)}/w`;
    case 'changeFailRate': return `${value.toFixed(1)}%`;
    case 'mttr': return value < 1 ? `${Math.round(value * 60)}m` : `${value.toFixed(1)}h`;
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never synced';
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function ProviderBadge({ provider }: { provider: string }) {
  const isAzure = provider === 'azure';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
      background: isAzure ? 'rgba(59,130,246,0.12)' : 'rgba(168,85,247,0.12)',
      color: isAzure ? '#60a5fa' : '#c084fc',
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {provider}
    </span>
  );
}

// ── Repo card ─────────────────────────────────────────────────────────────

interface RepoCardProps {
  repo: RepoMappingRow;
  syncStatus: SyncStatusItem | undefined;
  syncing: boolean;
  onSync: () => void;
}

function RepoCard({ repo, syncStatus, syncing, onSync }: RepoCardProps) {
  const [metrics, setMetrics] = useState<DoraSummary | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [metricsError, setMetricsError] = useState<string>('');

  const loadMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    setMetricsError('');
    try {
      const overview = await fetchDoraOverview(30, String(repo.id));
      setMetrics(overview);
    } catch (e) {
      setMetricsError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoadingMetrics(false);
    }
  }, [repo.id]);

  useEffect(() => { void loadMetrics(); }, [loadMetrics]);
  // Refresh after sync
  useEffect(() => {
    if (!syncing && syncStatus?.last_sync) void loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus?.last_sync]);

  const stats: { key: MetricKey; label: string; value: number | null }[] = [
    { key: 'leadTime', label: 'Lead Time', value: metrics?.lead_time_hours ?? null },
    { key: 'deployFreq', label: 'Deploy Freq', value: metrics?.deploy_frequency ?? null },
    { key: 'changeFailRate', label: 'CFR', value: metrics?.change_failure_rate ?? null },
    { key: 'mttr', label: 'MTTR', value: metrics?.mttr_hours ?? null },
  ];

  const hasSynced = (syncStatus?.commits || 0) > 0 || (syncStatus?.prs || 0) > 0;

  return (
    <div style={{
      borderRadius: 14, padding: 18,
      border: '1px solid var(--panel-border-2)',
      background: 'var(--panel)',
      display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'border-color 0.15s, transform 0.15s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <ProviderBadge provider={repo.provider} />
            <span style={{ fontSize: 11, color: 'var(--ink-50)' }}>{relativeTime(syncStatus?.last_sync || null)}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {repo.display_name || `${repo.owner}/${repo.repo_name}`}
          </div>
        </div>
        <button
          onClick={onSync}
          disabled={syncing}
          style={{
            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: syncing ? 'wait' : 'pointer',
            background: syncing ? 'rgba(234,179,8,0.15)' : hasSynced ? 'rgba(34,197,94,0.12)' : 'rgba(94,234,212,0.12)',
            color: syncing ? '#eab308' : hasSynced ? '#22c55e' : '#5eead4',
            fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}
        >
          {syncing
            ? '⏳ Syncing…'
            : hasSynced
              ? `↻ Refresh (${(syncStatus?.commits || 0).toLocaleString()}c · ${(syncStatus?.prs || 0).toLocaleString()}p)`
              : '↻ Sync'}
        </button>
      </div>

      {/* Metrics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {stats.map((s) => {
          const tier = classifyMetric(s.key, s.value);
          const tc = tierColors[tier];
          return (
            <div key={s.key} style={{
              padding: '10px 8px', borderRadius: 10,
              background: 'var(--panel-alt)',
              border: `1px solid ${s.value !== null ? tc.border : 'var(--panel-border)'}`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-50)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.value !== null ? tc.text : 'var(--ink-30)', marginTop: 4 }}>
                {loadingMetrics ? '…' : formatValue(s.key, s.value)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Activity strip */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--ink-65)', flexWrap: 'wrap', borderTop: '1px solid var(--panel-border)', paddingTop: 10 }}>
        <span><strong style={{ color: 'var(--ink)' }}>{syncStatus?.commits ?? 0}</strong> commits</span>
        <span><strong style={{ color: 'var(--ink)' }}>{syncStatus?.prs ?? 0}</strong> PRs</span>
        <span><strong style={{ color: 'var(--ink)' }}>{syncStatus?.deployments ?? 0}</strong> deploys</span>
        <Link
          href={`/dashboard/dora/development?repo=${repo.id}`}
          style={{ marginLeft: 'auto', color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
        >
          Details →
        </Link>
      </div>

      {metricsError && (
        <div style={{ fontSize: 10, color: '#fca5a5' }}>{metricsError}</div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function DoraOverviewPage() {
  const { t } = useLocale();
  const [repos, setRepos] = useState<RepoMappingRow[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState('');
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncStatusItem>>({});
  const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [pageError, setPageError] = useState('');

  // Server-side "currently syncing" registry, populated by the sync route.
  // Survives page reloads so the user knows a click-then-reload didn't lose
  // their in-flight sync.
  const [serverSyncingIds, setServerSyncingIds] = useState<Set<number>>(new Set());

  const refreshSyncStatus = useCallback(async () => {
    try {
      const [statusRes, activeRes] = await Promise.all([
        apiFetch<{ repos: SyncStatusItem[] }>('/analytics/dora/sync-status'),
        apiFetch<{ repo_mapping_ids: number[] }>('/analytics/dora/sync-active').catch(() => ({ repo_mapping_ids: [] })),
      ]);
      const map: Record<string, SyncStatusItem> = {};
      for (const item of statusRes.repos) map[item.repo_mapping_id] = item;
      setSyncStatus(map);
      setServerSyncingIds(new Set(activeRes.repo_mapping_ids || []));
    } catch { /* silent — non-fatal */ }
  }, []);

  // Initial load: repo_mappings + sync status
  useEffect(() => {
    (async () => {
      setReposLoading(true);
      try {
        const rows = await apiFetch<RepoMappingRow[]>('/repo-mappings');
        setRepos((rows || []).filter((r) => r.is_active !== false));
      } catch (e) {
        setReposError(e instanceof Error ? e.message : 'Failed to load repos');
      } finally {
        setReposLoading(false);
      }
      void refreshSyncStatus();
    })();
  }, [refreshSyncStatus]);

  // Background poll. While anything is syncing (this tab OR any other
  // session in this org), poll fast (3s) so the user sees commits / PRs
  // tick up live. Otherwise back off to 15s — just enough to catch a
  // sync started from another tab without burning requests.
  useEffect(() => {
    const fast = syncingIds.size > 0 || serverSyncingIds.size > 0;
    const iv = setInterval(() => { void refreshSyncStatus(); }, fast ? 3000 : 15000);
    return () => clearInterval(iv);
  }, [syncingIds.size, serverSyncingIds.size, refreshSyncStatus]);

  const handleSync = useCallback(async (repoId: number) => {
    setSyncingIds((prev) => new Set(prev).add(repoId));
    setPageError('');
    try {
      await syncDoraRepo(String(repoId));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : `Sync failed for repo ${repoId}`);
    } finally {
      setSyncingIds((prev) => { const n = new Set(prev); n.delete(repoId); return n; });
      void refreshSyncStatus();
    }
  }, [refreshSyncStatus]);

  const handleSyncAll = useCallback(async () => {
    setBulkSyncing(true);
    setPageError('');
    for (const r of repos) {
      // Sequential — Azure rate-limits aggressively on parallel WIQL/REST,
      // and one stuck repo shouldn't poison the others.
      // eslint-disable-next-line no-await-in-loop
      await handleSync(r.id);
    }
    setBulkSyncing(false);
  }, [repos, handleSync]);

  const subpages = [
    { href: '/dashboard/dora/project', icon: '📋', label: t('dora.projectTitle'), desc: t('dora.projectDesc') },
    { href: '/dashboard/dora/development', icon: '⚡', label: t('dora.devTitle'), desc: t('dora.devDesc') },
    { href: '/dashboard/dora/quality', icon: '🛡', label: t('dora.qualityTitle'), desc: t('dora.qualityDesc') },
    { href: '/dashboard/dora/bugs', icon: '🐛', label: t('dora.bugsTitle'), desc: t('dora.bugsDesc') },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>{t('dora.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, maxWidth: 640 }}>
            Each card below shows DORA metrics computed from that repo&apos;s synced git data.
            Click <strong style={{ color: 'var(--ink)' }}>Sync</strong> on a repo to pull its latest commits, PRs, and deployments.
          </p>
        </div>
        <button
          onClick={handleSyncAll}
          disabled={bulkSyncing || repos.length === 0}
          style={{
            padding: '10px 18px', borderRadius: 12, border: 'none',
            background: bulkSyncing ? 'var(--panel-alt)' : 'linear-gradient(135deg, #0d9488, #22c55e)',
            color: bulkSyncing ? 'var(--muted)' : '#fff',
            fontWeight: 700, fontSize: 13, cursor: bulkSyncing ? 'not-allowed' : 'pointer',
          }}
        >
          {bulkSyncing ? `Syncing ${syncingIds.size}/${repos.length}…` : `↻ Sync all (${repos.length})`}
        </button>
      </div>

      {/* Errors */}
      {(reposError || pageError) && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5', fontSize: 13,
        }}>
          {reposError || pageError}
        </div>
      )}

      {/* Empty state */}
      {!reposLoading && !reposError && repos.length === 0 && (
        <div style={{
          padding: '32px 24px', borderRadius: 14, textAlign: 'center',
          border: '1px dashed var(--panel-border-2)', background: 'var(--panel-alt)',
          color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>No repos configured yet</div>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            Add your repos at <Link href='/dashboard/integrations/repo-mappings' style={{ color: 'var(--accent)', fontWeight: 600 }}>Integrations → Repo mappings</Link>, then come back to sync DORA data.
          </div>
        </div>
      )}

      {/* Repo grid */}
      {repos.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14,
          marginBottom: 32,
        }}>
          {repos.map((r) => (
            <RepoCard
              key={r.id}
              repo={r}
              syncStatus={syncStatus[String(r.id)]}
              syncing={syncingIds.has(r.id) || serverSyncingIds.has(r.id)}
              onSync={() => void handleSync(r.id)}
            />
          ))}
        </div>
      )}

      {/* Subpage quick links — kept for cross-cutting (multi-repo) views */}
      <div style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: 1 }}>{t('dora.quickLinks')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {subpages.map((sp) => (
            <Link
              key={sp.href}
              href={sp.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--panel-border)',
                background: 'var(--panel)',
                color: 'var(--ink)', textDecoration: 'none',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <span style={{ fontSize: 18 }}>{sp.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.label}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sp.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
