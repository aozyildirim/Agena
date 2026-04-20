'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, loadPrefs, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Opt = { id: string; name: string; path?: string; is_current?: boolean };
type Provider = 'azure' | 'jira';

export const SPRINT_CHANGED_EVENT = 'agena:sprint-changed';

export default function SprintSwitcher() {
  const { t } = useLocale();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('azure');
  const [jiraConnected, setJiraConnected] = useState(false);

  // Azure state
  const [azProjects, setAzProjects] = useState<Opt[]>([]);
  const [azTeams, setAzTeams] = useState<Opt[]>([]);
  const [azSprints, setAzSprints] = useState<Opt[]>([]);
  const [azProject, setAzProject] = useState('');
  const [azTeam, setAzTeam] = useState('');
  const [azSprint, setAzSprint] = useState('');
  const [loadingAzTeams, setLoadingAzTeams] = useState(false);
  const [loadingAzSprints, setLoadingAzSprints] = useState(false);

  // Jira state
  const [jiraProjects, setJiraProjects] = useState<Opt[]>([]);
  const [jiraBoards, setJiraBoards] = useState<Opt[]>([]);
  const [jiraSprints, setJiraSprints] = useState<Opt[]>([]);
  const [jiraProject, setJiraProject] = useState('');
  const [jiraBoard, setJiraBoard] = useState('');
  const [jiraSprint, setJiraSprint] = useState('');
  const [loadingJiraBoards, setLoadingJiraBoards] = useState(false);
  const [loadingJiraSprints, setLoadingJiraSprints] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    apiFetch<Opt[]>('/tasks/azure/projects').then(setAzProjects).catch(() => {});
    apiFetch<Array<{ provider: string; has_secret?: boolean; base_url?: string | null; username?: string | null }>>('/integrations')
      .then((integrations) => {
        const jiraCfg = integrations.find((cfg) => cfg.provider === 'jira');
        const connected = Boolean(jiraCfg && (jiraCfg.has_secret || (jiraCfg.base_url || '').trim() || (jiraCfg.username || '').trim()));
        setJiraConnected(connected);
        if (connected) apiFetch<Opt[]>('/tasks/jira/projects').then(setJiraProjects).catch(() => {});
      })
      .catch(() => {});

    loadPrefs().then(async (prefs) => {
      const p = prefs.azure_project || '';
      const tm = prefs.azure_team || '';
      const s = prefs.azure_sprint_path || '';
      const rawSettings = (prefs.profile_settings || {}) as Record<string, unknown>;
      const jp = typeof rawSettings.jira_project === 'string' ? rawSettings.jira_project : '';
      const jb = typeof rawSettings.jira_board === 'string' ? rawSettings.jira_board : '';
      const js = typeof rawSettings.jira_sprint_id === 'string' ? rawSettings.jira_sprint_id : '';
      const preferred = typeof rawSettings.preferred_sprint_provider === 'string' ? rawSettings.preferred_sprint_provider : '';
      if (preferred === 'jira' || preferred === 'azure') setProvider(preferred as Provider);

      if (p) {
        setAzProject(p);
        if (tm) {
          const tms = await apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(p)).catch(() => [] as Opt[]);
          setAzTeams(tms);
          setAzTeam(tm);
          if (s) {
            const sps = await apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(p) + '&team=' + encodeURIComponent(tm)).catch(() => [] as Opt[]);
            setAzSprints(sps);
            setAzSprint(s);
          }
        }
      }

      if (jp) {
        const jiraProjectList = await apiFetch<Opt[]>('/tasks/jira/projects').catch(() => [] as Opt[]);
        if (jiraProjectList.length) setJiraProjects(jiraProjectList);
        let normalized = jp;
        const byId = jiraProjectList.find((x) => (x.id ?? x.name) === normalized);
        if (!byId) {
          const byName = jiraProjectList.find((x) => x.name === normalized);
          if (byName) normalized = byName.id ?? byName.name;
        }
        setJiraProject(normalized);
        if (jb) {
          const boards = await apiFetch<Opt[]>('/tasks/jira/boards?project_key=' + encodeURIComponent(normalized)).catch(() => [] as Opt[]);
          setJiraBoards(boards);
          setJiraBoard(jb);
          if (js) {
            const jsps = await apiFetch<Opt[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(jb)).catch(() => [] as Opt[]);
            setJiraSprints(jsps);
            setJiraSprint(js);
          }
        }
      }
    }).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const root = rootRef.current;
      if (root && root.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const onAzProjectChange = useCallback((v: string) => {
    setAzProject(v); setAzTeam(''); setAzTeams([]); setAzSprint(''); setAzSprints([]);
    if (!v) return;
    setLoadingAzTeams(true);
    apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(v))
      .then(setAzTeams).catch(() => {}).finally(() => setLoadingAzTeams(false));
  }, []);

  const onAzTeamChange = useCallback((v: string) => {
    setAzTeam(v); setAzSprint(''); setAzSprints([]);
    if (!v || !azProject) return;
    setLoadingAzSprints(true);
    apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(azProject) + '&team=' + encodeURIComponent(v))
      .then((sps) => {
        setAzSprints(sps);
        const current = sps.find((s) => s.is_current);
        if (current) setAzSprint(current.path ?? current.name);
      })
      .catch(() => {}).finally(() => setLoadingAzSprints(false));
  }, [azProject]);

  const onJiraProjectChange = useCallback((v: string) => {
    setJiraProject(v); setJiraBoard(''); setJiraBoards([]); setJiraSprint(''); setJiraSprints([]);
    if (!v) return;
    setLoadingJiraBoards(true);
    apiFetch<Opt[]>('/tasks/jira/boards?project_key=' + encodeURIComponent(v))
      .then(setJiraBoards).catch(() => {}).finally(() => setLoadingJiraBoards(false));
  }, []);

  const onJiraBoardChange = useCallback((v: string) => {
    setJiraBoard(v); setJiraSprint(''); setJiraSprints([]);
    if (!v) return;
    setLoadingJiraSprints(true);
    apiFetch<Opt[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(v))
      .then((jsps) => {
        setJiraSprints(jsps);
        const current = jsps.find((s) => s.is_current);
        if (current) setJiraSprint(current.path ?? current.name);
      })
      .catch(() => {}).finally(() => setLoadingJiraSprints(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const existingRaw = (typeof window !== 'undefined' && localStorage.getItem('agena_profile_settings')) || '{}';
      const existing = JSON.parse(existingRaw) as Record<string, unknown>;
      await savePrefs({
        azure_project: azProject,
        azure_team: azTeam,
        azure_sprint_path: azSprint,
        profile_settings: {
          ...existing,
          jira_project: jiraProject,
          jira_board: jiraBoard,
          jira_sprint_id: jiraSprint,
          preferred_sprint_provider: provider,
        },
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SPRINT_CHANGED_EVENT, {
          detail: { provider, azure: { project: azProject, team: azTeam, sprint: azSprint }, jira: { project: jiraProject, board: jiraBoard, sprint: jiraSprint } },
        }));
      }
      setOpen(false);
    } catch {
      // no-op
    } finally {
      setSaving(false);
    }
  }

  const selAzSprintObj = azSprints.find((s) => (s.path ?? s.name) === azSprint);
  const selJiraSprintObj = jiraSprints.find((s) => (s.path ?? s.name) === jiraSprint);

  const activeLabel = (() => {
    if (provider === 'jira') {
      if (jiraSprint) return selJiraSprintObj?.name || jiraSprint;
      return t('sprintSwitcher.noSprint');
    }
    if (azSprint) return selAzSprintObj?.name || azSprint.split('\\').pop() || azSprint;
    return t('sprintSwitcher.noSprint');
  })();

  const activeColor = provider === 'jira' ? '#a5b4fc' : '#5eead4';
  const activeBg = provider === 'jira' ? 'rgba(99,102,241,0.12)' : 'rgba(13,148,136,0.12)';
  const activeBorder = provider === 'jira' ? 'rgba(99,102,241,0.3)' : 'rgba(13,148,136,0.3)';
  const hasActiveSprint = provider === 'jira' ? Boolean(jiraSprint) : Boolean(azSprint);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('sprintSwitcher.tooltip')}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', height: 32, borderRadius: 8,
          border: `1px solid ${hasActiveSprint ? activeBorder : 'var(--panel-border-3)'}`,
          background: hasActiveSprint ? activeBg : 'transparent',
          color: hasActiveSprint ? activeColor : 'var(--muted)',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
          maxWidth: 220,
        }}
      >
        <span style={{ fontSize: 13 }}>{provider === 'jira' ? '◉' : '◎'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{activeLabel}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>&#9660;</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 40, right: 0, width: 360,
          border: '1px solid var(--border)', background: 'var(--surface)',
          borderRadius: 12, padding: 14, display: 'grid', gap: 12, zIndex: 200,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
              {t('sprintSwitcher.title')}
            </div>
            <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border-3)' }}>
              <TabBtn active={provider === 'azure'} onClick={() => setProvider('azure')} label='Azure' color='#5eead4' />
              <TabBtn active={provider === 'jira'} onClick={() => setProvider('jira')} label='Jira' color='#a5b4fc' disabled={!jiraConnected} />
            </div>
          </div>

          {provider === 'azure' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <CompactSel label={t('profile.azureProject')} value={azProject} onChange={onAzProjectChange}
                options={azProjects.map((p) => ({ id: p.name, name: p.name }))}
                placeholder={t('profile.selectProject')} loading={false} disabled={false} />
              <CompactSel label={t('profile.azureTeam')} value={azTeam} onChange={onAzTeamChange}
                options={azTeams.map((tm) => ({ id: tm.name, name: tm.name }))}
                placeholder={azProject ? t('profile.selectTeam') : t('profile.selectTeamFirst')} loading={loadingAzTeams} disabled={!azProject} />
              <CompactSel label={t('profile.azureSprint')} value={azSprint} onChange={setAzSprint}
                options={azSprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))}
                placeholder={azTeam ? t('profile.selectSprint') : t('profile.selectSprintFirst')} loading={loadingAzSprints} disabled={!azTeam} />
            </div>
          )}

          {provider === 'jira' && (
            <div style={{ display: 'grid', gap: 8 }}>
              {!jiraConnected ? (
                <div style={{ fontSize: 12, color: 'var(--muted)', padding: '12px 8px', textAlign: 'center' }}>
                  {t('sprintSwitcher.jiraNotConnected')}
                </div>
              ) : (
                <>
                  <CompactSel label={t('profile.jiraProject')} value={jiraProject} onChange={onJiraProjectChange}
                    options={jiraProjects.map((p) => ({ id: p.id ?? p.name, name: p.name }))}
                    placeholder={t('profile.selectProject')} loading={false} disabled={false} />
                  <CompactSel label={t('profile.jiraBoard')} value={jiraBoard} onChange={onJiraBoardChange}
                    options={jiraBoards.map((b) => ({ id: b.id ?? b.name, name: b.name }))}
                    placeholder={jiraProject ? t('profile.selectBoard') : t('profile.selectTeamFirst')} loading={loadingJiraBoards} disabled={!jiraProject} />
                  <CompactSel label={t('profile.jiraSprint')} value={jiraSprint} onChange={setJiraSprint}
                    options={jiraSprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))}
                    placeholder={jiraBoard ? t('profile.selectSprint') : t('profile.selectBoardFirst')} loading={loadingJiraSprints} disabled={!jiraBoard} />
                </>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => { setOpen(false); router.push('/dashboard/sprints'); }}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              {t('sprintSwitcher.openBoard')}
            </button>
            <button
              onClick={() => void save()} disabled={saving}
              style={{
                padding: '8px 14px', borderRadius: 8, border: 'none',
                background: savedFlash ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
                color: '#fff', fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? t('profile.saving') : savedFlash ? t('profile.saved') : t('sprintSwitcher.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label, color, disabled }: { active: boolean; onClick: () => void; label: string; color: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none',
        background: active ? `${color}22` : 'transparent',
        color: active ? color : disabled ? 'var(--ink-25)' : 'var(--muted)',
        fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function CompactSel({ label, value, onChange, options, placeholder, loading, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id: string; name: string }[]; placeholder: string; loading: boolean; disabled: boolean;
}) {
  const { t } = useLocale();
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 4 }}>
        {label} {loading ? <span style={{ color: 'var(--ink-25)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t('profile.loading')}</span> : null}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || loading}
        style={{
          width: '100%', padding: '7px 9px', borderRadius: 8,
          border: '1px solid ' + (value ? 'rgba(139,92,246,0.4)' : 'var(--panel-border-3)'),
          background: value ? 'rgba(139,92,246,0.08)' : 'var(--glass)',
          color: value ? 'var(--ink)' : 'var(--ink-35)', fontSize: 12, outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        }}>
        <option value='' style={{ background: 'var(--surface)' }}>{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id} style={{ background: 'var(--surface)' }}>{o.name}</option>)}
      </select>
    </div>
  );
}
