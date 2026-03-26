'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { apiFetch, fetchDoraOverview, loadPrefs, syncDoraRepo } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const box: React.CSSProperties = {
  borderRadius: 14,
  border: '1px solid var(--panel-border-2)',
  background: 'var(--panel)',
  padding: 24,
};

interface DoraSummary {
  lead_time_hours: number | null;
  deploy_frequency: number | null;
  change_failure_rate: number | null;
  mttr_hours: number | null;
  daily: Array<{
    date: string;
    completed: number;
    failed: number;
    lead_time_hours: number | null;
    mttr_hours: number | null;
  }>;
}

function classifyMetric(
  metric: 'leadTime' | 'deployFreq' | 'changeFailRate' | 'mttr',
  value: number | null,
): 'elite' | 'high' | 'medium' | 'low' {
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

const badgeColors: Record<string, { bg: string; border: string; text: string }> = {
  elite: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', text: '#22c55e' },
  high: { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)', text: '#3b82f6' },
  medium: { bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.4)', text: '#eab308' },
  low: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)', text: '#ef4444' },
};

function Sparkline({ data, color, width = 120, height = 36 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height, opacity: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>--</div>;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polygon points={areaPoints} fill={color} opacity={0.15} />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatValue(metric: string, value: number | null): string {
  if (value === null) return '\u2014';
  switch (metric) {
    case 'leadTime': return value < 1 ? `${Math.round(value * 60)}m` : `${value.toFixed(1)}h`;
    case 'deployFreq': return value >= 1 ? `${value.toFixed(1)}/d` : `${(value * 7).toFixed(1)}/w`;
    case 'changeFailRate': return `${value.toFixed(1)}%`;
    case 'mttr': return value < 1 ? `${Math.round(value * 60)}m` : `${value.toFixed(1)}h`;
    default: return String(value);
  }
}

type RepoMapping = { id: string; name: string; provider?: string; github_owner?: string; github_repo?: string; azure_project?: string; azure_repo_name?: string };
type SyncStatusItem = { repo_mapping_id: string; commits: number; prs: number; deployments: number; last_sync: string | null };
type SyncStatus = Record<string, SyncStatusItem>;

export default function DoraOverviewPage() {
  const { t } = useLocale();
  const [data, setData] = useState<DoraSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [repoId, setRepoId] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({});
  const [syncingRepo, setSyncingRepo] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  // Load repos + sync status
  useEffect(() => {
    (async () => {
      try {
        const prefs = await loadPrefs();
        const mappings = (prefs.repo_mappings || []) as RepoMapping[];
        setRepos(mappings);
      } catch { /* silent */ }
      try {
        const res = await apiFetch<{ repos: SyncStatusItem[] }>('/analytics/dora/sync-status');
        const map: SyncStatus = {};
        for (const item of res.repos) map[item.repo_mapping_id] = item;
        setSyncStatus(map);
      } catch { /* silent */ }
    })();
  }, []);

  // Load DORA data
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetchDoraOverview(30, repoId);
        if (active) setData(res);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load DORA metrics');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [repoId]);

  const handleSync = useCallback(async (id: string) => {
    setSyncingRepo(id);
    try {
      await syncDoraRepo(id);
      const res2 = await apiFetch<{ repos: SyncStatusItem[] }>('/analytics/dora/sync-status');
      const map2: SyncStatus = {};
      for (const item of res2.repos) map2[item.repo_mapping_id] = item;
      setSyncStatus(map2);
      // Refresh DORA data if this repo is selected
      if (repoId === id || repoId === null) {
        const res = await fetchDoraOverview(30, repoId);
        setData(res);
      }
    } catch { /* silent */ }
    setSyncingRepo(null);
  }, [repoId]);

  const handleSyncAll = useCallback(async () => {
    setSyncingAll(true);
    for (const repo of repos) {
      setSyncingRepo(repo.id);
      try { await syncDoraRepo(repo.id); } catch { /* silent */ }
    }
    setSyncingRepo(null);
    try {
      const res2 = await apiFetch<{ repos: SyncStatusItem[] }>('/analytics/dora/sync-status');
      const map2: SyncStatus = {};
      for (const item of res2.repos) map2[item.repo_mapping_id] = item;
      setSyncStatus(map2);
      const res = await fetchDoraOverview(30, repoId);
      setData(res);
    } catch { /* silent */ }
    setSyncingAll(false);
  }, [repos, repoId]);

  const metrics = [
    {
      key: 'leadTime' as const,
      label: t('dora.leadTime'),
      desc: t('dora.leadTimeDesc'),
      value: data?.lead_time_hours ?? null,
      sparkData: data?.daily.map((d) => d.lead_time_hours ?? 0) ?? [],
      color: '#3b82f6',
    },
    {
      key: 'deployFreq' as const,
      label: t('dora.deployFreq'),
      desc: t('dora.deployFreqDesc'),
      value: data?.deploy_frequency ?? null,
      sparkData: data?.daily.map((d) => d.completed) ?? [],
      color: '#22c55e',
    },
    {
      key: 'changeFailRate' as const,
      label: t('dora.changeFailRate'),
      desc: t('dora.changeFailRateDesc'),
      value: data?.change_failure_rate ?? null,
      sparkData: data?.daily.map((d) => {
        const total = d.completed + d.failed;
        return total > 0 ? (d.failed / total) * 100 : 0;
      }) ?? [],
      color: '#ef4444',
    },
    {
      key: 'mttr' as const,
      label: t('dora.mttr'),
      desc: t('dora.mttrDesc'),
      value: data?.mttr_hours ?? null,
      sparkData: data?.daily.map((d) => d.mttr_hours ?? 0) ?? [],
      color: '#f59e0b',
    },
  ];

  const benchmarkRows = [
    { label: t('dora.elite'), color: '#22c55e', lt: '< 1 day', df: 'On-demand', cfr: '< 5%', mttr: '< 1 hour' },
    { label: t('dora.high'), color: '#3b82f6', lt: '1 day - 1 week', df: 'Daily to weekly', cfr: '5-10%', mttr: '< 1 day' },
    { label: t('dora.medium'), color: '#eab308', lt: '1 week - 1 month', df: 'Weekly to monthly', cfr: '10-15%', mttr: '< 1 week' },
    { label: t('dora.low'), color: '#ef4444', lt: '> 1 month', df: '< monthly', cfr: '> 15%', mttr: '> 1 week' },
  ];

  const quickLinks = [
    { href: '/dashboard/dora/project', icon: '📋', label: t('dora.projectTitle'), desc: t('dora.projectDesc') },
    { href: '/dashboard/dora/development', icon: '⚡', label: t('dora.devTitle'), desc: t('dora.devDesc') },
    { href: '/dashboard/dora/quality', icon: '🛡', label: t('dora.qualityTitle'), desc: t('dora.qualityDesc') },
    { href: '/dashboard/dora/bugs', icon: '🐛', label: t('dora.bugsTitle'), desc: t('dora.bugsDesc') },
  ];

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>{t('dora.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>{t('dora.subtitle')}</p>
          </div>
          <button onClick={handleSyncAll} disabled={syncingAll || repos.length === 0}
            style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: syncingAll ? 'var(--panel-alt)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: syncingAll ? 'var(--muted)' : '#fff', fontWeight: 700, fontSize: 13, cursor: syncingAll ? 'not-allowed' : 'pointer' }}>
            {syncingAll ? `Syncing... (${syncingRepo ? repos.findIndex(r => r.id === syncingRepo) + 1 : 0}/${repos.length})` : `Sync All (${repos.length})`}
          </button>
        </div>
        {/* Repo filter pills */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setRepoId(null)}
            style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: repoId === null ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border)', background: repoId === null ? 'rgba(94,234,212,0.12)' : 'var(--panel-alt)', color: repoId === null ? '#5eead4' : 'var(--muted)' }}>
            {t('dora.allRepos')}
          </button>
          {repos.map((r) => (
            <button key={r.id} onClick={() => setRepoId(r.id)}
              style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: repoId === r.id ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border)', background: repoId === r.id ? 'rgba(94,234,212,0.12)' : 'var(--panel-alt)', color: repoId === r.id ? '#5eead4' : 'var(--muted)' }}>
              {r.provider === 'github' ? '⬤' : '🔷'} {r.name}
            </button>
          ))}
        </div>
      </div>

      {/* Repo Cards */}
      {repos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginBottom: 32 }}>
          {repos.map((repo) => {
            const st = syncStatus[repo.id];
            const isSyncing = syncingRepo === repo.id;
            const providerIcon = repo.provider === 'github' ? '⬤' : repo.provider === 'azure' ? '🔷' : '📁';
            const repoLabel = repo.github_owner && repo.github_repo
              ? `${repo.github_owner}/${repo.github_repo}`
              : repo.azure_project && repo.azure_repo_name
                ? `${repo.azure_project}/${repo.azure_repo_name}`
                : repo.name;
            return (
              <div key={repo.id} style={{ ...box, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 24, flexShrink: 0 }}>{providerIcon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repoLabel}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {st ? (
                      <>
                        <span>{st.commits} commits</span>
                        <span>{st.prs} PRs</span>
                        <span>{st.deployments} deploys</span>
                        {st.last_sync && <span>· {new Date(st.last_sync).toLocaleString()}</span>}
                      </>
                    ) : <span>Not synced yet</span>}
                  </div>
                </div>
                <button onClick={() => handleSync(repo.id)} disabled={isSyncing}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--panel-border)', background: isSyncing ? 'var(--panel-alt)' : 'var(--panel)', color: isSyncing ? 'var(--muted)' : '#5eead4', fontSize: 12, fontWeight: 600, cursor: isSyncing ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
                  {isSyncing ? '⏳' : '🔄'} Sync
                </button>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ ...box, borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {/* 4 DORA metric cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 40 }}>
        {metrics.map((m) => {
          const level = classifyMetric(m.key, m.value);
          const badge = badgeColors[level];
          return (
            <div key={m.key} style={{ ...box, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', overflow: 'hidden' }}>
              {loading && (
                <div style={{ position: 'absolute', inset: 0, background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>...</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{m.desc}</div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
                  padding: '3px 8px', borderRadius: 999,
                  background: badge.bg, border: `1px solid ${badge.border}`, color: badge.text,
                }}>
                  {t(`dora.${level}` as Parameters<typeof t>[0])}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>
                  {formatValue(m.key, m.value)}
                </div>
                <Sparkline data={m.sparkData} color={m.color} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Engineering Benchmark */}
      <div style={{ ...box, marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.benchmark')}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Level</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{t('dora.leadTime')}</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{t('dora.deployFreq')}</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{t('dora.changeFailRate')}</th>
                <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{t('dora.mttr')}</th>
              </tr>
            </thead>
            <tbody>
              {benchmarkRows.map((row) => (
                <tr key={row.label} style={{ borderBottom: '1px solid var(--panel-border-2)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                      <span style={{ fontWeight: 600, color: row.color }}>{row.label}</span>
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>{row.lt}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>{row.df}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>{row.cfr}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink)' }}>{row.mttr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Links */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>{t('dora.quickLinks')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {quickLinks.map((link) => (
            <Link key={link.href} href={link.href} style={{
              ...box, textDecoration: 'none', padding: 20, display: 'flex', flexDirection: 'column', gap: 8,
              transition: 'border-color 0.2s, transform 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(139,92,246,0.3)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--panel-border-2)'; }}
            >
              <span style={{ fontSize: 24 }}>{link.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{link.label}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>{link.desc}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
