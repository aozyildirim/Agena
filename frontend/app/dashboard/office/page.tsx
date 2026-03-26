'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch, loadPrefs, savePrefs } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';

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
  provider?: string;
  model?: string;
  custom_model?: string;
  description?: string;
  system_prompt?: string;
};

type OfficeAgent = AgentConfig & {
  pixelId: number;
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

/* ── Step label to pixel-agents tool animation ───────────────────── */

function stepToToolName(step: string): string {
  if (step.includes('fetch') || step.includes('context')) return 'Grep';
  if (step.includes('pm') || step.includes('analyz') || step.includes('plan')) return 'Read';
  if (step.includes('generat') || step.includes('cod') || step.includes('dev')) return 'Write';
  if (step.includes('review') || step.includes('qa')) return 'Read';
  if (step.includes('final') || step.includes('complete')) return 'Bash';
  return 'Bash';
}

type LiveResponse = {
  running_tasks: Array<{ task_id: number; title: string; active_role: string; step_label: string }>;
  active_roles: Record<string, { task_id: number; title: string; active_role: string; step_label: string }>;
  active_count: number;
};

/* ── Provider / Model constants ─────────────────────────────────── */

const PROVIDERS: { id: string; label: string; icon: string; desc: string }[] = [
  { id: 'openai', label: 'OpenAI', icon: '⚡', desc: 'GPT-4o, GPT-5, o3...' },
  { id: 'gemini', label: 'Gemini', icon: '✦', desc: 'Gemini 2.5 Pro/Flash' },
  { id: 'codex_cli', label: 'Codex CLI', icon: '⌘', desc: 'Local CLI agent' },
  { id: 'claude_cli', label: 'Claude CLI', icon: '✎', desc: 'Claude Code CLI' },
  { id: 'custom', label: 'Custom', icon: '🔧', desc: 'Custom endpoint' },
];

const OPENAI_MODELS = [
  { id: 'o3', label: 'o3' },
  { id: 'o4-mini', label: 'o4-mini' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
  { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

function modelsForProvider(provider: string) {
  if (provider === 'openai') return OPENAI_MODELS;
  if (provider === 'gemini') return GEMINI_MODELS;
  return [];
}

const COLOR_PICKS = ['#38bdf8', '#22c55e', '#f59e0b', '#a78bfa', '#f472b6', '#ef4444', '#14b8a6', '#6366f1', '#ec4899', '#84cc16'];

// 6 pixel character palettes (char_0.png .. char_5.png)
const PALETTE_COUNT = 6;
// Each PNG is 112×96: 7 frames × 16px wide, 3 direction rows × 32px tall
// Walk2 (standing idle pose) = frame index 1, row 0 (down direction)
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const IDLE_FRAME_X = 1 * CHAR_FRAME_W; // frame 1
const IDLE_FRAME_Y = 0; // row 0 = down

function PixelCharacterPicker({ selected, onSelect, accentColor }: {
  selected: number;
  onSelect: (palette: number) => void;
  accentColor: string;
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    for (let i = 0; i < PALETTE_COUNT; i++) {
      const img = new Image();
      img.src = `/pixel-office/assets/characters/char_${i}.png`;
      img.onload = () => {
        const canvas = canvasRefs.current[i];
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw the idle frame (walk2, facing down)
        ctx.drawImage(img, IDLE_FRAME_X, IDLE_FRAME_Y, CHAR_FRAME_W, CHAR_FRAME_H, 0, 0, canvas.width, canvas.height);
        setLoaded((p) => p + 1);
      };
    }
  }, []);

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      {Array.from({ length: PALETTE_COUNT }, (_, i) => (
        <button key={i} onClick={() => onSelect(i)}
          style={{
            width: 56, height: 72, borderRadius: 12, cursor: 'pointer', padding: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: selected === i ? `2px solid ${accentColor}` : '2px solid var(--panel-border)',
            background: selected === i ? `${accentColor}15` : 'var(--panel)',
            boxShadow: selected === i ? `0 0 12px ${accentColor}30` : 'none',
            transition: 'all 0.15s', position: 'relative',
          }}>
          <canvas
            ref={(el) => { canvasRefs.current[i] = el; }}
            width={CHAR_FRAME_W * 3}
            height={CHAR_FRAME_H * 3}
            style={{ width: 48, height: 96, imageRendering: 'pixelated' }}
          />
          {selected === i && (
            <div style={{
              position: 'absolute', bottom: -4, right: -4,
              width: 16, height: 16, borderRadius: 99,
              background: accentColor, color: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 900,
            }}>✓</div>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Pixel Office iframe bridge ──────────────────────────────────── */

function usePixelOfficeBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  agentsRef: React.RefObject<OfficeAgent[]>,
  iframeReady: boolean,
) {
  const spawnedRef = useRef<Set<number>>(new Set());
  const stageRef = useRef<Record<number, string>>({});

  useEffect(() => {
    if (!iframeReady) return;
    let syncId: ReturnType<typeof setInterval>;

    const safeSend = (ref: React.RefObject<HTMLIFrameElement | null>, p: unknown) => {
      const w = ref.current?.contentWindow;
      if (w) w.postMessage({ source: 'tiqr-bridge', payload: p }, '*');
    };

    const startTimer = setTimeout(() => {
      const agents = agentsRef.current ?? [];
      if (!iframeRef.current?.contentWindow || !agents.length) return;
      for (const a of agents) {
        safeSend(iframeRef, { type: 'agentCreated', id: a.pixelId, folderName: a.label });
        spawnedRef.current.add(a.pixelId);
        stageRef.current[a.pixelId] = a.status === 'active' ? (a.currentStage || 'active') : 'idle';
      }
      setTimeout(() => {
        const curr = agentsRef.current ?? [];
        for (const a of curr) {
          if (a.status === 'active') {
            safeSend(iframeRef, { type: 'agentToolStart', id: a.pixelId, toolId: `t-${a.pixelId}-${Date.now()}`, status: stepToToolName(a.currentStage || '') });
          } else {
            safeSend(iframeRef, { type: 'agentStatus', id: a.pixelId, status: 'waiting' });
          }
        }
      }, 3000);

      syncId = setInterval(() => {
        const ag = agentsRef.current ?? [];
        if (!iframeRef.current?.contentWindow || !ag.length) return;
        for (const agent of ag) {
          const key = agent.status === 'active' ? (agent.currentStage || 'active') : 'idle';
          if (key === stageRef.current[agent.pixelId]) continue;
          const prev = stageRef.current[agent.pixelId];
          stageRef.current[agent.pixelId] = key;
          if (agent.status === 'active') {
            safeSend(iframeRef, { type: 'agentToolStart', id: agent.pixelId, toolId: `t-${agent.pixelId}-${Date.now()}`, status: stepToToolName(agent.currentStage || '') });
          } else if (prev && prev !== 'idle') {
            safeSend(iframeRef, { type: 'agentToolsClear', id: agent.pixelId });
            safeSend(iframeRef, { type: 'agentStatus', id: agent.pixelId, status: 'waiting' });
          }
        }
      }, 1000);
    }, 2500);

    return () => { clearTimeout(startTimer); clearInterval(syncId); };
  }, [iframeReady, iframeRef, agentsRef]);
}

/* ── Task Assignment Modal ───────────────────────────────────────── */

function AssignTaskModal({
  agent, tasks, onClose, t,
}: {
  agent: OfficeAgent;
  tasks: TaskItem[];
  onClose: () => void;
  t: (key: TranslationKey) => string;
}) {
  const [tab, setTab] = useState<'assign' | 'new'>('assign');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [selProvider, setSelProvider] = useState(agent.provider || '');
  const [selModel, setSelModel] = useState(agent.model || '');
  const [customModel, setCustomModel] = useState('');
  const assignable = tasks.filter((tk) => tk.status === 'queued' || tk.status === 'failed');
  const availModels = modelsForProvider(selProvider);

  const assignBody = () => {
    const body: Record<string, unknown> = { create_pr: true };
    if (selProvider) body.agent_provider = selProvider;
    const m = selModel || customModel;
    if (m) body.agent_model = m;
    if (agent.role) body.agent_role = agent.role;
    return body;
  };

  const handleAssign = async (taskId: number) => {
    setAssigning(taskId);
    try {
      await apiFetch(`/tasks/${taskId}/assign`, { method: 'POST', body: JSON.stringify(assignBody()) });
      onClose();
    } catch { /* silent */ } finally { setAssigning(null); }
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await apiFetch('/agents/run', {
        method: 'POST',
        body: JSON.stringify({
          task: { title: title.trim(), description: desc.trim() || title.trim() },
          async_mode: true, create_pr: true,
          agent_provider: selProvider || undefined,
          agent_model: (selModel || customModel) || undefined,
          agent_role: agent.role || undefined,
        }),
      });
      onClose();
    } catch { /* silent */ } finally { setCreating(false); }
  };

  const isActive = agent.status === 'active';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div style={{ width: 'min(500px, 100%)', borderRadius: 20, border: `1px solid ${agent.color}40`, background: 'var(--surface)', padding: 24, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: `${agent.color}20`, border: `1px solid ${agent.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{agent.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: agent.color }}>{agent.label}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)' }}>
              {isActive ? `${agent.currentStage} · ${agent.currentTask?.slice(0, 30)}` : t('office.agentBusy')}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        {isActive && (
          <div style={{ padding: '10px 12px', borderRadius: 12, marginBottom: 16, background: `${agent.color}10`, border: `1px solid ${agent.color}25`, fontSize: 12, color: agent.color }}>
            {t('office.agentWorking')} <strong>{agent.currentTask}</strong>
            <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 2 }}>{t('office.agentStage')} {agent.currentStage}</div>
          </div>
        )}

        {/* Provider & Model selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{t('office.typeModel')}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {PROVIDERS.map((p) => (
              <button key={p.id} onClick={() => { setSelProvider(p.id); setSelModel(''); setCustomModel(''); }}
                style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: selProvider === p.id ? `1px solid ${agent.color}60` : '1px solid var(--panel-border-2)', background: selProvider === p.id ? `${agent.color}15` : 'var(--panel)', color: selProvider === p.id ? agent.color : 'var(--ink-50)' }}>
                {p.icon} {p.label}
              </button>
            ))}
          </div>
          {availModels.length > 0 ? (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {availModels.map((m) => (
                <button key={m.id} onClick={() => setSelModel(m.id)}
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: selModel === m.id ? `1px solid ${agent.color}50` : '1px solid var(--panel-border)', background: selModel === m.id ? `${agent.color}12` : 'transparent', color: selModel === m.id ? agent.color : 'var(--ink-40)' }}>
                  {selModel === m.id && '✓ '}{m.label}
                </button>
              ))}
            </div>
          ) : (selProvider === 'custom' || selProvider === 'codex_cli' || selProvider === 'claude_cli') ? (
            <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder={t('office.modelPlaceholder')}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 11, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', outline: 'none', boxSizing: 'border-box' }} />
          ) : null}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {([{ key: 'assign' as const, label: `${t('office.tabAssign')} (${assignable.length})` }, { key: 'new' as const, label: t('office.tabNew') }]).map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              style={{ flex: 1, padding: '8px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: tab === tb.key ? `${agent.color}20` : 'var(--panel)', color: tab === tb.key ? agent.color : 'var(--ink-35)' }}>
              {tb.label}
            </button>
          ))}
        </div>

        {tab === 'assign' && (
          <div>
            {assignable.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-25)', fontSize: 13 }}>{t('office.noAssignable')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {assignable.map((task) => (
                  <button key={task.id} onClick={() => handleAssign(task.id)} disabled={assigning === task.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 12, fontSize: 13, background: 'var(--panel)', border: '1px solid var(--panel-border-2)', color: 'var(--ink-78)', cursor: 'pointer', textAlign: 'left', opacity: assigning === task.id ? 0.5 : 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0, color: task.status === 'failed' ? '#f87171' : '#f59e0b' }}>{task.status === 'failed' ? '✕' : '⏳'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-25)', marginTop: 2 }}>#{task.id} · {task.status}</div>
                    </div>
                    <span style={{ color: agent.color, fontSize: 12, fontWeight: 700, flexShrink: 0, padding: '4px 10px', borderRadius: 8, background: `${agent.color}15`, border: `1px solid ${agent.color}30` }}>
                      {assigning === task.id ? '...' : t('office.run')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'new' && (
          <div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('office.taskTitlePlaceholder')}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', outline: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('office.taskDescPlaceholder')} rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            <button onClick={handleCreate} disabled={!title.trim() || creating}
              style={{ marginTop: 8, width: '100%', padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: title.trim() && !creating ? 'pointer' : 'default', background: title.trim() ? agent.color : 'var(--panel-alt)', color: title.trim() ? '#000' : 'var(--ink-25)', border: 'none' }}>
              {creating ? t('office.sending') : t('office.createAndRun')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Add Agent Modal (3-step) ────────────────────────────────────── */

function AddAgentModal({
  onClose, onAdd, t, existingRoles,
}: {
  onClose: () => void;
  onAdd: (agent: AgentConfig) => void;
  t: (key: TranslationKey) => string;
  existingRoles: string[];
}) {
  const [step, setStep] = useState(0); // 0=identity, 1=provider, 2=model
  const [label, setLabel] = useState('');
  const [palette, setPalette] = useState(0);
  const [color, setColor] = useState('#38bdf8');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const availModels = modelsForProvider(provider);
  const needsCustomInput = provider === 'custom' || provider === 'codex_cli' || provider === 'claude_cli';

  // Map palette index to a default icon for the agent config
  const paletteIcons = ['👔', '📋', '🧑‍💻', '⚡', '🔍', '🤖'];

  const toRoleId = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `agent_${Date.now()}`;

  const roleId = toRoleId(label);
  const roleConflict = existingRoles.includes(roleId);

  const canNext = () => {
    if (step === 0) return label.trim().length > 0 && !roleConflict;
    if (step === 1) return provider !== '';
    return true;
  };

  const handleFinish = () => {
    if (!label.trim()) return;
    const finalModel = model || customModel;
    onAdd({
      role: roleId,
      label: label.trim(),
      icon: paletteIcons[palette] || '🤖',
      color,
      enabled: true,
      provider: provider || undefined,
      model: finalModel || undefined,
      custom_model: customModel || undefined,
      description: '',
      system_prompt: '',
    });
  };

  const stepTitles = [t('office.addAgentTitle'), t('office.type'), t('office.model')];

  const inputSt: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13,
    border: '1px solid var(--panel-border)', background: 'var(--panel)',
    color: 'var(--ink-90)', outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onClose}>
      <div style={{ width: 'min(480px, 100%)', borderRadius: 24, border: `1px solid ${color}30`, background: 'var(--surface)', padding: 0, overflow: 'hidden', boxShadow: `0 32px 100px rgba(0,0,0,0.5), 0 0 0 1px ${color}10` }} onClick={(e) => e.stopPropagation()}>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--panel-border)' }}>
          <div style={{ height: '100%', width: `${((step + 1) / 3) * 100}%`, background: `linear-gradient(90deg, ${color}, ${color}88)`, borderRadius: 2, transition: 'width 0.3s ease' }} />
        </div>

        <div style={{ padding: '20px 24px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4 }}>
                {step + 1}/3
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)' }}>{stepTitles[step]}</div>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>

          {/* Step 0: Identity */}
          {step === 0 && (
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Character picker */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 10 }}>{t('office.pickCharacter')}</div>
                <PixelCharacterPicker selected={palette} onSelect={setPalette} accentColor={color} />
              </div>

              {/* Name input */}
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('office.agentNamePlaceholder')} autoFocus
                style={inputSt} />

              {roleConflict && (
                <div style={{ fontSize: 11, color: '#f87171', padding: '0 2px' }}>
                  {t('office.roleConflict')}
                </div>
              )}

              {/* Color picker */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{t('office.color')}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {COLOR_PICKS.map((c) => (
                    <button key={c} onClick={() => setColor(c)}
                      style={{ width: 28, height: 28, borderRadius: 8, cursor: 'pointer', background: c, border: color === c ? '2px solid #fff' : '2px solid transparent', boxShadow: color === c ? `0 0 0 2px ${c}` : 'none', transition: 'all 0.15s' }} />
                  ))}
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                    style={{ width: 28, height: 28, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--panel-border)', padding: 0, background: 'transparent' }} />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Provider */}
          {step === 1 && (
            <div style={{ display: 'grid', gap: 8 }}>
              {PROVIDERS.map((p) => (
                <button key={p.id} onClick={() => { setProvider(p.id); setModel(''); setCustomModel(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left', width: '100%',
                    border: provider === p.id ? `2px solid ${color}` : '1px solid var(--panel-border-2)',
                    background: provider === p.id ? `${color}10` : 'var(--panel)',
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: provider === p.id ? `${color}20` : 'var(--panel-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{p.icon}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: provider === p.id ? color : 'var(--ink-90)' }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 2 }}>{p.desc}</div>
                  </div>
                  {provider === p.id && <div style={{ marginLeft: 'auto', color: color, fontSize: 18 }}>✓</div>}
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Model */}
          {step === 2 && (
            <div style={{ display: 'grid', gap: 10 }}>
              {availModels.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {availModels.map((m) => (
                    <button key={m.id} onClick={() => setModel(m.id)}
                      style={{
                        padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                        border: model === m.id ? `2px solid ${color}` : '1px solid var(--panel-border-2)',
                        background: model === m.id ? `${color}10` : 'var(--panel)',
                        transition: 'all 0.15s',
                      }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: model === m.id ? color : 'var(--ink-78)' }}>
                        {model === m.id && '✓ '}{m.label}
                      </div>
                    </button>
                  ))}
                </div>
              ) : needsCustomInput ? (
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder={t('office.modelPlaceholder')} autoFocus style={inputSt} />
              ) : (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-35)', fontSize: 13 }}>
                  {t('office.noModelNeeded')}
                </div>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)}
                style={{ flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                ← {t('office.back')}
              </button>
            )}
            {step < 2 ? (
              <button onClick={() => setStep(step + 1)} disabled={!canNext()}
                style={{
                  flex: 2, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: canNext() ? 'pointer' : 'not-allowed',
                  background: canNext() ? `linear-gradient(135deg, ${color}, ${color}cc)` : 'var(--panel-alt)',
                  border: 'none', color: canNext() ? '#000' : 'var(--ink-25)', transition: 'all 0.2s',
                }}>
                {t('office.next')} →
              </button>
            ) : (
              <button onClick={handleFinish} disabled={!label.trim()}
                style={{
                  flex: 2, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: label.trim() ? 'pointer' : 'not-allowed',
                  background: label.trim() ? `linear-gradient(135deg, ${color}, ${color}cc)` : 'var(--panel-alt)',
                  border: 'none', color: label.trim() ? '#000' : 'var(--ink-25)', transition: 'all 0.2s',
                }}>
                ✓ {t('office.create')}
              </button>
            )}
          </div>
        </div>
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
  const [showAddAgent, setShowAddAgent] = useState(false);
  const officeAgentsRef = useRef<OfficeAgent[]>([]);
  const { t } = useLocale();
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Layout: save to DB via profile_settings.office_layout ──
  const saveLayoutToDB = useCallback((layout: unknown) => {
    // Debounce: wait 2s of no changes before saving
    if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      void savePrefs({ profile_settings: { office_layout: layout } }).catch(() => {});
    }, 2000);
  }, []);

  // Listen for messages from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.source !== 'pixel-office') return;
      const type = e.data.payload?.type;
      if (type === 'saveLayout') {
        saveLayoutToDB(e.data.payload.layout);
      } else if (type === 'openClaude') {
        // +Agent clicked inside pixel office iframe
        setShowAddAgent(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [saveLayoutToDB]);

  // After iframe loads, restore layout from DB
  useEffect(() => {
    if (!iframeLoaded) return;
    const timer = setTimeout(async () => {
      try {
        const prefs = await loadPrefs();
        const layout = prefs.profile_settings?.office_layout;
        if (layout) {
          iframeRef.current?.contentWindow?.postMessage(
            { source: 'tiqr-bridge', payload: { type: 'layoutLoaded', layout } }, '*',
          );
        }
      } catch { /* silent */ }
    }, 1500);
    return () => clearTimeout(timer);
  }, [iframeLoaded]);

  // Keep ref in sync with state
  useEffect(() => { officeAgentsRef.current = officeAgents; }, [officeAgents]);

  // Load agent configs
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
        const [taskList, live] = await Promise.all([
          apiFetch<TaskItem[]>('/tasks'),
          apiFetch<LiveResponse>('/agents/live').catch((): LiveResponse => ({ running_tasks: [], active_roles: {}, active_count: 0 })),
        ]);
        setTasks(taskList);
        const agents: OfficeAgent[] = agentConfigs.map((config, idx) => {
          const activeInfo = live.active_roles[config.role];
          return { ...config, pixelId: idx + 1, status: activeInfo ? 'active' as const : 'idle' as const, currentTask: activeInfo?.title || null, currentStage: activeInfo?.step_label || null };
        });
        setOfficeAgents(agents);
      } catch { /* silent */ }
    };
    void poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [agentConfigs]);

  usePixelOfficeBridge(iframeRef, officeAgentsRef, iframeLoaded);

  const handleAddAgent = useCallback((newAgent: AgentConfig) => {
    setAgentConfigs((prev) => {
      const updated = [...prev, newAgent];
      localStorage.setItem(LS_AGENTS, JSON.stringify(updated));
      void savePrefs({ agents: updated as unknown as Record<string, unknown>[] }).catch(() => {});
      return updated;
    });
    setShowAddAgent(false);
  }, []);

  const activeAgents = officeAgents.filter((a) => a.status === 'active');
  const running = tasks.filter((tk) => tk.status === 'running');
  const queued = tasks.filter((tk) => tk.status === 'queued');
  const recentCompleted = tasks.filter((tk) => tk.status === 'completed').slice(0, 5);

  const statusText = activeAgents.length > 0
    ? t('office.statusWorking').replace('{active}', String(activeAgents.length)).replace('{total}', String(officeAgents.length))
    : t('office.statusReady').replace('{total}', String(officeAgents.length));

  return (
    <div style={{ display: 'grid', gap: 20, height: 'calc(100vh - 136px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="section-label">{t('office.section')}</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 12 }}>
            {t('office.title')}
            <span style={{ fontSize: 12, fontWeight: 700, color: activeAgents.length > 0 ? '#22c55e' : 'var(--ink-35)', background: activeAgents.length > 0 ? 'rgba(34,197,94,0.16)' : 'var(--panel-alt)', border: `1px solid ${activeAgents.length > 0 ? 'rgba(34,197,94,0.35)' : 'var(--panel-border)'}`, borderRadius: 999, padding: '4px 12px' }}>
              {statusText}
            </span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['split', 'office'] as const).map((mode) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              style={{ padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: viewMode === mode ? 'rgba(94,234,212,0.16)' : 'var(--panel-alt)', border: viewMode === mode ? '1px solid rgba(94,234,212,0.35)' : '1px solid var(--panel-border)', color: viewMode === mode ? '#5eead4' : 'var(--ink-50)' }}>
              {mode === 'split' ? t('office.viewSplit') : t('office.viewFull')}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ display: 'grid', gridTemplateColumns: viewMode === 'split' ? '1fr 340px' : '1fr', gap: 16, flex: 1, minHeight: 0 }}>
        {/* Pixel Office iframe */}
        <div style={{ borderRadius: 20, border: '1px solid var(--panel-border)', overflow: 'hidden', position: 'relative', background: '#0a0a14', minHeight: 400 }}>
          {!iframeLoaded && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-35)', fontSize: 14, background: '#0a0a14', zIndex: 2 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
                <div>{t('office.loading')}</div>
              </div>
            </div>
          )}
          <iframe ref={iframeRef} src="/pixel-office/index.html" onLoad={() => setIframeLoaded(true)}
            style={{ width: '100%', height: '100%', border: 'none', display: iframeLoaded ? 'block' : 'none' }} title="Pixel Office" />
        </div>

        {/* Side Panel */}
        {viewMode === 'split' && (
          <div style={{ display: 'grid', gap: 12, alignContent: 'start', overflow: 'auto' }}>

            {/* Agent Cards */}
            <div style={{ borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 12 }}>
                {t('office.teamTitle')} ({officeAgents.length}) · {t('office.teamHint')}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {officeAgents.map((agent) => {
                  const isActive = agent.status === 'active';
                  return (
                    <div key={agent.pixelId} onClick={() => setAssignAgent(agent)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, cursor: 'pointer', background: isActive ? `${agent.color}12` : 'var(--panel)', border: `1px solid ${isActive ? `${agent.color}35` : 'var(--panel-border-2)'}`, transition: 'all 0.15s' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `${agent.color}20`, border: `1px solid ${agent.color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{agent.icon}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: agent.color, display: 'flex', alignItems: 'center', gap: 5 }}>
                          {agent.label}
                          {(agent.provider && (agent.model || agent.custom_model)) && (
                            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 999, background: `${agent.color}15`, color: `${agent.color}cc` }}>{agent.model || agent.custom_model}</span>
                          )}
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? '#22c55e' : 'var(--ink-25)', boxShadow: isActive ? '0 0 6px #22c55e' : 'none' }} />
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--ink-35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isActive ? `${agent.currentStage} · ${agent.currentTask?.slice(0, 20) || ''}` : t('office.agentIdle')}
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
                <span>{t('office.activeTasks')}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: running.length > 0 ? '#38bdf8' : 'var(--ink-25)', background: running.length > 0 ? 'rgba(56,189,248,0.16)' : 'var(--panel)', borderRadius: 999, padding: '2px 8px' }}>{running.length}</span>
              </div>
              {running.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-25)', padding: '8px 0' }}>{t('office.noActiveTasks')}</div>
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
                  <span>{t('office.queue')}</span>
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
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#22c55e', marginBottom: 10 }}>{t('office.recentCompleted')}</div>
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

      {assignAgent && <AssignTaskModal agent={assignAgent} tasks={tasks} onClose={() => setAssignAgent(null)} t={t} />}

      {showAddAgent && (
        <AddAgentModal
          onClose={() => setShowAddAgent(false)}
          onAdd={handleAddAgent}
          t={t}
          existingRoles={agentConfigs.map((a) => a.role)}
        />
      )}
    </div>
  );
}
