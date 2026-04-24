'use client';

import Link from 'next/link';
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, loadPrefs, type AzureMember } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type SprintOption = {
  id: string;
  name: string;
  path?: string;
  is_current?: boolean;
  timeframe?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
};

type WorkItem = {
  id: string;
  title: string;
  description: string;
  source: string;
  state?: string | null;
  assigned_to?: string | null;
  web_url?: string | null;
};

type MemberStat = {
  key: string;
  name: string;
  total: number;
  done: number;
  pending: number;
  blocked: number;
  percent: number;
  score: number;
  critical: boolean;
};

type BlockedItem = {
  id: string;
  title: string;
  state: string;
  assignee: string;
  reason: string;
  webUrl?: string | null;
};

type IntegrationConfig = {
  provider: string;
  has_secret?: boolean;
  base_url?: string | null;
  username?: string | null;
};

type DoraMetrics = {
  lead_time_hours: number | null;
  deploy_frequency: number | null;
  change_failure_rate: number | null;
  mttr_hours: number | null;
};

type PrMetrics = {
  pct_merged_within_goal: number;
  merge_goal_hours: number;
  avg_merge_hours: number;
  merged_count: number;
};

type DoraResp = DoraMetrics & { daily?: Array<{ date: string; completed: number; failed: number; lead_time_hours: number | null; mttr_hours: number | null }> };
type PrResp = { kpi: PrMetrics };
type DeployResp = { deploy_freq_trend: Array<{ date: string; deploys: number }> };
type DailyResp = { task_velocity: Array<{ date: string; completed: number; failed: number; queued: number; total: number }> };

const LS_PROVIDER = 'agena_sprint_provider';
const LS_PROJECT = 'agena_sprint_project';
const LS_TEAM = 'agena_sprint_team';
const LS_SPRINT = 'agena_sprint_path';
const LS_JIRA_PROJECT = 'agena_jira_project';
const LS_JIRA_BOARD = 'agena_jira_board';
const LS_JIRA_SPRINT = 'agena_jira_sprint';

const doneTokens = ['done', 'closed', 'resolved', 'complete', 'completed', 'tamam'];
const blockedTokens = ['blocked', 'imped', 'hold', 'bekle', 'engell', 'stuck'];

function normalize(v: string | null | undefined): string {
  return String(v || '').trim().toLowerCase();
}

function isDoneState(v: string | null | undefined): boolean {
  const state = normalize(v);
  return doneTokens.some((t) => state.includes(t));
}

function isBlockedState(v: string | null | undefined): boolean {
  const state = normalize(v);
  return blockedTokens.some((t) => state.includes(t));
}

function pickCurrentSprint(list: SprintOption[]): SprintOption | null {
  const byFlag = list.find((s) => s.is_current || normalize(s.timeframe || '') === 'current');
  if (byFlag) return byFlag;
  const now = Date.now();
  const byDate = list.find((s) => {
    if (!s.start_date || !s.finish_date) return false;
    const start = new Date(s.start_date).getTime();
    const finish = new Date(s.finish_date).getTime();
    return Number.isFinite(start) && Number.isFinite(finish) && start <= now && now <= finish;
  });
  if (byDate) return byDate;
  return list[0] || null;
}

function getDaysLeft(finishDate?: string | null): number | null {
  if (!finishDate) return null;
  const finish = new Date(finishDate).getTime();
  if (!Number.isFinite(finish)) return null;
  const left = Math.ceil((finish - Date.now()) / 86400000);
  return left;
}

function getTimelineProgress(startDate?: string | null, finishDate?: string | null): number | null {
  if (!startDate || !finishDate) return null;
  const start = new Date(startDate).getTime();
  const finish = new Date(finishDate).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return null;
  const raw = ((now - start) / (finish - start)) * 100;
  return Math.max(0, Math.min(100, raw));
}

function extractBlockedReason(input: string): string {
  const plain = String(input || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const patterns = [
    /blocked\s+(?:by|because|due to|until)\s+([^.!?\n]{8,200})/i,
    /(?:reason|root cause|neden)\s*[:\-]\s*([^.!?\n]{8,200})/i,
    /(?:dependency|bağımlılık)\s*[:\-]\s*([^.!?\n]{8,200})/i,
  ];
  for (const p of patterns) {
    const m = plain.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return plain.length > 160 ? plain.slice(0, 157).trimEnd() + '\u2026' : plain;
}

function personMatches(item: WorkItem, member: AzureMember): boolean {
  const assigned = normalize(item.assigned_to);
  if (!assigned) return false;
  const unique = normalize(member.uniqueName);
  const display = normalize(member.displayName);
  if (assigned === unique || assigned === display) return true;
  if (display && (assigned.includes(display) || display.includes(assigned))) return true;
  if (unique && (assigned.includes(unique) || unique.includes(assigned))) return true;
  const uniqueLocal = unique.includes('@') ? unique.split('@')[0] : unique;
  if (uniqueLocal && (assigned === uniqueLocal || assigned.includes(uniqueLocal))) return true;
  return false;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
    'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
    'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getTaskBorderColor(state: string | null | undefined): string {
  const s = String(state || '').trim().toLowerCase();
  if (doneTokens.some((t) => s.includes(t))) return '#22c55e';
  if (blockedTokens.some((t) => s.includes(t))) return '#ef4444';
  return '#eab308';
}

function getScoreColor(score: number): string {
  if (score >= 75) return '#22c55e';
  if (score >= 50) return '#eab308';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

function getScoreGradient(score: number): string {
  if (score >= 75) return 'linear-gradient(135deg, #22c55e, #4ade80)';
  if (score >= 50) return 'linear-gradient(135deg, #eab308, #facc15)';
  if (score >= 25) return 'linear-gradient(135deg, #f97316, #fb923c)';
  return 'linear-gradient(135deg, #ef4444, #f87171)';
}

export default function SprintPerformancePage() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<'azure' | 'jira'>('azure');
  const [activeSprintName, setActiveSprintName] = useState('');
  const [timelineProgress, setTimelineProgress] = useState<number | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [memberStats, setMemberStats] = useState<MemberStat[]>([]);
  const [blockedItems, setBlockedItems] = useState<BlockedItem[]>([]);
  const [allWorkItems, setAllWorkItems] = useState<WorkItem[]>([]);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [missingConfig, setMissingConfig] = useState(false);
  const [hasAzure, setHasAzure] = useState(false);
  const [hasJira, setHasJira] = useState(false);
  const [projectOptions, setProjectOptions] = useState<SprintOption[]>([]);
  const [teamOptions, setTeamOptions] = useState<SprintOption[]>([]);
  const [sprintOptions, setSprintOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedSprint, setSelectedSprint] = useState('');
  const [doraMetrics, setDoraMetrics] = useState<DoraMetrics | null>(null);
  const [prMetrics, setPrMetrics] = useState<PrMetrics | null>(null);
  const [deploySparkline, setDeploySparkline] = useState<number[]>([]);
  const [velocitySparkline, setVelocitySparkline] = useState<number[]>([]);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [doraModuleEnabled, setDoraModuleEnabled] = useState<boolean | null>(null);
  const [pingState, setPingState] = useState<Record<string, 'idle' | 'loading' | 'sent' | 'error'>>({});
  const [pingError, setPingError] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    setMissingConfig(false);
    try {
      const [prefs, integrations] = await Promise.all([
        loadPrefs(),
        apiFetch<IntegrationConfig[]>('/integrations'),
      ]);
      const settings = (prefs.profile_settings || {}) as Record<string, unknown>;
      const azureCfg = integrations.find((x) => x.provider === 'azure');
      const jiraCfg = integrations.find((x) => x.provider === 'jira');
      const azureConnected = Boolean(azureCfg && (azureCfg.has_secret || (azureCfg.base_url || '').trim()));
      const jiraConnected = Boolean(jiraCfg && (jiraCfg.has_secret || (jiraCfg.base_url || '').trim() || (jiraCfg.username || '').trim()));
      setHasAzure(azureConnected);
      setHasJira(jiraConnected);
      let source: 'azure' | 'jira' = provider;
      if (source === 'azure' && !azureConnected && jiraConnected) source = 'jira';
      if (source === 'jira' && !jiraConnected && azureConnected) source = 'azure';
      if (source !== provider) setProvider(source);
      localStorage.setItem(LS_PROVIDER, source);

      if (source === 'jira') {
        const jiraProjectPref = (typeof settings.jira_project === 'string' ? settings.jira_project : '');
        const jiraBoardPref = (typeof settings.jira_board === 'string' ? settings.jira_board : '');
        const jiraSprintPref = (typeof settings.jira_sprint_id === 'string' ? settings.jira_sprint_id : '');
        const projects = await apiFetch<SprintOption[]>('/tasks/jira/projects').catch(() => [] as SprintOption[]);
        setProjectOptions(projects);
        let project = selectedProject || localStorage.getItem(LS_JIRA_PROJECT) || jiraProjectPref || '';
        if (projects.length > 0) {
          const found = projects.find((p) => (p.id || p.name) === project || p.name === project);
          project = found ? (found.id || found.name) : (projects[0].id || projects[0].name);
        }
        if (selectedProject !== project) setSelectedProject(project);
        if (project) localStorage.setItem(LS_JIRA_PROJECT, project);

        const boards = await apiFetch<SprintOption[]>(
          project
            ? '/tasks/jira/boards?project_key=' + encodeURIComponent(project)
            : '/tasks/jira/boards',
        ).catch(() => [] as SprintOption[]);
        setTeamOptions(boards);
        let boardId = selectedTeam || localStorage.getItem(LS_JIRA_BOARD) || jiraBoardPref || '';
        if (boards.length > 0) {
          const foundBoard = boards.find((b) => (b.id || b.name) === boardId || b.name === boardId);
          boardId = foundBoard ? (foundBoard.id || foundBoard.name) : (boards[0].id || boards[0].name);
        }
        if (selectedTeam !== boardId) setSelectedTeam(boardId);
        if (boardId) localStorage.setItem(LS_JIRA_BOARD, boardId);

        if (!boardId) {
          setMissingConfig(true);
          setActiveSprintName('');
          setTimelineProgress(null);
          setDaysLeft(null);
          setMemberStats([]);
          setBlockedItems([]);
          return;
        }

        let sprintId = selectedSprint || localStorage.getItem(LS_JIRA_SPRINT) || jiraSprintPref || '';
        const sprintList = await apiFetch<SprintOption[]>('/tasks/jira/sprints?board_id=' + encodeURIComponent(boardId)).catch(() => [] as SprintOption[]);
        setSprintOptions(sprintList.map((s) => ({ value: String(s.id || s.path || ''), label: s.name })));
        const current = pickCurrentSprint(sprintList);
        if (sprintId && !sprintList.some((s) => String(s.id || s.path || '') === sprintId)) sprintId = '';
        if (!sprintId && current) sprintId = current.id || current.path || '';
        if (!sprintId && sprintList.length > 0) sprintId = String(sprintList[0].id || sprintList[0].path || '');
        if (!sprintId) {
          setMissingConfig(true);
          setActiveSprintName('');
          setTimelineProgress(null);
          setDaysLeft(null);
          setMemberStats([]);
          setBlockedItems([]);
          return;
        }
        if (selectedSprint !== sprintId) setSelectedSprint(sprintId);
        localStorage.setItem(LS_JIRA_SPRINT, sprintId);
        const sprintMeta = sprintList.find((s) => String(s.id) === String(sprintId)) || current;
        setActiveSprintName(sprintMeta?.name || sprintId);
        setTimelineProgress(getTimelineProgress(sprintMeta?.start_date, sprintMeta?.finish_date));
        setDaysLeft(getDaysLeft(sprintMeta?.finish_date));
        setMissingConfig(false);

        const q = new URLSearchParams({ board_id: boardId, sprint_id: sprintId });
        if (project) q.set('project_key', project);
        const jiraAll = await apiFetch<{ items: WorkItem[] }>('/tasks/jira?' + q.toString()).catch(() => ({ items: [] as WorkItem[] }));
        const allItems = jiraAll.items || [];
        setAllWorkItems(allItems);

        const teamFromPrefs = Array.isArray(prefs.my_team_by_source?.jira)
          ? prefs.my_team_by_source?.jira || []
          : [];
        let members: AzureMember[] = teamFromPrefs;
        if (!members.length) {
          const uniq = new Map<string, AzureMember>();
          allItems.forEach((item) => {
            const name = String(item.assigned_to || '').trim();
            if (!name) return;
            uniq.set(name.toLowerCase(), { id: name.toLowerCase(), displayName: name, uniqueName: name });
          });
          members = Array.from(uniq.values());
        }
        if (!members.length) {
          members = await apiFetch<AzureMember[]>(
            '/tasks/jira/members?board_id=' + encodeURIComponent(boardId) + '&sprint_id=' + encodeURIComponent(sprintId),
          ).catch(() => [] as AzureMember[]);
        }

        const left = getDaysLeft(sprintMeta?.finish_date);
        const stats = members.map((member) => {
          const personItems = allItems.filter((item) => personMatches(item, member));
          const total = personItems.length;
          const done = personItems.filter((item) => isDoneState(item.state)).length;
          const blocked = personItems.filter((item) => isBlockedState(item.state)).length;
          const pending = Math.max(0, total - done - blocked);
          const percent = total > 0 ? Math.round((done / total) * 100) : 0;
          const score = Math.max(0, Math.min(100, Math.round(percent - (blocked * 12))));
          const critical = (left !== null && left <= 2 && (pending + blocked) >= 3) || blocked >= 2;
          return {
            key: member.id || member.uniqueName || member.displayName,
            name: member.displayName || member.uniqueName,
            total,
            done,
            pending,
            blocked,
            percent,
            score,
            critical,
          };
        }).sort((a, b) => b.pending - a.pending || a.percent - b.percent);
        setMemberStats(stats);

        const blocked = allItems
          .filter((item) => isBlockedState(item.state))
          .map((item) => ({
            id: item.id,
            title: item.title,
            state: String(item.state || ''),
            assignee: String(item.assigned_to || '\u2014'),
            reason: extractBlockedReason(item.description || ''),
            webUrl: item.web_url,
          }));
        setBlockedItems(blocked);
        return;
      }

      const projects = await apiFetch<SprintOption[]>('/tasks/azure/projects').catch(() => [] as SprintOption[]);
      setProjectOptions(projects);
      let project = selectedProject || localStorage.getItem(LS_PROJECT) || prefs.azure_project || '';
      if (projects.length > 0) {
        const found = projects.find((p) => p.name === project || p.id === project);
        project = found ? found.name : projects[0].name;
      }
      if (selectedProject !== project) setSelectedProject(project);
      if (project) localStorage.setItem(LS_PROJECT, project);

      const teams = project
        ? await apiFetch<SprintOption[]>('/tasks/azure/teams?project=' + encodeURIComponent(project)).catch(() => [] as SprintOption[])
        : [];
      setTeamOptions(teams);
      let team = selectedTeam || localStorage.getItem(LS_TEAM) || prefs.azure_team || '';
      if (teams.length > 0) {
        const foundTeam = teams.find((x) => x.name === team || x.id === team);
        team = foundTeam ? foundTeam.name : teams[0].name;
      }
      if (selectedTeam !== team) setSelectedTeam(team);
      if (team) localStorage.setItem(LS_TEAM, team);

      let sprint = selectedSprint || localStorage.getItem(LS_SPRINT) || prefs.azure_sprint_path || '';
      if (!project || !team) {
        setMissingConfig(true);
        setActiveSprintName('');
        setTimelineProgress(null);
        setDaysLeft(null);
        setMemberStats([]);
        setBlockedItems([]);
        return;
      }
      const sprintList = await apiFetch<SprintOption[]>(
        '/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team),
      ).catch(() => [] as SprintOption[]);
      setSprintOptions(sprintList.map((s) => ({ value: String(s.path || s.name || ''), label: s.name })));
      const current = pickCurrentSprint(sprintList);
      if (sprint && !sprintList.some((s) => String(s.path || s.name || '') === sprint)) sprint = '';
      if (!sprint && current) sprint = current.path || current.name || '';
      if (!sprint && sprintList.length > 0) sprint = String(sprintList[0].path || sprintList[0].name || '');
      if (!sprint) {
        setMissingConfig(true);
        setActiveSprintName('');
        setTimelineProgress(null);
        setDaysLeft(null);
        setMemberStats([]);
        setBlockedItems([]);
        return;
      }
      if (selectedSprint !== sprint) setSelectedSprint(sprint);
      localStorage.setItem(LS_SPRINT, sprint);

      const sprintMeta = sprintList.find((s) => (s.path || s.name) === sprint) || current;
      setActiveSprintName(sprintMeta?.name || sprint);
      setTimelineProgress(getTimelineProgress(sprintMeta?.start_date, sprintMeta?.finish_date));
      setDaysLeft(getDaysLeft(sprintMeta?.finish_date));
      setMissingConfig(false);

      // Fetch ALL sprint items at once (no state filter) to avoid state-matching issues
      const q = new URLSearchParams({ sprint_path: sprint, project, team, state: '' });
      const allResult = await apiFetch<{ items: WorkItem[] }>('/tasks/azure?' + q.toString()).catch(() => ({ items: [] as WorkItem[] }));
      const allItems = allResult.items || [];
      setAllWorkItems(allItems);

      const teamFromPrefs = Array.isArray(prefs.my_team_by_source?.azure)
        ? prefs.my_team_by_source?.azure || []
        : (prefs.my_team || []);
      let members: AzureMember[] = teamFromPrefs;
      if (!members.length) {
        members = await apiFetch<AzureMember[]>(
          '/tasks/azure/sprint/members?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team) + '&sprint_path=' + encodeURIComponent(sprint),
        ).catch(() => [] as AzureMember[]);
      }
      if (!members.length) {
        const uniq = new Map<string, AzureMember>();
        allItems.forEach((item) => {
          const name = String(item.assigned_to || '').trim();
          if (!name) return;
          uniq.set(name.toLowerCase(), { id: name.toLowerCase(), displayName: name, uniqueName: name });
        });
        members = Array.from(uniq.values());
      }

      const left = getDaysLeft(sprintMeta?.finish_date);
      const stats = members.map((member) => {
        const personItems = allItems.filter((item) => personMatches(item, member));
        const total = personItems.length;
        const done = personItems.filter((item) => isDoneState(item.state)).length;
        const blocked = personItems.filter((item) => isBlockedState(item.state)).length;
        const pending = Math.max(0, total - done - blocked);
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        const score = Math.max(0, Math.min(100, Math.round(percent - (blocked * 12))));
        const critical = (left !== null && left <= 2 && (pending + blocked) >= 3) || blocked >= 2;
        return {
          key: member.id || member.uniqueName || member.displayName,
          name: member.displayName || member.uniqueName,
          total,
          done,
          pending,
          blocked,
          percent,
          score,
          critical,
        };
      }).sort((a, b) => b.pending - a.pending || a.percent - b.percent);
      setMemberStats(stats);

      const blocked = allItems
        .filter((item) => isBlockedState(item.state))
        .map((item) => ({
          id: item.id,
          title: item.title,
          state: String(item.state || ''),
          assignee: String(item.assigned_to || '\u2014'),
          reason: extractBlockedReason(item.description || ''),
          webUrl: item.web_url,
        }));
      setBlockedItems(blocked);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setProjectOptions([]);
      setTeamOptions([]);
      setSprintOptions([]);
      setMemberStats([]);
      setBlockedItems([]);
    } finally {
      setLoading(false);
    }
  }, [provider, selectedProject, selectedTeam, selectedSprint]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Resolve enabled modules once — the Engineering Pulse section depends on
  // the `dora` module. On failure, hide the section rather than assume it's
  // on.
  useEffect(() => {
    let cancelled = false;
    apiFetch<Array<{ slug: string; enabled: boolean }>>('/modules')
      .then((mods) => {
        if (cancelled) return;
        setDoraModuleEnabled(mods.some((m) => m.slug === 'dora' && m.enabled));
      })
      .catch(() => { if (!cancelled) setDoraModuleEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  // Engineering Pulse — DORA / PR / deploy / velocity snapshot for a rolling
  // 30-day window. Not sprint-scoped on the backend (those endpoints are
  // org-wide with a days filter), but gives useful context alongside the
  // active sprint. Only fetches when the dora module is enabled.
  useEffect(() => {
    if (missingConfig || !activeSprintName || !doraModuleEnabled) {
      setDoraMetrics(null);
      setPrMetrics(null);
      setDeploySparkline([]);
      setVelocitySparkline([]);
      return;
    }
    let cancelled = false;
    setPulseLoading(true);
    const days = 30;
    Promise.all([
      apiFetch<DoraResp>(`/analytics/dora?days=${days}`).catch(() => null),
      apiFetch<PrResp>(`/analytics/dora/development/prs?days=${days}`).catch(() => null),
      apiFetch<DeployResp>(`/analytics/dora/development/deployments?days=${days}`).catch(() => null),
      apiFetch<DailyResp>(`/analytics/daily?days=${days}`).catch(() => null),
    ]).then(([dora, pr, dep, daily]) => {
      if (cancelled) return;
      setDoraMetrics(dora ? { lead_time_hours: dora.lead_time_hours, deploy_frequency: dora.deploy_frequency, change_failure_rate: dora.change_failure_rate, mttr_hours: dora.mttr_hours } : null);
      setPrMetrics(pr ? pr.kpi : null);
      setDeploySparkline(dep ? dep.deploy_freq_trend.slice(-14).map((x) => x.deploys) : []);
      setVelocitySparkline(daily ? daily.task_velocity.slice(-14).map((x) => x.completed) : []);
      setPulseLoading(false);
    }).catch(() => { if (!cancelled) setPulseLoading(false); });
    return () => { cancelled = true; };
  }, [missingConfig, activeSprintName, doraModuleEnabled]);

  const handlePing = useCallback(async (item: BlockedItem) => {
    const key = item.id;
    if (pingState[key] === 'loading' || pingState[key] === 'sent') return;
    setPingState((s) => ({ ...s, [key]: 'loading' }));
    setPingError((s) => ({ ...s, [key]: '' }));
    const mention = item.assignee && item.assignee !== '—' ? item.assignee : t('sprintPerf.pingFallbackAssignee');
    const reasonLine = item.reason ? t('sprintPerf.pingReasonLine', { reason: item.reason }) : '';
    const comment = [
      t('sprintPerf.pingGreeting', { name: mention }),
      t('sprintPerf.pingBody'),
      reasonLine,
      t('sprintPerf.pingSignature'),
    ].filter(Boolean).join('\n\n');
    const path = provider === 'jira'
      ? `/tasks/jira/issues/${encodeURIComponent(item.id)}/comment`
      : `/tasks/azure/workitems/${encodeURIComponent(item.id)}/comment`;
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify({ comment }) });
      setPingState((s) => ({ ...s, [key]: 'sent' }));
    } catch (err) {
      setPingState((s) => ({ ...s, [key]: 'error' }));
      setPingError((s) => ({ ...s, [key]: err instanceof Error ? err.message : 'Failed' }));
    }
  }, [pingState, provider, t]);

  const avgCompletion = useMemo(() => {
    if (!memberStats.length) return 0;
    return Math.round(memberStats.reduce((sum, m) => sum + m.score, 0) / memberStats.length);
  }, [memberStats]);

  const totalItems = useMemo(() => memberStats.reduce((s, m) => s + m.total, 0), [memberStats]);
  const totalDone = useMemo(() => memberStats.reduce((s, m) => s + m.done, 0), [memberStats]);
  const totalPending = useMemo(() => memberStats.reduce((s, m) => s + m.pending, 0), [memberStats]);
  const totalBlocked = useMemo(() => memberStats.reduce((s, m) => s + m.blocked, 0), [memberStats]);

  const blockedByAssignee = useMemo(() => {
    const grouped = new Map<string, BlockedItem[]>();
    blockedItems.forEach((item) => {
      const key = item.assignee || '\u2014';
      const prev = grouped.get(key) || [];
      prev.push(item);
      grouped.set(key, prev);
    });
    return Array.from(grouped.entries())
      .map(([assignee, items]) => ({ assignee, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [blockedItems]);

  const sprintHealthLabel = avgCompletion >= 75 ? t('sprintPerf.healthExcellent') : avgCompletion >= 50 ? t('sprintPerf.healthGood') : avgCompletion >= 25 ? t('sprintPerf.healthAtRisk') : t('sprintPerf.healthCriticalLabel');

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className='section-label' style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: loading ? '#facc15' : avgCompletion >= 50 ? '#22c55e' : '#ef4444', boxShadow: loading ? '0 0 8px rgba(250,204,21,0.5)' : avgCompletion >= 50 ? '0 0 8px rgba(34,197,94,0.5)' : '0 0 8px rgba(239,68,68,0.5)', animation: loading ? 'pulse 1.5s ease-in-out infinite' : 'none' }} />
            {t('sprintPerf.section')}
          </div>
          <h1 style={{ margin: '8px 0 4px', fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', letterSpacing: '-0.02em' }}>{t('sprintPerf.title')}</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-45)', maxWidth: 500 }}>{t('sprintPerf.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TooltipWrap text='Refresh sprint performance data'>
            <button
              onClick={() => void loadData()}
              style={{
                padding: '10px 16px', borderRadius: 12,
                border: '1px solid var(--panel-border-3)',
                background: 'var(--panel-alt)', color: 'var(--ink-75)',
                cursor: 'pointer', fontWeight: 700, fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              {loading ? t('sprintPerf.loading') : t('sprintPerf.refresh')}
            </button>
          </TooltipWrap>
          <TooltipWrap text='Open Sprints board and sprint import page'>
            <Link
              href='/dashboard/sprints'
              style={{
                padding: '10px 16px', borderRadius: 12,
                border: '1px solid rgba(94,234,212,0.35)',
                background: 'linear-gradient(135deg, rgba(94,234,212,0.15) 0%, rgba(56,189,248,0.10) 100%)',
                color: '#5eead4', textDecoration: 'none', fontWeight: 700, fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.2s ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              {t('sprintPerf.openSprints')}
            </Link>
          </TooltipWrap>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 14,
          border: '1px solid rgba(248,113,113,0.35)',
          background: 'linear-gradient(135deg, rgba(248,113,113,0.12) 0%, rgba(239,68,68,0.06) 100%)',
          color: '#f87171', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Source & Filters ── */}
      <div style={{
        padding: 16, borderRadius: 16,
        border: '1px solid var(--panel-border-2)',
        background: 'var(--surface)',
        display: 'grid', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-38)' }}>{t('sprintPerf.source')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(hasAzure || !hasJira) && (
              <TooltipWrap text='Use Azure DevOps project, team and sprint source for performance calculations'>
                <button
                  onClick={() => { setProvider('azure'); setSelectedProject(''); setSelectedTeam(''); setSelectedSprint(''); }}
                  style={{
                    padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    border: provider === 'azure' ? '1px solid rgba(56,189,248,0.5)' : '1px solid var(--panel-border-3)',
                    background: provider === 'azure' ? 'linear-gradient(135deg, rgba(56,189,248,0.18) 0%, rgba(59,130,246,0.12) 100%)' : 'var(--panel-alt)',
                    color: provider === 'azure' ? '#7dd3fc' : 'var(--ink-58)',
                    boxShadow: provider === 'azure' ? '0 0 12px rgba(56,189,248,0.15)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {t('tasks.source.azure')}
                </button>
              </TooltipWrap>
            )}
            {(hasJira || !hasAzure) && (
              <TooltipWrap text='Use Jira project, board and sprint source for performance calculations'>
                <button
                  onClick={() => { setProvider('jira'); setSelectedProject(''); setSelectedTeam(''); setSelectedSprint(''); }}
                  style={{
                    padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    border: provider === 'jira' ? '1px solid rgba(129,140,248,0.5)' : '1px solid var(--panel-border-3)',
                    background: provider === 'jira' ? 'linear-gradient(135deg, rgba(129,140,248,0.18) 0%, rgba(99,102,241,0.12) 100%)' : 'var(--panel-alt)',
                    color: provider === 'jira' ? '#a5b4fc' : 'var(--ink-58)',
                    boxShadow: provider === 'jira' ? '0 0 12px rgba(129,140,248,0.15)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {t('tasks.source.jira')}
                </button>
              </TooltipWrap>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <TooltipWrap text='Select project to load related teams/boards and sprint data' full>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-85)', fontSize: 13 }}
            >
              <option value=''>{t('sprints.selectProject')}</option>
              {projectOptions.map((opt) => (
                <option key={String(opt.id || opt.name)} value={provider === 'jira' ? String(opt.id || opt.name) : opt.name}>{opt.name}</option>
              ))}
            </select>
          </TooltipWrap>
          <TooltipWrap text={provider === 'jira' ? 'Select Jira board for sprint performance metrics' : 'Select Azure team for sprint performance metrics'} full>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-85)', fontSize: 13 }}
            >
              <option value=''>{provider === 'jira' ? t('sprints.selectBoard') : t('sprints.selectTeam')}</option>
              {teamOptions.map((opt) => (
                <option key={String(opt.id || opt.name)} value={provider === 'jira' ? String(opt.id || opt.name) : opt.name}>{opt.name}</option>
              ))}
            </select>
          </TooltipWrap>
          <TooltipWrap text='Select sprint to compute team completion, risk, and blocked workload' full>
            <select
              value={selectedSprint}
              onChange={(e) => setSelectedSprint(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-85)', fontSize: 13 }}
            >
              <option value=''>{t('sprints.selectSprint')}</option>
              {sprintOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </TooltipWrap>
        </div>
      </div>

      {missingConfig ? (
        <div style={{
          padding: 24, borderRadius: 16,
          border: '1px dashed var(--panel-border-3)',
          background: 'var(--panel-alt)', color: 'var(--ink-58)', fontSize: 14,
          textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink-30)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
          {t('sprintPerf.noActiveSprint')}
        </div>
      ) : (
        <>
          {/* ── Sprint Health Overview ── */}
          <div className="dash-grid-responsive" style={{
            display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20,
            padding: 20, borderRadius: 16,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--surface)',
          }}>
            {/* Circular Gauge */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ position: 'relative', width: 130, height: 130 }}>
                <svg viewBox="0 0 120 120" width="130" height="130">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--panel-border-2)" strokeWidth="10" />
                  <circle
                    cx="60" cy="60" r="52" fill="none"
                    stroke={getScoreColor(avgCompletion)}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(avgCompletion / 100) * 327} 327`}
                    transform="rotate(-90 60 60)"
                    style={{ transition: 'stroke-dasharray 0.8s ease, stroke 0.5s ease', filter: `drop-shadow(0 0 6px ${getScoreColor(avgCompletion)}40)` }}
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: getScoreColor(avgCompletion), lineHeight: 1 }}>{avgCompletion}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-45)', marginTop: 2 }}>{t('sprintPerf.healthScore')}</span>
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8,
                padding: '3px 10px', borderRadius: 999,
                background: `${getScoreColor(avgCompletion)}18`,
                color: getScoreColor(avgCompletion),
                border: `1px solid ${getScoreColor(avgCompletion)}35`,
              }}>
                {sprintHealthLabel}
              </span>
            </div>

            {/* Metric Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignContent: 'center' }}>
              <GlowCard
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" /></svg>}
                label={t('sprintPerf.activeSprint')}
                value={activeSprintName || '\u2014'}
                accent="#38bdf8"
              />
              <GlowCard
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
                label={t('sprintPerf.timeline')}
                value={timelineProgress === null ? '\u2014' : `${Math.round(timelineProgress)}%`}
                sub={daysLeft === null ? t('sprintPerf.noDateRange') : (daysLeft === 1 ? t('sprintPerf.daysLeftSingle', { days: daysLeft }) : t('sprintPerf.daysLeft', { days: daysLeft }))}
                accent="#a78bfa"
                progress={timelineProgress ?? undefined}
              />
              <GlowCard
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
                label={t('sprintPerf.completedItems')}
                value={`${totalDone}/${totalItems}`}
                sub={totalItems > 0 ? `${Math.round((totalDone / totalItems) * 100)}% ${t('sprintPerf.completed')}` : undefined}
                accent="#34d399"
              />
              <GlowCard
                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>}
                label={t('sprintPerf.blockedLabel')}
                value={String(totalBlocked)}
                sub={`${totalPending} ${t('sprintPerf.pending')}`}
                accent={totalBlocked > 0 ? '#f87171' : '#fb923c'}
              />
            </div>
          </div>

          {/* ── Timeline Bar ── */}
          {timelineProgress !== null && (
            <div style={{
              padding: '14px 18px', borderRadius: 14,
              border: '1px solid var(--panel-border-2)',
              background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-75)' }}>{t('sprintPerf.sprintTimeline')}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-55)' }}>
                  {Math.round(timelineProgress)}% {t('sprintPerf.elapsed')}
                  {daysLeft !== null && ` \u00b7 ${daysLeft}d ${t('sprintPerf.remaining')}`}
                </span>
              </div>
              <div style={{ position: 'relative', width: '100%', height: 12, borderRadius: 999, background: 'var(--panel-border-2)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(0, Math.min(100, timelineProgress))}%`, height: '100%',
                  background: 'linear-gradient(90deg, #5eead4 0%, #38bdf8 50%, #818cf8 100%)',
                  borderRadius: 999,
                  transition: 'width 0.8s ease',
                  boxShadow: '0 0 10px rgba(94,234,212,0.3)',
                }} />
                {/* Work completion overlay */}
                {totalItems > 0 && (
                  <div style={{
                    position: 'absolute', top: 0, left: `${Math.round((totalDone / totalItems) * 100)}%`,
                    width: 2, height: '100%', background: '#22c55e',
                    boxShadow: '0 0 6px rgba(34,197,94,0.6)',
                  }} />
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--ink-38)' }}>{t('sprintPerf.start')}</span>
                {totalItems > 0 && (
                  <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>
                    {Math.round((totalDone / totalItems) * 100)}% {t('sprintPerf.workDone')}
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--ink-38)' }}>{t('sprintPerf.end')}</span>
              </div>
            </div>
          )}

          {/* ── Engineering Pulse (DORA + PR + Velocity) ── always rendered; DORA link gated */}
          <div style={{
            padding: 20, borderRadius: 16,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--surface)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>{t('sprintPerf.pulseTitle')}</h2>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)',
                }}>
                  {t('sprintPerf.pulseWindow')}
                </span>
              </div>
              {doraModuleEnabled && (
                <Link href="/dashboard/dora" style={{ fontSize: 11, color: 'var(--ink-58)', textDecoration: 'none' }}>
                  {t('sprintPerf.pulseSeeAll')} →
                </Link>
              )}
            </div>
            {pulseLoading && !doraMetrics && !prMetrics ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-45)', fontSize: 13 }}>
                {t('sprintPerf.pulseLoading')}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {/* Lead Time */}
                <PulseCard
                  label={t('sprintPerf.pulseLeadTime')}
                  value={doraMetrics?.lead_time_hours != null ? `${doraMetrics.lead_time_hours.toFixed(1)}h` : '—'}
                  sub={t('sprintPerf.pulseLeadTimeSub')}
                  accent="#38bdf8"
                />
                {/* Deploy Frequency */}
                <PulseCard
                  label={t('sprintPerf.pulseDeployFreq')}
                  value={doraMetrics?.deploy_frequency != null ? `${doraMetrics.deploy_frequency.toFixed(2)}/${t('sprintPerf.perDay')}` : '—'}
                  sub={t('sprintPerf.pulseDeployFreqSub')}
                  accent="#5eead4"
                  sparkline={deploySparkline}
                />
                {/* Change Failure Rate — backend already returns a percentage (0–100) */}
                <PulseCard
                  label={t('sprintPerf.pulseCfr')}
                  value={doraMetrics?.change_failure_rate != null ? `${doraMetrics.change_failure_rate.toFixed(1)}%` : '—'}
                  sub={t('sprintPerf.pulseCfrSub')}
                  accent={doraMetrics?.change_failure_rate != null && doraMetrics.change_failure_rate > 15 ? '#f87171' : '#fb923c'}
                />
                {/* MTTR */}
                <PulseCard
                  label={t('sprintPerf.pulseMttr')}
                  value={doraMetrics?.mttr_hours != null ? `${doraMetrics.mttr_hours.toFixed(1)}h` : '—'}
                  sub={t('sprintPerf.pulseMttrSub')}
                  accent="#a78bfa"
                />
                {/* PR review SLA */}
                <PulseCard
                  label={t('sprintPerf.pulsePrReview')}
                  value={prMetrics && prMetrics.merged_count > 0 ? `${Math.round(prMetrics.pct_merged_within_goal)}%` : '—'}
                  sub={prMetrics && prMetrics.merged_count > 0 ? t('sprintPerf.pulsePrReviewSub', { avg: prMetrics.avg_merge_hours.toFixed(1), goal: prMetrics.merge_goal_hours.toFixed(0) }) : t('sprintPerf.pulsePrReviewEmpty')}
                  accent={prMetrics && prMetrics.merged_count > 0 && prMetrics.pct_merged_within_goal >= 75 ? '#22c55e' : prMetrics && prMetrics.merged_count > 0 && prMetrics.pct_merged_within_goal >= 50 ? '#fb923c' : '#94a3b8'}
                />
                {/* AI task velocity */}
                <PulseCard
                  label={t('sprintPerf.pulseVelocity')}
                  value={velocitySparkline.length ? String(velocitySparkline.reduce((s, n) => s + n, 0)) : '—'}
                  sub={t('sprintPerf.pulseVelocitySub')}
                  accent="#facc15"
                  sparkline={velocitySparkline}
                />
              </div>
            )}
          </div>

          {/* ── Team Member Cards ── */}
          <div style={{
            padding: 20, borderRadius: 16,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--surface)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>{t('sprintPerf.teamProgress')}</h2>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)',
                }}>
                  {memberStats.length} {t('sprintPerf.members')}
                </span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--ink-38)', maxWidth: 280, textAlign: 'right' }}>
                {t('sprintPerf.riskRule')}
              </span>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {memberStats.map((member, idx) => {
                const isExpanded = expandedMember === member.key;
                const memberItems = allWorkItems.filter((item) => {
                  const assigned = String(item.assigned_to || '').trim().toLowerCase();
                  const name = member.name.trim().toLowerCase();
                  return assigned === name || assigned.includes(name) || name.includes(assigned);
                });
                return (
                <div
                  key={member.key}
                  style={{
                    borderRadius: 14,
                    border: `1px solid ${isExpanded ? 'rgba(94,234,212,0.45)' : member.critical ? 'rgba(248,113,113,0.35)' : 'var(--panel-border-2)'}`,
                    background: member.critical
                      ? 'linear-gradient(135deg, rgba(248,113,113,0.08) 0%, rgba(239,68,68,0.03) 100%)'
                      : isExpanded ? 'linear-gradient(135deg, rgba(94,234,212,0.06) 0%, var(--panel-alt) 100%)' : 'var(--panel-alt)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <button
                    onClick={() => setExpandedMember(isExpanded ? null : member.key)}
                    style={{
                      all: 'unset', width: '100%', cursor: 'pointer', padding: '14px 16px',
                      display: 'block', boxSizing: 'border-box',
                    }}
                  >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: getAvatarColor(member.name),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em',
                      flexShrink: 0,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}>
                      {getInitials(member.name)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700, color: 'var(--ink-90)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {idx === 0 && memberStats.length > 1 && member.score >= 75 && (
                            <span title="Top performer" style={{ marginRight: 4 }}>*</span>
                          )}
                          {member.name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 18, fontWeight: 800, color: getScoreColor(member.score),
                            lineHeight: 1,
                          }}>
                            {member.score}
                          </span>
                          <span style={{
                            padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: 0.5,
                            border: `1px solid ${member.critical ? 'rgba(248,113,113,0.45)' : 'rgba(34,197,94,0.35)'}`,
                            background: member.critical ? 'rgba(248,113,113,0.18)' : 'rgba(34,197,94,0.12)',
                            color: member.critical ? '#f87171' : '#22c55e',
                          }}>
                            {member.critical ? t('sprintPerf.critical') : t('sprintPerf.healthy')}
                          </span>
                          <span style={{
                            fontSize: 14, color: 'var(--ink-45)', transition: 'transform 0.2s',
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          }}>▾</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ position: 'relative', width: '100%', height: 8, borderRadius: 999, background: 'var(--panel-border-2)', overflow: 'hidden' }}>
                      {/* Done segment */}
                      <div style={{
                        position: 'absolute', left: 0, top: 0,
                        width: `${member.total > 0 ? (member.done / member.total) * 100 : 0}%`,
                        height: '100%',
                        background: getScoreGradient(member.score),
                        borderRadius: '999px 0 0 999px',
                        transition: 'width 0.6s ease',
                      }} />
                      {/* Blocked segment */}
                      {member.blocked > 0 && (
                        <div style={{
                          position: 'absolute', top: 0,
                          left: `${member.total > 0 ? (member.done / member.total) * 100 : 0}%`,
                          width: `${member.total > 0 ? (member.blocked / member.total) * 100 : 0}%`,
                          height: '100%',
                          background: 'repeating-linear-gradient(135deg, #ef444480 0px, #ef444480 3px, #ef444440 3px, #ef444440 6px)',
                          transition: 'width 0.6s ease',
                        }} />
                      )}
                    </div>
                  </div>

                  {/* Stats pills */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <StatPill color="#22c55e" label={t('sprintPerf.completed')} value={member.done} />
                    <StatPill color="#eab308" label={t('sprintPerf.pending')} value={member.pending} />
                    {member.blocked > 0 && <StatPill color="#ef4444" label="blocked" value={member.blocked} />}
                    <StatPill color="var(--ink-45)" label={t('sprintPerf.total')} value={member.total} />
                  </div>
                  </button>

                  {/* Expanded: work items list */}
                  {isExpanded && memberItems.length > 0 && (
                    <div style={{ padding: '0 16px 14px', display: 'grid', gap: 6 }}>
                      <div style={{ height: 1, background: 'var(--panel-border-2)', margin: '2px 0 6px' }} />
                      {memberItems.map((item) => {
                        const borderColor = getTaskBorderColor(item.state);
                        return (
                          <div key={item.id} style={{
                            padding: '8px 12px', borderRadius: 10,
                            borderLeft: `3px solid ${borderColor}`,
                            background: `${borderColor}08`,
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: borderColor,
                              boxShadow: `0 0 6px ${borderColor}60`,
                            }} />
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-85)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.web_url ? (
                                <a href={item.web_url} target='_blank' rel='noreferrer' style={{ color: 'inherit', textDecoration: 'none' }}>{item.title}</a>
                              ) : item.title}
                            </span>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                              background: `${borderColor}18`, color: borderColor,
                              border: `1px solid ${borderColor}30`, whiteSpace: 'nowrap',
                            }}>
                              {item.state || 'Unknown'}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--ink-35)', fontFamily: 'monospace', flexShrink: 0 }}>#{item.id}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })}
              {!memberStats.length && !loading && (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--ink-38)' }}>
                  {t('sprintPerf.noMembers')}
                </div>
              )}
            </div>
          </div>

          {/* ── Blocked By Assignee ── */}
          {blockedByAssignee.length > 0 && (
            <div style={{
              padding: 20, borderRadius: 16,
              border: '1px solid rgba(248,113,113,0.25)',
              background: 'linear-gradient(135deg, rgba(248,113,113,0.04) 0%, var(--surface) 100%)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: 'rgba(248,113,113,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>{t('sprintPerf.blockedByAssignee')}</h2>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-45)' }}>{t('sprintPerf.blockedByAssigneeSub')}</p>
                </div>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 700,
                  padding: '3px 10px', borderRadius: 999,
                  background: 'rgba(248,113,113,0.15)', color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.3)',
                }}>
                  {blockedItems.length} blocked
                </span>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {blockedByAssignee.map((group) => (
                  <div
                    key={group.assignee}
                    style={{
                      borderRadius: 12, padding: 14,
                      border: '1px solid rgba(248,113,113,0.2)',
                      background: 'rgba(248,113,113,0.04)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8,
                          background: getAvatarColor(group.assignee),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 800, color: '#fff',
                        }}>
                          {getInitials(group.assignee)}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>{group.assignee}</span>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#f87171',
                        padding: '2px 8px', borderRadius: 999,
                        background: 'rgba(248,113,113,0.15)',
                      }}>
                        {group.items.length} blocked
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {group.items.map((item) => (
                        <div key={`${group.assignee}-${item.id}`} style={{
                          padding: '8px 10px', borderRadius: 8,
                          background: 'rgba(248,113,113,0.06)',
                          border: '1px solid rgba(248,113,113,0.12)',
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-80)' }}>
                            <span style={{ color: 'var(--ink-45)', marginRight: 4 }}>#{item.id}</span>
                            {item.title}
                          </div>
                          {item.reason && (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-50)', lineHeight: 1.4 }}>{item.reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Blocked Items Detail ── */}
          <div style={{
            padding: 20, borderRadius: 16,
            border: '1px solid var(--panel-border-2)',
            background: 'var(--surface)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: 'rgba(251,146,60,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--ink-90)' }}>{t('sprintPerf.blockedTitle')}</h2>
            </div>

            {blockedItems.length === 0 ? (
              <div style={{
                padding: 20, textAlign: 'center', borderRadius: 12,
                border: '1px dashed var(--panel-border-3)',
                color: 'var(--ink-38)', fontSize: 13,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink-25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8, display: 'inline-block' }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div>{t('sprintPerf.blockedEmpty')}</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {blockedItems.map((item) => (
                  <div key={item.id} style={{
                    borderRadius: 12, padding: 14,
                    border: '1px solid rgba(248,113,113,0.25)',
                    background: 'linear-gradient(135deg, rgba(248,113,113,0.06) 0%, transparent 100%)',
                    transition: 'all 0.2s ease',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', flex: 1, minWidth: 0 }}>
                        {item.webUrl ? (
                          <a href={item.webUrl} target='_blank' rel='noreferrer' style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dashed var(--ink-30)' }}>
                            <span style={{ color: '#f87171', marginRight: 4 }}>#{item.id}</span>
                            {item.title}
                          </a>
                        ) : (
                          <>
                            <span style={{ color: '#f87171', marginRight: 4 }}>#{item.id}</span>
                            {item.title}
                          </>
                        )}
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8,
                        padding: '3px 8px', borderRadius: 999,
                        background: 'rgba(248,113,113,0.15)',
                        color: '#f87171', whiteSpace: 'nowrap',
                      }}>
                        {item.state}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 6,
                        background: getAvatarColor(item.assignee),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, fontWeight: 800, color: '#fff',
                      }}>
                        {getInitials(item.assignee)}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--ink-55)' }}>{item.assignee}</span>
                      <span style={{ flex: 1 }} />
                      <PingButton
                        state={pingState[item.id] || 'idle'}
                        onClick={() => void handlePing(item)}
                        labelIdle={t('sprintPerf.pingAction')}
                        labelLoading={t('sprintPerf.pingSending')}
                        labelSent={t('sprintPerf.pingSent')}
                        labelError={t('sprintPerf.pingRetry')}
                      />
                    </div>
                    {pingError[item.id] && pingState[item.id] === 'error' && (
                      <div style={{
                        marginTop: 6, fontSize: 11, color: '#f87171',
                        padding: '4px 8px', borderRadius: 6,
                        background: 'rgba(248,113,113,0.08)',
                      }}>
                        {pingError[item.id]}
                      </div>
                    )}
                    {item.reason && (
                      <div style={{
                        marginTop: 8, fontSize: 12, color: 'var(--ink-65)', lineHeight: 1.5,
                        padding: '8px 10px', borderRadius: 8,
                        background: 'rgba(248,113,113,0.04)',
                        borderLeft: '3px solid rgba(248,113,113,0.3)',
                      }}>
                        {item.reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

function GlowCard({ icon, label, value, sub, accent, progress }: {
  icon: ReactNode; label: string; value: string; sub?: string; accent: string; progress?: number;
}) {
  return (
    <div style={{
      padding: 14, borderRadius: 14,
      border: `1px solid ${accent}20`,
      background: `linear-gradient(135deg, ${accent}08 0%, transparent 100%)`,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 60, height: 60,
        borderRadius: '50%', background: `${accent}06`,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--ink-45)', fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 3 }}>{sub}</div>}
      {typeof progress === 'number' && (
        <div style={{ marginTop: 8, width: '100%', height: 4, borderRadius: 999, background: 'var(--panel-border-2)', overflow: 'hidden' }}>
          <div style={{
            width: `${Math.max(0, Math.min(100, progress))}%`, height: '100%',
            background: `linear-gradient(90deg, ${accent}, ${accent}80)`,
            borderRadius: 999, transition: 'width 0.6s ease',
          }} />
        </div>
      )}
    </div>
  );
}

function StatPill({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: 11,
      background: `${color}12`, color: color, fontWeight: 600,
      border: `1px solid ${color}20`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, opacity: 0.7 }} />
      {value} {label}
    </span>
  );
}

function TooltipWrap({ text, children, full = false }: { text: string; children: ReactNode; full?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', width: full ? '100%' : 'auto' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onTouchStart={() => {
        setOpen(true);
        window.setTimeout(() => setOpen(false), 2200);
      }}
    >
      {children}
      {open && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            maxWidth: 320,
            zIndex: 1200,
            background: 'rgba(2,6,23,0.96)',
            color: '#e2e8f0',
            border: '1px solid rgba(94,234,212,0.35)',
            borderRadius: 10,
            padding: '7px 10px',
            fontSize: 11,
            lineHeight: 1.3,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
            backdropFilter: 'blur(8px)',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

function PulseCard({ label, value, sub, accent, sparkline }: {
  label: string;
  value: string;
  sub: string;
  accent: string;
  sparkline?: number[];
}) {
  return (
    <div style={{
      padding: 14,
      borderRadius: 12,
      border: '1px solid var(--panel-border-2)',
      background: 'var(--panel)',
      display: 'grid',
      gap: 6,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-55)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-45)', lineHeight: 1.4 }}>
        {sub}
      </div>
      {sparkline && sparkline.length > 1 && (
        <Sparkline values={sparkline} color={accent} />
      )}
    </div>
  );
}

function PingButton({ state, onClick, labelIdle, labelLoading, labelSent, labelError }: {
  state: 'idle' | 'loading' | 'sent' | 'error';
  onClick: () => void;
  labelIdle: string;
  labelLoading: string;
  labelSent: string;
  labelError: string;
}) {
  const label = state === 'loading' ? labelLoading : state === 'sent' ? labelSent : state === 'error' ? labelError : labelIdle;
  const color = state === 'sent' ? '#22c55e' : state === 'error' ? '#f87171' : '#5eead4';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'loading' || state === 'sent'}
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${color}44`,
        background: `${color}14`,
        color,
        cursor: state === 'loading' || state === 'sent' ? 'default' : 'pointer',
        opacity: state === 'loading' ? 0.7 : 1,
        transition: 'all 0.15s ease',
      }}
    >
      {state === 'sent' ? '✓ ' : ''}{label}
    </button>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 120;
  const h = 24;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: 2 }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
      <polyline fill={`${color}18`} stroke="none" points={`0,${h} ${points} ${w},${h}`} />
    </svg>
  );
}
