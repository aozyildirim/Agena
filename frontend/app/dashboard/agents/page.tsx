'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { loadPrefs, savePrefs, getAgentAnalytics, loadPromptCatalog, type PromptCatalog } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = string;

interface AgentConfig {
  role: AgentRole;
  label: string;
  icon: string;
  color: string;
  description: string;
  provider: 'openai' | 'gemini' | 'custom' | 'codex_cli' | 'claude_cli' | '';
  model: string;
  custom_model: string;
  system_prompt: string;
  enabled: boolean;
  palette?: number;
  create_pr?: boolean;
}

const BUILTIN_ROLE_KEYS = {
  manager: {
    label: 'agents.role.manager.label',
    description: 'agents.role.manager.description',
    prompt: 'agents.role.manager.prompt',
  },
  pm: {
    label: 'agents.role.pm.label',
    description: 'agents.role.pm.description',
    prompt: 'agents.role.pm.prompt',
  },
  lead_developer: {
    label: 'agents.role.leadDeveloper.label',
    description: 'agents.role.leadDeveloper.description',
    prompt: 'agents.role.leadDeveloper.prompt',
  },
  developer: {
    label: 'agents.role.developer.label',
    description: 'agents.role.developer.description',
    prompt: 'agents.role.developer.prompt',
  },
  qa: {
    label: 'agents.role.qa.label',
    description: 'agents.role.qa.description',
    prompt: 'agents.role.qa.prompt',
  },
} as const;

// ── Pixel Character Picker ────────────────────────────────────────────────────
const PALETTE_COUNT = 10;
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;

function PixelCharPicker({ selected, onSelect, accent }: {
  selected: number;
  onSelect: (p: number) => void;
  accent: string;
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    for (let i = 0; i < PALETTE_COUNT; i++) {
      const img = new Image();
      img.src = `/pixel-office/assets/characters/char_${i}.png`;
      img.onload = () => {
        const c = canvasRefs.current[i];
        if (!c) return;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, CHAR_FRAME_W, 0, CHAR_FRAME_W, CHAR_FRAME_H, 0, 0, c.width, c.height);
      };
    }
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 38px)', gap: 5, justifyContent: 'center', width: '100%' }}>
      {Array.from({ length: PALETTE_COUNT }, (_, i) => (
        <button key={i} onClick={() => onSelect(i)}
          style={{
            width: 38, height: 52, borderRadius: 8, cursor: 'pointer', padding: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: selected === i ? `2px solid ${accent}` : '1px solid var(--panel-border)',
            background: selected === i ? `${accent}15` : 'var(--panel)',
            transition: 'all 0.15s',
          }}>
          <canvas ref={(el) => { canvasRefs.current[i] = el; }}
            width={CHAR_FRAME_W * 2} height={CHAR_FRAME_H * 2}
            style={{ width: 30, height: 60, imageRendering: 'pixelated' }} />
        </button>
      ))}
    </div>
  );
}

type AgentAnalytics = {
  coveragePct: number;
  activityPct: number;
  latencySec: number;
  successPct: number;
};

const OPENAI_MODELS = [
  { id: 'o3', name: 'o3' },
  { id: 'o4-mini', name: 'o4-mini' },
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' },
  { id: 'gpt-4o', name: 'GPT-4o' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
];

function defaultAgents(t: ReturnType<typeof useLocale>['t']): AgentConfig[] {
  return [
    {
      role: 'manager',
      label: t('agents.role.manager.label'),
      icon: '👔',
      color: '#f59e0b',
      description: t('agents.role.manager.description'),
      provider: '',
      model: '',
      custom_model: '',
      system_prompt: t('agents.role.manager.prompt'),
      enabled: true,
      palette: 0,
    },
    {
      role: 'pm',
      label: t('agents.role.pm.label'),
      icon: '📋',
      color: '#a78bfa',
      description: t('agents.role.pm.description'),
      provider: '',
      model: '',
      custom_model: '',
      system_prompt: t('agents.role.pm.prompt'),
      enabled: true,
      palette: 1,
    },
    {
      role: 'lead_developer',
      label: t('agents.role.leadDeveloper.label'),
      icon: '🧑‍💻',
      color: '#38bdf8',
      description: t('agents.role.leadDeveloper.description'),
      provider: '',
      model: '',
      custom_model: '',
      system_prompt: t('agents.role.leadDeveloper.prompt'),
      enabled: true,
      palette: 2,
    },
    {
      role: 'developer',
      label: t('agents.role.developer.label'),
      icon: '⚡',
      color: '#22c55e',
      description: t('agents.role.developer.description'),
      provider: '',
      model: '',
      custom_model: '',
      system_prompt: t('agents.role.developer.prompt'),
      enabled: true,
      palette: 3,
    },
    {
      role: 'qa',
      label: t('agents.role.qa.label'),
      icon: '🔍',
      color: '#f472b6',
      description: t('agents.role.qa.description'),
      provider: '',
      model: '',
      custom_model: '',
      system_prompt: t('agents.role.qa.prompt'),
      enabled: true,
      palette: 4,
    },
  ];
}

const LS_AGENTS = 'agena_agent_configs';

function localizedAgentLabel(agent: AgentConfig, t: ReturnType<typeof useLocale>['t']) {
  const keys = BUILTIN_ROLE_KEYS[agent.role as keyof typeof BUILTIN_ROLE_KEYS];
  return keys ? t(keys.label) : (agent.label || t('agents.customAgent'));
}

function localizedAgentDescription(agent: AgentConfig, t: ReturnType<typeof useLocale>['t']) {
  const keys = BUILTIN_ROLE_KEYS[agent.role as keyof typeof BUILTIN_ROLE_KEYS];
  return keys ? t(keys.description) : (agent.description || t('agents.customAgentDesc'));
}

function loadAgents(defaults: AgentConfig[], t: ReturnType<typeof useLocale>['t']): AgentConfig[] {
  if (typeof window === 'undefined') return defaults;
  try {
    const saved = localStorage.getItem(LS_AGENTS);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved) as Partial<AgentConfig>[];
    const mergedDefaults = defaults.map((def) => {
      const found = parsed.find((p) => p.role === def.role);
      return found ? { ...def, ...found } : def;
    });
    const extras = parsed
      .filter((p) => p.role && !defaults.some((d) => d.role === p.role))
      .map((p) => ({
        role: String(p.role),
        label: p.label || t('agents.customAgent'),
        icon: p.icon || '🤖',
        color: p.color || '#5eead4',
        description: p.description || t('agents.customAgentDesc'),
        provider: (p.provider as AgentConfig['provider']) || 'custom',
        model: p.model || '',
        custom_model: p.custom_model || '',
        system_prompt: p.system_prompt || '',
        enabled: p.enabled ?? true,
        palette: p.palette ?? 0,
        create_pr: p.create_pr ?? false,
      }));
    return [...mergedDefaults, ...extras];
  } catch {
    return defaults;
  }
}

function saveAgents(agents: AgentConfig[]) {
  localStorage.setItem(LS_AGENTS, JSON.stringify(agents));
}

function toRoleId(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || ('agent_' + Date.now());
}

// ── Small character icon for card headers ─────────────────────────────────────
function AgentCharIcon({ palette, color, size }: { palette: number; color: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = `/pixel-office/assets/characters/char_${palette % PALETTE_COUNT}.png`;
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, CHAR_FRAME_W, 0, CHAR_FRAME_W, CHAR_FRAME_H, 0, 0, c.width, c.height);
    };
  }, [palette]);

  return (
    <div style={{ width: size, height: size, borderRadius: 10, background: color + '18', border: '1px solid ' + color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
      <canvas ref={canvasRef} width={CHAR_FRAME_W * 2} height={CHAR_FRAME_H * 2}
        style={{ width: size - 4, height: (size - 4) * 2, imageRendering: 'pixelated', marginTop: 4 }} />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const { t } = useLocale();
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [editing, setEditing] = useState<AgentRole | null>(null);
  const [editModalAgent, setEditModalAgent] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, AgentAnalytics>>({});
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [draft, setDraft] = useState<AgentConfig>({
    role: '',
    label: '',
    icon: '🤖',
    color: '#38bdf8',
    description: '',
    provider: 'custom',
    model: '',
    custom_model: '',
    system_prompt: '',
    enabled: true,
    palette: 0,
  });
  const [promptSlugs, setPromptSlugs] = useState<string[]>([]);
  const defaults = useMemo(() => defaultAgents(t), [t]);

  useEffect(() => {
    const boot = async () => {
      setAgents(loadAgents(defaults, t));
      try {
        const prefs = await loadPrefs();
        if (prefs.agents?.length) {
          localStorage.setItem(LS_AGENTS, JSON.stringify(prefs.agents));
          const merged = loadAgents(defaults, t);
          setAgents(merged);
          saveAgents(merged);
        }
      } catch {
        // fallback to local storage only
      }
      try {
        const catalog = await loadPromptCatalog();
        setPromptSlugs(Object.keys(catalog.defaults));
      } catch { /* prompt catalog optional */ }
      try {
        const analyticsRes = await getAgentAnalytics(true);
        const map = {} as Record<string, AgentAnalytics>;
        Object.entries(analyticsRes.data).forEach(([role, data]) => {
          map[role] = data;
        });
        setAnalytics(map);
      } catch {
        // no analytics runs fallback
      }
    };
    void boot();
  }, [defaults, t]);

  function updateAgent(role: AgentRole, patch: Partial<AgentConfig>) {
    setAgents((prev) => {
      const next = prev.map((a) => a.role === role ? { ...a, ...patch } : a);
      saveAgents(next);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      saveAgents(agents);
      await savePrefs({ agents: agents as unknown as Record<string, unknown>[] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // localStorage'a yazıldı en azından
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function openNewAgentPopup() {
    setDraft({
      role: '',
      label: '',
      icon: '🤖',
      color: '#38bdf8',
      description: '',
      provider: 'custom',
      model: '',
      custom_model: '',
      system_prompt: '',
      enabled: true,
      palette: 0,
    });
    setShowNewAgent(true);
  }

  function createNewAgent() {
    if (!draft.label.trim()) return;
    const role = toRoleId(draft.role || draft.label);
    if (agents.some((a) => a.role === role)) return;
    const model = (draft.model || draft.custom_model).trim();
    const next: AgentConfig[] = [
      ...agents,
      {
        role,
        label: draft.label.trim(),
        icon: draft.icon.trim() || '🤖',
        color: draft.color || '#38bdf8',
        description: draft.description.trim(),
        provider: draft.provider || 'custom',
        model,
        custom_model: draft.custom_model.trim(),
        system_prompt: draft.system_prompt.trim(),
        enabled: draft.enabled,
        palette: draft.palette ?? 0,
      },
    ];
    setAgents(next);
    saveAgents(next);
    savePrefs({ agents: next as unknown as Record<string, unknown>[] })
      .then(() => { setNotice({ type: 'success', msg: t('agents.createSuccess') }); setTimeout(() => setNotice(null), 3000); })
      .catch(() => { setNotice({ type: 'error', msg: t('agents.createError') }); setTimeout(() => setNotice(null), 3000); });
    setEditing(role);
    setShowNewAgent(false);
  }

  return (
    <div style={{ display: 'grid', gap: 14, width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
        <div className="section-label">{t('agents.section')}</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6, marginBottom: 2, lineHeight: 1.15 }}>
          {t('agents.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', margin: 0 }}>
          {t('agents.subtitle')}
        </p>
        </div>
        <button onClick={openNewAgentPopup} className='button button-outline' style={{ whiteSpace: 'nowrap', height: 36, padding: '0 14px' }}>
          + {t('agents.new')}
        </button>
      </div>

      {/* Notice */}
      {notice && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: notice.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${notice.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, color: notice.type === 'success' ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{notice.type === 'success' ? '✓' : '✕'}</span>
          {notice.msg}
        </div>
      )}

      {/* Agent Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8, alignItems: 'stretch' }}>
        {agents.map((agent) => (
          <div key={agent.role}>
            <AgentCard
              agent={agent}
              isEditing={false}
              onEdit={() => setEditModalAgent(agent)}
              onUpdate={(patch) => updateAgent(agent.role, patch)}
              promptSlugs={promptSlugs}
            />
          </div>
        ))}
      </div>

      {/* Analytics — below agent cards */}
      <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'linear-gradient(180deg, var(--panel-alt), var(--panel))', padding: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>
          {t('agents.analyticsTitle')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-35)', marginBottom: 10 }}>
          {t('agents.analyticsDesc')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 8, alignItems: 'stretch' }}>
          {agents.map((a) => {
            const m = analytics[a.role] ?? { coveragePct: 0, activityPct: 0, latencySec: 0, successPct: 0 };
            return (
              <div key={a.role} style={{ borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 8, minHeight: 128 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <AgentCharIcon palette={a.palette ?? 0} color={a.color} size={24} />
                  <span style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 12 }}>{localizedAgentLabel(a, t)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                  <MetricChip label={t('agents.analyticsCoverage')} value={`${m.coveragePct}%`} />
                  <MetricChip label={t('agents.analyticsActivity')} value={`${m.activityPct}%`} />
                  <MetricChip label={t('agents.analyticsLatency')} value={`${m.latencySec}s`} />
                  <MetricChip label={t('agents.analyticsSuccess')} value={`${m.successPct}%`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => void handleSave()} disabled={saving}
          style={{ height: 38, padding: '0 18px', borderRadius: 10, border: 'none', background: saved ? 'rgba(34,197,94,0.3)' : saving ? 'rgba(13,148,136,0.4)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.3s' }}>
          {saved ? t('agents.saved') : saving ? t('agents.saving') : t('agents.save')}
        </button>
      </div>

      {/* CLI hint */}
      <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-35)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{t('agents.cliUsage')}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-50)', lineHeight: 1.6 }}>
          {t('agents.cliDesc')}
        </div>
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid var(--panel-border-2)', fontFamily: 'monospace', fontSize: 11, color: '#5eead4', overflowX: 'auto' }}>
          agena agent run --role lead_developer --task &lt;task-id&gt; --model {agents.find(a => a.role === 'lead_developer')?.model || 'gpt-4o'}
        </div>
      </div>

      {/* Agent Edit/Create Modal */}
      {(showNewAgent || editModalAgent) && (
        <AgentModal
          agent={editModalAgent || draft}
          isNew={showNewAgent && !editModalAgent}
          onClose={() => { setShowNewAgent(false); setEditModalAgent(null); }}
          onSave={(updated) => {
            if (editModalAgent) {
              const next = agents.map((a) => a.role === editModalAgent.role ? { ...a, ...updated } : a);
              setAgents(next);
              saveAgents(next);
              savePrefs({ agents: next as unknown as Record<string, unknown>[] })
                .then(() => { setNotice({ type: 'success', msg: t('agents.updateSuccess') }); setTimeout(() => setNotice(null), 3000); })
                .catch(() => { setNotice({ type: 'error', msg: t('agents.updateError') }); setTimeout(() => setNotice(null), 3000); });
            } else {
              setDraft(updated);
              createNewAgent();
            }
            setShowNewAgent(false);
            setEditModalAgent(null);
          }}
          onDelete={editModalAgent ? () => {
            const next = agents.filter((a) => a.role !== editModalAgent.role);
            setAgents(next);
            saveAgents(next);
            savePrefs({ agents: next as unknown as Record<string, unknown>[] })
              .then(() => { setNotice({ type: 'success', msg: t('agents.deleteSuccess') }); setTimeout(() => setNotice(null), 3000); })
              .catch(() => { setNotice({ type: 'error', msg: t('agents.deleteError') }); setTimeout(() => setNotice(null), 3000); });
            setEditModalAgent(null);
          } : undefined}
          t={t}
        />
      )}
    </div>
  );
}

// ── Agent Edit/Create Modal ───────────────────────────────────────────────────
function AgentModal({ agent: initial, isNew, onClose, onSave, onDelete, t }: {
  agent: AgentConfig;
  isNew: boolean;
  onClose: () => void;
  onSave: (agent: AgentConfig) => void;
  onDelete?: () => void;
  t: ReturnType<typeof useLocale>['t'];
}) {
  const [a, setA] = useState<AgentConfig>({ ...initial });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const models = a.provider === 'openai' ? OPENAI_MODELS : a.provider === 'gemini' ? GEMINI_MODELS : [];
  const color = a.color || '#38bdf8';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: 'min(560px, 100%)', maxHeight: '85vh', overflowY: 'auto', borderRadius: 24, border: `1px solid ${color}30`, background: 'var(--surface)', padding: 0, boxShadow: `0 32px 100px rgba(0,0,0,0.5), 0 0 0 1px ${color}10` }} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AgentCharIcon palette={a.palette ?? 0} color={color} size={44} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-90)' }}>{isNew ? t('agents.createTitle') : localizedAgentLabel(a, t)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>{a.role || '...'}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ padding: '16px 24px 24px', display: 'grid', gap: 14 }}>
          {/* Character picker */}
          <div>
            <label style={labelStyle}>{t('office.pickCharacter')}</label>
            <PixelCharPicker selected={a.palette ?? 0} onSelect={(p) => setA((v) => ({ ...v, palette: p }))} accent={color} />
          </div>

          {/* Name + Role */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>{t('agents.newLabelPlaceholder')}</label>
              <input value={a.label} onChange={(e) => setA((v) => ({ ...v, label: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('agents.newColorPlaceholder')}</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="color" value={color} onChange={(e) => setA((v) => ({ ...v, color: e.target.value }))} style={{ width: 36, height: 36, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--panel-border)', padding: 2 }} />
                <input value={color} onChange={(e) => setA((v) => ({ ...v, color: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>{t('agents.newDescriptionPlaceholder')}</label>
            <textarea value={a.description} onChange={(e) => setA((v) => ({ ...v, description: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          {/* Provider */}
          <div>
            <label style={labelStyle}>{t('agents.provider')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {(['openai', 'gemini', 'custom', 'codex_cli', 'claude_cli'] as const).map((p) => (
                <button key={p} onClick={() => setA((v) => ({ ...v, provider: p, model: '', custom_model: '' }))}
                  style={{ padding: '10px', borderRadius: 12, border: a.provider === p ? `2px solid ${color}` : '1px solid var(--panel-border-2)', background: a.provider === p ? `${color}10` : 'var(--panel)', color: a.provider === p ? 'var(--ink-90)' : 'var(--ink-35)', fontWeight: a.provider === p ? 700 : 500, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {p === 'openai'
                    ? `⚡ ${t('agents.providerOpenai')}`
                    : p === 'gemini'
                      ? `✦ ${t('agents.providerGemini')}`
                      : p === 'codex_cli'
                        ? `⌘ ${t('agents.providerCodexCli')}`
                        : p === 'claude_cli'
                          ? `✎ ${t('agents.providerClaudeCli')}`
                          : `🔧 ${t('agents.providerCustom')}`}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          {models.length > 0 ? (
            <div>
              <label style={labelStyle}>{t('agents.model')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                {models.map((m) => (
                  <button key={m.id} onClick={() => setA((v) => ({ ...v, model: m.id, custom_model: '' }))}
                    style={{ padding: '8px 10px', borderRadius: 10, border: a.model === m.id ? `2px solid ${color}` : '1px solid var(--panel-border-2)', background: a.model === m.id ? `${color}10` : 'var(--panel)', color: a.model === m.id ? 'var(--ink-90)' : 'var(--ink-35)', fontWeight: a.model === m.id ? 700 : 500, fontSize: 11, cursor: 'pointer', textAlign: 'left' }}>
                    {a.model === m.id && '✓ '}{m.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Custom model */}
          <div>
            <label style={labelStyle}>{t('agents.modelName')}</label>
            <input value={a.custom_model || a.model} onChange={(e) => setA((v) => ({ ...v, custom_model: e.target.value, model: e.target.value }))} placeholder={t('agents.modelNamePlaceholder')} style={inputStyle} />
          </div>

          {/* System prompt — select from Prompt Studio or write custom */}
          <div>
            <label style={labelStyle}>{t('agents.systemPrompt')}</label>
            {promptSlugs.length > 0 && (
              <select
                value={promptSlugs.includes(a.system_prompt) ? a.system_prompt : ''}
                onChange={(e) => setA((v) => ({ ...v, system_prompt: e.target.value }))}
                style={{ ...inputStyle, marginBottom: 6 }}
              >
                <option value="">{t('agents.promptCustom')}</option>
                {promptSlugs.map((slug) => (
                  <option key={slug} value={slug}>{slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                ))}
              </select>
            )}
            {!promptSlugs.includes(a.system_prompt) && (
              <textarea value={a.system_prompt} onChange={(e) => setA((v) => ({ ...v, system_prompt: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} placeholder={t('agents.promptCustomPlaceholder')} />
            )}
            {promptSlugs.includes(a.system_prompt) && (
              <div style={{ fontSize: 11, color: 'var(--accent)', padding: '4px 0' }}>
                Prompt Studio: {a.system_prompt.replace(/_/g, ' ')}
              </div>
            )}
          </div>

          {/* Create PR + Enabled toggles */}
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div onClick={() => setA((v) => ({ ...v, create_pr: !(v.create_pr ?? false) }))}
                style={{ width: 40, height: 22, borderRadius: 999, background: (a.create_pr ?? false) ? color : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: (a.create_pr ?? false) ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-50)' }}>{t('agents.toggleCreatePr')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <div onClick={() => setA((v) => ({ ...v, enabled: !v.enabled }))}
                style={{ width: 40, height: 22, borderRadius: 999, background: a.enabled ? '#22c55e' : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: a.enabled ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-50)' }}>{t('agents.toggleEnabled')}</div>
            </div>
          </div>

          {/* Confirm delete overlay */}
          {confirmDelete && onDelete && (
            <div style={{ padding: '14px', borderRadius: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', marginBottom: 10 }}>{t('agents.deleteConfirm')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmDelete(false)}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
                  {t('agents.cancel')}
                </button>
                <button onClick={onDelete}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.9)', border: 'none', color: '#fff' }}>
                  {t('agents.confirmDelete')}
                </button>
              </div>
            </div>
          )}

          {/* Save / Delete buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {onDelete && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)}
                style={{ padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                {t('agents.delete')}
              </button>
            )}
            <button onClick={onClose}
              style={{ flex: 1, padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)' }}>
              {t('agents.cancel')}
            </button>
            <button onClick={() => onSave(a)} disabled={!a.label.trim()}
              style={{ flex: 2, padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: a.label.trim() ? 'pointer' : 'not-allowed', background: a.label.trim() ? `linear-gradient(135deg, ${color}, ${color}cc)` : 'var(--panel-alt)', border: 'none', color: a.label.trim() ? '#000' : 'var(--ink-25)' }}>
              {isNew ? t('agents.create') : t('agents.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────────
function AgentCard({ agent, isEditing, onEdit, onUpdate, promptSlugs }: {
  agent: AgentConfig;
  isEditing: boolean;
  onEdit: () => void;
  promptSlugs: string[];
  onUpdate: (patch: Partial<AgentConfig>) => void;
}) {
  const { t } = useLocale();
  const models = agent.provider === 'openai' ? OPENAI_MODELS : agent.provider === 'gemini' ? GEMINI_MODELS : [];

  return (
    <div style={{ width: '100%', minWidth: 0, minHeight: isEditing ? 'auto' : 118, borderRadius: 14, border: '1px solid ' + (isEditing ? agent.color + '40' : 'var(--panel-border)'), background: isEditing ? agent.color + '08' : 'var(--panel)', overflow: 'hidden', transition: 'all 0.2s' }}>
      {/* Card header */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }} onClick={onEdit}>
        <AgentCharIcon palette={agent.palette ?? 0} color={agent.color} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-90)' }}>{localizedAgentLabel(agent, t)}</span>
            {agent.provider && agent.model ? (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: agent.color + '18', border: '1px solid ' + agent.color + '35', color: agent.color, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.provider === 'openai' ? '⚡' : agent.provider === 'gemini' ? '✦' : agent.provider === 'codex_cli' ? '⌘' : '✎'} {agent.model || agent.custom_model}
              </span>
            ) : (
              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: 'var(--panel-alt)', border: '1px solid var(--panel-border-3)', color: 'var(--ink-30)' }}>
                {t('agents.noModel')}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-25)', transform: isEditing ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block', flexShrink: 0 }}>⌄</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-35)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 30 }}>{localizedAgentDescription(agent, t)}</div>
        </div>
        {/* Toggle */}
        <div onClick={(e) => { e.stopPropagation(); onUpdate({ enabled: !agent.enabled }); }}
          style={{ width: 34, height: 18, borderRadius: 999, background: agent.enabled ? agent.color : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 2, left: agent.enabled ? 18 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </div>
      </div>

      {/* Expanded editor */}
      {isEditing && (
        <div style={{ borderTop: '1px solid var(--panel-border)', padding: '10px 12px 12px', display: 'grid', gap: 10 }}>
          {/* Character picker */}
          <div>
            <label style={labelStyle}>{t('office.pickCharacter')}</label>
            <PixelCharPicker selected={agent.palette ?? 0} onSelect={(p) => onUpdate({ palette: p })} accent={agent.color} />
          </div>

          {/* Provider seçimi */}
          <div>
            <label style={labelStyle}>{t('agents.provider')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {(['openai', 'gemini', 'custom', 'codex_cli'] as const).map((p) => (
                <button key={p} onClick={() => onUpdate({ provider: p, model: '', custom_model: '' })}
                  style={{ padding: '8px 9px', borderRadius: 10, border: '1px solid ' + (agent.provider === p ? agent.color + '60' : 'var(--panel-border-2)'), background: agent.provider === p ? agent.color + '12' : 'var(--panel)', color: agent.provider === p ? 'var(--ink-90)' : 'var(--ink-35)', fontWeight: agent.provider === p ? 700 : 500, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {p === 'openai'
                    ? `⚡ ${t('agents.providerOpenai')}`
                    : p === 'gemini'
                      ? `✦ ${t('agents.providerGemini')}`
                      : p === 'codex_cli'
                        ? `⌘ ${t('agents.providerCodexCli')}`
                        : `✎ ${t('agents.providerCustom')}`}
                </button>
              ))}
            </div>
          </div>

          {/* Model seçimi */}
          {(agent.provider === 'openai' || agent.provider === 'gemini') && (
            <div>
              <label style={labelStyle}>{t('agents.model')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                {models.map((m) => (
                  <button key={m.id} onClick={() => onUpdate({ model: m.id })}
                    style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid ' + (agent.model === m.id ? agent.color + '60' : 'var(--panel-border-2)'), background: agent.model === m.id ? agent.color + '12' : 'var(--panel)', color: agent.model === m.id ? 'var(--ink-90)' : 'var(--ink-35)', fontWeight: agent.model === m.id ? 700 : 500, fontSize: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                    {agent.model === m.id && <span style={{ color: agent.color, marginRight: 6 }}>✓</span>}
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom model input */}
          {(agent.provider === 'custom' || agent.provider === 'codex_cli') && (
            <div>
              <label style={labelStyle}>{t('agents.modelName')}</label>
              <input
                value={agent.custom_model}
                onChange={(e) => onUpdate({ custom_model: e.target.value, model: e.target.value })}
                placeholder={t('agents.modelNamePlaceholder')}
                style={inputStyle}
              />
            </div>
          )}

          {/* System prompt — select from Prompt Studio or write custom */}
          <div>
            <label style={labelStyle}>{t('agents.systemPrompt')}</label>
            {promptSlugs.length > 0 && (
              <select
                value={promptSlugs.includes(agent.system_prompt) ? agent.system_prompt : ''}
                onChange={(e) => onUpdate({ system_prompt: e.target.value })}
                style={{ ...inputStyle, marginBottom: 6 }}
              >
                <option value="">{t('agents.promptCustom')}</option>
                {promptSlugs.map((slug) => (
                  <option key={slug} value={slug}>{slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
                ))}
              </select>
            )}
            {!promptSlugs.includes(agent.system_prompt) && (
              <textarea
                value={agent.system_prompt}
                onChange={(e) => onUpdate({ system_prompt: e.target.value })}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                placeholder={t('agents.promptCustomPlaceholder')}
              />
            )}
            {promptSlugs.includes(agent.system_prompt) && (
              <div style={{ fontSize: 11, color: 'var(--accent)', padding: '4px 0' }}>
                Prompt Studio: {agent.system_prompt.replace(/_/g, ' ')}
              </div>
            )}
          </div>

          {/* Create PR toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
            <div>
              <label style={{ ...labelStyle, marginBottom: 0 }}>{t('agents.toggleCreatePr')}</label>
              <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 2 }}>{t('agents.createPrDesc')}</div>
            </div>
            <div onClick={() => onUpdate({ create_pr: !(agent.create_pr ?? false) })}
              style={{ width: 40, height: 22, borderRadius: 999, background: (agent.create_pr ?? false) ? agent.color : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
              <div style={{ position: 'absolute', top: 3, left: (agent.create_pr ?? false) ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--ink-35)', display: 'block', marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10,
  border: '1px solid var(--panel-border-3)', background: 'var(--glass)',
  color: 'var(--ink-90)', fontSize: 12, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', padding: '5px 7px' }}>
      <div style={{ color: 'var(--ink-35)', marginBottom: 2, fontSize: 10 }}>{label}</div>
      <div style={{ color: 'var(--ink-90)', fontWeight: 700, fontSize: 11 }}>{value}</div>
    </div>
  );
}
