'use client';

/**
 * WorkspaceSprintPicker — inline Azure/Jira sprint cascade, mirroring the
 * global SprintSwitcher (Azure: project→team→sprint, Jira: project→board→
 * sprint) but scoped to a single workspace. On "Apply" it hands the full
 * selection back via onApply so the page can PUT it onto the workspace.
 *
 * Seeded from the workspace's stored context (sprint_provider/project/team/
 * board/path) so reopening restores the exact selection.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Opt = { id: string; name: string; path?: string; is_current?: boolean };
type Provider = 'azure' | 'jira';

export interface WorkspaceSprintInitial {
  provider?: string | null;
  project?: string | null;
  team?: string | null;
  board?: string | null;
  sprintPath?: string | null;
}

export interface WorkspaceSprintPatch {
  sprint_provider: string;
  sprint_path: string;
  sprint_project: string;
  sprint_team: string;
  sprint_board: string;
}

const selStyle = (filled: boolean): React.CSSProperties => ({
  width: '100%', padding: '8px 10px', borderRadius: 8,
  border: `1px solid ${filled ? 'var(--acc)' : 'var(--panel-border-3)'}`,
  background: filled ? 'var(--acc-soft)' : 'var(--surface)',
  color: filled ? 'var(--ink-90)' : 'var(--ink-50)', fontSize: 13, outline: 'none', cursor: 'pointer',
});

function Sel({ label, value, onChange, options, placeholder, loading, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id: string; name: string }[]; placeholder: string; loading?: boolean; disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 4 }}>
        {label}{loading ? ' …' : ''}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || loading} style={{ ...selStyle(!!value), opacity: disabled ? 0.5 : 1 }}>
        <option value=''>{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

export default function WorkspaceSprintPicker({ initial, onApply, saving }: {
  initial: WorkspaceSprintInitial;
  onApply: (patch: WorkspaceSprintPatch) => void | Promise<void>;
  saving?: boolean;
}) {
  const { t } = useLocale();
  const [provider, setProvider] = useState<Provider>((initial.provider === 'jira' ? 'jira' : 'azure'));
  const [jiraConnected, setJiraConnected] = useState(false);

  const [azProjects, setAzProjects] = useState<Opt[]>([]);
  const [azTeams, setAzTeams] = useState<Opt[]>([]);
  const [azSprints, setAzSprints] = useState<Opt[]>([]);
  const [azProject, setAzProject] = useState(initial.provider === 'azure' ? (initial.project || '') : '');
  const [azTeam, setAzTeam] = useState(initial.provider === 'azure' ? (initial.team || '') : '');
  const [azSprint, setAzSprint] = useState(initial.provider === 'azure' ? (initial.sprintPath || '') : '');
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingSprints, setLoadingSprints] = useState(false);

  const [jiraProjects, setJiraProjects] = useState<Opt[]>([]);
  const [jiraBoards, setJiraBoards] = useState<Opt[]>([]);
  const [jiraSprints, setJiraSprints] = useState<Opt[]>([]);
  const [jiraProject, setJiraProject] = useState(initial.provider === 'jira' ? (initial.project || '') : '');
  const [jiraBoard, setJiraBoard] = useState(initial.provider === 'jira' ? (initial.board || '') : '');
  const [jiraSprint, setJiraSprint] = useState(initial.provider === 'jira' ? (initial.sprintPath || '') : '');
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingJiraSprints, setLoadingJiraSprints] = useState(false);

  // Load top-level options + restore the saved cascade.
  useEffect(() => {
    apiFetch<Opt[]>('/tasks/azure/projects').then(setAzProjects).catch(() => {});
    apiFetch<Array<{ provider: string; has_secret?: boolean; base_url?: string | null; username?: string | null }>>('/integrations')
      .then((ints) => {
        const j = ints.find((c) => c.provider === 'jira');
        const connected = Boolean(j && (j.has_secret || (j.base_url || '').trim() || (j.username || '').trim()));
        setJiraConnected(connected);
        if (connected) apiFetch<Opt[]>('/tasks/jira/projects').then(setJiraProjects).catch(() => {});
      }).catch(() => {});

    (async () => {
      if (initial.provider === 'azure' && initial.project) {
        if (initial.team) {
          const tms = await apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(initial.project)).catch(() => [] as Opt[]);
          setAzTeams(tms);
          const sps = await apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(initial.project) + '&team=' + encodeURIComponent(initial.team)).catch(() => [] as Opt[]);
          setAzSprints(sps);
        }
      } else if (initial.provider === 'jira' && initial.project) {
        if (initial.board) {
          const boards = await apiFetch<Opt[]>('/tasks/jira/boards?project_key=' + encodeURIComponent(initial.project)).catch(() => [] as Opt[]);
          setJiraBoards(boards);
          const jsps = await apiFetch<Opt[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(initial.board)).catch(() => [] as Opt[]);
          setJiraSprints(jsps);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAzProject = useCallback((v: string) => {
    setAzProject(v); setAzTeam(''); setAzTeams([]); setAzSprint(''); setAzSprints([]);
    if (!v) return;
    setLoadingTeams(true);
    apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(v)).then(setAzTeams).catch(() => {}).finally(() => setLoadingTeams(false));
  }, []);
  const onAzTeam = useCallback((v: string) => {
    setAzTeam(v); setAzSprint(''); setAzSprints([]);
    if (!v || !azProject) return;
    setLoadingSprints(true);
    apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(azProject) + '&team=' + encodeURIComponent(v))
      .then((sps) => { setAzSprints(sps); const cur = sps.find((s) => s.is_current); if (cur) setAzSprint(cur.path ?? cur.name); })
      .catch(() => {}).finally(() => setLoadingSprints(false));
  }, [azProject]);

  const onJiraProject = useCallback((v: string) => {
    setJiraProject(v); setJiraBoard(''); setJiraBoards([]); setJiraSprint(''); setJiraSprints([]);
    if (!v) return;
    setLoadingBoards(true);
    apiFetch<Opt[]>('/tasks/jira/boards?project_key=' + encodeURIComponent(v)).then(setJiraBoards).catch(() => {}).finally(() => setLoadingBoards(false));
  }, []);
  const onJiraBoard = useCallback((v: string) => {
    setJiraBoard(v); setJiraSprint(''); setJiraSprints([]);
    if (!v) return;
    setLoadingJiraSprints(true);
    apiFetch<Opt[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(v))
      .then((jsps) => { setJiraSprints(jsps); const cur = jsps.find((s) => s.is_current); if (cur) setJiraSprint(cur.path ?? cur.name); })
      .catch(() => {}).finally(() => setLoadingJiraSprints(false));
  }, []);

  const apply = () => {
    if (provider === 'azure') {
      onApply({ sprint_provider: 'azure', sprint_path: azSprint, sprint_project: azProject, sprint_team: azTeam, sprint_board: '' });
    } else {
      onApply({ sprint_provider: 'jira', sprint_path: jiraSprint, sprint_project: jiraProject, sprint_team: '', sprint_board: jiraBoard });
    }
  };

  const canApply = provider === 'azure' ? !!azSprint : !!jiraSprint;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--panel-border-3)' }}>
        {(['azure', 'jira'] as const).map((p) => (
          <button key={p} type='button' onClick={() => setProvider(p)} disabled={p === 'jira' && !jiraConnected}
            style={{
              flex: 1, padding: '7px 8px', borderRadius: 6, border: 'none',
              background: provider === p ? 'var(--acc-soft)' : 'transparent',
              color: provider === p ? 'var(--acc)' : (p === 'jira' && !jiraConnected ? 'var(--ink-25)' : 'var(--muted)'),
              fontSize: 12, fontWeight: 700, cursor: p === 'jira' && !jiraConnected ? 'not-allowed' : 'pointer',
            }}>{p === 'azure' ? 'Azure' : 'Jira'}</button>
        ))}
      </div>

      {provider === 'azure' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <Sel label={t('sprintPicker.azureProject')} value={azProject} onChange={onAzProject} options={azProjects.map((p) => ({ id: p.name, name: p.name }))} placeholder={t('sprintPicker.selectProject')} />
          <Sel label={t('sprintPicker.azureTeam')} value={azTeam} onChange={onAzTeam} options={azTeams.map((tm) => ({ id: tm.name, name: tm.name }))} placeholder={azProject ? t('sprintPicker.selectTeam') : t('sprintPicker.selectProjectFirst')} loading={loadingTeams} disabled={!azProject} />
          <Sel label={t('sprintPicker.azureSprint')} value={azSprint} onChange={setAzSprint} options={azSprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))} placeholder={azTeam ? t('sprintPicker.selectSprint') : t('sprintPicker.selectTeamFirst')} loading={loadingSprints} disabled={!azTeam} />
        </div>
      ) : !jiraConnected ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 4px' }}>{t('sprintPicker.jiraNotConnected')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <Sel label={t('sprintPicker.jiraProject')} value={jiraProject} onChange={onJiraProject} options={jiraProjects.map((p) => ({ id: p.id ?? p.name, name: p.name }))} placeholder={t('sprintPicker.selectProject')} />
          <Sel label={t('sprintPicker.jiraBoard')} value={jiraBoard} onChange={onJiraBoard} options={jiraBoards.map((b) => ({ id: b.id ?? b.name, name: b.name }))} placeholder={jiraProject ? t('sprintPicker.selectBoard') : t('sprintPicker.selectProjectFirst')} loading={loadingBoards} disabled={!jiraProject} />
          <Sel label={t('sprintPicker.jiraSprint')} value={jiraSprint} onChange={setJiraSprint} options={jiraSprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))} placeholder={jiraBoard ? t('sprintPicker.selectSprint') : t('sprintPicker.selectBoardFirst')} loading={loadingJiraSprints} disabled={!jiraBoard} />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type='button' onClick={apply} disabled={!canApply || saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: !canApply || saving ? 'not-allowed' : 'pointer', opacity: !canApply || saving ? 0.5 : 1 }}>
          {saving ? '…' : t('sprintPicker.apply')}
        </button>
      </div>
    </div>
  );
}
