'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { apiFetch, fetchDoraOverview, loadPrefs, savePrefs, syncDoraRepo } from '@/lib/api';
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

type RepoMapping = { id: string; name: string; provider?: string; local_path?: string; github_owner?: string; github_repo?: string; azure_project?: string; azure_repo_url?: string; azure_repo_name?: string; default_branch?: string };
type SyncStatusItem = { repo_mapping_id: string; commits: number; prs: number; deployments: number; last_sync: string | null };
type SyncStatus = Record<string, SyncStatusItem>;
type AzureProject = { id: string; name: string };
type AzureRepo = { id: string; name: string; remote_url: string; web_url: string };

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

  // Azure project discovery
  const [projects, setProjects] = useState<AzureProject[]>([]);
  const [projectRepos, setProjectRepos] = useState<Record<string, AzureRepo[]>>({});
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [syncedKeys, setSyncedKeys] = useState<Set<string>>(new Set());
  const [syncingKeys, setSyncingKeys] = useState<Set<string>>(new Set());

  // Load repos + sync status + Azure projects
  useEffect(() => {
    (async () => {
      let mappings: RepoMapping[] = [];
      try {
        const prefs = await loadPrefs();
        mappings = (prefs.repo_mappings || []) as RepoMapping[];
        setRepos(mappings);
      } catch { /* silent */ }
      try {
        const res = await apiFetch<{ repos: SyncStatusItem[] }>('/analytics/dora/sync-status');
        const map: SyncStatus = {};
        const synced = new Set<string>();
        for (const item of res.repos) {
          map[item.repo_mapping_id] = item;
          // Mark repos that have been synced before
          const mapping = mappings.find((m) => m.id === item.repo_mapping_id);
          if (mapping && mapping.azure_project && mapping.azure_repo_name && (item.commits > 0 || item.prs > 0)) {
            synced.add(`${mapping.azure_project}/${mapping.azure_repo_name}`);
          }
        }
        setSyncStatus(map);
        setSyncedKeys(synced);
      } catch { /* silent */ }

      // Discover Azure projects
      try {
        const azProjects = await apiFetch<AzureProject[]>('/tasks/azure/projects');
        setProjects(azProjects);
        const repoMap: Record<string, AzureRepo[]> = {};
        await Promise.all(azProjects.map(async (p) => {
          try {
            repoMap[p.name] = await apiFetch<AzureRepo[]>(`/tasks/azure/repos?project=${encodeURIComponent(p.name)}`);
          } catch { repoMap[p.name] = []; }
        }));
        setProjectRepos(repoMap);
      } catch { /* no azure */ }
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

  const refreshSyncStatus = useCallback(async (currentMappings: RepoMapping[]) => {
    try {
      const res2 = await apiFetch<{ repos: SyncStatusItem[] }>('/analytics/dora/sync-status');
      const map2: SyncStatus = {};
      const synced = new Set(syncedKeys);
      for (const item of res2.repos) {
        map2[item.repo_mapping_id] = item;
        const mapping = currentMappings.find((m) => m.id === item.repo_mapping_id);
        if (mapping && mapping.azure_project && mapping.azure_repo_name && (item.commits > 0 || item.prs > 0)) {
          synced.add(`${mapping.azure_project}/${mapping.azure_repo_name}`);
        }
      }
      setSyncStatus(map2);
      setSyncedKeys(synced);
    } catch { /* silent */ }
  }, [syncedKeys]);

  // Sync a single Azure repo (auto-add mapping if needed)
  const syncAzureRepo = useCallback(async (projectName: string, repo: AzureRepo) => {
    const key = `${projectName}/${repo.name}`;
    setSyncingKeys((prev) => new Set(prev).add(key));
    setSyncingRepo(key);

    let currentRepos = [...repos];
    let mapping = currentRepos.find(
      (m) => m.provider === 'azure' && m.azure_project === projectName && m.azure_repo_name === repo.name,
    );
    if (!mapping) {
      mapping = {
        id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
        provider: 'azure',
        name: repo.name,
        local_path: '',
        azure_project: projectName,
        azure_repo_url: repo.remote_url,
        azure_repo_name: repo.name,
        default_branch: 'main',
      };
      currentRepos.push(mapping);
      setRepos(currentRepos);
      try { await savePrefs({ repo_mappings: currentRepos }); } catch { /* silent */ }
    }

    try {
      await syncDoraRepo(mapping.id);
      setSyncedKeys((prev) => new Set(prev).add(key));
    } catch { /* silent */ }

    setSyncingKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
    setSyncingRepo(null);
    await refreshSyncStatus(currentRepos);
  }, [repos, refreshSyncStatus]);

  // Sync entire project
  const syncProject = useCallback(async (projectName: string) => {
    const pRepos = projectRepos[projectName] || [];
    for (const repo of pRepos) {
      await syncAzureRepo(projectName, repo);
    }
    // Refresh DORA data
    try { const res = await fetchDoraOverview(30, repoId); setData(res); } catch { /* silent */ }
  }, [projectRepos, syncAzureRepo, repoId]);

  // Sync ALL projects
  const handleSyncAll = useCallback(async () => {
    setSyncingAll(true);
    for (const p of projects) {
      await syncProject(p.name);
    }
    setSyncingAll(false);
  }, [projects, syncProject]);

  const toggleProject = (name: string) => {
    setExpandedProjects((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  };

  const metrics = [
    { key: 'leadTime' as const, label: t('dora.leadTime'), desc: t('dora.leadTimeDesc'), value: data?.lead_time_hours ?? null, sparkData: data?.daily.map((d) => d.lead_time_hours ?? 0) ?? [], color: '#3b82f6' },
    { key: 'deployFreq' as const, label: t('dora.deployFreq'), desc: t('dora.deployFreqDesc'), value: data?.deploy_frequency ?? null, sparkData: data?.daily.map((d) => d.completed) ?? [], color: '#22c55e' },
    { key: 'changeFailRate' as const, label: t('dora.changeFailRate'), desc: t('dora.changeFailRateDesc'), value: data?.change_failure_rate ?? null, sparkData: data?.daily.map((d) => { const tot = d.completed + d.failed; return tot > 0 ? (d.failed / tot) * 100 : 0; }) ?? [], color: '#ef4444' },
    { key: 'mttr' as const, label: t('dora.mttr'), desc: t('dora.mttrDesc'), value: data?.mttr_hours ?? null, sparkData: data?.daily.map((d) => d.mttr_hours ?? 0) ?? [], color: '#f59e0b' },
  ];

  const benchmarkRows = [
    { label: t('dora.elite'), color: '#22c55e', lt: '< 1 day', df: 'On-demand', cfr: '< 5%', mttr: '< 1 hour' },
    { label: t('dora.high'), color: '#3b82f6', lt: '1 day - 1 week', df: 'Daily to weekly', cfr: '5-10%', mttr: '< 1 day' },
    { label: t('dora.medium'), color: '#eab308', lt: '1 week - 1 month', df: 'Weekly to monthly', cfr: '10-15%', mttr: '< 1 week' },
    { label: t('dora.low'), color: '#ef4444', lt: '> 1 month', df: '< monthly', cfr: '> 15%', mttr: '> 1 week' },
  ];

  const quickLinks = [
    { href: '/dashboard/dora/project', icon: '\uD83D\uDCCB', label: t('dora.projectTitle'), desc: t('dora.projectDesc') },
    { href: '/dashboard/dora/development', icon: '\u26A1', label: t('dora.devTitle'), desc: t('dora.devDesc') },
    { href: '/dashboard/dora/quality', icon: '\uD83D\uDEE1', label: t('dora.qualityTitle'), desc: t('dora.qualityDesc') },
    { href: '/dashboard/dora/bugs', icon: '\uD83D\uDC1B', label: t('dora.bugsTitle'), desc: t('dora.bugsDesc') },
    { href: '/dashboard/dora/team', icon: '\uD83D\uDC65', label: t('nav.doraTeam'), desc: t('tooltip.nav.doraTeam') },
  ];

  const totalReposCount = Object.values(projectRepos).reduce((s, r) => s + r.length, 0);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>{t('dora.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6 }}>{t('dora.subtitle')}</p>
          </div>
          <button onClick={handleSyncAll} disabled={syncingAll || projects.length === 0}
            style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: syncingAll ? 'var(--panel-alt)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: syncingAll ? 'var(--muted)' : '#fff', fontWeight: 700, fontSize: 13, cursor: syncingAll ? 'not-allowed' : 'pointer' }}>
            {syncingAll ? `Syncing... ${syncingRepo || ''}` : `Sync All (${totalReposCount} repos)`}
          </button>
        </div>
      </div>

      {/* ── Azure Project Cards ─────────────────────────────────────────── */}
      {projects.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {projects.map((project) => {
              const pRepos = projectRepos[project.name] || [];
              const isExpanded = expandedProjects.has(project.name);
              const isSyncingProject = pRepos.some((r) => syncingKeys.has(`${project.name}/${r.name}`));
              const hasSyncedRepos = pRepos.some((r) => syncedKeys.has(`${project.name}/${r.name}`));
              const allSynced = pRepos.length > 0 && pRepos.every((r) => syncedKeys.has(`${project.name}/${r.name}`));

              // Border color: syncing = yellow animated, synced = green, default
              const borderColor = isSyncingProject
                ? 'rgba(234,179,8,0.6)'
                : allSynced
                  ? 'rgba(34,197,94,0.4)'
                  : hasSyncedRepos
                    ? 'rgba(34,197,94,0.2)'
                    : 'var(--panel-border-2)';

              return (
                <div
                  key={project.id}
                  className={isSyncingProject ? 'project-card-syncing' : ''}
                  style={{
                    borderRadius: 12, padding: '12px 14px',
                    border: `2px solid ${borderColor}`,
                    background: allSynced ? 'rgba(34,197,94,0.04)' : 'var(--panel)',
                    transition: 'border-color 0.3s, background 0.3s',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleProject(project.name)}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 13, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>{'\u25B6'}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.name}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{pRepos.length}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); syncProject(project.name); }}
                      disabled={isSyncingProject || pRepos.length === 0}
                      style={{
                        padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, flexShrink: 0,
                        border: 'none', cursor: isSyncingProject ? 'not-allowed' : 'pointer',
                        background: isSyncingProject ? 'rgba(234,179,8,0.15)' : allSynced ? 'rgba(34,197,94,0.12)' : 'rgba(94,234,212,0.1)',
                        color: isSyncingProject ? '#eab308' : allSynced ? '#22c55e' : '#5eead4',
                      }}
                    >
                      {isSyncingProject ? '\u23F3' : allSynced ? '\u2714' : '\uD83D\uDD04'}
                    </button>
                  </div>

                  {/* Expanded: repo list */}
                  {isExpanded && pRepos.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {pRepos.map((repo) => {
                        const key = `${project.name}/${repo.name}`;
                        const isSyncingThis = syncingKeys.has(key);
                        const isSynced = syncedKeys.has(key);
                        const mapping = repos.find((m) => m.provider === 'azure' && m.azure_project === project.name && m.azure_repo_name === repo.name);
                        const st = mapping ? syncStatus[mapping.id] : null;

                        return (
                          <div key={repo.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                            borderRadius: 8, fontSize: 11,
                            background: isSyncingThis ? 'rgba(234,179,8,0.06)' : isSynced ? 'rgba(34,197,94,0.04)' : 'transparent',
                            border: isSynced ? '1px solid rgba(34,197,94,0.25)' : '1px solid transparent',
                          }}>
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: isSyncingThis ? '#eab308' : isSynced ? '#22c55e' : 'var(--panel-border)',
                              boxShadow: isSyncingThis ? '0 0 6px rgba(234,179,8,0.5)' : isSynced ? '0 0 4px rgba(34,197,94,0.4)' : 'none',
                            }} />
                            <span style={{ color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {repo.name}
                            </span>
                            {isSyncingThis && <span style={{ color: '#eab308', marginLeft: 'auto', flexShrink: 0, fontSize: 10 }}>syncing...</span>}
                            {!isSyncingThis && st && (st.commits > 0 || st.prs > 0) && (
                              <span style={{ color: 'var(--muted)', marginLeft: 'auto', flexShrink: 0, fontSize: 10 }}>
                                {st.commits}c · {st.prs}pr
                              </span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); syncAzureRepo(project.name, repo); }}
                              disabled={isSyncingThis}
                              style={{
                                padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                                border: 'none', cursor: isSyncingThis ? 'not-allowed' : 'pointer', flexShrink: 0,
                                background: isSyncingThis ? 'rgba(234,179,8,0.1)' : isSynced ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.05)',
                                color: isSyncingThis ? '#eab308' : isSynced ? '#22c55e' : 'var(--muted)',
                              }}
                            >
                              {isSyncingThis ? '\u23F3' : isSynced ? '\u2714' : '\uD83D\uDD04'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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

      {/* Syncing animation CSS */}
      <style>{`
        @keyframes border-spin {
          0% { border-color: rgba(234,179,8,0.3); }
          50% { border-color: rgba(234,179,8,0.8); }
          100% { border-color: rgba(234,179,8,0.3); }
        }
        .project-card-syncing {
          animation: border-spin 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
