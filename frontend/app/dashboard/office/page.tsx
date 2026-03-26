'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch, loadPrefs } from '@/lib/api';

/* ── Types ───────────────────────────────────────────────────────── */

type TaskItem = {
  id: number;
  title: string;
  status: string;
  run_duration_sec?: number;
  queue_position?: number;
};

type AgentConfig = {
  role: string;
  label: string;
  icon: string;
  color: string;
  enabled: boolean;
};

type OfficeAgent = AgentConfig & {
  pixelId: number; // unique ID for pixel office character
  status: 'active' | 'idle';
  currentTask: string | null;
  currentStage: string | null;
};

/* ── Load agents from same source as /dashboard/agents ───────────── */

const DEFAULT_AGENTS: AgentConfig[] = [
  { role: 'manager', label: 'Manager', icon: '👔', color: '#f59e0b', enabled: true },
  { role: 'pm', label: 'Product Manager', icon: '📋', color: '#a78bfa', enabled: true },
  { role: 'lead_developer', label: 'Lead Developer', icon: '🧑‍💻', color: '#38bdf8', enabled: true },
  { role: 'developer', label: 'Developer', icon: '⚡', color: '#22c55e', enabled: true },
  { role: 'qa', label: 'QA Engineer', icon: '🔍', color: '#f472b6', enabled: true },
];

const LS_AGENTS = 'tiqr_agent_configs';

function loadAgentConfigs(): AgentConfig[] {
  if (typeof window === 'undefined') return DEFAULT_AGENTS;
  try {
    const saved = localStorage.getItem(LS_AGENTS);
    if (!saved) return DEFAULT_AGENTS;
    const parsed = JSON.parse(saved) as AgentConfig[];
    return parsed.filter((a) => a.enabled !== false);
  } catch {
    return DEFAULT_AGENTS;
  }
}

/* ── Stage mapping ───────────────────────────────────────────────── */

const STAGE_TO_ROLE: Record<string, string[]> = {
  fetch_context: ['pm', 'manager'],
  analyze: ['pm', 'manager'],
  generate_code: ['developer', 'lead_developer'],
  code_generation: ['developer', 'lead_developer'],
  review_code: ['qa', 'lead_developer', 'reviewer'],
  code_review: ['qa', 'lead_developer', 'reviewer'],
  finalize: ['developer', 'lead_developer'],
  code_diff: ['developer'],
  code_preview: ['developer'],
};

function stageToToolName(stage: string): string {
  switch (stage) {
    case 'fetch_context': return 'Grep';
    case 'analyze': return 'Read';
    case 'generate_code': case 'code_generation': return 'Write';
    case 'review_code': case 'code_review': return 'Read';
    case 'finalize': case 'code_diff': case 'code_preview': return 'Bash';
    default: return 'Bash';
  }
}

/* ── Pixel Office iframe bridge ──────────────────────────────────── */

function usePixelOfficeBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  agents: OfficeAgent[],
  iframeReady: boolean,
) {
  const spawnedRef = useRef<Set<number>>(new Set());
  const stageRef = useRef<Record<number, string>>({});
  const bridgeReady = useRef(false);

  useEffect(() => {
    if (!iframeReady) return;
    const timer = setTimeout(() => {
      bridgeReady.current = true;
      spawnedRef.current.clear();
      stageRef.current = {};
    }, 2500);
    return () => clearTimeout(timer);
  }, [iframeReady]);

  useEffect(() => {
    if (!bridgeReady.current) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    const send = (payload: unknown) => {
      iframe.contentWindow?.postMessage({ source: 'tiqr-bridge', payload }, '*');
    };

    for (const agent of agents) {
      if (!spawnedRef.current.has(agent.pixelId)) {
        send({ type: 'agentCreated', id: agent.pixelId, folderName: agent.label });
        spawnedRef.current.add(agent.pixelId);
      }

      const stage = agent.status === 'active' ? (agent.currentStage || 'working') : 'idle';
      const prev = stageRef.current[agent.pixelId] || '';

      if (stage !== prev) {
        stageRef.current[agent.pixelId] = stage;
        if (agent.status === 'active' && agent.currentStage) {
          send({
            type: 'agentToolStart',
            id: agent.pixelId,
            toolId: `tool-${agent.pixelId}-${Date.now()}`,
            status: stageToToolName(agent.currentStage),
          });
        } else if (prev && prev !== 'idle') {
          send({ type: 'agentToolsClear', id: agent.pixelId });
          send({ type: 'agentStatus', id: agent.pixelId, status: 'waiting' });
        }
      }
    }
  }, [agents, iframeRef]);
}

/* ── Task Assignment Modal ───────────────────────────────────────── */

function AssignTaskModal({
  agent, tasks, onClose,
}: {
  agent: OfficeAgent;
  tasks: TaskItem[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const queuedTasks = tasks.filter((t) => t.status === 'queued');

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await apiFetch('/agents/run', {
        method: 'POST',
        body: JSON.stringify({
          task: { title: title.trim(), description: desc.trim() || title.trim() },
          async_mode: true,
          create_pr: true,
        }),
      });
      onClose();
    } catch { /* silent */ } finally { setCreating(false); }
  };

  const handleAssign = async (taskId: number) => {
    try {
      await apiFetch(`/tasks/${taskId}/assign`, { method: 'POST' });
      onClose();
    } catch { /* silent */ }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100, padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(480px, 100%)', borderRadius: 20,
          border: `1px solid ${agent.color}40`, background: 'var(--surface)',
          padding: 24, maxHeight: '80vh', overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: `${agent.color}20`, border: `1px solid ${agent.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>{agent.icon}</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: agent.color }}>{agent.label}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)' }}>
              {agent.status === 'active' ? `${agent.currentStage} · ${agent.currentTask?.slice(0, 30)}` : 'Bos, is bekliyor'}
            </div>
          </div>
          <button onClick={onClose} style={{
            marginLeft: 'auto', width: 32, height: 32, borderRadius: 8,
            border: '1px solid var(--panel-border)', background: 'var(--panel-alt)',
            color: 'var(--ink-50)', cursor: 'pointer', fontSize: 16,
          }}>✕</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: agent.color, marginBottom: 8 }}>
            Yeni Task Olustur
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task basligi..."
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Aciklama (opsiyonel)..." rows={3}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          <button onClick={handleCreate} disabled={!title.trim() || creating}
            style={{ marginTop: 8, width: '100%', padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: title.trim() && !creating ? 'pointer' : 'default', background: title.trim() ? agent.color : 'var(--panel-alt)', color: title.trim() ? '#000' : 'var(--ink-25)', border: 'none' }}>
            {creating ? 'Gonderiliyor...' : 'Goreve Gonder'}
          </button>
        </div>

        {queuedTasks.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>
              veya Bekleyen Task Ata
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {queuedTasks.slice(0, 5).map((task) => (
                <button key={task.id} onClick={() => handleAssign(task.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 10, fontSize: 12, background: 'var(--panel)', border: '1px solid var(--panel-border-2)', color: 'var(--ink-78)', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>⏳</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                  <span style={{ color: agent.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>Ata →</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────── */

export default function OfficePage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [officeAgents, setOfficeAgents] = useState<OfficeAgent[]>([]);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<'office' | 'split'>('split');
  const [assignAgent, setAssignAgent] = useState<OfficeAgent | null>(null);

  // Load agent configs (same source as /dashboard/agents)
  useEffect(() => {
    const boot = async () => {
      let configs = loadAgentConfigs();
      try {
        const prefs = await loadPrefs();
        if (prefs.agents?.length) {
          localStorage.setItem(LS_AGENTS, JSON.stringify(prefs.agents));
          configs = (prefs.agents as AgentConfig[]).filter((a) => a.enabled !== false);
        }
      } catch { /* silent */ }
      setAgentConfigs(configs);
    };
    void boot();
  }, []);

  // Poll tasks and build office agents with live status
  useEffect(() => {
    if (agentConfigs.length === 0) return;

    const poll = async () => {
      try {
        const taskList = await apiFetch<TaskItem[]>('/tasks');
        setTasks(taskList);

        // Get running tasks with their latest stage from logs
        const runningTasks = taskList.filter((t) => t.status === 'running');

        // Try to get live data from backend
        let liveStages: Array<{ task_id: number; title: string; current_stage: string; active_role: string }> = [];
        try {
          const live = await apiFetch<{ running_tasks: typeof liveStages }>('/agents/live');
          liveStages = live.running_tasks || [];
        } catch { /* silent */ }

        // Build office agents from configs + live status
        const agents: OfficeAgent[] = agentConfigs.map((config, idx) => {
          // Find if this agent role is currently active
          const activeTask = liveStages.find((t) => {
            const roles = STAGE_TO_ROLE[t.current_stage] || [];
            return roles.includes(config.role);
          });

          return {
            ...config,
            pixelId: idx + 1,
            status: activeTask ? 'active' as const : 'idle' as const,
            currentTask: activeTask?.title || null,
            currentStage: activeTask?.current_stage || null,
          };
        });

        setOfficeAgents(agents);
      } catch { /* silent */ }
    };

    void poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [agentConfigs]);

  usePixelOfficeBridge(iframeRef, officeAgents, iframeLoaded);

  const activeAgents = officeAgents.filter((a) => a.status === 'active');
  const running = tasks.filter((t) => t.status === 'running');
  const queued = tasks.filter((t) => t.status === 'queued');
  const recentCompleted = tasks.filter((t) => t.status === 'completed').slice(0, 5);

  return (
    <div style={{ display: 'grid', gap: 20, height: 'calc(100vh - 136px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="section-label">PIXEL OFFICE</div>
          <h1 style={{
            fontSize: 28, fontWeight: 800, color: 'var(--ink-90)',
            marginTop: 6, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 12,
          }}>
            Patron Modu
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: activeAgents.length > 0 ? '#22c55e' : 'var(--ink-35)',
              background: activeAgents.length > 0 ? 'rgba(34,197,94,0.16)' : 'var(--panel-alt)',
              border: `1px solid ${activeAgents.length > 0 ? 'rgba(34,197,94,0.35)' : 'var(--panel-border)'}`,
              borderRadius: 999, padding: '4px 12px',
            }}>
              {activeAgents.length > 0
                ? `${activeAgents.length}/${officeAgents.length} calisiyor`
                : `${officeAgents.length} agent hazir`}
            </span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['split', 'office'] as const).map((mode) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              style={{
                padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: viewMode === mode ? 'rgba(94,234,212,0.16)' : 'var(--panel-alt)',
                border: viewMode === mode ? '1px solid rgba(94,234,212,0.35)' : '1px solid var(--panel-border)',
                color: viewMode === mode ? '#5eead4' : 'var(--ink-50)',
              }}>
              {mode === 'split' ? 'Split' : 'Full Office'}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: viewMode === 'split' ? '1fr 340px' : '1fr',
        gap: 16, flex: 1, minHeight: 0,
      }}>
        {/* Pixel Office iframe */}
        <div style={{
          borderRadius: 20, border: '1px solid var(--panel-border)',
          overflow: 'hidden', position: 'relative', background: '#0a0a14', minHeight: 400,
        }}>
          {!iframeLoaded && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-35)', fontSize: 14, background: '#0a0a14', zIndex: 2,
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
                <div>Ofis yukleniyor...</div>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef} src="/pixel-office/index.html"
            onLoad={() => setIframeLoaded(true)}
            style={{ width: '100%', height: '100%', border: 'none', display: iframeLoaded ? 'block' : 'none' }}
            title="Pixel Office"
          />
        </div>

        {/* Side Panel */}
        {viewMode === 'split' && (
          <div style={{ display: 'grid', gap: 12, alignContent: 'start', overflow: 'auto' }}>

            {/* Agent Cards */}
            <div style={{ borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 12 }}>
                AI Ekibi ({officeAgents.length}) · tikla → gorev ata
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {officeAgents.map((agent) => {
                  const isActive = agent.status === 'active';
                  return (
                    <div key={agent.pixelId} onClick={() => setAssignAgent(agent)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 12, cursor: 'pointer',
                        background: isActive ? `${agent.color}12` : 'var(--panel)',
                        border: `1px solid ${isActive ? `${agent.color}35` : 'var(--panel-border-2)'}`,
                        transition: 'all 0.15s',
                      }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: `${agent.color}20`, border: `1px solid ${agent.color}35`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, flexShrink: 0,
                      }}>{agent.icon}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: agent.color, display: 'flex', alignItems: 'center', gap: 5 }}>
                          {agent.label}
                          <span style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: isActive ? '#22c55e' : 'var(--ink-25)',
                            boxShadow: isActive ? '0 0 6px #22c55e' : 'none',
                          }} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isActive ? `${agent.currentStage} · ${agent.currentTask?.slice(0, 20) || ''}` : 'tikla → gorev ata'}
                        </div>
                      </div>
                      {!isActive && <span style={{ fontSize: 14, color: agent.color, flexShrink: 0 }}>+</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Running Tasks */}
            <div style={{ borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Aktif Gorevler</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: running.length > 0 ? '#38bdf8' : 'var(--ink-25)', background: running.length > 0 ? 'rgba(56,189,248,0.16)' : 'var(--panel)', borderRadius: 999, padding: '2px 8px' }}>
                  {running.length}
                </span>
              </div>
              {running.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-25)', padding: '8px 0' }}>Aktif gorev yok — bir agent'a tikla!</div>
              ) : running.map((task) => (
                <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none', display: 'block', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                  <div style={{ fontSize: 11, color: '#5eead4', marginTop: 3 }}>{task.run_duration_sec ? `${Math.round(task.run_duration_sec)}s` : 'running...'}</div>
                </Link>
              ))}
            </div>

            {/* Queue */}
            {queued.length > 0 && (
              <div style={{ borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Kuyruk</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.16)', borderRadius: 999, padding: '2px 8px' }}>{queued.length}</span>
                </div>
                {queued.slice(0, 5).map((task, i) => (
                  <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--panel-border-2)', fontSize: 12, color: 'var(--ink-50)', marginBottom: 3 }}>
                    <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 11 }}>#{i + 1}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                  </Link>
                ))}
              </div>
            )}

            {/* Recent Completed */}
            {recentCompleted.length > 0 && (
              <div style={{ borderRadius: 16, border: '1px solid rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.04)', padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#22c55e', marginBottom: 10 }}>Son Tamamlananlar</div>
                {recentCompleted.map((task) => (
                  <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-50)', padding: '4px 0' }}>
                    <span style={{ color: '#22c55e' }}>✓</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task Assignment Modal */}
      {assignAgent && <AssignTaskModal agent={assignAgent} tasks={tasks} onClose={() => setAssignAgent(null)} />}
    </div>
  );
}
