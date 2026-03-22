'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { loadPrefs, savePrefs, runFlow, getFlowRuns, FlowRunResult, createFlowVersion, getFlowVersion, listFlowVersions, createNotificationEvent } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = 'lead_developer' | 'pm' | 'qa' | 'manager' | 'developer' | string;
type NodeType = 'agent' | 'trigger' | 'http' | 'azure_update' | 'github' | 'notify' | 'condition';

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

const AGENT_PRESETS: { role: AgentRole; label: string; icon: string; color: string }[] = [
  { role: 'manager',        label: 'Manager',         icon: '👔', color: '#f59e0b' },
  { role: 'pm',             label: 'Product Manager', icon: '📋', color: '#a78bfa' },
  { role: 'lead_developer', label: 'Lead Developer',  icon: '🧑‍💻', color: '#38bdf8' },
  { role: 'developer',      label: 'Developer',       icon: '⚡', color: '#22c55e' },
  { role: 'qa',             label: 'QA Engineer',     icon: '🔍', color: '#f472b6' },
];

const NODE_TYPE_PRESETS: { type: NodeType; label: string; icon: string; color: string }[] = [
  { type: 'trigger',      label: 'Trigger',       icon: '⚡', color: '#f59e0b' },
  { type: 'http',         label: 'HTTP Request',  icon: '🌐', color: '#38bdf8' },
  { type: 'azure_update', label: 'Azure Update',  icon: '☁️', color: '#0078d4' },
  { type: 'github',       label: 'GitHub',        icon: '🐙', color: '#6e40c9' },
  { type: 'notify',       label: 'Notify',        icon: '🔔', color: '#fb923c' },
  { type: 'condition',    label: 'Condition',     icon: '🔀', color: '#22c55e' },
];

const PRESET_FLOWS: Flow[] = [
  {
    id: 'full-cycle',
    name: 'Full Dev Cycle',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'n1', type: 'agent', role: 'pm',             label: 'PM Analiz',      icon: '📋', color: '#a78bfa', action: 'Acceptance criteria yaz', waitForApproval: false, x: 60,  y: 160 },
      { id: 'n2', type: 'agent', role: 'lead_developer', label: 'Teknik Plan',    icon: '🧑‍💻', color: '#38bdf8', action: 'Implementasyon planı',   waitForApproval: true,  x: 280, y: 160 },
      { id: 'n3', type: 'agent', role: 'developer',      label: 'Geliştirme',     icon: '⚡', color: '#22c55e', action: 'Kodu yaz, PR aç',         waitForApproval: false, x: 500, y: 160 },
      { id: 'n4', type: 'agent', role: 'qa',             label: 'QA Test',        icon: '🔍', color: '#f472b6', action: 'Test senaryoları çalıştır', waitForApproval: false, x: 720, y: 160 },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },
  {
    id: 'quick-fix',
    name: 'Quick Fix',
    createdAt: new Date().toISOString(),
    nodes: [
      { id: 'n1', type: 'agent', role: 'lead_developer', label: 'Root Cause', icon: '🧑‍💻', color: '#38bdf8', action: "Bug'ı analiz et", waitForApproval: false, x: 60,  y: 160 },
      { id: 'n2', type: 'agent', role: 'developer',      label: 'Fix',        icon: '⚡', color: '#22c55e', action: 'Fix uygula, PR aç',  waitForApproval: false, x: 280, y: 160 },
      { id: 'n3', type: 'agent', role: 'qa',             label: 'Verify',     icon: '🔍', color: '#f472b6', action: 'Regression test',   waitForApproval: false, x: 500, y: 160 },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
];

const LS_FLOWS = 'tiqr_flows';

function loadFlows(): Flow[] {
  if (typeof window === 'undefined') return PRESET_FLOWS;
  try {
    const s = localStorage.getItem(LS_FLOWS);
    if (!s) return PRESET_FLOWS;
    const parsed = JSON.parse(s) as Flow[];
    return parsed.map((f) => ({ ...f, nodes: f.nodes ?? [], edges: f.edges ?? [] }));
  }
  catch { return PRESET_FLOWS; }
}
function saveFlowsLS(flows: Flow[]) { localStorage.setItem(LS_FLOWS, JSON.stringify(flows)); }

function sortNodesForRun(nodes: FlowNode[]): FlowNode[] {
  return [...nodes].sort((a, b) => a.x - b.x || a.y - b.y);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FlowsPage() {
  const { t } = useLocale();
  const [flows, setFlows] = useState<Flow[]>(PRESET_FLOWS);
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

  useEffect(() => {
    const local = loadFlows();
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
        setFlows(db); saveFlowsLS(db);
        setActiveFlow(db[0].id);
      }
    }).catch(() => {});
  }, []);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)', gap: 0 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 0 16px', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-label">{t('nav.flows')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.95)', margin: '4px 0 0' }}>{t('flows.title')}</h1>
        </div>
        {/* Flow tabs */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {flows.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <button onClick={() => setActiveFlow(f.id)}
                style={{ padding: '7px 14px', borderRadius: activeFlow === f.id ? '10px 0 0 10px' : 10, border: '1px solid ' + (activeFlow === f.id ? 'rgba(13,148,136,0.5)' : 'rgba(255,255,255,0.1)'), borderRight: activeFlow === f.id ? 'none' : undefined, background: activeFlow === f.id ? 'rgba(13,148,136,0.15)' : 'rgba(255,255,255,0.03)', color: activeFlow === f.id ? '#5eead4' : 'rgba(255,255,255,0.5)', fontWeight: activeFlow === f.id ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
                {f.name}
              </button>
              {activeFlow === f.id && (
                <button onClick={() => deleteFlow(f.id)}
                  style={{ padding: '7px 8px', borderRadius: '0 10px 10px 0', border: '1px solid rgba(248,113,113,0.25)', borderLeft: 'none', background: 'rgba(248,113,113,0.08)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>×</button>
              )}
            </div>
          ))}
          {creating ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newFlowName} onChange={(e) => setNewFlowName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createFlow()}
                placeholder={t('flows.newPlaceholder')} autoFocus
                style={{ padding: '7px 12px', borderRadius: 10, border: '1px solid rgba(13,148,136,0.4)', background: 'rgba(13,148,136,0.08)', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', width: 140 }} />
              <button onClick={createFlow} style={{ padding: '7px 12px', borderRadius: 10, border: 'none', background: '#0d9488', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>+</button>
              <button onClick={() => setCreating(false)} style={{ padding: '7px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>×</button>
            </div>
          ) : (
              <button onClick={() => setCreating(true)}
              style={{ padding: '7px 14px', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.2)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>
              {t('flows.new')}
            </button>
          )}
          <button onClick={toggleRuns}
            style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid ' + (showRuns ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.1)'), background: showRuns ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.03)', color: showRuns ? '#a78bfa' : 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer', fontWeight: showRuns ? 700 : 400 }}>
            {t('flows.runHistory')}
          </button>
          <Link href='/dashboard/templates'
            style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', fontSize: 13, textDecoration: 'none' }}>
            {t('flows.templates')}
          </Link>
          <button onClick={saveManualVersion}
            style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
            {t('flows.saveVersion')}
          </button>
          <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
            <option value=''>{t('flows.selectVersion')}</option>
            {(versionsByFlow[activeFlow] ?? []).map((v) => (
              <option key={v.id} value={v.id} style={{ background: '#0d1117' }}>
                {new Date(v.createdAt).toLocaleString()} - {v.label}
              </option>
            ))}
          </select>
          <button onClick={rollbackToVersion} disabled={!selectedVersionId}
            style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.25)', background: selectedVersionId ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.03)', color: selectedVersionId ? '#f87171' : 'rgba(255,255,255,0.25)', fontSize: 13, cursor: selectedVersionId ? 'pointer' : 'not-allowed' }}>
            {t('flows.rollback')}
          </button>
          <button onClick={() => void runDrySimulation()} disabled={runningDryRun || !current}
            style={{ padding: '7px 14px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.25)', background: runningDryRun ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.12)', color: '#22c55e', fontSize: 13, cursor: runningDryRun ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
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
                  title: nextApproved ? 'Approval gate approved' : 'Approval gate pending',
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
        <div style={{ marginBottom: 12, borderRadius: 14, border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(8,14,30,0.85)', padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>{t('flows.dryRunResult')}</div>
            <button onClick={() => setDryRunOpen(false)} style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.45)', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{dryRunSummary}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {dryRunSteps.map((s) => (
              <div key={s.id} style={{ borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.78)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{s.label}</span>
                <span style={{ color: s.status === 'done' ? '#22c55e' : s.status === 'waiting' ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>
                  {s.status === 'done' ? `${s.durationMs}ms` : s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Canvas + Run History */}
      <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {current ? (
            <FlowCanvas flow={current} onChange={updateFlow} />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 14, borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(3,7,18,0.6)' }}>
              {t('flows.empty')}
            </div>
          )}
        </div>

        {/* Run History Panel — overlay olarak açılır, canvas'ı ezmez */}
        {showRuns && (
          <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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

  // ── Connector dot'tan drag-to-connect ──
  const onConnectorMouseDown = useCallback((e: React.MouseEvent, sourceId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConnecting({
      sourceId,
      x: e.clientX - rect.left - canvasOffset.x,
      y: e.clientY - rect.top - canvasOffset.y,
    });
  }, [canvasOffset]);

  // ── Drag node ──
  const onNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (connecting) return; // bağlantı modunda node drag yok
    setSelected(id);
    const node = flow.nodes.find((n) => n.id === id)!;
    setDragging({ id, ox: e.clientX - node.x, oy: e.clientY - node.y });
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
    function handleMouseMove(e: MouseEvent) {
      const drag = draggingRef.current;
      if (drag) {
        const nx = e.clientX - drag.ox;
        const ny = e.clientY - drag.oy;
        const f = flowRef.current;
        onChange({ ...f, nodes: f.nodes.map((n) => n.id === drag.id ? { ...n, x: Math.max(0, nx), y: Math.max(0, ny) } : n) });
      }
      const pan = panStartRef.current;
      if (pan) {
        setCanvasOffset({ x: pan.ox + e.clientX - pan.mx, y: pan.oy + e.clientY - pan.my });
      }
      if (connectingRef.current) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const off = canvasOffsetRef.current;
        setConnecting((prev) => prev ? {
          ...prev,
          x: e.clientX - rect.left - off.x,
          y: e.clientY - rect.top - off.y,
        } : null);
        // hover target güncelle
        const mx = e.clientX - rect.left - off.x;
        const my = e.clientY - rect.top - off.y;
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
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  // Global mouseup — node üzerinde bırakınca da çalışsın
  useEffect(() => {
    function handleMouseUp(e: MouseEvent) {
      setDragging(null);
      setPanStart(null);
      const conn = connectingRef.current;
      if (conn) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const mx = e.clientX - rect.left - canvasOffsetRef.current.x;
          const my = e.clientY - rect.top - canvasOffsetRef.current.y;
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
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (connecting) { setConnecting(null); return; }
    setSelected(null);
    setPanStart({ mx: e.clientX, my: e.clientY, ox: canvasOffset.x, oy: canvasOffset.y });
  }, [connecting, canvasOffset]);

  function addNode(preset: typeof AGENT_PRESETS[0]) {
    const id = 'n' + Date.now();
    const node: FlowNode = {
      id, type: 'agent', role: preset.role, label: preset.label, icon: preset.icon,
      color: preset.color, action: '', waitForApproval: false,
      x: 80 + flow.nodes.length * 220, y: 160,
    };
    onChange({ ...flow, nodes: [...flow.nodes, node] });
    setShowPicker(false);
  }

  function addTypeNode(preset: typeof NODE_TYPE_PRESETS[0]) {
    const id = 'n' + Date.now();
    const node: FlowNode = {
      id, type: preset.type, role: preset.type, label: preset.label, icon: preset.icon,
      color: preset.color, action: '', waitForApproval: false,
      x: 80 + flow.nodes.length * 220, y: 160,
    };
    onChange({ ...flow, nodes: [...flow.nodes, node] });
    setShowPicker(false);
    setEditNode(node);
  }

  function addCustomNode() {
    const id = 'n' + Date.now();
    const node: FlowNode = {
      id, type: 'agent', role: 'custom', label: 'Yeni Agent', icon: '🤖', color: '#5eead4',
      action: '', waitForApproval: false,
      x: 80 + flow.nodes.length * 220, y: 160,
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

  const canvasW = Math.max(900, ...flow.nodes.map((n) => n.x + NODE_W + 80));
  const canvasH = Math.max(400, ...flow.nodes.map((n) => n.y + NODE_H + 80));

  return (
    <div style={{ flex: 1, display: 'flex', gap: 0, minHeight: 0, borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden', background: 'rgba(3,7,18,0.6)', position: 'relative', height: '100%' }}>

      {/* Left toolbar */}
      <div style={{ width: 52, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 8, background: 'rgba(0,0,0,0.2)' }}>
        <ToolBtn title={t('flows.toolbarAddNode')} onClick={() => setShowPicker(true)}>+</ToolBtn>
        <div style={{ flex: 1 }} />
        <ToolBtn title={t('flows.toolbarReset')} onClick={() => setCanvasOffset({ x: 0, y: 0 })}>⊙</ToolBtn>
      </div>

      {/* Canvas */}
      <div ref={canvasRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: connecting ? 'crosshair' : panStart ? 'grabbing' : 'grab' }}
        onMouseDown={onCanvasMouseDown}>

        {/* Grid dots */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"
              patternTransform={`translate(${canvasOffset.x % 28},${canvasOffset.y % 28})`}>
              <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.06)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

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
              const from = flow.nodes.find((n) => n.id === edge.from);
              const to   = flow.nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const midX = (from.x + NODE_W + to.x) / 2;
              const midY = (from.y + to.y + NODE_H) / 2;
              return (
                <g key={edge.from + '-' + edge.to} style={{ pointerEvents: 'all' }}>
                  <path d={edgePath(from, to)} fill="none" stroke="rgba(94,234,212,0.25)" strokeWidth={2} markerEnd="url(#arrow)" style={{ pointerEvents: 'none' }} />
                  {/* invisible wider hit area */}
                  <path d={edgePath(from, to)} fill="none" stroke="transparent" strokeWidth={12}
                    style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                    onMouseDown={(e) => { e.stopPropagation(); deleteEdge(edge.from, edge.to); }} />
                  {/* delete dot */}
                  <circle cx={midX} cy={midY} r={10} fill="rgba(8,14,30,0.9)" stroke="rgba(248,113,113,0.5)" strokeWidth={1.5}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onMouseDown={(e) => { e.stopPropagation(); deleteEdge(edge.from, edge.to); }} />
                  <text x={midX} y={midY + 4} textAnchor="middle" fontSize={11} fill="#f87171" style={{ pointerEvents: 'none', userSelect: 'none' }}>×</text>
                </g>
              );
            })}

            {/* Drag-to-connect preview line */}
            {connecting && (() => {
              const src = flow.nodes.find((n) => n.id === connecting.sourceId);
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
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${canvasOffset.x}px,${canvasOffset.y}px)` }}>
          {flow.nodes.map((node, idx) => (
            <FlowNodeCard
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
            />
          ))}
        </div>

        {/* Empty state */}
        {flow.nodes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ fontSize: 40, opacity: 0.08, marginBottom: 12 }}>⟳</div>
            <div style={{ color: 'rgba(255,255,255,0.15)', fontSize: 13 }}>{t('flows.addNodeHint')}</div>
          </div>
        )}

        {/* Connecting hint */}
        {connecting && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', padding: '6px 16px', borderRadius: 999, background: 'rgba(13,148,136,0.2)', border: '1px solid rgba(13,148,136,0.4)', color: '#5eead4', fontSize: 12, fontWeight: 700, pointerEvents: 'none' }}>
            {t('flows.dragToTarget')} - {t('flows.dragCancel')}
          </div>
        )}
      </div>

      {/* Node picker panel */}
      {showPicker && (
        <div style={{ position: 'absolute', left: 60, top: 12, zIndex: 100, borderRadius: 16, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(8,14,30,0.98)', padding: 16, width: 230, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', maxHeight: 'calc(100% - 24px)', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>{t('flows.agentRoles')}</div>
          <div style={{ display: 'grid', gap: 5, marginBottom: 12 }}>
            {AGENT_PRESETS.map((p) => (
              <button key={p.role} onClick={() => addNode(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid ' + p.color + '30', background: p.color + '0a', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{p.label}</span>
              </button>
            ))}
            <button onClick={addCustomNode}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>{t('flows.customAgent')}</span>
            </button>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 8 }}>{t('flows.nodeTypes')}</div>
          <div style={{ display: 'grid', gap: 5 }}>
            {NODE_TYPE_PRESETS.map((p) => (
              <button key={p.type} onClick={() => addTypeNode(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: '1px solid ' + p.color + '30', background: p.color + '0a', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 16 }}>{p.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{p.label}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowPicker(false)}
            style={{ marginTop: 10, width: '100%', padding: '7px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.3)', fontSize: 12, cursor: 'pointer' }}>
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
        />
      )}
    </div>
  );
}

// ── FlowNodeCard ──────────────────────────────────────────────────────────────
function FlowNodeCard({ node, index, selected, connecting, isDropTarget, onMouseDown, onMouseEnterNode, onMouseLeaveNode, onConnectorMouseDown, onEdit, onDelete }: {
  node: FlowNode; index: number; selected: boolean; connecting: boolean; isDropTarget: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnterNode: () => void;
  onMouseLeaveNode: () => void;
  onConnectorMouseDown: (e: React.MouseEvent) => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const borderColor = isDropTarget ? '#5eead4'
    : selected ? node.color
    : hovered ? node.color + '60'
    : 'rgba(255,255,255,0.1)';

  return (
    <div
      style={{
        position: 'absolute',
        left: node.x, top: node.y,
        width: NODE_W, height: NODE_H,
        borderRadius: 16,
        border: '2px solid ' + borderColor,
        background: isDropTarget ? 'rgba(94,234,212,0.08)' : selected ? node.color + '14' : 'rgba(8,14,30,0.95)',
        boxShadow: isDropTarget ? '0 0 20px rgba(94,234,212,0.3)' : selected ? '0 0 24px ' + node.color + '30' : hovered ? '0 4px 20px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.3)',
        cursor: connecting ? 'crosshair' : 'grab',
        userSelect: 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
        overflow: 'visible',
      }}
      onMouseDown={onMouseDown}
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
          <span style={{ fontSize: 20 }}>{node.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</div>
            <div style={{ fontSize: 10, color: node.color, fontWeight: 600, marginTop: 1 }}>{node.role}</div>
          </div>
        </div>
        {node.action && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>{node.action}</div>
        )}
        {node.waitForApproval && (
          <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', marginTop: 2 }}>⏸ Onay bekler</div>
        )}
      </div>

      {/* Right connector dot — sürükle → bağla */}
      <div
        title="Sürükle → bağla"
        onMouseDown={onConnectorMouseDown}
        style={{
          position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
          width: 16, height: 16, borderRadius: '50%',
          background: node.color, border: '2px solid rgba(8,14,30,0.9)',
          cursor: 'crosshair', zIndex: 10,
          opacity: hovered || selected ? 1 : 0,
          transition: 'opacity 0.15s',
          boxShadow: '0 0 8px ' + node.color,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1.4)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-50%) scale(1)'; }}
      />

      {/* Left connector dot (input indicator) */}
      <div style={{
        position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)',
        width: 16, height: 16, borderRadius: '50%',
        background: isDropTarget ? '#5eead4' : 'rgba(8,14,30,0.9)',
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
            style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(8,14,30,0.95)', color: 'rgba(255,255,255,0.6)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✎</button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(8,14,30,0.95)', color: '#f87171', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
      )}
    </div>
  );
}

// ── NodeEditPanel ─────────────────────────────────────────────────────────────
const ICON_OPTIONS = ['🤖','👔','📋','🧑‍💻','⚡','🔍','🚀','🛠','🧪','🔧','📊','💡','🎯','⚙️','🔐','🌐','☁️','🐙','🔔','🔀'];
const COLOR_OPTIONS = ['#38bdf8','#22c55e','#a78bfa','#f59e0b','#f472b6','#fb923c','#5eead4','#0d9488','#7c3aed','#e11d48','#0078d4','#6e40c9'];

function NodeEditPanel({ node, onChange, onClose }: {
  node: FlowNode; onChange: (p: Partial<FlowNode>) => void; onClose: () => void;
}) {
  return (
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 300, borderLeft: '1px solid rgba(255,255,255,0.08)', background: 'rgba(8,14,30,0.98)', display: 'flex', flexDirection: 'column', zIndex: 50 }}>
      <div style={{ height: 2, background: 'linear-gradient(90deg, ' + node.color + ', #7c3aed)' }} />
      <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>Node Düzenle</span>
        <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Node Type */}
        <div>
          <label style={pLbl}>Tip</label>
          <select value={node.type ?? 'agent'} onChange={(e) => onChange({ type: e.target.value as NodeType })}
            style={{ ...pInp, cursor: 'pointer' }}>
            <option value="agent">Agent</option>
            <option value="trigger">Trigger</option>
            <option value="http">HTTP Request</option>
            <option value="azure_update">Azure Update</option>
            <option value="github">GitHub</option>
            <option value="notify">Notify</option>
            <option value="condition">Condition</option>
          </select>
        </div>

        {/* Label */}
        <div>
          <label style={pLbl}>İsim</label>
          <input value={node.label} onChange={(e) => onChange({ label: e.target.value })} style={pInp} />
        </div>

        {/* Icon */}
        <div>
          <label style={pLbl}>İkon</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICON_OPTIONS.map((ic) => (
              <button key={ic} onClick={() => onChange({ icon: ic })}
                style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid ' + (node.icon === ic ? node.color : 'rgba(255,255,255,0.1)'), background: node.icon === ic ? node.color + '20' : 'rgba(255,255,255,0.03)', fontSize: 16, cursor: 'pointer' }}>
                {ic}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div>
          <label style={pLbl}>Renk</label>
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
            <label style={pLbl}>Rol</label>
            <input value={node.role} onChange={(e) => onChange({ role: e.target.value })}
              placeholder="developer, pm, custom..." style={pInp} />
          </div>
          <div>
            <label style={pLbl}>Görev</label>
            <textarea value={node.action} onChange={(e) => onChange({ action: e.target.value })}
              placeholder="Bu agent ne yapacak?" rows={3}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div onClick={() => onChange({ waitForApproval: !node.waitForApproval })}
              style={{ width: 36, height: 20, borderRadius: 999, background: node.waitForApproval ? '#f59e0b' : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 2, left: node.waitForApproval ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </div>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Onay bekle</span>
          </label>
        </>)}

        {/* TRIGGER */}
        {node.type === 'trigger' && (
          <div>
            <label style={pLbl}>Açıklama</label>
            <input value={node.action} onChange={(e) => onChange({ action: e.target.value })}
              placeholder="Flow tetikleyici açıklaması" style={pInp} />
          </div>
        )}

        {/* HTTP */}
        {node.type === 'http' && (<>
          <div>
            <label style={pLbl}>Method</label>
            <select value={node.method ?? 'GET'} onChange={(e) => onChange({ method: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              {['GET','POST','PUT','PATCH','DELETE'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label style={pLbl}>URL</label>
            <input value={node.url ?? ''} onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://api.example.com/endpoint" style={pInp} />
          </div>
          <div>
            <label style={pLbl}>Headers (JSON)</label>
            <textarea value={node.headers ?? ''} onChange={(e) => onChange({ headers: e.target.value })}
              placeholder={'{"Authorization": "Bearer {{token}}"}'} rows={2}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
          </div>
          <div>
            <label style={pLbl}>Body (JSON / Template)</label>
            <textarea value={node.body ?? ''} onChange={(e) => onChange({ body: e.target.value })}
              placeholder={'{"title": "{{title}}", "state": "{{state}}"}'} rows={3}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5, fontFamily: 'monospace', fontSize: 11 }} />
          </div>
        </>)}

        {/* AZURE UPDATE */}
        {node.type === 'azure_update' && (<>
          <div>
            <label style={pLbl}>Yeni Durum</label>
            <select value={node.new_state ?? ''} onChange={(e) => onChange({ new_state: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="">Seç...</option>
              {['Active','In Progress','Code Review','QA To Do','Done','Closed','Resolved'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={pLbl}>Yorum (opsiyonel)</label>
            <textarea value={node.comment ?? ''} onChange={(e) => onChange({ comment: e.target.value })}
              placeholder="Work item'a eklenecek yorum..." rows={2}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </>)}

        {/* GITHUB */}
        {node.type === 'github' && (<>
          <div>
            <label style={pLbl}>İşlem</label>
            <select value={node.github_action ?? 'create_branch'} onChange={(e) => onChange({ github_action: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="create_branch">Branch Oluştur</option>
              <option value="create_pr">PR Aç</option>
              <option value="merge_pr">PR Merge</option>
            </select>
          </div>
          <div>
            <label style={pLbl}>Repo</label>
            <input value={node.repo ?? ''} onChange={(e) => onChange({ repo: e.target.value })}
              placeholder="owner/repo-name" style={pInp} />
          </div>
          <div>
            <label style={pLbl}>Branch</label>
            <input value={node.branch ?? ''} onChange={(e) => onChange({ branch: e.target.value })}
              placeholder="feature/{{id}}-{{title}}" style={pInp} />
          </div>
          {(node.github_action === 'create_pr' || !node.github_action) && (
            <div>
              <label style={pLbl}>PR Başlığı</label>
              <input value={node.pr_title ?? ''} onChange={(e) => onChange({ pr_title: e.target.value })}
                placeholder="{{title}}" style={pInp} />
            </div>
          )}
        </>)}

        {/* NOTIFY */}
        {node.type === 'notify' && (<>
          <div>
            <label style={pLbl}>Webhook URL</label>
            <input value={node.webhook_url ?? ''} onChange={(e) => onChange({ webhook_url: e.target.value })}
              placeholder="https://hooks.slack.com/..." style={pInp} />
          </div>
          <div>
            <label style={pLbl}>Mesaj</label>
            <textarea value={node.notify_message ?? ''} onChange={(e) => onChange({ notify_message: e.target.value })}
              placeholder="{{title}} tamamlandı." rows={2}
              style={{ ...pInp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </>)}

        {/* CONDITION */}
        {node.type === 'condition' && (<>
          <div>
            <label style={pLbl}>Alan</label>
            <input value={node.condition_field ?? ''} onChange={(e) => onChange({ condition_field: e.target.value })}
              placeholder="state, title, assigned_to..." style={pInp} />
          </div>
          <div>
            <label style={pLbl}>Operatör</label>
            <select value={node.condition_op ?? 'eq'} onChange={(e) => onChange({ condition_op: e.target.value })}
              style={{ ...pInp, cursor: 'pointer' }}>
              <option value="eq">Eşit (eq)</option>
              <option value="neq">Eşit Değil (neq)</option>
              <option value="contains">İçerir (contains)</option>
            </select>
          </div>
          <div>
            <label style={pLbl}>Değer</label>
            <input value={node.condition_value ?? ''} onChange={(e) => onChange({ condition_value: e.target.value })}
              placeholder="In Progress" style={pInp} />
          </div>
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
      style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid ' + (active ? 'rgba(13,148,136,0.5)' : 'rgba(255,255,255,0.1)'), background: active ? 'rgba(13,148,136,0.2)' : 'rgba(255,255,255,0.04)', color: active ? '#5eead4' : 'rgba(255,255,255,0.5)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
      {children}
    </button>
  );
}

const pLbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 6 };
const pInp: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };

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

  function fmt(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) + ' ' +
      d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ width: 320, flexShrink: 0, borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(3,7,18,0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{t('flows.runHistory')}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onRefresh} title="Yenile"
            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12 }}>↻</button>
          <button onClick={onClose}
            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
      </div>

      {selected ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => onSelect(null as unknown as FlowRunResult)}
            style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer' }}>
            ← Geri
          </button>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{selected.flow_name}</div>
          {selected.task_title && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Görev: {selected.task_title}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[selected.status] ?? '#fff', padding: '2px 8px', borderRadius: 999, background: (STATUS_COLOR[selected.status] ?? '#fff') + '18', border: '1px solid ' + (STATUS_COLOR[selected.status] ?? '#fff') + '40' }}>{selected.status}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{fmt(selected.started_at)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selected.steps.map((step) => (
              <div key={step.id} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{step.node_label ?? step.node_id}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[step.status] ?? '#fff' }}>{step.status}</span>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: step.output ? 6 : 0 }}>{step.node_type}</div>
                {step.error_msg && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{step.error_msg}</div>}
                {Boolean(step.output) && typeof step.output === 'object' && Boolean((step.output as Record<string, unknown>).output) && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 80, overflow: 'hidden' }}>
                    {String((step.output as Record<string, unknown>).output).slice(0, 200)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {loading && <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Yükleniyor...</div>}
          {!loading && runs.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>Henüz run yok</div>
          )}
          {runs.map((run) => (
            <button key={run.id} onClick={() => onSelect(run)}
              style={{ width: '100%', padding: '10px 16px', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{run.flow_name}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[run.status] ?? '#fff' }}>{run.status}</span>
              </div>
              {run.task_title && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.task_title}</div>}
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{fmt(run.started_at)} · {run.steps.length} adım</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
