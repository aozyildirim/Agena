'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchTeamSymptoms, loadPrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface PRDetail {
  author: string;
  title: string;
  target_branch?: string;
  repo_mapping_id?: string;
  size?: number;
  hours?: number;
  seconds?: number;
}

interface Symptom {
  id: string;
  name: string;
  category: string;
  active: boolean;
  severity: 'healthy' | 'info' | 'warning' | 'critical';
  value: number;
  unit: string;
  detail: string;
  threshold?: number;
  trend?: number[];
  overloaded_members?: { author: string; impact: number }[];
  pr_details?: PRDetail[];
  weekend_authors?: { author: string; count: number }[];
  unreviewed_by_author?: { author: string; count: number }[];
}

interface Summary {
  total_symptoms: number;
  active_count: number;
  critical_count: number;
  warning_count: number;
  healthy_count: number;
  total_commits: number;
  total_prs: number;
  total_merged: number;
  contributors: number;
  period_days: number;
}

interface SymptomsData {
  git_analytics: Symptom[];
  pr_delivery: Symptom[];
  summary: Summary;
}

type RepoMapping = { id: string; name: string; provider?: string };

/* ── Severity ───────────────────────────────────────────────────────────────── */

const sevColors: Record<string, { bg: string; border: string; text: string }> = {
  healthy:  { bg: 'rgba(63,157,106,0.08)',  border: 'rgba(63,157,106,0.25)',  text: '#3f9d6a' },
  info:     { bg: 'rgba(91,155,213,0.08)',  border: 'rgba(91,155,213,0.25)',  text: '#5b9bd5' },
  warning:  { bg: 'rgba(201,138,43,0.08)',  border: 'rgba(201,138,43,0.25)',  text: '#c98a2b' },
  critical: { bg: 'rgba(207,91,87,0.08)',   border: 'rgba(207,91,87,0.25)',   text: '#cf5b57' },
};
const sevIconNames: Record<string, string> = { healthy: 'user-check', info: 'dot', warning: 'alert', critical: 'alert' };

/* ── MiniSparkline ──────────────────────────────────────────────────────────── */

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const w = 80, h = 24;
  const max = Math.max(...data, 1), min = Math.min(...data, 0), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Health Ring ─────────────────────────────────────────────────────────────── */

function HealthRing({ healthy, warning, critical, size = 110 }: { healthy: number; warning: number; critical: number; size?: number }) {
  const total = healthy + warning + critical || 1;
  const r = (size - 12) / 2, c = Math.PI * 2 * r;
  const hP = healthy / total, wP = warning / total, cP = critical / total;
  const score = Math.round((healthy / total) * 100);
  const col = score >= 70 ? '#3f9d6a' : score >= 40 ? '#c98a2b' : '#cf5b57';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth={10} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#3f9d6a" strokeWidth={10} strokeDasharray={`${c*hP} ${c}`} strokeDashoffset={0} strokeLinecap="round" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#c98a2b" strokeWidth={10} strokeDasharray={`${c*wP} ${c}`} strokeDashoffset={-c*hP} strokeLinecap="round" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#cf5b57" strokeWidth={10} strokeDasharray={`${c*cP} ${c}`} strokeDashoffset={-c*(hP+wP)} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: col, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>score</span>
      </div>
    </div>
  );
}

/* ── Symptom Card ────────────────────────────────────────────────────────────── */

function formatReviewTime(hours?: number, seconds?: number): string {
  if (seconds !== undefined) {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  if (hours === undefined || hours === 0) return '-';
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function SymptomCard({ symptom, t, repos }: { symptom: Symptom; t: ReturnType<typeof useLocale>['t']; repos: RepoMapping[] }) {
  const [expanded, setExpanded] = useState(false);
  const sev = sevColors[symptom.severity] || sevColors.healthy;
  const iconName = sevIconNames[symptom.severity] || 'dot';
  const id = symptom.id.toLowerCase();

  const details = symptom.pr_details || [];
  const weekendAuthors = symptom.weekend_authors || [];
  const unreviewedAuthors = symptom.unreviewed_by_author || [];
  const hasDetails = details.length > 0 || weekendAuthors.length > 0 || unreviewedAuthors.length > 0;

  const repoName = (rid: string) => repos.find((r) => r.id === rid)?.name || rid.slice(0, 12);

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${sev.border}`, background: sev.bg, position: 'relative', overflow: 'hidden' }}>
      {symptom.active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: sev.text, opacity: 0.8 }} />}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flexShrink: 0, color: sev.text, display: 'inline-flex' }}><NavIcon name={iconName} size={14} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`dora.team.${id}.name` as Parameters<typeof t>[0])}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{t(`dora.team.${id}.desc` as Parameters<typeof t>[0])}</div>
            </div>
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, padding: '2px 7px', borderRadius: 999, flexShrink: 0, background: sev.bg, border: `1px solid ${sev.border}`, color: sev.text }}>
            {t(`dora.team.${symptom.severity}` as Parameters<typeof t>[0])}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <span style={{ fontSize: 22, fontWeight: 800, color: sev.text, lineHeight: 1 }}>{typeof symptom.value === 'number' ? (symptom.value % 1 === 0 ? symptom.value : symptom.value.toFixed(1)) : symptom.value}</span>
            <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 4, fontWeight: 600 }}>{symptom.unit}</span>
          </div>
          {symptom.trend && symptom.trend.length > 1 && <MiniSparkline data={symptom.trend} color={sev.text} />}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>{symptom.detail}</div>
        {symptom.overloaded_members && symptom.overloaded_members.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {symptom.overloaded_members.map((m) => (
              <span key={m.author} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 999, background: 'rgba(207,91,87,0.1)', border: '1px solid rgba(207,91,87,0.2)', color: '#cf5b57', fontWeight: 600 }}>{m.author}</span>
            ))}
          </div>
        )}
        {hasDetails && (
          <button onClick={() => setExpanded(!expanded)} style={{
            marginTop: 8, fontSize: 10, fontWeight: 600, color: sev.text, background: 'none', border: 'none',
            cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4, opacity: 0.8,
          }}>
            <span style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-flex' }}><NavIcon name="chevron-right" size={12} /></span>
            {expanded ? 'Hide details' : `Show details (${details.length || weekendAuthors.length || unreviewedAuthors.length})`}
          </button>
        )}
      </div>

      {/* PR Details Table */}
      {expanded && details.length > 0 && (
        <div style={{ borderTop: `1px solid var(--panel-border)`, padding: '8px 12px', overflowX: 'auto' }}>
          <table className="ent-table" style={{ fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>PR</th>
                <th style={{ textAlign: 'left' }}>{t('common.author')}</th>
                <th style={{ textAlign: 'left' }}>{t('common.repo')}</th>
                <th style={{ textAlign: 'right' }}>{t('dora.reviewTime')}</th>
                <th style={{ textAlign: 'right' }}>{t('common.size')}</th>
              </tr>
            </thead>
            <tbody>
              {details.map((pr, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--ink-90)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.title}</td>
                  <td style={{ color: 'var(--muted)' }}>{pr.author}</td>
                  <td style={{ color: 'var(--muted)', fontSize: 9 }}>
                    {pr.repo_mapping_id ? repoName(pr.repo_mapping_id) : ''}{pr.target_branch ? `/${pr.target_branch}` : ''}
                  </td>
                  <td style={{ color: sev.text, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatReviewTime(pr.hours, pr.seconds)}
                  </td>
                  <td style={{ color: 'var(--ink-90)', fontWeight: 600, textAlign: 'right' }}>
                    {pr.size !== undefined && pr.size > 0 ? pr.size.toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Weekend Authors Table */}
      {expanded && weekendAuthors.length > 0 && (
        <div style={{ borderTop: `1px solid var(--panel-border)`, padding: '8px 12px' }}>
          <table className="ent-table" style={{ fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('common.author')}</th>
                <th style={{ textAlign: 'right' }}>{t('dora.weekendCommits')}</th>
              </tr>
            </thead>
            <tbody>
              {weekendAuthors.map((a, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--ink-90)', fontWeight: 500 }}>{a.author}</td>
                  <td style={{ color: sev.text, fontWeight: 600, textAlign: 'right' }}>{a.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────────── */

export default function TeamHealthPage() {
  const { t } = useLocale();
  const [data, setData] = useState<SymptomsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [repoId, setRepoId] = useState<string | null>(null);
  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [days, setDays] = useState(90);
  const [teamName, setTeamName] = useState('');
  const [teamNameInput, setTeamNameInput] = useState('');
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('agena_dora_team_name') || '';
    (async () => {
      try {
        const prefs = await loadPrefs();
        setRepos((prefs.repo_mappings || []) as RepoMapping[]);
        const name = saved || (prefs.azure_team as string) || '';
        setTeamName(name);
        setTeamNameInput(name);
      } catch { if (saved) { setTeamName(saved); setTeamNameInput(saved); } }
    })();
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await fetchTeamSymptoms(days, repoId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setLoading(false); }
  }, [days, repoId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveTeamName = () => { setTeamName(teamNameInput); setEditingName(false); localStorage.setItem('agena_dora_team_name', teamNameInput); };
  const summary = data?.summary;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              {editingName ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={teamNameInput} onChange={(e) => setTeamNameInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveTeamName()} placeholder={t('dora.team.teamNamePlaceholder')} autoFocus
                    style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', background: 'transparent', border: 'none', borderBottom: '2px solid var(--acc)', outline: 'none', padding: '2px 0', minWidth: 200 }} />
                  <button onClick={handleSaveTeamName} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, border: 'none', background: 'var(--acc)', color: '#fff', cursor: 'pointer' }}>{t('dora.team.save')}</button>
                </div>
              ) : (
                <h1 onClick={() => setEditingName(true)} style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <NavIcon name="users" size={20} /> {teamName || t('dora.team.title')} <span style={{ color: 'var(--muted)', opacity: 0.6, display: 'inline-flex' }}><NavIcon name="pencil" size={14} /></span>
                </h1>
              )}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('dora.team.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ d: 30, l: t('dora.team.days30') }, { d: 60, l: t('dora.team.days60') }, { d: 90, l: t('dora.team.days90') }].map((o) => (
              <button key={o.d} onClick={() => setDays(o.d)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: days === o.d ? '1px solid var(--acc)' : '1px solid var(--panel-border)', background: days === o.d ? 'var(--acc-soft)' : 'var(--panel-alt)', color: days === o.d ? 'var(--acc)' : 'var(--muted)' }}>{o.l}</button>
            ))}
          </div>
        </div>
        {repos.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setRepoId(null)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: repoId === null ? '1px solid var(--acc)' : '1px solid var(--panel-border)', background: repoId === null ? 'var(--acc-soft)' : 'var(--panel-alt)', color: repoId === null ? 'var(--acc)' : 'var(--muted)' }}>{t('dora.allRepos')}</button>
            {repos.map((r) => (
              <button key={r.id} onClick={() => setRepoId(r.id)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: repoId === r.id ? '1px solid var(--acc)' : '1px solid var(--panel-border)', background: repoId === r.id ? 'var(--acc-soft)' : 'var(--panel-alt)', color: repoId === r.id ? 'var(--acc)' : 'var(--muted)' }}>{r.name}</button>
            ))}
          </div>
        )}
      </div>

      {error && <div style={{ borderRadius: 10, padding: 20, marginBottom: 24, border: '1px solid rgba(207,91,87,0.3)', background: 'rgba(207,91,87,0.06)', color: '#cf5b57', fontSize: 13 }}>{error}</div>}

      {loading && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: 'var(--muted)', fontSize: 14 }}><span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex', marginRight: 8 }}><NavIcon name="clock" size={16} /></span> Loading...</div>}

      {!loading && data && summary && (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
            <div style={{ borderRadius: 10, padding: 20, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 20 }}>
              <HealthRing healthy={summary.healthy_count} warning={summary.warning_count} critical={summary.critical_count} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>{t('dora.team.summaryTitle')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 14px', fontSize: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{t('dora.team.activeSymptoms')}</span>
                  <span style={{ fontWeight: 700, color: summary.active_count > 0 ? '#c98a2b' : '#3f9d6a' }}>{summary.active_count} / {summary.total_symptoms}</span>
                  <span style={{ color: '#cf5b57' }}>{t('dora.team.criticalCount')}</span>
                  <span style={{ fontWeight: 700, color: '#cf5b57' }}>{summary.critical_count}</span>
                  <span style={{ color: '#c98a2b' }}>{t('dora.team.warningCount')}</span>
                  <span style={{ fontWeight: 700, color: '#c98a2b' }}>{summary.warning_count}</span>
                  <span style={{ color: '#3f9d6a' }}>{t('dora.team.healthyCount')}</span>
                  <span style={{ fontWeight: 700, color: '#3f9d6a' }}>{summary.healthy_count}</span>
                </div>
              </div>
            </div>
            <div style={{ borderRadius: 10, padding: 20, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, alignContent: 'center' }}>
              {[{ l: t('dora.team.contributors'), v: summary.contributors, i: 'users' }, { l: t('dora.team.totalCommits'), v: summary.total_commits, i: 'clipboard' }, { l: t('dora.team.totalPRs'), v: summary.total_prs, i: 'flows' }].map((k) => (
                <div key={k.l} style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'center', color: 'var(--muted)' }}><NavIcon name={k.i} size={18} /></div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink-90)', lineHeight: 1 }}>{k.v}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontWeight: 600 }}>{k.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Split: Git | PR */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 16px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--panel-border)' }}>
                <span style={{ display: 'inline-flex', color: '#5b9bd5' }}><NavIcon name="activity" size={16} /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{t('dora.team.gitAnalytics')}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'var(--acc-soft)', color: '#5b9bd5' }}>{data.git_analytics.filter((s) => s.active).length} {t('dora.team.active').toLowerCase()}</span>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>{data.git_analytics.map((s) => <SymptomCard key={s.id} symptom={s} t={t} repos={repos} />)}</div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 16px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--panel-border)' }}>
                <span style={{ display: 'inline-flex', color: '#c98a2b' }}><NavIcon name="trending" size={16} /></span>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{t('dora.team.prDelivery')}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'rgba(201,138,43,0.12)', color: '#c98a2b' }}>{data.pr_delivery.filter((s) => s.active).length} {t('dora.team.active').toLowerCase()}</span>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>{data.pr_delivery.map((s) => <SymptomCard key={s.id} symptom={s} t={t} repos={repos} />)}</div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ marginTop: 28, padding: '12px 18px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border-2)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 12 }}>{t('dora.symptomsCatalog')}</span>
            {(['healthy', 'info', 'warning', 'critical'] as const).map((s) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: sevColors[s].text }} />
                {t(`dora.team.${s}` as Parameters<typeof t>[0])}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{summary.period_days} days</span>
          </div>
        </>
      )}

      {!loading && !data && !error && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 14, borderRadius: 10, border: '1px dashed var(--panel-border)' }}>
          {t('dora.team.noData')}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
