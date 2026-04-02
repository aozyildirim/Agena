'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, loadPrefs, savePrefs, runFlow, getFlowRuns, FlowRunResult, createFlowVersion, getFlowVersion, listFlowVersions, createNotificationEvent, loadPromptCatalog } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = 'lead_developer' | 'pm' | 'qa' | 'manager' | 'developer' | string;
type NodeType = 'agent' | 'trigger' | 'http' | 'azure_update' | 'azure_devops' | 'github' | 'notify' | 'condition';

interface FlowNode {
  id: string;
  type: NodeType;
  role: AgentRole;
  label: string;
  icon: string;
  color: string;
  action: string;
  waitForApproval: boolean;
  x: number;
  y: number;
  // http node
  url?: string;
  method?: string;
  headers?: string;
  body?: string;
  // github node
  github_action?: string;
  repo?: string;
  branch?: string;
  pr_title?: string;
  // agent execution options
  execute_task_pipeline?: boolean;
  create_pr?: boolean;
  review_only?: boolean;
  auto_fix_from_comments?: boolean;
  // azure_update node
  new_state?: string;
  comment?: string;
  // notify node
  webhook_url?: string;
  notify_message?: string;
  // condition node
  condition_field?: string;
  condition_op?: string;
  condition_value?: string;
  true_target?: string;
  false_target?: string;
  // agent advanced
  model?: string;
  provider?: string;
  prompt_slug?: string;
  max_tokens?: number;
  temperature?: number;
  // http advanced
  auth_type?: string;
  auth_token?: string;
  auth_key_name?: string;
  auth_key_value?: string;
  timeout?: number;
  response_var?: string;
  // github advanced
  pr_description?: string;
  reviewers?: string;
  labels?: string;
  // notify advanced
  notify_channel?: string;
  // azure_devops node (PR operations)
  azure_action?: string;
  azure_project?: string;
  azure_repo?: string;
  azure_branch?: string;
  azure_pr_title?: string;
  azure_pr_description?: string;
  azure_reviewers?: string;
}

interface FlowEdge {
  from: string; // node id
  to: string;   // node id
}

interface Flow {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  createdAt: string;
}

interface FlowVersion {
  id: string;
  createdAt: string;
  label: string;
  flow: Flow;
}

interface DryRunStep {
  id: string;
  label: string;
  status: 'done' | 'waiting' | 'skipped';
  durationMs: number;
}

const AGENT_PRESETS: { role: AgentRole; icon: string; color: string }[] = [
  { role: 'manager', icon: '👔', color: '#f59e0b' },
  { role: 'pm', icon: '📋', color: '#a78bfa' },
  { role: 'lead_developer', icon: '🧑‍💻', color: '#38bdf8' },
  { role: 'developer', icon: '⚡', color: '#22c55e' },
  { role: 'qa', icon: '🔍', color: '#f472b6' },
];

const NODE_TYPE_PRESETS: { type: NodeType; icon: string; color: string }[] = [
  { type: 'trigger', icon: '⚡', color: '#f59e0b' },
  { type: 'http', icon: '🌐', color: '#38bdf8' },
  { type: 'azure_update', icon: '☁️', color: '#0078d4' },
  { type: 'azure_devops', icon: '🔷', color: '#0078d4' },
  { type: 'github', icon: '🐙', color: '#6e40c9' },
  { type: 'notify', icon: '🔔', color: '#fb923c' },
  { type: 'condition', icon: '🔀', color: '#22c55e' },
];

function agentRoleLabel(role: AgentRole, t: ReturnType<typeof useLocale>['t']) {
  if (role === 'manager') return t('agents.role.manager.label');
  if (role === 'pm') return t('agents.role.pm.label');
  if (role === 'lead_developer') return t('agents.role.leadDeveloper.label');
  if (role === 'developer') return t('agents.role.developer.label');
  if (role === 'qa') return t('agents.role.qa.label');
  return role;
}

function nodeTypeLabel(type: NodeType, t: ReturnType<typeof useLocale>['t']) {
  if (type === 'trigger') return t('flows.nodeTypeTrigger');
  if (type === 'http') return t('flows.nodeTypeHttp');
  if (type === 'azure_update') return t('flows.nodeTypeAzureUpdate');
  if (type === 'azure_devops') return 'Azure DevOps';
  if (type === 'github') return t('flows.nodeTypeGithub');
  if (type === 'notify') return t('flows.nodeTypeNotify');
  if (type === 'condition') return t('flows.nodeTypeCondition');
  return type;
}

function presetFlows(t: ReturnType<typeof useLocale>['t']): Flow[] {
  return [
  {
    id: 'pr-review-loop',
    name: t('flows.preset.prReviewLoop.name'),
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'p1', type: 'trigger', role: 'trigger', label: t('flows.preset.prReviewLoop.p1.label'), icon: '🧾', color: '#f59e0b', action: t('flows.preset.prReviewLoop.p1.action'), waitForApproval: false, x: 60, y: 160 },
      { id: 'p2', type: 'agent', role: 'developer', label: t('flows.preset.prReviewLoop.p2.label'), icon: '⚡', color: '#22c55e', action: t('flows.preset.prReviewLoop.p2.action'), execute_task_pipeline: true, create_pr: true, waitForApproval: false, x: 280, y: 160 },
      { id: 'p3', type: 'github', role: 'github', label: t('flows.preset.prReviewLoop.p3.label'), icon: '🐙', color: '#6e40c9', action: t('flows.preset.prReviewLoop.p3.action'), github_action: 'create_pr', pr_title: 'AI: {{title}}', waitForApproval: false, x: 500, y: 160 },
      { id: 'p4', type: 'agent', role: 'lead_developer', label: t('flows.preset.prReviewLoop.p4.label'), icon: '🧑‍💻', color: '#38bdf8', action: t('flows.preset.prReviewLoop.p4.action'), review_only: true, auto_fix_from_comments: true, waitForApproval: true, x: 720, y: 160 },
    ],
    edges: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'p3' }, { from: 'p3', to: 'p4' }],
  },
  {
    id: 'full-cycle',
    name: t('flows.preset.fullCycle.name'),
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'n1', type: 'agent', role: 'pm', label: t('flows.preset.fullCycle.n1.label'), icon: '📋', color: '#a78bfa', action: t('flows.preset.fullCycle.n1.action'), waitForApproval: false, x: 60,  y: 160 },
      { id: 'n2', type: 'agent', role: 'lead_developer', label: t('flows.preset.fullCycle.n2.label'), icon: '🧑‍💻', color: '#38bdf8', action: t('flows.preset.fullCycle.n2.action'), waitForApproval: true,  x: 280, y: 160 },
      { id: 'n3', type: 'agent', role: 'developer', label: t('flows.preset.fullCycle.n3.label'), icon: '⚡', color: '#22c55e', action: t('flows.preset.fullCycle.n3.action'), waitForApproval: false, x: 500, y: 160 },
      { id: 'n4', type: 'agent', role: 'qa', label: t('flows.preset.fullCycle.n4.label'), icon: '🔍', color: '#f472b6', action: t('flows.preset.fullCycle.n4.action'), waitForApproval: false, x: 720, y: 160 },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },
  {
    id: 'azure-pr-flow',
    name: 'Azure DevOps PR Flow',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'a1', type: 'trigger', role: 'trigger', label: 'Task Trigger', icon: '⚡', color: '#f59e0b', action: 'Triggered from sprint backlog', waitForApproval: false, x: 60, y: 160 },
      { id: 'a2', type: 'agent', role: 'pm', label: 'PM Analysis', icon: '📋', color: '#a78bfa', action: 'Analyze task and create implementation plan', waitForApproval: false, x: 260, y: 160 },
      { id: 'a3', type: 'agent', role: 'developer', label: 'Developer', icon: '⚡', color: '#22c55e', action: 'Implement the task according to the plan', execute_task_pipeline: true, waitForApproval: false, x: 460, y: 160 },
      { id: 'a4', type: 'azure_devops', role: 'azure_devops', label: 'Create PR', icon: '🔷', color: '#0078d4', action: 'Create pull request on Azure DevOps', azure_action: 'create_pr', azure_pr_title: 'AI: {{task.title}}', azure_pr_description: '## Summary\nAI-generated implementation for: {{task.title}}\n\n{{task.description}}', waitForApproval: false, x: 660, y: 160 },
      { id: 'a5', type: 'azure_update', role: 'azure_update', label: 'Update Work Item', icon: '☁️', color: '#0078d4', action: 'Set work item to Code Review', new_state: 'Code Review', comment: 'AI PR created — ready for review', waitForApproval: false, x: 860, y: 160 },
      { id: 'a6', type: 'notify', role: 'notify', label: 'Notify Team', icon: '🔔', color: '#fb923c', action: 'Notify team about PR', notify_message: 'PR created for: {{task.title}}', waitForApproval: false, x: 1060, y: 160 },
    ],
    edges: [{ from: 'a1', to: 'a2' }, { from: 'a2', to: 'a3' }, { from: 'a3', to: 'a4' }, { from: 'a4', to: 'a5' }, { from: 'a5', to: 'a6' }],
  },
  {
    id: 'quick-fix',
    name: t('flows.preset.quickFix.name'),
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'n1', type: 'agent', role: 'lead_developer', label: t('flows.preset.quickFix.n1.label'), icon: '🧑‍💻', color: '#38bdf8', action: t('flows.preset.quickFix.n1.action'), waitForApproval: false, x: 60,  y: 160 },
      { id: 'n2', type: 'agent', role: 'developer', label: t('flows.preset.quickFix.n2.label'), icon: '⚡', color: '#22c55e', action: t('flows.preset.quickFix.n2.action'), waitForApproval: false, x: 280, y: 160 },
      { id: 'n3', type: 'agent', role: 'qa', label: t('flows.preset.quickFix.n3.label'), icon: '🔍', color: '#f472b6', action: t('flows.preset.quickFix.n3.action'), waitForApproval: false, x: 500, y: 160 },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  ];
}

const LS_FLOWS = 'agena_flows';

function localizePresetFlow(flow: Flow, t: ReturnType<typeof useLocale>['t']): Flow {
  const preset = presetFlows(t).find((p) => p.id === flow.id);
  if (!preset) return flow;
  const presetNodeById = Object.fromEntries(preset.nodes.map((n) => [n.id, n]));
  return {
    ...flow,
    name: preset.name,
    nodes: flow.nodes.map((n) => {
      const pn = presetNodeById[n.id];
      if (!pn) return n;
      return { ...n, label: pn.label, action: pn.action };
    }),
  };
}

function loadFlows(defaults: Flow[], t: ReturnType<typeof useLocale>['t']): Flow[] {
  if (typeof window === 'undefined') return defaults;
  try {
    const s = localStorage.getItem(LS_FLOWS);
    if (!s) return defaults;
    const parsed = JSON.parse(s) as Flow[];
    return parsed.map((f) => localizePresetFlow({ ...f, nodes: f.nodes ?? [], edges: f.edges ?? [] }, t));
  }
  catch { return defaults; }
}
function saveFlowsLS(flows: Flow[]) { localStorage.setItem(LS_FLOWS, JSON.stringify(flows)); }

function sortNodesForRun(nodes: FlowNode[]): FlowNode[] {
  return [...nodes].sort((a, b) => a.x - b.x || a.y - b.y);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FlowsPage() {
  const { t } = useLocale();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [activeFlow, setActiveFlow] = useState<string>('full-cycle');
  const [creating, setCreating] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');
  const [showRuns, setShowRuns] = useState(false);
  const [runs, setRuns] = useState<FlowRunResult[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<FlowRunResult | null>(null);
  const [versionsByFlow, setVersionsByFlow] = useState<Record<string, FlowVersion[]>>({});
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [dryRunSteps, setDryRunSteps] = useState<DryRunStep[]>([]);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [dryRunSummary, setDryRunSummary] = useState('');
  const [gateApprovals, setGateApprovals] = useState<Record<string, boolean>>({});
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Flow | null>(null);

  useEffect(() => {
    const defaults = presetFlows(t);
    const local = loadFlows(defaults, t);
    setFlows(local);
    if (local.length) setActiveFlow(local[0].id);
    loadPrefs().then((p) => {
      if (p.flows?.length) {
        // nodes/edges undefined olabilir — normalize et
        const db = (p.flows as unknown as Flow[]).map((f) => ({
          ...f,
          nodes: f.nodes ?? [],
          edges: f.edges ?? [],
        }));
        const localized = db.map((f) => localizePresetFlow(f, t));
        setFlows(localized); saveFlowsLS(localized);
        setActiveFlow(db[0].id);
      }
    }).catch(() => {});
  }, [t]);

  useEffect(() => {
    if (!activeFlow) return;
    void listFlowVersions(activeFlow, 30).then((rows) => {
      const mapped: FlowVersion[] = rows.map((v) => ({
        id: String(v.id),
        createdAt: v.created_at,
        label: v.label,
        flow: v.flow as unknown as Flow,
      }));
      setVersionsByFlow((prev) => ({ ...prev, [activeFlow]: mapped }));
      setSelectedVersionId(mapped[0]?.id ?? '');
    }).catch(() => {
      const currentVersions = versionsByFlow[activeFlow] ?? [];
      setSelectedVersionId(currentVersions[0]?.id ?? '');
    });
  }, [activeFlow]);

  function snapshotVersion(flow: Flow, label: string) {
    const cloned: Flow = JSON.parse(JSON.stringify(flow)) as Flow;
    setVersionsByFlow((prev) => {
      const current = prev[flow.id] ?? [];
      const latest = current[0];
      const sameAsLatest = latest ? JSON.stringify(latest.flow) === JSON.stringify(cloned) : false;
      if (sameAsLatest) return prev;
      const nextForFlow: FlowVersion[] = [
        { id: String(Date.now()), createdAt: new Date().toISOString(), label, flow: cloned },
        ...current,
      ].slice(0, 30);
      const nextMap = { ...prev, [flow.id]: nextForFlow };
      return nextMap;
    });
    void createFlowVersion(flow.id, {
      flow_name: flow.name,
      label,
      flow: cloned as unknown as Record<string, unknown>,
    }).catch(() => {});
  }

  async function persist(next: Flow[]) {
    setFlows(next); saveFlowsLS(next);
    try { await savePrefs({ flows: next as unknown as Record<string, unknown>[] }); } catch { /* ok */ }
  }

  function createFlow() {
    if (!newFlowName.trim()) return;
    const f: Flow = {
      id: Date.now().toString(), name: newFlowName.trim(),
      nodes: [], edges: [], createdAt: new Date().toISOString(),
    };
    const next = [...flows, f];
    void persist(next);
    snapshotVersion(f, t('flows.versionCreated'));
    setActiveFlow(f.id);
    setCreating(false); setNewFlowName('');
  }

  function deleteFlow(id: string) {
    const next = flows.filter((f) => f.id !== id);
    void persist(next);
    setVersionsByFlow((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setActiveFlow(next[0]?.id ?? '');
  }

  function requestDeleteFlow(flow: Flow) {
    setDeleteCandidate(flow);
  }

  function confirmDeleteFlow() {
    if (!deleteCandidate) return;
    deleteFlow(deleteCandidate.id);
    setDeleteCandidate(null);
  }

  function updateFlow(updated: Flow) {
    const next = flows.map((f) => f.id === updated.id ? updated : f);
    void persist(next);
    snapshotVersion(updated, t('flows.versionUpdated'));
  }

  function saveManualVersion() {
    if (!current) return;
    snapshotVersion(current, t('flows.versionCheckpoint'));
  }

  async function rollbackToVersion() {
    if (!current || !selectedVersionId) return;
    if (/^\d+$/.test(selectedVersionId)) {
      try {
        const ver = await getFlowVersion(current.id, Number(selectedVersionId));
        const rolledFromDb: Flow = { ...(ver.flow as unknown as Flow), id: current.id, name: current.name };
        updateFlow(rolledFromDb);
        return;
      } catch {
        // fallback to local snapshot map
      }
    }
    const target = (versionsByFlow[current.id] ?? []).find((v) => v.id === selectedVersionId);
    if (!target) return;
    const rolled: Flow = { ...target.flow, id: current.id, name: current.name };
    updateFlow(rolled);
  }

  async function runDrySimulation() {
    if (!current) return;
    setRunningDryRun(true);
    setDryRunOpen(true);
    const ordered = sortNodesForRun(current.nodes);
    const steps: DryRunStep[] = [];
    let stoppedByGate = false;
    for (const node of ordered) {
      if (node.waitForApproval && !gateApprovals[node.id]) {
        steps.push({ id: node.id, label: `${node.label} (${t('flows.approvalRequired')})`, status: 'waiting', durationMs: 0 });
        stoppedByGate = true;
        break;
      }
      const durationMs = 180 + Math.floor(Math.random() * 900);
      await new Promise((r) => setTimeout(r, 60));
      steps.push({ id: node.id, label: node.label, status: 'done', durationMs });
    }
    if (!stoppedByGate && steps.length < ordered.length) {
      const done = new Set(steps.map((s) => s.id));
      ordered.filter((n) => !done.has(n.id)).forEach((n) => {
        steps.push({ id: n.id, label: n.label, status: 'skipped', durationMs: 0 });
      });
    }
    setDryRunSteps(steps);
    setDryRunSummary(stoppedByGate ? t('flows.dryRunPaused') : t('flows.dryRunDone'));
    setRunningDryRun(false);
  }

  async function loadRuns() {
    setRunsLoading(true);
    try {
      const data = await getFlowRuns(30);
      setRuns(data);
    } catch { /* ok */ }
    finally { setRunsLoading(false); }
  }

  function toggleRuns() {
    if (!showRuns) loadRuns();
    setShowRuns((v) => !v);
    setSelectedRun(null);
  }

  const current = flows.find((f) => f.id === activeFlow);

  return (
    <div className="flow-page-root" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)', gap: 0 }}>
      {/* Top bar */}
      <div className="flow-top-bar" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 0 14px', flexShrink: 0 }}>
        {/* Row 1: Title + Flow tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', margin: 0, whiteSpace: 'nowrap' }}>{t('flows.title')}</h1>
          <div className="flow-tabs" style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
            {flows.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <button onClick={() => setActiveFlow(f.id)}
                  style={{ padding: '6px 12px', borderRadius: activeFlow === f.id ? '8px 0 0 8px' : 8, border: '1px solid ' + (activeFlow === f.id ? 'var(--border)' : 'var(--panel-border-3)'), borderRight: activeFlow === f.id ? 'none' : undefined, background: activeFlow === f.id ? 'var(--panel)' : 'transparent', color: activeFlow === f.id ? 'var(--ink)' : 'var(--ink-50)', fontWeight: activeFlow === f.id ? 700 : 400, fontSize: 12, cursor: 'pointer' }}>
                  {f.name}
                </button>
                {activeFlow === f.id && (
                  <button onClick={() => requestDeleteFlow(f)} title={t('flows.deleteFlow')}
                    style={{ padding: '6px 7px', borderRadius: '0 8px 8px 0', border: '1px solid rgba(248,113,113,0.25)', borderLeft: 'none', background: 'rgba(248,113,113,0.08)', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>×</button>
                )}
              </div>
            ))}
            {creating ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input value={newFlowName} onChange={(e) => setNewFlowName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createFlow()}
                  placeholder={t('flows.newPlaceholder')} autoFocus
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 12, outline: 'none', width: 120 }} />
                <button onClick={createFlow} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#0d9488', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>+</button>
                <button onClick={() => setCreating(false)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-35)', fontSize: 12, cursor: 'pointer' }}>×</button>
              </div>
            ) : (
              <button onClick={() => setCreating(true)}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px dashed var(--ink-25)', background: 'transparent', color: 'var(--ink-35)', fontSize: 12, cursor: 'pointer' }}>
                + {t('flows.new')}
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Actions — grouped and compact */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={toggleRuns}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid ' + (showRuns ? 'rgba(94,234,212,0.4)' : 'var(--panel-border-3)'), background: showRuns ? 'rgba(94,234,212,0.1)' : 'transparent', color: showRuns ? '#5eead4' : 'var(--ink-45)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
            {t('flows.runHistory')}
          </button>
          <Link href='/dashboard/templates'
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-45)', fontSize: 11, textDecoration: 'none', fontWeight: 600 }}>
            {t('flows.templates')}
          </Link>
          <div style={{ width: 1, height: 16, background: 'var(--panel-border-2)' }} />
          <button onClick={saveManualVersion}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-45)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
            {t('flows.saveVersion')}
          </button>
          <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-58)', fontSize: 11, maxWidth: 180 }}>
            <option value=''>{t('flows.selectVersion')}</option>
            {(versionsByFlow[activeFlow] ?? []).map((v) => (
              <option key={v.id} value={v.id} style={{ background: 'var(--surface)' }}>
                {new Date(v.createdAt).toLocaleString()} - {v.label}
              </option>
            ))}
          </select>
          <button onClick={rollbackToVersion} disabled={!selectedVersionId}
            style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.25)', background: selectedVersionId ? 'rgba(248,113,113,0.08)' : 'transparent', color: selectedVersionId ? '#f87171' : 'var(--ink-25)', fontSize: 11, cursor: selectedVersionId ? 'pointer' : 'not-allowed', fontWeight: 600 }}>
            {t('flows.rollback')}
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--panel-border-2)' }} />
          <button onClick={() => void runDrySimulation()} disabled={runningDryRun || !current}
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 11, cursor: runningDryRun ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {runningDryRun ? t('flows.dryRunning') : t('flows.dryRun')}
          </button>
        </div>
      </div>

      {current && current.nodes.some((n) => n.waitForApproval) && (
        <div style={{ marginBottom: 12, borderRadius: 12, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.06)', padding: '10px 12px', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>{t('flows.approvalGates')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {current.nodes.filter((n) => n.waitForApproval).map((n) => (
              <button key={n.id} onClick={() => {
                const nextApproved = !gateApprovals[n.id];
                setGateApprovals((prev) => ({ ...prev, [n.id]: nextApproved }));
                void createNotificationEvent({
                  event_type: nextApproved ? 'approval_decision' : 'approval_required',
                  title: nextApproved ? t('flows.approvalApprovedTitle') : t('flows.approvalPendingTitle'),
                  message: `${current.name} / ${n.label}`,
                  severity: nextApproved ? 'success' : 'warning',
                });
              }}
                style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid ' + (gateApprovals[n.id] ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'), background: gateApprovals[n.id] ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', color: gateApprovals[n.id] ? '#22c55e' : '#f59e0b', fontSize: 12, cursor: 'pointer' }}>
                {gateApprovals[n.id] ? t('flows.approved') : t('flows.pending')}: {n.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {dryRunOpen && (
        <div style={{ marginBottom: 12, borderRadius: 14, border: '1px solid rgba(34,197,94,0.2)', background: 'var(--panel)', padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>{t('flows.dryRunResult')}</div>
            <button onClick={() => setDryRunOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--ink-45)', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-35)' }}>{dryRunSummary}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {dryRunSteps.map((s) => (
              <div key={s.id} style={{ borderRadius: 9, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: '8px 10px', fontSize: 12, color: 'var(--ink-78)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.label}</span>
                <span style={{ color: s.status === 'done' ? '#22c55e' : s.status === 'waiting' ? '#f59e0b' : 'var(--ink-35)' }}>
                  {s.status === 'done'
                    ? `${s.durationMs}ms`
                    : s.status === 'waiting'
                      ? t('flows.stepStatus.waiting')
                      : t('flows.stepStatus.skipped')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleteCandidate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(500px, 100%)', borderRadius: 16, border: '1px solid rgba(248,113,113,0.28)', background: 'var(--surface)', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, rgba(248,113,113,0.9), transparent)' }} />
            <div style={{ padding: 18, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{t('flows.deleteConfirmTitle')}</div>
                <button onClick={() => setDeleteCandidate(null)} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-45)', cursor: 'pointer', fontSize: 13 }}>×</button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-58)', lineHeight: 1.6 }}>
                {t('flows.deleteConfirmDesc')}
              </div>
              <div style={{ borderRadius: 10, border: '1px solid rgba(248,113,113,0.28)', background: 'rgba(248,113,113,0.08)', color: 'var(--ink-78)', padding: '8px 10px', fontSize: 12, fontWeight: 700 }}>
                {deleteCandidate.name}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
                <button onClick={() => setDeleteCandidate(null)} className='button button-outline' style={{ minWidth: 110, justifyContent: 'center' }}>
                  {t('flows.cancel')}
                </button>
                <button onClick={confirmDeleteFlow} className='button button-outline' style={{ minWidth: 140, justifyContent: 'center', borderColor: 'rgba(248,113,113,0.45)', color: '#f87171', background: 'rgba(248,113,113,0.1)' }}>
                  {t('flows.deleteNow')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Canvas + Run History */}
      <div className="flow-canvas-area" style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {current ? (
            <FlowCanvas flow={current} onChange={updateFlow} />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-25)', fontSize: 14, borderRadius: 20, border: '1px solid var(--panel-border)', background: 'var(--panel)' }}>
              {t('flows.empty')}
            </div>
          )}
        </div>

        {/* Run History Panel — overlay olarak açılır, canvas'ı ezmez */}
        {showRuns && (
          <div className="flow-run-panel" style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <RunHistoryPanel
              runs={runs}
              loading={runsLoading}
              selected={selectedRun}
              onSelect={setSelectedRun}
              onRefresh={loadRuns}
              onClose={() => { setShowRuns(false); setSelectedRun(null); }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── FlowCanvas ────────────────────────────────────────────────────────────────
const NODE_W = 180;
const NODE_H = 90;

function FlowCanvas({ flow, onChange }: { flow: Flow; onChange: (f: Flow) => void }) {
  const { t } = useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragPosRef = useRef(dragPos);
  dragPosRef.current = dragPos;
  // connecting: sürükleme ile bağlantı — sourceId + anlık fare pozisyonu
  const [connecting, setConnecting] = useState<{ sourceId: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [editNode, setEditNode] = useState<FlowNode | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null); // bağlantı hedefi

  // ESC → connecting iptal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setConnecting(null); setShowPicker(false); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Helper: extract clientX/clientY from mouse or touch event
  function getPointer(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in e) {
      const t = (e as TouchEvent).touches[0] || (e as TouchEvent).changedTouches[0];
      return { clientX: t.clientX, clientY: t.clientY };
    }
    return { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
  }

  // ── Connector dot'tan drag-to-connect ──
  const onConnectorMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent, sourceId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = getPointer(e);
    setConnecting({
      sourceId,
      x: p.clientX - rect.left - canvasOffset.x,
      y: p.clientY - rect.top - canvasOffset.y,
    });
  }, [canvasOffset]);

  // ── Drag node ──
  const onNodeMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent, id: string) => {
    e.stopPropagation();
    if (connecting) return;
    setSelected(id);
    const node = flow.nodes.find((n) => n.id === id)!;
    const p = getPointer(e);
    setDragging({ id, ox: p.clientX - node.x, oy: p.clientY - node.y });
  }, [connecting, flow]);

  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const panStartRef = useRef(panStart);
  panStartRef.current = panStart;
  const connectingRef = useRef(connecting);
  connectingRef.current = connecting;
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const canvasOffsetRef = useRef(canvasOffset);
  canvasOffsetRef.current = canvasOffset;

  useEffect(() => {
    function handleMove(e: MouseEvent | TouchEvent) {
      const p = 'touches' in e ? { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } : { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
      const drag = draggingRef.current;
      if (drag) {
        if ('touches' in e) e.preventDefault();
        const nx = Math.max(0, p.clientX - drag.ox);
        const ny = Math.max(0, p.clientY - drag.oy);
        setDragPos({ id: drag.id, x: nx, y: ny });
      }
      const pan = panStartRef.current;
      if (pan) {
        if ('touches' in e) e.preventDefault();
        setCanvasOffset({ x: pan.ox + p.clientX - pan.mx, y: pan.oy + p.clientY - pan.my });
      }
      if (connectingRef.current) {
        if ('touches' in e) e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const off = canvasOffsetRef.current;
        setConnecting((prev) => prev ? {
          ...prev,
          x: p.clientX - rect.left - off.x,
          y: p.clientY - rect.top - off.y,
        } : null);
        const mx = p.clientX - rect.left - off.x;
        const my = p.clientY - rect.top - off.y;
        const f = flowRef.current;
        const conn = connectingRef.current;
        const over = f.nodes.find((n) =>
          mx >= n.x && mx <= n.x + NODE_W &&
          my >= n.y && my <= n.y + NODE_H &&
          n.id !== conn.sourceId
        );
        setHoverTarget(over?.id ?? null);
      }
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: false });
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('touchmove', handleMove); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  // Global mouseup/touchend
  useEffect(() => {
    function handleEnd(e: MouseEvent | TouchEvent) {
      const pos = dragPosRef.current;
      if (pos) {
        const f = flowRef.current;
        onChange({ ...f, nodes: f.nodes.map((n) => n.id === pos.id ? { ...n, x: pos.x, y: pos.y } : n) });
        setDragPos(null);
      }
      setDragging(null);
      setPanStart(null);
      const conn = connectingRef.current;
      if (conn) {
        const p = 'changedTouches' in e ? { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY } : { clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY };
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const mx = p.clientX - rect.left - canvasOffsetRef.current.x;
          const my = p.clientY - rect.top - canvasOffsetRef.current.y;
          const f = flowRef.current;
          const target = f.nodes.find((n) =>
            mx >= n.x && mx <= n.x + NODE_W &&
            my >= n.y && my <= n.y + NODE_H &&
            n.id !== conn.sourceId
          );
          if (target && !f.edges.some((ed) => ed.from === conn.sourceId && ed.to === target.id)) {
            onChange({ ...f, edges: [...f.edges, { from: conn.sourceId, to: target.id }] });
          }
        }
        setConnecting(null);
        setHoverTarget(null);
      }
    }
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);
    return () => { window.removeEventListener('mouseup', handleEnd); window.removeEventListener('touchend', handleEnd); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (connecting) { setConnecting(null); return; }
    setSelected(null);
    const p = getPointer(e);
    setPanStart({ mx: p.clientX, my: p.clientY, ox: canvasOffset.x, oy: canvasOffset.y });
  }, [connecting, canvasOffset]);

  function getNextNodePosition() {
    const viewW = Math.max(360, (canvasRef.current?.clientWidth ?? 700));
    const viewH = Math.max(260, (canvasRef.current?.clientHeight ?? 400));
    const left = Math.max(16, -canvasOffset.x + 16);
    const top = Math.max(16, -canvasOffset.y + 16);
    const horizontalGap = NODE_W + 28;
    const verticalGap = NODE_H + 24;
    const cols = Math.max(1, Math.floor((viewW - 32) / horizontalGap));
    const index = flow.nodes.length;
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      x: left + col * horizontalGap,
      y: top + row * verticalGap,
    };
  }

  function addNode(preset: typeof AGENT_PRESETS[0]) {
    const id = 'n' + Date.now();
    const pos = getNextNodePosition();
    const node: FlowNode = {
      id, type: 'agent', role: preset.role, label: agentRoleLabel(preset.role, t), icon: preset.icon,
      color: preset.color, action: '', waitForApproval: false,
      x: pos.x, y: pos.y,
    };
    onChange({ ...flow, nodes: [...flow.nodes, node] });
    setShowPicker(false);
  }

  function addTypeNode(preset: typeof NODE_TYPE_PRESETS[0]) {
    const id = 'n' + Date.now();
    const pos = getNextNodePosition();
    const node: FlowNode = {
      id, type: preset.type, role: preset.type, label: nodeTypeLabel(preset.type, t), icon: preset.icon,
      color: preset.color, action: '', waitForApproval: false,
      x: pos.x, y: pos.y,
    };
    onChange({ ...flow, nodes: [...flow.nodes, node] });
    setShowPicker(false);
    setEditNode(node);
  }

  function addCustomNode() {
    const id = 'n' + Date.now();
    const pos = getNextNodePosition();
    const node: FlowNode = {
      id, type: 'agent', role: 'custom', label: t('flows.customAgent'), icon: '🤖', color: '#5eead4',
      action: '', waitForApproval: false,
      x: pos.x, y: pos.y,
    };
    onChange({ ...flow, nodes: [...flow.nodes, node] });
    setShowPicker(false);
    setEditNode(node);
  }

  function deleteNode(id: string) {
    onChange({
      ...flow,
      nodes: flow.nodes.filter((n) => n.id !== id),
      edges: flow.edges.filter((e) => e.from !== id && e.to !== id),
    });
    setSelected(null);
  }

  function deleteEdge(from: string, to: string) {
    onChange({ ...flow, edges: flow.edges.filter((e) => !(e.from === from && e.to === to)) });
  }

  function handleDeleteEdgeEvent(
    e: React.MouseEvent<SVGPathElement | SVGCircleElement | SVGTextElement>,
    from: string,
    to: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    deleteEdge(from, to);
  }

  function updateNode(patch: Partial<FlowNode>) {
    if (!editNode) return;
    const updated = { ...editNode, ...patch };
    setEditNode(updated);
    onChange({ ...flow, nodes: flow.nodes.map((n) => n.id === updated.id ? updated : n) });
  }

  // Edge path between two nodes
  function edgePath(from: FlowNode, to: FlowNode) {
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  const visualNodes = flow.nodes.map((n) => dragPos && dragPos.id === n.id ? { ...n, x: dragPos.x, y: dragPos.y } : n);
  const canvasW = Math.max(900, ...visualNodes.map((n) => n.x + NODE_W + 80));
  const canvasH = Math.max(400, ...visualNodes.map((n) => n.y + NODE_H + 80));

  return (
    <div style={{ flex: 1, display: 'flex', gap: 0, minHeight: 0, borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--surface)', position: 'relative', height: '100%' }}>

      {/* Left toolbar */}
      <div className="flow-toolbar-desktop" style={{ width: 52, flexShrink: 0, borderRight: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 8, background: 'var(--panel-alt)' }}>
        <ToolBtn title={t('flows.toolbarAddNode')} onClick={() => setShowPicker(true)}>+</ToolBtn>
        <div style={{ flex: 1 }} />
        <ToolBtn title={t('flows.toolbarReset')} onClick={() => setCanvasOffset({ x: 0, y: 0 })}>⊙</ToolBtn>
      </div>

      {/* Canvas */}
      <div ref={canvasRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'none', cursor: connecting ? 'crosshair' : panStart ? 'grabbing' : 'default', backgroundImage: 'radial-gradient(circle, var(--panel-border) 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundPosition: `${canvasOffset.x % 20}px ${canvasOffset.y % 20}px` }}
        onMouseDown={onCanvasMouseDown} onTouchStart={onCanvasMouseDown}>

        {/* SVG edges */}
        <svg ref={svgRef} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
          width={canvasW} height={canvasH}
          onMouseDown={onCanvasMouseDown}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="rgba(94,234,212,0.7)" />
            </marker>
            <marker id="arrow-preview" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="rgba(94,234,212,0.5)" />
            </marker>
          </defs>
          <g transform={`translate(${canvasOffset.x},${canvasOffset.y})`}>
            {flow.edges.map((edge) => {
              const from = visualNodes.find((n) => n.id === edge.from);
              const to   = visualNodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const midX = (from.x + NODE_W + to.x) / 2;
              const midY = (from.y + to.y + NODE_H) / 2;
              return (
                <g key={edge.from + '-' + edge.to} style={{ pointerEvents: 'all' }}>
                  <path d={edgePath(from, to)} fill="none" stroke="rgba(94,234,212,0.25)" strokeWidth={2} markerEnd="url(#arrow)" style={{ pointerEvents: 'none' }} />
                  {/* invisible wider hit area */}
                  <path d={edgePath(from, to)} fill="none" stroke="transparent" strokeWidth={12}
                    style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                    onMouseDown={(e) => handleDeleteEdgeEvent(e, edge.from, edge.to)}
                    onClick={(e) => handleDeleteEdgeEvent(e, edge.from, edge.to)} />
                  {/* delete dot */}
                  <circle cx={midX} cy={midY} r={12} fill="var(--surface)" stroke="rgba(248,113,113,0.58)" strokeWidth={1.6}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onMouseDown={(e) => handleDeleteEdgeEvent(e, edge.from, edge.to)}
                    onClick={(e) => handleDeleteEdgeEvent(e, edge.from, edge.to)} />
                  <text
                    x={midX}
                    y={midY + 4}
                    textAnchor="middle"
                    fontSize={12}
                    fill="#f87171"
                    style={{ pointerEvents: 'all', userSelect: 'none', cursor: 'pointer' }}
                    onMouseDown={(e) => handleDeleteEdgeEvent(e, edge.from, edge.to)}
                    onClick={(e) => handleDeleteEdgeEvent(e, edge.from, edge.to)}
                  >
                    ×
                  </text>
                </g>
              );
            })}

            {/* Drag-to-connect preview line */}
            {connecting && (() => {
              const src = visualNodes.find((n) => n.id === connecting.sourceId);
              if (!src) return null;
              const x1 = src.x + NODE_W;
              const y1 = src.y + NODE_H / 2;
              const x2 = connecting.x;
              const y2 = connecting.y;
              const cx = (x1 + x2) / 2;
              return (
                <path
                  d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="rgba(94,234,212,0.5)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  markerEnd="url(#arrow-preview)"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })()}
          </g>
        </svg>

        {/* Nodes */}
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${canvasOffset.x}px,${canvasOffset.y}px)`, pointerEvents: 'none' }}>
          {visualNodes.map((node, idx) => {
            return (<FlowNodeCard
              key={node.id}
              node={node}
              index={idx}
              selected={selected === node.id}
              connecting={!!connecting}
              isDropTarget={hoverTarget === node.id}
              onMouseDown={(e) => onNodeMouseDown(e, node.id)}
              onMouseEnterNode={() => connecting && node.id !== connecting.sourceId && setHoverTarget(node.id)}
              onMouseLeaveNode={() => setHoverTarget(null)}
              onConnectorMouseDown={(e) => onConnectorMouseDown(e, node.id)}
              onEdit={() => setEditNode(node)}
              onDelete={() => deleteNode(node.id)}
            />);
          })}
        </div>

        {/* Empty state */}
        {flow.nodes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 40, opacity: 0.08, marginBottom: 12 }}>⟳</div>
            <div style={{ color: 'var(--panel-border-4)', fontSize: 13 }}>{t('flows.addNodeHint')}</div>
          </div>
        )}

        {/* Connecting hint */}
        {connecting && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', padding: '6px 16px', borderRadius: 999, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink-78)', fontSize: 12, fontWeight: 700, pointerEvents: 'none' }}>
            {t('flows.dragToTarget')} - {t('flows.dragCancel')}
          </div>
        )}
      </div>

      {/* Mobile floating add button (hidden on desktop via CSS) */}
      <button
        className="flow-mobile-add-btn"
        onClick={() => setShowPicker(true)}
        style={{
          display: 'none', position: 'absolute', bottom: 16, right: 16, zIndex: 90,
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--brand)', border: 'none', color: '#fff',
          fontSize: 24, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(13,148,136,0.4)',
          alignItems: 'center', justifyContent: 'center',
        }}
      >+</button>

      {/* Node picker panel */}
      {showPicker && (
        <div style={{ position: 'absolute', left: 60, top: 12, zIndex: 100, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', padding: 16, width: 230, boxShadow: '0 12px 40px rgba(0,0,0,0.15)', maxHeight: 'calc(100% - 24px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-30)', textTransform: 'uppercase', marginBottom: 8 }}>{t('flows.agentRoles')}</div>
          <div style={{ display: 'grid', gap: 5, marginBottom: 12 }}>
            {AGENT_PRESETS.map((p) => (
              <button key={p.role} onClick={() => addNode(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid ' + p.color + '30', background: p.color + '0a', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-78)' }}>{agentRoleLabel(p.role, t)}</span>
              </button>
            ))}
            <button onClick={addCustomNode}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px dashed var(--panel-border-4)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-35)' }}>{t('flows.customAgent')}</span>
            </button>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--ink-30)', textTransform: 'uppercase', marginBottom: 8 }}>{t('flows.nodeTypes')}</div>
          <div style={{ display: 'grid', gap: 5 }}>
            {NODE_TYPE_PRESETS.map((p) => (
              <button key={p.type} onClick={() => addTypeNode(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid ' + p.color + '30', background: p.color + '0a', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-78)' }}>{nodeTypeLabel(p.type, t)}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowPicker(false)}
            style={{ marginTop: 10, width: '100%', padding: '7px', borderRadius: 9, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-30)', fontSize: 12, cursor: 'pointer' }}>
            {t('flows.close')}
          </button>
        </div>
      )}

      {/* Node edit panel */}
      {editNode && (
        <NodeEditPanel
          node={editNode}
          onChange={updateNode}
          onClose={() => setEditNode(null)}
          flow={flow}
        />
      )}
    </div>
  );
}

// ── FlowNodeCard ──────────────────────────────────────────────────────────────
function FlowNodeCard({ node, index, selected, connecting, isDropTarget, onMouseDown, onMouseEnterNode, onMouseLeaveNode, onConnectorMouseDown, onEdit, onDelete }: {
  node: FlowNode; index: number; selected: boolean; connecting: boolean; isDropTarget: boolean;
  onMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onMouseEnterNode: () => void;
  onMouseLeaveNode: () => void;
  onConnectorMouseDown: (e: React.MouseEvent | React.TouchEvent) => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const { t } = useLocale();
  const [hovered, setHovered] = useState(false);
  const roleText = node.type === 'agent' ? agentRoleLabel(node.role, t) : nodeTypeLabel(node.type, t);

  const borderColor = isDropTarget ? '#5eead4'
    : selected ? node.color
    : hovered ? node.color + '60'
    : 'var(--panel-border-3)';

  return (
    <div
      style={{
        position: 'absolute',
        left: node.x, top: node.y,
        width: NODE_W, height: NODE_H,
        borderRadius: 12,
        border: '1px solid ' + borderColor,
        borderLeft: '4px solid ' + node.color,
        background: isDropTarget ? 'rgba(94,234,212,0.08)' : selected ? node.color + '0a' : 'var(--surface)',
        boxShadow: isDropTarget ? '0 0 20px rgba(94,234,212,0.3)' : selected ? '0 0 20px ' + node.color + '20' : hovered ? '0 4px 16px rgba(0,0,0,0.18)' : '0 1px 4px rgba(0,0,0,0.08)',
        cursor: connecting ? 'crosshair' : 'grab',
        userSelect: 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
        overflow: 'visible',
        pointerEvents: 'all',
      }}
      onMouseDown={onMouseDown}
      onTouchStart={onMouseDown}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => { setHovered(false); }}
    >
      {/* Step number */}
      <div style={{ position: 'absolute', top: -10, left: 12, width: 20, height: 20, borderRadius: '50%', background: node.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff' }}>
        {index + 1}
      </div>

      {/* Content */}
      <div style={{ padding: '14px 14px 10px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{node.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</div>
            <div style={{ fontSize: 10, color: 'var(--ink-45)', fontWeight: 500, marginTop: 2 }}>{roleText}</div>
          </div>
        </div>
        {node.action && (
          <div style={{ fontSize: 10, color: 'var(--ink-45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>{node.action}</div>
        )}
        {node.waitForApproval && (
          <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', marginTop: 2 }}>⏸ {t('flows.nodeAwaitingApproval')}</div>
        )}
      </div>

      {/* Right connector dot(s) */}
      {node.type === 'condition' ? (<>
        {/* True connector — green, top-right */}
        <div
          title="True path"
          onMouseDown={onConnectorMouseDown}
          onTouchStart={onConnectorMouseDown}
          style={{
            position: 'absolute', right: -8, top: '30%', transform: 'translateY(-50%)',
            width: 16, height: 16, borderRadius: '50%',
            background: '#22c55e', border: '2px solid var(--surface)',
            cursor: 'crosshair', zIndex: 10,
            opacity: hovered || selected ? 1 : 0,
            transition: 'opacity 0.15s',
            boxShadow: '0 0 8px #22c55e',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1.4)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1)'; }}
        />
        {(hovered || selected) && <div style={{ position: 'absolute', right: 12, top: 'calc(30% - 14px)', fontSize: 8, fontWeight: 700, color: '#22c55e', pointerEvents: 'none' }}>T</div>}
        {/* False connector — red, bottom-right */}
        <div
          title="False path"
          onMouseDown={onConnectorMouseDown}
          onTouchStart={onConnectorMouseDown}
          style={{
            position: 'absolute', right: -8, top: '70%', transform: 'translateY(-50%)',
            width: 16, height: 16, borderRadius: '50%',
            background: '#f87171', border: '2px solid var(--surface)',
            cursor: 'crosshair', zIndex: 10,
            opacity: hovered || selected ? 1 : 0,
            transition: 'opacity 0.15s',
            boxShadow: '0 0 8px #f87171',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1.4)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1)'; }}
        />
        {(hovered || selected) && <div style={{ position: 'absolute', right: 12, top: 'calc(70% - 14px)', fontSize: 8, fontWeight: 700, color: '#f87171', pointerEvents: 'none' }}>F</div>}
      </>) : (
        <div
          title={t('flows.dragConnect')}
          onMouseDown={onConnectorMouseDown}
          onTouchStart={onConnectorMouseDown}
          style={{
            position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
            width: 16, height: 16, borderRadius: '50%',
            background: node.color, border: '2px solid var(--surface)',
            cursor: 'crosshair', zIndex: 10,
            opacity: hovered || selected ? 1 : 0,
            transition: 'opacity 0.15s',
            boxShadow: '0 0 8px ' + node.color,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1.4)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1)'; }}
        />
      )}

      {/* Left connector dot (input indicator) */}
      <div style={{
        position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)',
        width: 16, height: 16, borderRadius: '50%',
        background: isDropTarget ? '#5eead4' : 'var(--surface)',
        border: '2px solid ' + (isDropTarget ? '#5eead4' : node.color),
        zIndex: 10,
        opacity: hovered || selected || isDropTarget ? 1 : 0,
        transition: 'opacity 0.15s, background 0.15s',
        boxShadow: isDropTarget ? '0 0 10px rgba(94,234,212,0.6)' : 'none',
      }} />

      {/* Action buttons */}
      {(hovered || selected) && (
        <div style={{ position: 'absolute', top: -10, right: 8, display: 'flex', gap: 4 }}>
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
            style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--panel-border-4)', background: 'var(--surface)', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✎</button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)', background: 'var(--surface)', color: '#f87171', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}
    </div>
  );
}

// ── CollapsibleSection ───────────────────────────────────────────────────────
function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--panel-border-2)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', padding: '8px 12px', border: 'none', background: 'var(--panel-alt)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--ink-30)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>
      {open && <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>}
    </div>
  );
}

// ── VariablePicker ───────────────────────────────────────────────────────────
const VARIABLE_OPTIONS = [
  { label: 'Task Title', value: '{{task.title}}' },
  { label: 'Task Description', value: '{{task.description}}' },
  { label: 'Task ID', value: '{{task.id}}' },
  { label: 'Task Status', value: '{{task.status}}' },
  { label: 'Task Priority', value: '{{task.priority}}' },
  { label: 'Previous Output', value: '{{outputs.PREV.result}}' },
];

function VariablePicker({ targetRef, onInsert }: { targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>; onInsert: (val: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(!open)} title="Insert variable"
        style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--panel-border-3)', background: open ? 'var(--panel)' : 'var(--glass)', color: 'var(--ink-45)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 }}>
        {'\u{1F4CB}'}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 28, zIndex: 80, minWidth: 200, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-25)', padding: '4px 8px' }}>Variables</div>
          {VARIABLE_OPTIONS.map((v) => (
            <button key={v.value} onClick={() => { onInsert(v.value); setOpen(false); }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1, padding: '6px 8px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--panel-alt)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-78)' }}>{v.label}</span>
              <span style={{ fontSize: 10, color: 'var(--ink-35)', fontFamily: 'monospace' }}>{v.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Model / Provider options ─────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'claude-sonnet', label: 'Claude Sonnet' },
  { value: 'custom', label: 'Custom' },
];

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'custom', label: 'Custom' },
];

// ── NodeEditPanel ─────────────────────────────────────────────────────────────
const ICON_OPTIONS = ['🤖','👔','📋','🧑‍💻','⚡','🔍','🚀','🛠','🧪','🔧','📊','💡','🎯','⚙️','🔐','🌐','☁️','🐙','🔔','🔀'];
const COLOR_OPTIONS = ['#38bdf8','#22c55e','#a78bfa','#f59e0b','#f472b6','#fb923c','#5eead4','#0d9488','#7c3aed','#e11d48','#0078d4','#6e40c9'];

function NodeEditPanel({ node, onChange, onClose, flow }: {
  node: FlowNode; onChange: (p: Partial<FlowNode>) => void; onClose: () => void; flow: Flow;
}) {
  const { t } = useLocale();
  const [promptSlugs, setPromptSlugs] = useState<string[]>([]);
  const [azureProjects, setAzureProjects] = useState<string[]>([]);
  const [azureRepos, setAzureRepos] = useState<string[]>([]);
  const [azureReposLoading, setAzureReposLoading] = useState(false);
  const actionRef = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headersRef = useRef<HTMLTextAreaElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const condValueRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPromptCatalog().then((catalog) => {
      const slugs = Object.keys(catalog.effective ?? {});
      setPromptSlugs(slugs);
    }).catch(() => {});
    // Load Azure projects for azure_devops node
    apiFetch<{ name: string }[]>('/tasks/azure/projects')
      .then((projects) => setAzureProjects(projects.map((p) => p.name)))
      .catch(() => {});
  }, []);

  // Load repos when azure project changes
  useEffect(() => {
    if (node.type !== 'azure_devops' || !node.azure_project) return;
    setAzureReposLoading(true);
    apiFetch<{ name: string }[]>(`/tasks/azure/repos?project=${encodeURIComponent(node.azure_project)}`)
      .then((repos) => setAzureRepos(repos.map((r) => r.name)))
      .catch(() => setAzureRepos([]))
      .finally(() => setAzureReposLoading(false));
  }, [node.type, node.azure_project]);

  function insertVar(ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>, val: string, currentVal: string, field: string) {
    const el = ref.current;
    if (el) {
      const start = el.selectionStart ?? currentVal.length;
      const end = el.selectionEnd ?? currentVal.length;
      const next = currentVal.slice(0, start) + val + currentVal.slice(end);
      onChange({ [field]: next } as Partial<FlowNode>);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + val.length, start + val.length); }, 0);
    } else {
      onChange({ [field]: currentVal + val } as Partial<FlowNode>);
    }
  }

  return (
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 300, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', zIndex: 50 }}>
      <div style={{ height: 2, background: 'linear-gradient(90deg, ' + node.color + ', #7c3aed)' }} />
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{t('flows.nodeEditTitle')}</span>
        <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Node Type */}
        <div>
          <label style={pLbl}>{t('flows.nodeType')}</label>
          <select value={node.type ?? 'agent'} onChange={(e) => onChange({ type: e.target.value as NodeType })}
            style={{ ...pInp, cursor: 'pointer' }}>
            <option value="agent">{t('flows.nodeTypeAgent')}</option>
            <option value="trigger">{t('flows.nodeTypeTrigger')}</option>
            <option value="http">{t('flows.nodeTypeHttp')}</option>
            <option value="azure_update">{t('flows.nodeTypeAzureUpdate')}</option>
            <option value="github">{t('flows.nodeTypeGithub')}</option>
            <option value="notify">{t('flows.nodeTypeNotify')}</option>
            <option value="condition">{t('flows.nodeTypeCondition')}</option>
          </select>
        </div>

        {/* Label */}
        <div>
          <label style={pLbl}>{t('flows.nodeName')}</label>
          <input value={node.label} onChange={(e) => onChange({ label: e.target.value })} style={pInp} />
        </div>

        {/* Icon */}
        <div>
          <label style={pLbl}>{t('flows.nodeIcon')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICON_OPTIONS.map((ic) => (
              <button key={ic} onClick={() => onChange({ icon: ic })}
                style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid ' + (node.icon === ic ? node.color : 'var(--panel-border-3)'), background: node.icon === ic ? node.color + '20' : 'var(--panel-alt)', fontSize: 16, cursor: 'pointer' }}>
                {ic}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div>
          <label style={pLbl}>{t('flows.nodeColor')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COLOR_OPTIONS.map((c) => (
              <button key={c} onClick={() => onChange({ color: c })}
                style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: '3px solid ' + (node.color === c ? '#fff' : 'transparent'), cursor: 'pointer' }} />
            ))}
          </div>
        </div>

        {/* ── Tip-spesifik alanlar ── */}

        {/* AGENT */}
        {(!node.type || node.type === 'agent') && (<>
          <div>
            <label style={pLbl}>{t('flows.nodeRole')}</label>
            <input value={node.role} onChange={(e) => onChange({ role: e.target.value })}
              placeholder={t('flows.nodeRolePlaceholder')} style={pInp} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ ...pLbl, marginBottom: 0 }}>{t('flows.nodeTask')}</label>
              <VariablePicker targetRef={actionRef} onInsert={(val) => insertVar(actionRef, val, node.action ?? '', 'action')} />
            </div>
            <textarea ref={actionRef} value={node.action} onChange={(e) => onChange({ action: e.target.value })}
              placeholder={t('flows.nodeTaskPlaceholder')} rows={3}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div onClick={() => onChange({ waitForApproval: !node.waitForApproval })}
              style={{ width: 36, height: 20, borderRadius: 999, background: node.waitForApproval ? '#f59e0b' : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 2, left: node.waitForApproval ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </div>
            <span style={{ fontSize: 13, color: 'var(--ink-58)' }}>{t('flows.nodeWaitApproval')}</span>
          </label>
          {/* PR Review options — available for any agent role */}
          {(
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <div onClick={() => onChange({ review_only: !node.review_only })}
                  style={{ width: 36, height: 20, borderRadius: 999, background: node.review_only ? '#38bdf8' : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2, left: node.review_only ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-58)' }}>{t('flows.nodeReviewOnly')}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <div onClick={() => onChange({ auto_fix_from_comments: !node.auto_fix_from_comments })}
                  style={{ width: 36, height: 20, borderRadius: 999, background: node.auto_fix_from_comments !== false ? '#22c55e' : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 2, left: node.auto_fix_from_comments !== false ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                </div>
                <span style={{ fontSize: 13, color: 'var(--ink-58)' }}>{t('flows.nodeAutoFixPrComments')}</span>
              </label>
            </>
          )}

          {/* Model & Provider */}
          <CollapsibleSection title="Model & Provider" defaultOpen={false}>
            <div>
              <label style={pLbl}>Model</label>
              <select value={node.model ?? ''} onChange={(e) => onChange({ model: e.target.value })}
                style={{ ...pInp, cursor: 'pointer' }}>
                <option value="">Default</option>
                {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {node.model === 'custom' && (
              <div>
                <label style={pLbl}>Custom Model Name</label>
                <input value={node.model === 'custom' ? (node as FlowNode & { custom_model?: string }).custom_model ?? '' : ''} onChange={(e) => onChange({ model: 'custom', ...({ custom_model: e.target.value } as unknown as Partial<FlowNode>) })}
                  placeholder="e.g. my-fine-tuned-model" style={pInp} />
              </div>
            )}
            <div>
              <label style={pLbl}>Provider</label>
              <select value={node.provider ?? ''} onChange={(e) => onChange({ provider: e.target.value })}
                style={{ ...pInp, cursor: 'pointer' }}>
                <option value="">Auto-detect</option>
                {PROVIDER_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </CollapsibleSection>

          {/* Prompt Studio */}
          <CollapsibleSection title="Prompt Studio" defaultOpen={false}>
            <div>
              <label style={pLbl}>System Prompt</label>
              <select value={node.prompt_slug ?? ''} onChange={(e) => onChange({ prompt_slug: e.target.value })}
                style={{ ...pInp, cursor: 'pointer' }}>
                <option value="">Default (role-based)</option>
                {promptSlugs.map((slug) => <option key={slug} value={slug}>{slug}</option>)}
              </select>
              {node.prompt_slug && (
                <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', fontSize: 11, fontWeight: 600, color: '#a78bfa' }}>
                  {node.prompt_slug}
                  <button onClick={() => onChange({ prompt_slug: '' })} style={{ border: 'none', background: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>x</button>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Generation Settings */}
          <CollapsibleSection title="Generation Settings" defaultOpen={false}>
            <div>
              <label style={pLbl}>Max Tokens</label>
              <input type="number" value={node.max_tokens ?? 8000} onChange={(e) => onChange({ max_tokens: Math.min(128000, Math.max(1, Number(e.target.value) || 8000)) })}
                min={1} max={128000} style={pInp} />
              <div style={{ fontSize: 9, color: 'var(--ink-25)', marginTop: 3 }}>Range: 1 - 128,000</div>
            </div>
            <div>
              <label style={pLbl}>Temperature: {(node.temperature ?? 0.2).toFixed(1)}</label>
              <input type="range" min={0} max={1} step={0.1} value={node.temperature ?? 0.2}
                onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: node.color }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--ink-25)' }}>
                <span>Precise (0.0)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>
          </CollapsibleSection>
        </>)}

        {/* TRIGGER */}
        {node.type === 'trigger' && (
          <div>
            <label style={pLbl}>{t('flows.nodeDescription')}</label>
            <input value={node.action} onChange={(e) => onChange({ action: e.target.value })}
              placeholder={t('flows.nodeTriggerPlaceholder')} style={pInp} />
          </div>
        )}

        {/* HTTP */}
        {node.type === 'http' && (<>
          <div>
            <label style={pLbl}>{t('flows.nodeMethod')}</label>
            <select value={node.method ?? 'GET'} onChange={(e) => onChange({ method: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              {['GET','POST','PUT','PATCH','DELETE'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ ...pLbl, marginBottom: 0 }}>{t('flows.nodeUrl')}</label>
              <VariablePicker targetRef={urlRef} onInsert={(val) => insertVar(urlRef, val, node.url ?? '', 'url')} />
            </div>
            <input ref={urlRef} value={node.url ?? ''} onChange={(e) => onChange({ url: e.target.value })}
              placeholder={t('flows.nodeUrlPlaceholder')} style={pInp} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ ...pLbl, marginBottom: 0 }}>{t('flows.nodeHeaders')}</label>
              <VariablePicker targetRef={headersRef} onInsert={(val) => insertVar(headersRef, val, node.headers ?? '', 'headers')} />
            </div>
            <textarea ref={headersRef} value={node.headers ?? ''} onChange={(e) => onChange({ headers: e.target.value })}
              placeholder={t('flows.nodeHeadersPlaceholder')} rows={2}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ ...pLbl, marginBottom: 0 }}>{t('flows.nodeBody')}</label>
              <VariablePicker targetRef={bodyRef} onInsert={(val) => insertVar(bodyRef, val, node.body ?? '', 'body')} />
            </div>
            <textarea ref={bodyRef} value={node.body ?? ''} onChange={(e) => onChange({ body: e.target.value })}
              placeholder={t('flows.nodeBodyPlaceholder')} rows={3}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
          </div>

          {/* Authentication */}
          <CollapsibleSection title="Authentication" defaultOpen={false}>
            <div>
              <label style={pLbl}>Auth Type</label>
              <select value={node.auth_type ?? 'none'} onChange={(e) => onChange({ auth_type: e.target.value })}
                style={{ ...pInp, cursor: 'pointer' }}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="api_key">API Key</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>
            {node.auth_type === 'bearer' && (
              <div>
                <label style={pLbl}>Token</label>
                <input type="password" value={node.auth_token ?? ''} onChange={(e) => onChange({ auth_token: e.target.value })}
                  placeholder="Bearer token" style={pInp} />
              </div>
            )}
            {node.auth_type === 'api_key' && (<>
              <div>
                <label style={pLbl}>Key Name</label>
                <input value={node.auth_key_name ?? ''} onChange={(e) => onChange({ auth_key_name: e.target.value })}
                  placeholder="e.g. X-API-Key" style={pInp} />
              </div>
              <div>
                <label style={pLbl}>Key Value</label>
                <input type="password" value={node.auth_key_value ?? ''} onChange={(e) => onChange({ auth_key_value: e.target.value })}
                  placeholder="API key value" style={pInp} />
              </div>
            </>)}
            {node.auth_type === 'basic' && (<>
              <div>
                <label style={pLbl}>Username</label>
                <input value={node.auth_key_name ?? ''} onChange={(e) => onChange({ auth_key_name: e.target.value })}
                  placeholder="Username" style={pInp} />
              </div>
              <div>
                <label style={pLbl}>Password</label>
                <input type="password" value={node.auth_key_value ?? ''} onChange={(e) => onChange({ auth_key_value: e.target.value })}
                  placeholder="Password" style={pInp} />
              </div>
            </>)}
          </CollapsibleSection>

          {/* Request Options */}
          <CollapsibleSection title="Request Options" defaultOpen={false}>
            <div>
              <label style={pLbl}>Timeout (seconds)</label>
              <input type="number" value={node.timeout ?? 30} onChange={(e) => onChange({ timeout: Math.max(1, Number(e.target.value) || 30) })}
                min={1} max={300} style={pInp} />
            </div>
            <div>
              <label style={pLbl}>Response Variable</label>
              <input value={node.response_var ?? ''} onChange={(e) => onChange({ response_var: e.target.value })}
                placeholder="e.g. api_result" style={pInp} />
              <div style={{ fontSize: 9, color: 'var(--ink-25)', marginTop: 3 }}>Access via {'{{outputs.NODE_ID.result}}'}</div>
            </div>
          </CollapsibleSection>
        </>)}

        {/* AZURE UPDATE */}
        {node.type === 'azure_update' && (<>
          <div>
            <label style={pLbl}>{t('flows.nodeNewState')}</label>
            <select value={node.new_state ?? ''} onChange={(e) => onChange({ new_state: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="">{t('flows.select')}</option>
              {['Active','In Progress','Code Review','QA To Do','Done','Closed','Resolved'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={pLbl}>{t('flows.nodeComment')}</label>
            <textarea value={node.comment ?? ''} onChange={(e) => onChange({ comment: e.target.value })}
              placeholder={t('flows.nodeCommentPlaceholder')} rows={2}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </>)}

        {/* GITHUB */}
        {node.type === 'github' && (<>
          <div>
            <label style={pLbl}>{t('flows.nodeAction')}</label>
            <select value={node.github_action ?? 'create_branch'} onChange={(e) => onChange({ github_action: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="create_branch">{t('flows.nodeGithubCreateBranch')}</option>
              <option value="create_pr">{t('flows.nodeGithubCreatePr')}</option>
              <option value="merge_pr">{t('flows.nodeGithubMergePr')}</option>
            </select>
          </div>
          <div>
            <label style={pLbl}>{t('flows.nodeRepo')}</label>
            <input value={node.repo ?? ''} onChange={(e) => onChange({ repo: e.target.value })}
              placeholder={t('flows.nodeRepoPlaceholder')} style={pInp} />
          </div>
          <div>
            <label style={pLbl}>{t('flows.nodeBranch')}</label>
            <input value={node.branch ?? ''} onChange={(e) => onChange({ branch: e.target.value })}
              placeholder={t('flows.nodeBranchPlaceholder')} style={pInp} />
          </div>
          {(node.github_action === 'create_pr' || !node.github_action) && (<>
            <div>
              <label style={pLbl}>{t('flows.nodePrTitle')}</label>
              <input value={node.pr_title ?? ''} onChange={(e) => onChange({ pr_title: e.target.value })}
                placeholder={t('flows.nodePrTitlePlaceholder')} style={pInp} />
            </div>
            <div>
              <label style={pLbl}>PR Description</label>
              <textarea value={node.pr_description ?? ''} onChange={(e) => onChange({ pr_description: e.target.value })}
                placeholder="Markdown template for PR body..." rows={4}
                style={{ ...pInp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
            </div>
            <div>
              <label style={pLbl}>Reviewers</label>
              <input value={node.reviewers ?? ''} onChange={(e) => onChange({ reviewers: e.target.value })}
                placeholder="user1, user2 (comma-separated)" style={pInp} />
            </div>
            <div>
              <label style={pLbl}>Labels</label>
              <input value={node.labels ?? ''} onChange={(e) => onChange({ labels: e.target.value })}
                placeholder="bug, enhancement (comma-separated)" style={pInp} />
              {node.labels && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {node.labels.split(',').map((l) => l.trim()).filter(Boolean).map((l) => (
                    <span key={l} style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(110,64,201,0.12)', border: '1px solid rgba(110,64,201,0.3)', fontSize: 10, fontWeight: 600, color: '#6e40c9' }}>{l}</span>
                  ))}
                </div>
              )}
            </div>
          </>)}
        </>)}

        {/* AZURE DEVOPS (PR operations) */}
        {node.type === 'azure_devops' && (<>
          <div>
            <label style={pLbl}>Action</label>
            <select value={node.azure_action ?? 'create_pr'} onChange={(e) => onChange({ azure_action: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="create_branch">Create Branch</option>
              <option value="create_pr">Create Pull Request</option>
              <option value="complete_pr">Complete (Merge) PR</option>
              <option value="abandon_pr">Abandon PR</option>
            </select>
          </div>
          <div>
            <label style={pLbl}>Project</label>
            {azureProjects.length > 0 ? (
              <select value={node.azure_project ?? ''} onChange={(e) => onChange({ azure_project: e.target.value, azure_repo: '' })}
                style={{ ...pInp, cursor: 'pointer' }}>
                <option value="">Select project...</option>
                {azureProjects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            ) : (
              <input value={node.azure_project ?? ''} onChange={(e) => onChange({ azure_project: e.target.value })}
                placeholder="e.g. EcomBackend" style={pInp} />
            )}
          </div>
          <div>
            <label style={pLbl}>Repository</label>
            {azureRepos.length > 0 ? (
              <select value={node.azure_repo ?? ''} onChange={(e) => onChange({ azure_repo: e.target.value })}
                style={{ ...pInp, cursor: 'pointer' }}>
                <option value="">Select repo...</option>
                {azureRepos.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <input value={node.azure_repo ?? ''} onChange={(e) => onChange({ azure_repo: e.target.value })}
                placeholder={azureReposLoading ? 'Loading...' : node.azure_project ? 'No repos found' : 'Select project first'} style={pInp} disabled={azureReposLoading} />
            )}
          </div>
          <div>
            <label style={pLbl}>Branch</label>
            <input value={node.azure_branch ?? ''} onChange={(e) => onChange({ azure_branch: e.target.value })}
              placeholder="e.g. feature/ai-task-123" style={pInp} />
          </div>
          {(node.azure_action === 'create_pr' || !node.azure_action) && (<>
            <div>
              <label style={pLbl}>PR Title</label>
              <input value={node.azure_pr_title ?? ''} onChange={(e) => onChange({ azure_pr_title: e.target.value })}
                placeholder="AI: {{task.title}}" style={pInp} />
            </div>
            <div>
              <label style={pLbl}>PR Description</label>
              <textarea value={node.azure_pr_description ?? ''} onChange={(e) => onChange({ azure_pr_description: e.target.value })}
                placeholder="Markdown template..." rows={3}
                style={{ ...pInp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
            </div>
            <div>
              <label style={pLbl}>Reviewers</label>
              <input value={node.azure_reviewers ?? ''} onChange={(e) => onChange({ azure_reviewers: e.target.value })}
                placeholder="user@company.com (comma-separated)" style={pInp} />
            </div>
          </>)}
        </>)}

        {/* NOTIFY */}
        {node.type === 'notify' && (<>
          <div>
            <label style={pLbl}>Channel Type</label>
            <select value={node.notify_channel ?? 'webhook'} onChange={(e) => onChange({ notify_channel: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="webhook">Webhook</option>
              <option value="slack" disabled>Slack (coming soon)</option>
              <option value="email" disabled>Email (coming soon)</option>
            </select>
          </div>
          <div>
            <label style={pLbl}>{t('flows.nodeWebhookUrl')}</label>
            <input value={node.webhook_url ?? ''} onChange={(e) => onChange({ webhook_url: e.target.value })}
              placeholder={t('flows.nodeWebhookUrlPlaceholder')} style={pInp} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ ...pLbl, marginBottom: 0 }}>{t('flows.nodeMessage')}</label>
              <VariablePicker targetRef={messageRef} onInsert={(val) => insertVar(messageRef, val, node.notify_message ?? '', 'notify_message')} />
            </div>
            <textarea ref={messageRef} value={node.notify_message ?? ''} onChange={(e) => onChange({ notify_message: e.target.value })}
              placeholder={t('flows.nodeMessagePlaceholder')} rows={2}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </>)}

        {/* CONDITION */}
        {node.type === 'condition' && (<>
          <div>
            <label style={pLbl}>{t('flows.nodeField')}</label>
            <input value={node.condition_field ?? ''} onChange={(e) => onChange({ condition_field: e.target.value })}
              placeholder={t('flows.nodeFieldPlaceholder')} style={pInp} />
          </div>
          <div>
            <label style={pLbl}>{t('flows.nodeOperator')}</label>
            <select value={node.condition_op ?? 'eq'} onChange={(e) => onChange({ condition_op: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="eq">{t('flows.nodeOperatorEq')}</option>
              <option value="neq">{t('flows.nodeOperatorNeq')}</option>
              <option value="contains">{t('flows.nodeOperatorContains')}</option>
              <option value="gt">Greater than</option>
              <option value="lt">Less than</option>
              <option value="gte">Greater or equal</option>
              <option value="lte">Less or equal</option>
              <option value="regex">Regex match</option>
              <option value="empty">Is empty</option>
              <option value="not_empty">Is not empty</option>
            </select>
          </div>
          {node.condition_op !== 'empty' && node.condition_op !== 'not_empty' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ ...pLbl, marginBottom: 0 }}>{t('flows.nodeValue')}</label>
                <VariablePicker targetRef={condValueRef} onInsert={(val) => insertVar(condValueRef, val, node.condition_value ?? '', 'condition_value')} />
              </div>
              <input ref={condValueRef} value={node.condition_value ?? ''} onChange={(e) => onChange({ condition_value: e.target.value })}
                placeholder={t('flows.nodeValuePlaceholder')} style={pInp} />
            </div>
          )}

          {/* Branching paths */}
          <CollapsibleSection title="Branch Targets" defaultOpen={true}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>True path</div>
                <select value={node.true_target ?? ''} onChange={(e) => onChange({ true_target: e.target.value })}
                  style={{ ...pInp, fontSize: 11, padding: '6px 8px', cursor: 'pointer' }}>
                  <option value="">-- none --</option>
                  {flow.nodes.filter((n) => n.id !== node.id).map((n) => (
                    <option key={n.id} value={n.id}>{n.label} ({n.id})</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.06)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#f87171', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>False path</div>
                <select value={node.false_target ?? ''} onChange={(e) => onChange({ false_target: e.target.value })}
                  style={{ ...pInp, fontSize: 11, padding: '6px 8px', cursor: 'pointer' }}>
                  <option value="">-- none --</option>
                  {flow.nodes.filter((n) => n.id !== node.id).map((n) => (
                    <option key={n.id} value={n.id}>{n.label} ({n.id})</option>
                  ))}
                </select>
              </div>
            </div>
          </CollapsibleSection>
        </>)}

      </div>
    </div>
  );
}

// ── ToolBtn ───────────────────────────────────────────────────────────────────
function ToolBtn({ children, onClick, title, active }: {
  children: React.ReactNode; onClick: () => void; title?: string; active?: boolean;
}) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid ' + (active ? 'var(--border)' : 'var(--panel-border-3)'), background: active ? 'var(--panel)' : 'var(--glass)', color: active ? 'var(--ink)' : 'var(--ink-50)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
      {children}
    </button>
  );
}

const pLbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', display: 'block', marginBottom: 6 };
const pInp: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };

// ── RunHistoryPanel ───────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  completed: '#22c55e', failed: '#f87171', running: '#38bdf8',
  pending: '#f59e0b', cancelled: '#6b7280',
};

function RunHistoryPanel({ runs, loading, selected, onSelect, onRefresh, onClose }: {
  runs: FlowRunResult[];
  loading: boolean;
  selected: FlowRunResult | null;
  onSelect: (r: FlowRunResult) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function getFeedbackFlags(run: FlowRunResult) {
    const feedbackStep = run.steps.find((step) => {
      const out = step.output;
      if (!out || typeof out !== 'object') return false;
      const o = out as Record<string, unknown>;
      return o.mode === 'pr_feedback_loop' || Boolean(o.feedback_hash) || String(o.message ?? '').toLowerCase().includes('review comments');
    });
    if (!feedbackStep) return { found: false, rerun: false };
    const out = (feedbackStep.output || {}) as Record<string, unknown>;
    return {
      found: true,
      rerun: Boolean(out.new_pr_url),
    };
  }

  function fmt(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ width: 320, flexShrink: 0, borderRadius: 20, border: '1px solid var(--panel-border)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink-78)' }}>{t('flows.runHistory')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onRefresh} title={t('flows.refresh')}
            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 12 }}>↻</button>
          <button onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-30)', fontSize: 12 }}>{t('flows.loading')}</div>}
        {!loading && runs.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-25)', fontSize: 12 }}>{t('flows.noRuns')}</div>
        )}
        {runs.map((run) => {
          const isOpen = expandedId === run.id;
          const sc = STATUS_COLOR[run.status] ?? '#fff';
          const flags = getFeedbackFlags(run);
          return (
            <div key={run.id} style={{ borderBottom: '1px solid var(--glass)' }}>
              <button onClick={() => setExpandedId(isOpen ? null : run.id)}
                style={{ width: '100%', padding: '10px 16px', border: 'none', background: isOpen ? `${sc}08` : 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, transition: 'background 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{run.flow_name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sc }}>{run.status}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-30)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                  </div>
                </div>
                {run.task_title && <div style={{ fontSize: 10, color: 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.task_title}</div>}
                {flags.found && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', padding: '2px 7px', borderRadius: 999, background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.35)' }}>
                      {t('flows.prFeedbackFound')}
                    </span>
                    {flags.rerun && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', padding: '2px 7px', borderRadius: 999, background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)' }}>
                        {t('flows.developerRerunTriggered')}
                      </span>
                    )}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--ink-25)' }}>{fmt(run.started_at)} · {run.steps.length} {t('flows.steps')}</div>
              </button>

              {/* Expanded: step details inline */}
              {isOpen && (
                <div style={{ padding: '6px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6, borderLeft: `3px solid ${sc}40`, marginLeft: 12, marginBottom: 4 }}>
                  {run.steps.map((step) => {
                    const stepColor = STATUS_COLOR[step.status] ?? '#fff';
                    return (
                      <div key={step.id} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${stepColor}25`, background: `${stepColor}06` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-78)' }}>{step.node_label ?? step.node_id}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: stepColor, padding: '1px 6px', borderRadius: 999, background: `${stepColor}18` }}>{step.status}</span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--ink-30)' }}>{step.node_type}</div>
                        {step.error_msg && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>{step.error_msg}</div>}
                        {Boolean(step.output) && typeof step.output === 'object' && Boolean((step.output as Record<string, unknown>).output) && (
                          <div style={{ fontSize: 9, color: 'var(--ink-45)', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 60, overflow: 'hidden' }}>
                            {String((step.output as Record<string, unknown>).output).slice(0, 200)}
                          </div>
                        )}
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
  );
}
