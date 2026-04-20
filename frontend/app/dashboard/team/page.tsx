'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch, loadPrefs, savePrefs, type AzureMember } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import { useRole, canAccess } from '@/lib/rbac';
type WorkItem = { id: string; title: string; state: string };

const STATE_COLORS: Record<string, string> = {
  'Backlog': '#6b7280', 'To Do': '#f59e0b', 'In Progress': '#38bdf8',
  'Code Review': '#a78bfa', 'QA To Do': '#f472b6', 'Done': '#22c55e',
  'Closed': '#22c55e', 'Resolved': '#22c55e', 'Active': '#38bdf8', 'New': '#f59e0b',
};
const sc = (s: string) => STATE_COLORS[s] ?? '#5eead4';

const LS_PROJECT  = 'agena_sprint_project';
const LS_TEAM     = 'agena_sprint_team';
const LS_SPRINT   = 'agena_sprint_path';
const LS_PROVIDER = 'agena_sprint_provider';
const LS_JIRA_PROJECT = 'agena_jira_project';
const LS_JIRA_BOARD = 'agena_jira_board';
const LS_JIRA_SPRINT = 'agena_jira_sprint';

const GRADIENTS = [
  ['#0d9488','#22c55e'], ['#7c3aed','#a78bfa'], ['#0ea5e9','#38bdf8'],
  ['#f59e0b','#fb923c'], ['#ec4899','#f472b6'], ['#14b8a6','#06b6d4'],
];
const grad = (name: string) => {
  const g = GRADIENTS[name.charCodeAt(0) % GRADIENTS.length];
  return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
};
const initials = (name: string) =>
  name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2);

export default function TeamPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<'sprint' | 'org'>('sprint');
  const [provider,   setProvider]   = useState<'azure' | 'jira'>('azure');
  const [hasAzure,   setHasAzure]   = useState(false);
  const [hasJira,    setHasJira]    = useState(false);
  const [project,    setProject]    = useState('');
  const [team,       setTeam]       = useState('');
  const [sprintPath, setSprintPath] = useState('');
  const [providerDefaults, setProviderDefaults] = useState<{
    azure: { project: string; team: string; sprint: string };
    jira: { project: string; team: string; sprint: string };
  }>({
    azure: { project: '', team: '', sprint: '' },
    jira: { project: '', team: '', sprint: '' },
  });

  // Tüm Azure üyeleri (arama için)
  const [allMembers, setAllMembers] = useState<AzureMember[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  // Benim seçtiğim takım
  const [myTeam, setMyTeam] = useState<AzureMember[]>([]);
  const [myTeamBySource, setMyTeamBySource] = useState<Record<'azure' | 'jira', AzureMember[]>>({ azure: [], jira: [] });

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

  useEffect(() => {
    const init = async () => {
      try {
        const [prefs, integrations] = await Promise.all([
          loadPrefs(),
          apiFetch<Array<{ provider: string; has_secret?: boolean; base_url?: string | null; username?: string | null }>>('/integrations'),
        ]);

        const azureCfg = integrations.find((c) => c.provider === 'azure');
        const jiraCfg = integrations.find((c) => c.provider === 'jira');
        const azureConnected = Boolean(azureCfg && (azureCfg.has_secret || (azureCfg.base_url || '').trim().length > 0));
        const jiraConnected = Boolean(jiraCfg && (jiraCfg.has_secret || (jiraCfg.base_url || '').trim().length > 0 || (jiraCfg.username || '').trim().length > 0));
        setHasAzure(azureConnected);
        setHasJira(jiraConnected);
        setAzureBaseUrl((azureCfg?.base_url || '').trim().replace(/\/$/, ''));
        setJiraBaseUrl((jiraCfg?.base_url || '').trim().replace(/\/$/, ''));

        const rawSettings = (prefs.profile_settings || {}) as Record<string, unknown>;
        const jiraProject = typeof rawSettings.jira_project === 'string' ? rawSettings.jira_project : '';
        const jiraBoard = typeof rawSettings.jira_board === 'string' ? rawSettings.jira_board : '';
        const jiraSprint = typeof rawSettings.jira_sprint_id === 'string' ? rawSettings.jira_sprint_id : '';
        const azureProject = prefs.azure_project || '';
        const azureTeam = prefs.azure_team || '';
        const azureSprint = prefs.azure_sprint_path || '';
        const jiraProjectValue = jiraProject || '';
        const jiraBoardValue = jiraBoard || '';
        const jiraSprintValue = jiraSprint || '';
        const hasAzureProfileSelection = Boolean(azureProject || azureTeam || azureSprint);
        const hasJiraProfileSelection = Boolean(jiraProjectValue || jiraBoardValue || jiraSprintValue);
        const selectedProvider: 'azure' | 'jira' =
          (azureConnected && hasAzureProfileSelection) ? 'azure' :
          (jiraConnected && hasJiraProfileSelection) ? 'jira' :
          (azureConnected ? 'azure' : 'jira');
        setProvider(selectedProvider);
        setProviderDefaults({
          azure: { project: azureProject, team: azureTeam, sprint: azureSprint },
          jira: { project: jiraProjectValue, team: jiraBoardValue, sprint: jiraSprintValue },
        });
        const bySourceRaw = prefs.my_team_by_source;
        const bySource: Record<'azure' | 'jira', AzureMember[]> = {
          azure: (bySourceRaw && Array.isArray(bySourceRaw.azure)) ? bySourceRaw.azure : (prefs.my_team || []),
          jira: (bySourceRaw && Array.isArray(bySourceRaw.jira)) ? bySourceRaw.jira : (Array.isArray(rawSettings.my_team_jira) ? rawSettings.my_team_jira as AzureMember[] : []),
        };
        setMyTeamBySource(bySource);

        if (selectedProvider === 'jira') {
          setProject(jiraProjectValue);
          setTeam(jiraBoardValue);
          setSprintPath(jiraSprintValue);
          setMyTeam(bySource.jira || []);
        } else {
          setProject(azureProject);
          setTeam(azureTeam);
          setSprintPath(azureSprint);
          setMyTeam(bySource.azure || []);
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.toLowerCase().includes('invalid token')) return;
        const preferred = localStorage.getItem(LS_PROVIDER) === 'jira' ? 'jira' : 'azure';
        setProvider(preferred);
        setMyTeamBySource({ azure: [], jira: [] });
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
        const sourceKey = provider === 'jira' ? 'jira' : 'azure';
        type SearchRes = { items: Array<{ id: number; title: string }> };
        const res = await apiFetch<SearchRes>(
          '/tasks/search?source=' + sourceKey + '&page_size=100',
        );
        if (cancelled) return;
        const map: Record<string, number> = {};
        const re = /^\[(Azure|Jira)\s+#([^\]]+)\]/i;
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
        if (provider === 'jira') {
          if (!team) return;
          type JiraSprint = { id?: string; name: string; path?: string; is_current?: boolean };
          const sprints = await apiFetch<JiraSprint[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(team));
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
        if (provider === 'jira') {
          if (!team || !sprintPath) {
            if (reqId !== membersReqRef.current) return;
            setAllMembers([]);
            return;
          }
          const members = await apiFetch<AzureMember[]>(
            '/tasks/jira/members?board_id=' + encodeURIComponent(team) + '&sprint_id=' + encodeURIComponent(sprintPath),
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

  async function importSingleItem(item: WorkItem) {
    if (importedIds[item.id]) {
      setToast({ msg: t('sprints.alreadyImported'), kind: 'ok' });
      setTimeout(() => setToast(null), 2500);
      return;
    }
    setImportingId(item.id);
    try {
      const ctxParts = [
        `External Source: ${provider === 'jira' ? `Jira #${item.id}` : `Azure #${item.id}`}`,
        project ? `Project: ${project}` : '',
        team ? `Team: ${team}` : '',
        sprintPath ? `Sprint: ${sprintPath}` : '',
        workItemUrl(item) ? `External URL: ${workItemUrl(item)}` : '',
      ].filter(Boolean);
      type TaskRec = { id: number };
      const created = await apiFetch<TaskRec>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: `[${provider === 'jira' ? 'Jira' : 'Azure'} #${item.id}] ${item.title}`,
          description: `${item.title}\n\n---\n${ctxParts.join('\n')}`,
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
      const items = provider === 'jira'
        ? await apiFetch<WorkItem[]>(
            '/tasks/jira/member/workitems' +
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

  const hasConfig = provider === 'jira' ? !!(team && sprintPath) : !!(project && team && sprintPath);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="section-label">{t('team.section')}</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
            {t('team.title')}
          </h1>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {/* Main tabs: Sprint Team vs Organization */}
            <button onClick={() => setTab('sprint')}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: tab === 'sprint' ? '1px solid rgba(94,234,212,0.45)' : '1px solid var(--panel-border-3)',
                background: tab === 'sprint' ? 'rgba(94,234,212,0.12)' : 'var(--panel-alt)',
                color: tab === 'sprint' ? '#5eead4' : 'var(--ink-58)',
              }}>
              {t('team.sprintLabel')}
            </button>
            <button onClick={() => setTab('org')}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: tab === 'org' ? '1px solid rgba(167,139,250,0.45)' : '1px solid var(--panel-border-3)',
                background: tab === 'org' ? 'rgba(167,139,250,0.12)' : 'var(--panel-alt)',
                color: tab === 'org' ? '#a78bfa' : 'var(--ink-58)',
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
                  border: provider === 'azure' ? '1px solid rgba(56,189,248,0.45)' : '1px solid var(--panel-border-3)',
                  background: provider === 'azure' ? 'rgba(56,189,248,0.12)' : 'var(--panel-alt)',
                  color: provider === 'azure' ? '#7dd3fc' : 'var(--ink-58)',
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
                  border: provider === 'jira' ? '1px solid rgba(129,140,248,0.45)' : '1px solid var(--panel-border-3)',
                  background: provider === 'jira' ? 'rgba(129,140,248,0.12)' : 'var(--panel-alt)',
                  color: provider === 'jira' ? '#a5b4fc' : 'var(--ink-58)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('team.providerJira')}
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
            style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 12, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.1)', color: '#5eead4', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>+</span> {t('team.addEdit')}
          </button>
        )}
      </div>

      {/* Organization tab */}
      {tab === 'org' && <OrgMembersPanel t={t} />}

      {/* Sprint tab content */}
      {tab === 'sprint' && !hasConfig && (
        <div style={{ padding: '20px 24px', borderRadius: 16, border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, color: '#fbbf24', fontSize: 14 }}>
              {provider === 'jira' ? t('team.noConfigJira') : t('team.noConfig')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 4 }}>
              {provider === 'jira' ? t('team.noConfigDescJira') : t('team.noConfigDesc')}
            </div>
          </div>
          <a href="/dashboard/profile" style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            {t('team.profile')}
          </a>
        </div>
      )}

      {tab === 'sprint' && err && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{err}</div>
      )}

      {toast && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: toast.kind === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
          border: '1px solid ' + (toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'),
          color: toast.kind === 'ok' ? '#22c55e' : '#f87171',
          fontSize: 13,
          fontWeight: 600,
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
              <div key={member.id} style={{ borderRadius: 16, border: '1px solid ' + (isExpanded ? 'rgba(94,234,212,0.2)' : 'var(--panel-border)'), background: isExpanded ? 'rgba(13,148,136,0.04)' : 'var(--panel)', overflow: 'hidden', transition: 'border-color 0.2s' }}>
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
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: items.length > 0 ? 'rgba(94,234,212,0.1)' : 'var(--panel-alt)', border: '1px solid ' + (items.length > 0 ? 'rgba(94,234,212,0.25)' : 'var(--panel-border-2)'), color: items.length > 0 ? '#5eead4' : 'var(--ink-30)' }}>
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
                      borderRadius: 999,
                      border: '1px solid rgba(248,113,113,0.35)',
                      background: 'rgba(248,113,113,0.12)',
                      color: '#f87171',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {t('team.remove')}
                  </button>
                  {sprintPath && (
                    <span style={{ fontSize: 16, color: 'var(--ink-25)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>⌄</span>
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
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--panel-alt)', border: '1px solid var(--panel-alt)' }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(item.state), boxShadow: '0 0 5px ' + sc(item.state), flexShrink: 0 }} />
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={t('team.openExternal')}
                                  style={{ flex: 1, fontSize: 13, color: 'var(--ink-78)', textDecoration: 'none', cursor: 'pointer' }}
                                  onMouseEnter={(e) => { (e.currentTarget.style.color = '#5eead4'); (e.currentTarget.style.textDecoration = 'underline'); }}
                                  onMouseLeave={(e) => { (e.currentTarget.style.color = 'var(--ink-78)'); (e.currentTarget.style.textDecoration = 'none'); }}
                                >
                                  {item.title}
                                </a>
                              ) : (
                                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-78)' }}>{item.title}</span>
                              )}
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: sc(item.state) + '18', border: '1px solid ' + sc(item.state) + '35', color: sc(item.state), whiteSpace: 'nowrap' }}>{item.state}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); void importSingleItem(item); }}
                                disabled={isImporting || isImported}
                                title={isImported ? t('sprints.alreadyImported') : t('team.importItem')}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '3px 9px',
                                  borderRadius: 999,
                                  border: '1px solid ' + (isImported ? 'rgba(34,197,94,0.35)' : 'rgba(94,234,212,0.35)'),
                                  background: isImported ? 'rgba(34,197,94,0.12)' : 'rgba(94,234,212,0.1)',
                                  color: isImported ? '#22c55e' : '#5eead4',
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
          <div style={{ fontSize: 48, opacity: 0.1, marginBottom: 16 }}>◉</div>
          <div style={{ color: 'var(--ink-25)', fontSize: 14, marginBottom: 20 }}>{t('team.noMembers')}</div>
          <button onClick={() => setShowPicker(true)}
            style={{ padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.1)', color: '#5eead4', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {t('team.addMember')}
          </button>
        </div>
      ) : null}

      {/* Picker Modal */}
      {/* Remove confirmation modal */}
      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setConfirmRemove(null)}>
          <div style={{ width: 'min(400px, 100%)', borderRadius: 20, border: '1px solid rgba(239,68,68,0.25)', background: 'var(--surface)', padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}>
            {/* Icon */}
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 16px' }}>
              ⚠️
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)', marginBottom: 20 }}>
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
                style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                {t('team.removeCancel')}
              </button>
              <button onClick={() => doRemoveMember(confirmRemove)}
                style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg, #ef4444, #dc2626)', border: 'none', color: '#fff' }}>
                {t('team.removeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' }} onClick={() => setShowPicker(false)} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 480, borderRadius: 24, border: '1px solid var(--panel-border-3)', background: 'var(--surface)', overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.6)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 2, background: 'linear-gradient(90deg, #0d9488, #7c3aed, #22c55e)', flexShrink: 0 }} />

            <div style={{ padding: '24px 24px 16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--ink-90)' }}>{t('team.selectTitle')}</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-30)' }}>
                    {t('team.selectedSummary', { selected: myTeam.length, total: allMembers.length })}
                  </p>
                </div>
                <button onClick={() => setShowPicker(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>

              {/* Search */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--ink-25)' }}>⌕</span>
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
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, border: '1px solid ' + (selected ? 'rgba(13,148,136,0.35)' : 'var(--panel-alt)'), background: selected ? 'rgba(13,148,136,0.1)' : 'var(--panel)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: grad(m.displayName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                          {initials(m.displayName)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>{m.displayName}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-30)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.uniqueName}</div>
                        </div>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid ' + (selected ? '#0d9488' : 'var(--panel-border-4)'), background: selected ? '#0d9488' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                          {selected && <span style={{ fontSize: 10, color: '#fff', fontWeight: 800 }}>✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--panel-border)', flexShrink: 0 }}>
              <button onClick={() => setShowPicker(false)}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {t('team.done', { n: myTeam.length })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Org Members & Role Management Panel ────────────────────────── */

type OrgMember = { id: number; user_id: number; email: string; full_name: string; role: string };
type PendingInvite = { id: number; email: string; status: string; created_at?: string };

const ROLE_OPTIONS = [
  { value: 'owner', color: '#f59e0b' },
  { value: 'admin', color: '#a78bfa' },
  { value: 'member', color: '#38bdf8' },
  { value: 'viewer', color: '#6b7280' },
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
        <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 12, fontWeight: 600 }}>
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
              borderRadius: 14, border: `1px solid var(--panel-border)`, background: 'var(--panel)',
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
                    padding: '6px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700,
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
                  padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
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
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#f59e0b', marginBottom: 2 }}>
            {t('team.pendingInvites')} ({invites.length})
          </div>
          {invites.map((inv) => (
            <div key={inv.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px',
              borderRadius: 14, border: '1px dashed rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.04)',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, flexShrink: 0,
              }}>✉</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)' }}>{inv.email}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>
                  {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : ''} · {t('team.invitePending')}
                </div>
              </div>
              <span style={{
                padding: '5px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.3)', flexShrink: 0,
              }}>
                {t('invite.status.pending')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Permission matrix legend */}
      <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: 16 }}>
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
