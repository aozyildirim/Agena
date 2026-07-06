'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, loadPrefs, savePrefs, type AzureMember, type RepoMapping } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import { useRole, canAccess } from '@/lib/rbac';
import NavIcon from '@/components/NavIcon';
type WorkItem = {
  id: string;
  title: string;
  state: string;
  description?: string;
  acceptance_criteria?: string;
  repro_steps?: string;
};

const STATE_COLORS: Record<string, string> = {
  'Backlog': '#94a3b8', 'To Do': '#c98a2b', 'In Progress': '#5b9bd5',
  'Code Review': '#5b9bd5', 'QA To Do': '#5b9bd5', 'Done': '#3f9d6a',
  'Closed': '#3f9d6a', 'Resolved': '#3f9d6a', 'Active': '#5b9bd5', 'New': '#c98a2b',
};
const sc = (s: string) => STATE_COLORS[s] ?? '#5b9bd5';

const LS_PROJECT  = 'agena_sprint_project';
const LS_TEAM     = 'agena_sprint_team';
const LS_SPRINT   = 'agena_sprint_path';
const LS_PROVIDER = 'agena_sprint_provider';
const LS_JIRA_PROJECT = 'agena_jira_project';
const LS_JIRA_BOARD = 'agena_jira_board';
const LS_JIRA_SPRINT = 'agena_jira_sprint';

const GRADIENTS = [
  ['#5b9bd5','#5b9bd5'], ['#5b9bd5','#5b9bd5'], ['#5b9bd5','#5b9bd5'],
  ['#5b9bd5','#5b9bd5'], ['#5b9bd5','#5b9bd5'], ['#5b9bd5','#5b9bd5'],
];
const grad = (name: string) => {
  void GRADIENTS[name.charCodeAt(0) % GRADIENTS.length];
  return 'var(--acc)';
};
const initials = (name: string) =>
  name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2);

export default function TeamPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<'sprint' | 'org'>('sprint');
  const [provider,   setProvider]   = useState<'azure' | 'jira' | 'youtrack'>('azure');
  const [hasAzure,   setHasAzure]   = useState(false);
  const [hasJira,    setHasJira]    = useState(false);
  const [hasYoutrack, setHasYoutrack] = useState(false);
  const [project,    setProject]    = useState('');
  const [team,       setTeam]       = useState('');
  const [sprintPath, setSprintPath] = useState('');
  const [providerDefaults, setProviderDefaults] = useState<{
    azure: { project: string; team: string; sprint: string };
    jira: { project: string; team: string; sprint: string };
    youtrack: { project: string; team: string; sprint: string };
  }>({
    azure: { project: '', team: '', sprint: '' },
    jira: { project: '', team: '', sprint: '' },
    youtrack: { project: '', team: '', sprint: '' },
  });

  // Tüm Azure üyeleri (arama için)
  const [allMembers, setAllMembers] = useState<AzureMember[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  // Benim seçtiğim takım
  const [myTeam, setMyTeam] = useState<AzureMember[]>([]);
  const [myTeamBySource, setMyTeamBySource] = useState<Record<'azure' | 'jira' | 'youtrack', AzureMember[]>>({ azure: [], jira: [], youtrack: [] });

  // Arama & panel
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const membersReqRef = React.useRef(0);
  const sprintResolveReqRef = React.useRef(0);

  // İş detayları
  const [workItems,    setWorkItems]    = useState<Record<string, WorkItem[]>>({});
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<AzureMember | null>(null);

  // Import state
  const [azureBaseUrl, setAzureBaseUrl] = useState('');
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [importedIds, setImportedIds] = useState<Record<string, number>>({});
  const [importingId, setImportingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  // Repo picker modal — same flow as /dashboard/sprints so an import
  // from this page wires up the same repo mapping context (azure repo
  // url, playbook, github fullname) the AI agents need to actually
  // edit code. Without this the imported task is a "no-repo" orphan
  // and the photo-bearing description gets dropped on the floor.
  const [repoMappings, setRepoMappings] = useState<RepoMapping[]>([]);
  const [importPickerItem, setImportPickerItem] = useState<WorkItem | null>(null);
  const [importPickerRepoId, setImportPickerRepoId] = useState<string>('');
  const [importAiFill, setImportAiFill] = useState<boolean>(false);

  useEffect(() => {
    const init = async () => {
      try {
        const [prefs, integrations] = await Promise.all([
          loadPrefs(),
          apiFetch<Array<{ provider: string; has_secret?: boolean; base_url?: string | null; username?: string | null }>>('/integrations'),
        ]);

        const azureCfg = integrations.find((c) => c.provider === 'azure');
        const jiraCfg = integrations.find((c) => c.provider === 'jira');
        const youtrackCfg = integrations.find((c) => c.provider === 'youtrack');
        const azureConnected = Boolean(azureCfg && (azureCfg.has_secret || (azureCfg.base_url || '').trim().length > 0));
        const jiraConnected = Boolean(jiraCfg && (jiraCfg.has_secret || (jiraCfg.base_url || '').trim().length > 0 || (jiraCfg.username || '').trim().length > 0));
        const youtrackConnected = Boolean(youtrackCfg && (youtrackCfg.has_secret || (youtrackCfg.base_url || '').trim().length > 0));
        setHasAzure(azureConnected);
        setHasJira(jiraConnected);
        setHasYoutrack(youtrackConnected);
        setAzureBaseUrl((azureCfg?.base_url || '').trim().replace(/\/$/, ''));
        setJiraBaseUrl((jiraCfg?.base_url || '').trim().replace(/\/$/, ''));

        const rawSettings = (prefs.profile_settings || {}) as Record<string, unknown>;
        const jiraProject = typeof rawSettings.jira_project === 'string' ? rawSettings.jira_project : '';
        const jiraBoard = typeof rawSettings.jira_board === 'string' ? rawSettings.jira_board : '';
        const jiraSprint = typeof rawSettings.jira_sprint_id === 'string' ? rawSettings.jira_sprint_id : '';
        const ytProject = typeof rawSettings.youtrack_project === 'string' ? rawSettings.youtrack_project : '';
        const ytBoard = typeof rawSettings.youtrack_board === 'string' ? rawSettings.youtrack_board : '';
        const ytSprint = typeof rawSettings.youtrack_sprint_id === 'string' ? rawSettings.youtrack_sprint_id : '';
        const azureProject = prefs.azure_project || '';
        const azureTeam = prefs.azure_team || '';
        const azureSprint = prefs.azure_sprint_path || '';
        const jiraProjectValue = jiraProject || '';
        const jiraBoardValue = jiraBoard || '';
        const jiraSprintValue = jiraSprint || '';
        const hasAzureProfileSelection = Boolean(azureProject || azureTeam || azureSprint);
        const hasJiraProfileSelection = Boolean(jiraProjectValue || jiraBoardValue || jiraSprintValue);
        const hasYoutrackProfileSelection = Boolean(ytProject || ytBoard || ytSprint);
        const selectedProvider: 'azure' | 'jira' | 'youtrack' =
          (azureConnected && hasAzureProfileSelection) ? 'azure' :
          (jiraConnected && hasJiraProfileSelection) ? 'jira' :
          (youtrackConnected && hasYoutrackProfileSelection) ? 'youtrack' :
          (azureConnected ? 'azure' : jiraConnected ? 'jira' : youtrackConnected ? 'youtrack' : 'azure');
        setProvider(selectedProvider);
        setProviderDefaults({
          azure: { project: azureProject, team: azureTeam, sprint: azureSprint },
          jira: { project: jiraProjectValue, team: jiraBoardValue, sprint: jiraSprintValue },
          youtrack: { project: ytProject, team: ytBoard, sprint: ytSprint },
        });
        const bySourceRaw = prefs.my_team_by_source;
        const bySource: Record<'azure' | 'jira' | 'youtrack', AzureMember[]> = {
          azure: (bySourceRaw && Array.isArray(bySourceRaw.azure)) ? bySourceRaw.azure : (prefs.my_team || []),
          jira: (bySourceRaw && Array.isArray(bySourceRaw.jira)) ? bySourceRaw.jira : (Array.isArray(rawSettings.my_team_jira) ? rawSettings.my_team_jira as AzureMember[] : []),
          youtrack: (bySourceRaw && Array.isArray((bySourceRaw as Record<string, AzureMember[]>).youtrack)) ? (bySourceRaw as Record<string, AzureMember[]>).youtrack : [],
        };
        setMyTeamBySource(bySource);

        if (selectedProvider === 'jira') {
          setProject(jiraProjectValue);
          setTeam(jiraBoardValue);
          setSprintPath(jiraSprintValue);
          setMyTeam(bySource.jira || []);
        } else if (selectedProvider === 'youtrack') {
          setProject(ytProject);
          setTeam(ytBoard);
          setSprintPath(ytSprint);
          setMyTeam(bySource.youtrack || []);
        } else {
          setProject(azureProject);
          setTeam(azureTeam);
          setSprintPath(azureSprint);
          setMyTeam(bySource.azure || []);
        }

        // Repo mappings — same lookup pattern as /dashboard/sprints.
        // Prefer the canonical /repo-mappings table; fall back to the
        // user-pref blob for orgs that haven't migrated yet.
        try {
          type ServerMapping = {
            id: number; name?: string; provider: string; owner: string;
            repo_name: string; base_branch?: string;
            local_repo_path?: string | null; playbook?: string | null;
          };
          const rows = await apiFetch<ServerMapping[]>('/repo-mappings');
          if (Array.isArray(rows) && rows.length > 0) {
            const mapped: RepoMapping[] = rows.map((r) => {
              const prov: 'azure' | 'github' = r.provider === 'github' ? 'github' : 'azure';
              if (prov === 'github') {
                return {
                  id: String(r.id),
                  name: r.name || `${r.owner}/${r.repo_name}`,
                  local_path: r.local_repo_path || '',
                  provider: prov,
                  github_owner: r.owner,
                  github_repo: r.repo_name,
                  github_repo_full_name: `${r.owner}/${r.repo_name}`,
                  default_branch: r.base_branch || 'main',
                  repo_playbook: r.playbook || '',
                };
              }
              return {
                id: String(r.id),
                name: r.name || r.repo_name,
                local_path: r.local_repo_path || '',
                provider: prov,
                azure_project: r.owner,
                azure_repo_name: r.repo_name,
                default_branch: r.base_branch || 'main',
                repo_playbook: r.playbook || '',
              };
            });
            setRepoMappings(mapped);
          } else if (prefs.repo_mappings?.length) {
            setRepoMappings(prefs.repo_mappings);
          }
        } catch {
          if (prefs.repo_mappings?.length) setRepoMappings(prefs.repo_mappings);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.toLowerCase().includes('invalid token')) return;
        const lsProv = localStorage.getItem(LS_PROVIDER);
        const preferred: 'azure' | 'jira' | 'youtrack' = lsProv === 'jira' ? 'jira' : lsProv === 'youtrack' ? 'youtrack' : 'azure';
        setProvider(preferred);
        setMyTeamBySource({ azure: [], jira: [], youtrack: [] });
        if (preferred === 'jira') {
          setProject(localStorage.getItem(LS_JIRA_PROJECT) || '');
          setTeam(localStorage.getItem(LS_JIRA_BOARD) || '');
          setSprintPath(localStorage.getItem(LS_JIRA_SPRINT) || '');
          setMyTeam([]);
        } else {
          setProject(localStorage.getItem(LS_PROJECT) || '');
          setTeam(localStorage.getItem(LS_TEAM) || '');
          setSprintPath(localStorage.getItem(LS_SPRINT) || '');
          setMyTeam([]);
        }
      }
    };
    void init();
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_PROVIDER, provider);
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // Import helper stores origin as a title prefix ("[Azure #12345] ...").
        // Tasks created via direct POST /tasks are source='internal', so filter
        // on the prefix via q= instead of source= to catch all imported items.
        const prefix = provider === 'jira' ? '[Jira #' : provider === 'youtrack' ? '[YouTrack #' : '[Azure #';
        type SearchRes = { items: Array<{ id: number; title: string }> };
        const res = await apiFetch<SearchRes>(
          '/tasks/search?q=' + encodeURIComponent(prefix) + '&page_size=100',
        );
        if (cancelled) return;
        const map: Record<string, number> = {};
        const re = /^\[(Azure|Jira|YouTrack)\s+#([^\]]+)\]/i;
        for (const t of res.items) {
          const m = t.title.match(re);
          if (m) map[m[2].trim()] = t.id;
        }
        setImportedIds(map);
      } catch {
        // silent — keep whatever state we have
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [provider]);

  useEffect(() => {
    const reqId = ++sprintResolveReqRef.current;
    const run = async () => {
      try {
        if (provider !== 'azure') {
          if (!team) return;
          type JiraSprint = { id?: string; name: string; path?: string; is_current?: boolean };
          const sprints = await apiFetch<JiraSprint[]>('/tasks/' + provider + '/sprints?board_id=' + encodeURIComponent(team));
          if (reqId !== sprintResolveReqRef.current) return;
          const current = sprints.find((s) => s.is_current) || sprints[0];
          if (!current) return;
          const next = current.id ?? current.path ?? current.name;
          if (next && next !== sprintPath) setSprintPath(next);
          return;
        }
        if (!project || !team) return;
        type AzureSprint = { name: string; path?: string; is_current?: boolean };
        const sprints = await apiFetch<AzureSprint[]>(
          '/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team),
        );
        if (reqId !== sprintResolveReqRef.current) return;
        const current = sprints.find((s) => s.is_current) || sprints[0];
        if (!current) return;
        const next = current.path ?? current.name;
        if (next && next !== sprintPath) setSprintPath(next);
      } catch {
        // silent fallback: keep current sprintPath from profile
      }
    };
    void run();
  }, [provider, project, team]);

  useEffect(() => {
    const reqId = ++membersReqRef.current;
    setErr('');
    setExpanded(null);
    setWorkItems({});
    setLoadingAll(true);
    const run = async () => {
      try {
        if (provider !== 'azure') {
          if (!team || !sprintPath) {
            if (reqId !== membersReqRef.current) return;
            setAllMembers([]);
            return;
          }
          const members = await apiFetch<AzureMember[]>(
            '/tasks/' + provider + '/members?board_id=' + encodeURIComponent(team) + '&sprint_id=' + encodeURIComponent(sprintPath),
          );
          if (reqId !== membersReqRef.current) return;
          setAllMembers(members);
          return;
        }
        if (!project) {
          if (reqId !== membersReqRef.current) return;
          setAllMembers([]);
          return;
        }
        const members = await apiFetch<AzureMember[]>('/tasks/azure/members');
        if (reqId !== membersReqRef.current) return;
        setAllMembers(members);
      } catch (e: unknown) {
        if (reqId !== membersReqRef.current) return;
        setErr(e instanceof Error ? e.message : t('team.membersError'));
      } finally {
        if (reqId !== membersReqRef.current) return;
        setLoadingAll(false);
      }
    };
    void run();
  }, [provider, project, team, sprintPath, showPicker, t]);

  // Takıma ekle / çıkar — DB'ye de kaydet
  function toggleMember(m: AzureMember) {
    const exists = myTeam.some((x) => x.id === m.id);

    // Removing — show confirm modal
    if (exists) {
      setConfirmRemove(m);
      return;
    }

    // Adding
    setMyTeam((prev) => {
      const next = [...prev, m];
      setMyTeamBySource((curr) => ({ ...curr, [provider]: next }));
      void savePrefs({ my_team: next, my_team_source: provider });
      return next;
    });
  }

  function doRemoveMember(m: AzureMember) {
    setConfirmRemove(null);
    setMyTeam((prev) => {
      const next = prev.filter((x) => x.id !== m.id);
      setMyTeamBySource((curr) => ({ ...curr, [provider]: next }));
      void savePrefs({ my_team: next, my_team_source: provider });
      if (m.uniqueName) {
        void apiFetch('/org/remove-by-email', {
          method: 'POST',
          body: JSON.stringify({ email: m.uniqueName }),
        }).catch(() => {});
      }
      return next;
    });
  }

  // Arama filtresi
  const filtered = useMemo(() =>
    allMembers.filter((m) =>
      m.displayName.toLowerCase().includes(search.toLowerCase()) ||
      m.uniqueName.toLowerCase().includes(search.toLowerCase())
    ), [allMembers, search]);

  // Azure/Jira deep-link (work item detay sayfası)
  function workItemUrl(item: WorkItem): string {
    if (provider === 'jira') {
      return jiraBaseUrl ? `${jiraBaseUrl}/browse/${encodeURIComponent(item.id)}` : '';
    }
    if (!azureBaseUrl || !project) return '';
    return `${azureBaseUrl}/${encodeURIComponent(project)}/_workitems/edit/${encodeURIComponent(item.id)}`;
  }

  function requestImportSingleItem(item: WorkItem) {
    if (importedIds[item.id]) {
      setToast({ msg: t('sprints.alreadyImported'), kind: 'ok' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    if (repoMappings.length === 0) {
      setToast({
        msg: t('sprints.noRepoMapping' as TranslationKey) || 'Henüz repo eşleşmesi yok — Mappings sayfasından ekle',
        kind: 'err',
      });
      setTimeout(() => setToast(null), 3500);
      return;
    }
    if (!importPickerRepoId && repoMappings[0]) {
      setImportPickerRepoId(String(repoMappings[0].id));
    }
    setImportPickerItem(item);
  }

  async function importSingleItem(item: WorkItem, mapping: RepoMapping | undefined) {
    if (importedIds[item.id]) {
      setToast({ msg: t('sprints.alreadyImported'), kind: 'ok' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    if (!mapping?.id) {
      setToast({
        msg: t('sprints.noRepoMapping' as TranslationKey) || 'Önce bir repo seç',
        kind: 'err',
      });
      setTimeout(() => setToast(null), 2800);
      return;
    }
    setImportingId(item.id);
    try {
      // Preserve the original HTML description so embedded screenshots
      // (Azure <img> tags pointing at /_apis/wit/attachments/...) make
      // it through to the AI agent — the orchestration layer parses
      // <img> tags out of description on its end.
      const desc = String(item.description || '').trim();

      // Pull discussion comments — same logic as /dashboard/sprints
      // so the AI sees clarifications + acceptance-criteria tweaks
      // posted after the original ticket body. Azure-only for now.
      let commentsBlock = '';
      if (provider === 'azure' && project) {
        try {
          type AzureComment = { id: number; text: string; created_by: string; created_at: string };
          const params = new URLSearchParams({ project });
          const comments = await apiFetch<AzureComment[]>(
            `/tasks/azure/workitems/${item.id}/comments?${params}`,
          );
          if (Array.isArray(comments) && comments.length) {
            const ordered = [...comments].reverse();
            const lines = ordered.map((c, i) => {
              const text = String(c.text || '')
                .replace(/<\/?[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
              const who = c.created_by || 'unknown';
              const when = c.created_at ? c.created_at.slice(0, 19).replace('T', ' ') : '';
              return `### Comment ${i + 1} — ${who}${when ? ` (${when})` : ''}\n${text}`;
            }).filter((s) => s.length > 0);
            if (lines.length) {
              commentsBlock = `\n\n---\n## Discussion (${lines.length} comment${lines.length === 1 ? '' : 's'})\n${lines.join('\n\n')}`;
            }
          }
        } catch { /* non-fatal */ }
      }

      const azureRepoUrl =
        mapping.provider === 'azure' && mapping.azure_project && mapping.azure_repo_name && azureBaseUrl
          ? `${azureBaseUrl}/${encodeURIComponent(mapping.azure_project)}/_git/${encodeURIComponent(mapping.azure_repo_name)}`
          : '';
      const ctxParts = [
        `External Source: ${provider === 'youtrack' ? `YouTrack #${item.id}` : provider === 'jira' ? `Jira #${item.id}` : `Azure #${item.id}`}`,
        'Prompt Instruction: Read any images in the task description and include their context in your analysis.',
        project ? `Project: ${project}` : '',
        team ? `Team: ${team}` : '',
        sprintPath ? `Sprint: ${sprintPath}` : '',
        workItemUrl(item) ? `External URL: ${workItemUrl(item)}` : '',
        azureRepoUrl ? `Azure Repo: ${azureRepoUrl}` : '',
        mapping.name ? `Local Repo Mapping: ${mapping.name}` : '',
        mapping.local_path ? `Local Repo Path: ${mapping.local_path}` : '',
        mapping.repo_playbook ? `Repo Playbook: ${mapping.repo_playbook.replace(/\n+/g, ' ').trim()}` : '',
        mapping.github_repo_full_name ? `GitHub Repo: ${mapping.github_repo_full_name}` : '',
      ].filter(Boolean);
      const fullTitle = `[${provider === 'youtrack' ? 'YouTrack' : provider === 'jira' ? 'Jira' : 'Azure'} #${item.id}] ${item.title}`;
      const fullDescription = `${desc || item.title}${commentsBlock}\n\n---\n${ctxParts.join('\n')}`;

      type AiFill = { story_context: string; acceptance_criteria: string; edge_cases: string };
      let aiFields: Partial<AiFill> = {};
      if (importAiFill) {
        try {
          aiFields = await apiFetch<AiFill>('/tasks/ai-fill', {
            method: 'POST',
            body: JSON.stringify({ title: fullTitle, description: fullDescription }),
          });
        } catch { /* non-fatal — task still gets created without AI fields */ }
      }

      type TaskRec = { id: number };
      const created = await apiFetch<TaskRec>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: fullTitle,
          description: fullDescription,
          source: provider,
          external_id: String(item.id),
          ...(Number(mapping.id) ? { repo_mapping_ids: [Number(mapping.id)] } : {}),
          ...(aiFields.story_context ? { story_context: aiFields.story_context } : {}),
          ...(aiFields.acceptance_criteria ? { acceptance_criteria: aiFields.acceptance_criteria } : {}),
          ...(aiFields.edge_cases ? { edge_cases: aiFields.edge_cases } : {}),
        }),
      });
      setImportedIds((prev) => ({ ...prev, [item.id]: created.id }));
      setToast({ msg: t('sprints.importedSingle'), kind: 'ok' });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : t('sprints.importFailed'), kind: 'err' });
    } finally {
      setImportingId(null);
      setTimeout(() => setToast(null), 2800);
    }
  }

  // İş detayı aç/kapat
  async function loadWorkItems(member: AzureMember) {
    if (expanded === member.id) { setExpanded(null); return; }
    setExpanded(member.id);
    if (workItems[member.id] !== undefined || !sprintPath) return;
    setLoadingItems(member.id);
    try {
      const items = provider !== 'azure'
        ? await apiFetch<WorkItem[]>(
            '/tasks/' + provider + '/member/workitems' +
            '?board_id=' + encodeURIComponent(team) +
            '&sprint_id=' + encodeURIComponent(sprintPath) +
            '&assigned_to=' + encodeURIComponent(member.uniqueName),
          )
        : await apiFetch<WorkItem[]>(
            '/tasks/azure/member/workitems' +
            '?project=' + encodeURIComponent(project) +
            '&team=' + encodeURIComponent(team) +
            '&sprint_path=' + encodeURIComponent(sprintPath) +
            '&assigned_to=' + encodeURIComponent(member.uniqueName),
          );
      setWorkItems((prev) => ({ ...prev, [member.id]: items }));
    } catch {
      setWorkItems((prev) => ({ ...prev, [member.id]: [] }));
    } finally {
      setLoadingItems(null);
    }
  }

  const hasConfig = provider !== 'azure' ? !!(team && sprintPath) : !!(project && team && sprintPath);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="section-label">{t('team.section')}</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
            {t('team.title')}
          </h1>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {/* Main tabs: Sprint Team vs Organization */}
            <button onClick={() => setTab('sprint')}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: tab === 'sprint' ? '1px solid var(--acc)' : '1px solid var(--panel-border-3)',
                background: tab === 'sprint' ? 'var(--acc-soft)' : 'var(--panel-alt)',
                color: tab === 'sprint' ? 'var(--acc)' : 'var(--ink-58)',
              }}>
              {t('team.sprintLabel')}
            </button>
            <button onClick={() => setTab('org')}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: tab === 'org' ? '1px solid var(--acc)' : '1px solid var(--panel-border-3)',
                background: tab === 'org' ? 'var(--acc-soft)' : 'var(--panel-alt)',
                color: tab === 'org' ? 'var(--acc)' : 'var(--ink-58)',
              }}>
              {t('team.tabOrg')}
            </button>

            {tab === 'sprint' && <>
            <div style={{ width: 1, background: 'var(--panel-border)', margin: '0 4px' }} />
            {(hasAzure || !hasJira) && (
              <button
                onClick={() => {
                  setProvider('azure');
                  setProject(providerDefaults.azure.project);
                  setTeam(providerDefaults.azure.team);
                  setSprintPath(providerDefaults.azure.sprint);
                  setMyTeam(myTeamBySource.azure || []);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: provider === 'azure' ? '1px solid var(--acc)' : '1px solid var(--panel-border-3)',
                  background: provider === 'azure' ? 'var(--acc-soft)' : 'var(--panel-alt)',
                  color: provider === 'azure' ? 'var(--acc)' : 'var(--ink-58)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('team.providerAzure')}
              </button>
            )}
            {(hasJira || !hasAzure) && (
              <button
                onClick={() => {
                  setProvider('jira');
                  setProject(providerDefaults.jira.project);
                  setTeam(providerDefaults.jira.team);
                  setSprintPath(providerDefaults.jira.sprint);
                  setMyTeam(myTeamBySource.jira || []);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: provider === 'jira' ? '1px solid var(--acc)' : '1px solid var(--panel-border-3)',
                  background: provider === 'jira' ? 'var(--acc-soft)' : 'var(--panel-alt)',
                  color: provider === 'jira' ? 'var(--acc)' : 'var(--ink-58)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('team.providerJira')}
              </button>
            )}
            {hasYoutrack && (
              <button
                onClick={() => {
                  setProvider('youtrack');
                  setProject(providerDefaults.youtrack.project);
                  setTeam(providerDefaults.youtrack.team);
                  setSprintPath(providerDefaults.youtrack.sprint);
                  setMyTeam(myTeamBySource.youtrack || []);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: provider === 'youtrack' ? '1px solid var(--acc)' : '1px solid var(--panel-border-3)',
                  background: provider === 'youtrack' ? 'var(--acc-soft)' : 'var(--panel-alt)',
                  color: provider === 'youtrack' ? 'var(--acc)' : 'var(--ink-58)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('team.providerYoutrack')}
              </button>
            )}
            </>}
          </div>
          <p style={{ color: 'var(--ink-35)', fontSize: 14, margin: 0 }}>
            {tab === 'org'
              ? t('team.orgDesc')
              : myTeam.length > 0
                ? myTeam.length + ' · ' + (sprintPath ? t('team.sprintLabel') : t('team.noConfig'))
                : t('team.addEdit')}
          </p>
        </div>
        {tab === 'sprint' && hasConfig && (
          <button onClick={() => setShowPicker(true)}
            style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 10, border: '1px solid var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc)', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <NavIcon name="plus" size={16} /> {t('team.addEdit')}
          </button>
        )}
      </div>

      {/* Organization tab */}
      {tab === 'org' && <OrgMembersPanel t={t} />}

      {/* Sprint tab content */}
      {tab === 'sprint' && !hasConfig && (
        <div style={{ padding: '20px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, color: '#c98a2b', fontSize: 14 }}>
              {provider !== 'azure' ? t('team.noConfigJira') : t('team.noConfig')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 4 }}>
              {provider !== 'azure' ? t('team.noConfigDescJira') : t('team.noConfigDesc')}
            </div>
          </div>
          <a href="/dashboard/profile" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-78)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            {t('team.profile')}
          </a>
        </div>
      )}

      {tab === 'sprint' && err && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', color: '#cf5b57', fontSize: 13 }}>{err}</div>
      )}

      {toast && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: 24,
          transform: 'translateX(-50%)',
          zIndex: 9999,
          minWidth: 280,
          maxWidth: 480,
          padding: '12px 20px',
          borderRadius: 8,
          background: 'var(--surface)',
          border: '1px solid ' + (toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57'),
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          color: toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57',
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'center',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Benim takımım — kart listesi */}
      {tab === 'sprint' && myTeam.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {myTeam.map((member) => {
            const isExpanded = expanded === member.id;
            const items = workItems[member.id];
            const isLoadingItems = loadingItems === member.id;
            return (
              <div key={member.id} style={{ borderRadius: 10, border: '1px solid ' + (isExpanded ? 'var(--acc)' : 'var(--panel-border)'), background: isExpanded ? 'var(--acc-soft)' : 'var(--panel)', overflow: 'hidden', transition: 'border-color 0.2s' }}>
                <button onClick={() => void loadWorkItems(member)}
                  style={{ width: '100%', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: grad(member.displayName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                    {initials(member.displayName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14 }}>{member.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-30)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.uniqueName}</div>
                  </div>
                  {sprintPath && items !== undefined && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: items.length > 0 ? 'var(--acc-soft)' : 'var(--panel-alt)', border: '1px solid ' + (items.length > 0 ? 'var(--acc)' : 'var(--panel-border-2)'), color: items.length > 0 ? 'var(--acc)' : 'var(--ink-30)' }}>
                      {items.length} {t('team.itemsShort')}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleMember(member);
                    }}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px 9px',
                      borderRadius: 6,
                      border: '1px solid #cf5b57',
                      background: 'transparent',
                      color: '#cf5b57',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {t('team.remove')}
                  </button>
                  {sprintPath && (
                    <span style={{ fontSize: 16, color: 'var(--ink-25)', transform: isExpanded ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.2s', display: 'inline-flex' }}><NavIcon name="chevron-right" size={16} /></span>
                  )}
                </button>

                {isExpanded && sprintPath && (
                  <div style={{ borderTop: '1px solid var(--panel-alt)', padding: '10px 20px 14px' }}>
                    {isLoadingItems ? (
                      <div style={{ display: 'grid', gap: 6 }}><Skel /><Skel /><Skel opacity={0.4} /></div>
                    ) : !items || items.length === 0 ? (
                      <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--ink-25)', fontSize: 13 }}>{t('team.noItems')}</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {items.map((item) => {
                          const url = workItemUrl(item);
                          const isImported = Boolean(importedIds[item.id]);
                          const isImporting = importingId === item.id;
                          return (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border-2)' }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(item.state), flexShrink: 0 }} />
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={t('team.openExternal')}
                                  style={{ flex: 1, fontSize: 13, color: 'var(--ink-78)', textDecoration: 'none', cursor: 'pointer' }}
                                  onMouseEnter={(e) => { (e.currentTarget.style.color = 'var(--acc)'); (e.currentTarget.style.textDecoration = 'underline'); }}
                                  onMouseLeave={(e) => { (e.currentTarget.style.color = 'var(--ink-78)'); (e.currentTarget.style.textDecoration = 'none'); }}
                                >
                                  {item.title}
                                </a>
                              ) : (
                                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-78)' }}>{item.title}</span>
                              )}
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: sc(item.state) + '18', border: '1px solid ' + sc(item.state) + '35', color: sc(item.state), whiteSpace: 'nowrap' }}>{item.state}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); requestImportSingleItem(item); }}
                                disabled={isImporting || isImported}
                                title={isImported ? t('sprints.alreadyImported') : t('team.importItem')}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '3px 9px',
                                  borderRadius: 999,
                                  border: '1px solid ' + (isImported ? '#3f9d6a' : 'var(--acc)'),
                                  background: isImported ? 'transparent' : 'var(--acc-soft)',
                                  color: isImported ? '#3f9d6a' : 'var(--acc)',
                                  cursor: isImporting || isImported ? 'default' : 'pointer',
                                  opacity: isImporting ? 0.6 : 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {isImporting ? '…' : isImported ? '✓ ' + t('team.imported') : '+ ' + t('team.import')}
                              </button>
                              <span style={{ fontSize: 10, color: 'var(--ink-25)', fontFamily: 'monospace' }}>#{item.id}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : hasConfig && !loadingAll ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ opacity: 0.25, marginBottom: 16, display: 'flex', justifyContent: 'center', color: 'var(--ink-50)' }}><NavIcon name="users" size={48} /></div>
          <div style={{ color: 'var(--ink-25)', fontSize: 14, marginBottom: 20 }}>{t('team.noMembers')}</div>
          <button onClick={() => setShowPicker(true)}
            style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t('team.addMember')}
          </button>
        </div>
      ) : null}

      {/* Picker Modal */}
      {/* Remove confirmation modal */}
      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setConfirmRemove(null)}>
          <div style={{ width: 'min(400px, 100%)', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--surface)', padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.25)' }}
            onClick={(e) => e.stopPropagation()}>
            {/* Icon */}
            <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cf5b57', margin: '0 auto 16px' }}>
              <NavIcon name="alert" size={24} />
            </div>
            {/* Title */}
            <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 8 }}>
              {t('team.removeTitle')}
            </div>
            {/* Description */}
            <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-35)', lineHeight: 1.5, marginBottom: 20 }}>
              <strong style={{ color: 'var(--ink-78)' }}>{confirmRemove.displayName}</strong>
              {' '}{t('team.removeDesc')}
            </div>
            {/* Member preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--panel-border)', marginBottom: 20 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: grad(confirmRemove.displayName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                {initials(confirmRemove.displayName)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>{confirmRemove.displayName}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{confirmRemove.uniqueName}</div>
              </div>
            </div>
            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmRemove(null)}
                style={{ flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                {t('team.removeCancel')}
              </button>
              <button onClick={() => doRemoveMember(confirmRemove)}
                style={{ flex: 1, padding: '11px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#cf5b57', border: 'none', color: '#fff' }}>
                {t('team.removeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowPicker(false)} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 480, borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.25)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 2, background: 'var(--panel-border)', flexShrink: 0 }} />

            <div style={{ padding: '24px 24px 16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--ink-90)' }}>{t('team.selectTitle')}</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-30)' }}>
                    {t('team.selectedSummary', { selected: myTeam.length, total: allMembers.length })}
                  </p>
                </div>
                <button onClick={() => setShowPicker(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><NavIcon name="close" size={16} /></button>
              </div>

              {/* Search */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', color: 'var(--ink-25)' }}><NavIcon name="search" size={14} /></span>
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('team.searchPlaceholder')}
                  autoFocus
                  style={{ width: '100%', padding: '10px 14px 10px 34px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* Liste */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 16px' }}>
              {loadingAll ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-30)', fontSize: 13 }}>{t('team.loading')}</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-25)', fontSize: 13 }}>{t('team.noResults')}</div>
              ) : (
                <div style={{ display: 'grid', gap: 4 }}>
                  {filtered.map((m) => {
                    const selected = myTeam.some((x) => x.id === m.id);
                    return (
                      <button key={m.id} onClick={() => toggleMember(m)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid ' + (selected ? 'var(--acc)' : 'var(--panel-border-2)'), background: selected ? 'var(--acc-soft)' : 'var(--panel)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: grad(m.displayName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                          {initials(m.displayName)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>{m.displayName}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-30)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.uniqueName}</div>
                        </div>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid ' + (selected ? 'var(--acc)' : 'var(--panel-border-4)'), background: selected ? 'var(--acc)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', color: '#fff' }}>
                          {selected && <NavIcon name="user-check" size={11} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--panel-border)', flexShrink: 0 }}>
              <button onClick={() => setShowPicker(false)}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {t('team.done', { n: myTeam.length })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import repo picker modal — same UX as /dashboard/sprints so a
          team-page import gets the same repo/playbook context. Portaled
          to body so it sits above the page panels. */}
      {importPickerItem && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setImportPickerItem(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 460, maxWidth: '100%', maxHeight: '90vh',
              background: 'var(--surface)', color: 'var(--ink-90)',
              border: '1px solid var(--panel-border-3)', borderRadius: 10,
              padding: 18, boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', minHeight: 0,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35)', marginBottom: 4 }}>
              {t('sprints.importRepoPicker.label' as TranslationKey)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 2, lineHeight: 1.35 }}>
              {`[${provider === 'youtrack' ? 'YouTrack' : provider === 'jira' ? 'Jira' : 'Azure'} #${importPickerItem.id}] ${importPickerItem.title}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-55)', marginBottom: 14 }}>
              {t('sprints.importRepoPicker.hint' as TranslationKey)}
            </div>
            <div style={{ display: 'grid', gap: 6, overflowY: 'auto', marginBottom: 14, minHeight: 0, flex: 1 }}>
              {repoMappings.map((m) => {
                const selected = String(m.id) === importPickerRepoId;
                return (
                  <label
                    key={m.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderRadius: 8, border: '1px solid ' + (selected ? 'var(--acc)' : 'var(--panel-border-2)'),
                      background: selected ? 'var(--acc-soft)' : 'var(--panel-alt)',
                      cursor: 'pointer', fontSize: 12, color: 'var(--ink-78)',
                    }}
                  >
                    <input
                      type='radio'
                      name='import-repo-team'
                      checked={selected}
                      onChange={() => setImportPickerRepoId(String(m.id))}
                      style={{ accentColor: 'var(--acc)', width: 16, height: 16, flexShrink: 0, padding: 0, margin: 0 }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 700, color: 'var(--ink-90)' }}>{m.name}</span>
                      {m.local_path && (
                        <span style={{ fontSize: 10, color: 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.local_path}</span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
              borderRadius: 8, border: '1px solid var(--acc)',
              background: 'var(--acc-soft)',
              fontSize: 12, color: 'var(--ink-78)',
              cursor: 'pointer', marginBottom: 12,
            }}>
              <input
                type='checkbox'
                checked={importAiFill}
                onChange={(e) => setImportAiFill(e.target.checked)}
                style={{ accentColor: 'var(--acc)', marginTop: 2 }}
              />
              <span>
                <strong style={{ color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><NavIcon name="zap" size={14} /> {t('tasks.aiFill.checkboxTitle' as TranslationKey) || 'AI ile Doldur'}</strong>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-50)', marginTop: 2 }}>
                  {t('tasks.aiFill.checkboxDesc' as TranslationKey) || 'Story Context, Acceptance Criteria ve Edge Cases alanları otomatik doldurulur.'}
                </span>
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type='button'
                onClick={() => setImportPickerItem(null)}
                style={{
                  fontSize: 12, padding: '8px 16px', borderRadius: 10,
                  border: '1px solid var(--panel-border-2)', background: 'transparent',
                  color: 'var(--ink-65)', cursor: 'pointer',
                }}
              >
                {t('tasks.cancel')}
              </button>
              <button
                type='button'
                disabled={!importPickerRepoId}
                onClick={() => {
                  const picked = repoMappings.find((m) => String(m.id) === importPickerRepoId);
                  const target = importPickerItem;
                  setImportPickerItem(null);
                  if (target) void importSingleItem(target, picked);
                }}
                style={{
                  fontSize: 12, padding: '8px 18px', borderRadius: 8,
                  border: '1px solid var(--acc)',
                  background: importPickerRepoId ? 'var(--acc)' : 'var(--panel)',
                  color: importPickerRepoId ? '#fff' : 'var(--ink-35)',
                  cursor: importPickerRepoId ? 'pointer' : 'not-allowed',
                  fontWeight: 700,
                }}
              >
                {t('sprints.import')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ── Org Members & Role Management Panel ────────────────────────── */

type OrgMember = { id: number; user_id: number; email: string; full_name: string; role: string };
type PendingInvite = { id: number; email: string; status: string; created_at?: string };

const ROLE_OPTIONS = [
  { value: 'owner', color: '#c98a2b' },
  { value: 'admin', color: '#5b9bd5' },
  { value: 'member', color: '#5b9bd5' },
  { value: 'viewer', color: '#94a3b8' },
] as const;

function OrgMembersPanel({ t }: { t: (key: Parameters<ReturnType<typeof useLocale>['t']>[0]) => string }) {
  const { role: myRole } = useRole();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState<number | null>(null);
  const [toast, setToast] = useState('');

  const canManageRoles = canAccess(myRole, 'roles:manage');

  const fetchMembers = useCallback(async () => {
    try {
      const [data, invData] = await Promise.all([
        apiFetch<OrgMember[]>('/org/members'),
        apiFetch<PendingInvite[]>('/org/invites').catch(() => [] as PendingInvite[]),
      ]);
      setMembers(data);
      setInvites(invData.filter((i) => i.status === 'pending'));
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchMembers(); }, [fetchMembers]);

  const handleRoleChange = async (memberId: number, newRole: string) => {
    setChangingId(memberId);
    try {
      await apiFetch(`/org/members/${memberId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m));
      setToast(t('team.roleChanged'));
      setTimeout(() => setToast(''), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('team.errorDefault');
      setToast(msg);
      setTimeout(() => setToast(''), 3000);
    }
    setChangingId(null);
  };

  if (loading) return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Skel /><Skel opacity={0.7} /><Skel opacity={0.4} />
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>{t('team.orgDesc')}</div>

      {toast && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid #3f9d6a', color: '#3f9d6a', fontSize: 12, fontWeight: 600 }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {members.map((member) => {
          const roleInfo = ROLE_OPTIONS.find((r) => r.value === member.role) || ROLE_OPTIONS[2];
          const isChanging = changingId === member.id;
          return (
            <div key={member.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
              borderRadius: 10, border: `1px solid var(--panel-border)`, background: 'var(--panel)',
              opacity: isChanging ? 0.6 : 1, transition: 'opacity 0.2s',
            }}>
              {/* Avatar */}
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: grad(member.full_name || member.email),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0,
              }}>
                {initials(member.full_name || member.email)}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {member.full_name || member.email}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {member.email}
                </div>
              </div>

              {/* Role selector */}
              {canManageRoles ? (
                <select
                  value={member.role}
                  onChange={(e) => void handleRoleChange(member.id, e.target.value)}
                  disabled={isChanging}
                  style={{
                    padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: `1px solid ${roleInfo.color}40`,
                    background: `${roleInfo.color}15`, color: roleInfo.color,
                    cursor: 'pointer', outline: 'none', appearance: 'auto',
                    flexShrink: 0,
                  }}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{t(`role.${r.value}` as const)}</option>
                  ))}
                </select>
              ) : (
                <span style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: `${roleInfo.color}15`, color: roleInfo.color,
                  border: `1px solid ${roleInfo.color}40`, flexShrink: 0,
                }}>
                  {t(`role.${roleInfo.value}` as const)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-50)', marginBottom: 2 }}>
            {t('team.pendingInvites')} ({invites.length})
          </div>
          {invites.map((inv) => (
            <div key={inv.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px',
              borderRadius: 10, border: '1px dashed var(--panel-border)', background: 'var(--panel-alt)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--panel)', border: '1px solid var(--panel-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--ink-50)', flexShrink: 0,
              }}><NavIcon name="mail" size={16} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)' }}>{inv.email}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>
                  {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : ''} · {t('team.invitePending')}
                </div>
              </div>
              <span style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: 'var(--panel)', color: '#c98a2b',
                border: '1px solid var(--panel-border)', flexShrink: 0,
              }}>
                {t('invite.status.pending')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Permission matrix legend */}
      <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 10 }}>
          {t('team.orgMembers')}
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {ROLE_OPTIONS.map((r) => (
            <div key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 700, color: r.color, minWidth: 60 }}>{t(`role.${r.value}` as const)}</span>
              <span style={{ color: 'var(--ink-35)' }}>{t(`team.roleDesc.${r.value}` as const)}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function Skel({ opacity = 1 }: { opacity?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--panel)', opacity }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--panel-border-2)', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 11, borderRadius: 4, background: 'var(--panel-border)' }} />
      <div style={{ width: 55, height: 18, borderRadius: 999, background: 'var(--glass)' }} />
    </div>
  );
}
