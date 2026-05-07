'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, loadPrefs, savePrefs, loadPromptCatalog, type PromptCatalog } from '@/lib/api';
import { useEnabledModules } from '@/lib/useEnabledModules';
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
  // When true, this agent shows up in code-review dropdowns (🔎 Review on
  // tasks, Reviews tab, IntegrationRule action picker). Defaults to true for
  // built-in reviewer-class roles, false for general developers.
  is_reviewer?: boolean;
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
  security_developer: {
    label: 'agents.role.securityDeveloper.label',
    description: 'agents.role.securityDeveloper.description',
    prompt: 'agents.role.securityDeveloper.prompt',
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
      is_reviewer: true,
    },
    {
      role: 'security_developer',
      label: t('agents.role.securityDeveloper.label'),
      icon: '🛡️',
      color: '#ef4444',
      description: t('agents.role.securityDeveloper.description'),
      provider: '',
      model: '',
      custom_model: '',
      system_prompt: t('agents.role.securityDeveloper.prompt'),
      enabled: true,
      palette: 5,
      is_reviewer: true,
    },
    {
      role: 'sentry_developer',
      label: 'Sentry Developer',
      icon: '🚨',
      color: '#8b5cf6',
      description: 'Fixes production errors from Sentry. Uses targeted prompt with file content injection — no full repo scan.',
      provider: 'codex_cli',
      model: '',
      custom_model: '',
      system_prompt: 'SENTRY_FIX_PROMPT',
      enabled: true,
      palette: 5,
      create_pr: true,
    },
    {
      role: 'newrelic_developer',
      label: 'New Relic Developer',
      icon: '📡',
      color: '#00ac69',
      description: 'Fixes production errors from New Relic APM. Uses targeted prompt with file content injection — no full repo scan.',
      provider: 'codex_cli',
      model: '',
      custom_model: '',
      system_prompt: 'NEWRELIC_FIX_PROMPT',
      enabled: true,
      palette: 6,
      create_pr: true,
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
  const enabledModules = useEnabledModules();
  const reviewsEnabled = enabledModules?.has('reviews') ?? true;
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [editing, setEditing] = useState<AgentRole | null>(null);
  const [editModalAgent, setEditModalAgent] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
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
  const [reviewStats, setReviewStats] = useState<Record<string, { count: number; lastSeverity: string | null; avgScore: number | null }>>({});
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
        type ReviewRow = { reviewer_agent_role: string; severity: string | null; score: number | null; created_at: string };
        const reviews = await apiFetch<ReviewRow[]>('/reviews?limit=200');
        if (Array.isArray(reviews)) {
          const stats: Record<string, { count: number; lastSeverity: string | null; avgScore: number | null }> = {};
          const scores: Record<string, number[]> = {};
          // reviews come back DESC by created_at, so first occurrence per role is the most recent.
          for (const r of reviews) {
            const role = r.reviewer_agent_role;
            if (!stats[role]) {
              stats[role] = { count: 0, lastSeverity: r.severity, avgScore: null };
              scores[role] = [];
            }
            stats[role].count += 1;
            if (r.score != null) scores[role].push(r.score);
          }
          for (const role of Object.keys(stats)) {
            if (scores[role].length > 0) {
              stats[role].avgScore = Math.round(scores[role].reduce((s, v) => s + v, 0) / scores[role].length);
            }
          }
          setReviewStats(stats);
        }
      } catch { /* review stats optional */ }
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

  function createNewAgent(src?: AgentConfig): { ok: true } | { ok: false; error: string } {
    const d = src || draft;
    if (!d.label.trim()) {
      return { ok: false, error: t('agents.errLabelRequired') || 'Name (label) is required.' };
    }
    const role = toRoleId(d.role || d.label);
    if (!role) {
      return { ok: false, error: t('agents.errRoleRequired') || 'Role could not be derived — fill the name.' };
    }
    if (agents.some((a) => a.role === role)) {
      return { ok: false, error: (t('agents.errRoleDuplicate') || 'An agent with role "{role}" already exists.').replace('{role}', role) };
    }
    const model = (d.model || d.custom_model).trim();
    const next: AgentConfig[] = [
      ...agents,
      {
        role,
        label: d.label.trim(),
        icon: d.icon.trim() || '🤖',
        color: d.color || '#38bdf8',
        description: d.description.trim(),
        provider: d.provider || 'custom',
        model,
        custom_model: d.custom_model.trim(),
        system_prompt: d.system_prompt.trim(),
        enabled: d.enabled,
        palette: d.palette ?? 0,
      },
    ];
    setAgents(next);
    saveAgents(next);
    savePrefs({ agents: next as unknown as Record<string, unknown>[] })
      .then(() => { setNotice({ type: 'success', msg: t('agents.createSuccess') }); setTimeout(() => setNotice(null), 3000); })
      .catch(() => { setNotice({ type: 'error', msg: t('agents.createError') }); setTimeout(() => setNotice(null), 3000); });
    setEditing(role);
    return { ok: true };
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

      {/* Agent Cards — wider tiles (220px) with breathing room and hover. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, alignItems: 'stretch' }}>
        {agents.map((agent) => (
          <AgentCard
            key={agent.role}
            agent={agent}
            isEditing={false}
            onEdit={() => setEditModalAgent(agent)}
            onUpdate={(patch) => updateAgent(agent.role, patch)}
            promptSlugs={promptSlugs}
            reviewStat={reviewStats[agent.role]}
          />
        ))}
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
          promptSlugs={promptSlugs}
          reviewStat={editModalAgent ? reviewStats[editModalAgent.role] : undefined}
          onClose={() => { setShowNewAgent(false); setEditModalAgent(null); }}
          onSave={(updated) => {
            if (editModalAgent) {
              if (!updated.label.trim()) {
                return { ok: false, error: t('agents.errLabelRequired') || 'Name (label) is required.' };
              }
              const next = agents.map((a) => a.role === editModalAgent.role ? { ...a, ...updated } : a);
              setAgents(next);
              saveAgents(next);
              savePrefs({ agents: next as unknown as Record<string, unknown>[] })
                .then(() => { setNotice({ type: 'success', msg: t('agents.updateSuccess') }); setTimeout(() => setNotice(null), 3000); })
                .catch(() => { setNotice({ type: 'error', msg: t('agents.updateError') }); setTimeout(() => setNotice(null), 3000); });
            } else {
              const result = createNewAgent(updated);
              if (!result.ok) return result;
            }
            setShowNewAgent(false);
            setEditModalAgent(null);
            return { ok: true };
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
function AgentModal({ agent: initial, isNew, onClose, onSave, onDelete, t, promptSlugs, reviewStat }: {
  agent: AgentConfig;
  isNew: boolean;
  promptSlugs: string[];
  onClose: () => void;
  onSave: (agent: AgentConfig) => { ok: true } | { ok: false; error: string };
  onDelete?: () => void;
  t: ReturnType<typeof useLocale>['t'];
  reviewStat?: { count: number; lastSeverity: string | null; avgScore: number | null };
}) {
  const [a, setA] = useState<AgentConfig>({ ...initial });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string>('');
  const models = a.provider === 'openai' ? OPENAI_MODELS : a.provider === 'gemini' ? GEMINI_MODELS : [];
  const color = a.color || '#38bdf8';
  const enabledModules = useEnabledModules();
  const reviewsEnabled = enabledModules?.has('reviews') ?? true;

  function handleSave() {
    setSaveError('');
    const result = onSave(a);
    if (!result.ok) setSaveError(result.error);
    // success → parent closes the modal, no further action here
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
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
          {/* Review history banner — gated on the Reviews module */}
          {reviewsEnabled && !isNew && reviewStat && reviewStat.count > 0 && (() => {
            const sevColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#60a5fa', clean: '#22c55e' };
            const sevColor = reviewStat.lastSeverity ? (sevColors[reviewStat.lastSeverity] || 'var(--ink-35)') : 'var(--ink-35)';
            return (
              <a href={`/dashboard/reviews?agent_role=${encodeURIComponent(a.role)}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px', borderRadius: 12,
                  background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)',
                  textDecoration: 'none', color: 'var(--ink)',
                }}>
                <span style={{ fontSize: 20 }}>🔎</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {(t('reviews.count') || '{n} reviews').replace('{n}', String(reviewStat.count))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {reviewStat.lastSeverity && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: `${sevColor}1f`, color: sevColor, textTransform: 'uppercase' }}>
                        {(t('reviews.lastSeverity') || 'last') + ': ' + reviewStat.lastSeverity}
                      </span>
                    )}
                    {reviewStat.avgScore != null && <span>{(t('reviews.statAvgScore') || 'avg score')}: <strong>{reviewStat.avgScore}</strong></span>}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#c084fc' }}>
                  {t('reviews.viewHistory') || 'View history'} →
                </span>
              </a>
            );
          })()}

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

          {/* Reviewer toggle — only surfaces when the Reviews module is on */}
          {reviewsEnabled && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10,
              background: a.is_reviewer ? 'rgba(168,85,247,0.10)' : 'var(--panel)',
              border: `1px solid ${a.is_reviewer ? 'rgba(168,85,247,0.35)' : 'var(--panel-border)'}`,
            }}>
              <span style={{ fontSize: 18 }}>🔎</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t('agents.toggleReviewer') || 'Use as code reviewer'}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2, lineHeight: 1.5 }}>
                  {t('agents.toggleReviewerDesc') || 'When on, this agent shows up in the 🔎 Review dropdowns on tasks and on the Reviews tab. Reviews never modify code or open PRs.'}
                </div>
              </div>
              <div onClick={() => setA((v) => ({ ...v, is_reviewer: !v.is_reviewer }))}
                style={{ width: 40, height: 22, borderRadius: 999, background: a.is_reviewer ? '#a855f7' : 'var(--panel-border-3)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: 3, left: a.is_reviewer ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </div>
            </div>
          )}

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

          {/* Inline validation error — shown when save was blocked by validation */}
          {saveError && (
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginTop: 4,
              background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)',
              color: '#fca5a5', fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <span>⚠️</span>
              <span style={{ flex: 1 }}>{saveError}</span>
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
            <button onClick={handleSave} disabled={!a.label.trim()}
              style={{ flex: 2, padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: a.label.trim() ? 'pointer' : 'not-allowed', background: a.label.trim() ? `linear-gradient(135deg, ${color}, ${color}cc)` : 'var(--panel-alt)', border: 'none', color: a.label.trim() ? '#000' : 'var(--ink-25)' }}>
              {isNew ? t('agents.create') : t('agents.save')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────────
function AgentCard({ agent, isEditing, onEdit, onUpdate, promptSlugs, reviewStat }: {
  agent: AgentConfig;
  isEditing: boolean;
  onEdit: () => void;
  promptSlugs: string[];
  onUpdate: (patch: Partial<AgentConfig>) => void;
  reviewStat?: { count: number; lastSeverity: string | null; avgScore: number | null };
}) {
  const { t } = useLocale();
  const models = agent.provider === 'openai' ? OPENAI_MODELS : agent.provider === 'gemini' ? GEMINI_MODELS : [];
  const enabledModules = useEnabledModules();
  const reviewsEnabled = enabledModules?.has('reviews') ?? true;

  const [hover, setHover] = useState(false);
  const providerIcon = agent.provider === 'openai' ? '⚡'
    : agent.provider === 'gemini' ? '✦'
    : agent.provider === 'codex_cli' ? '⌘'
    : agent.provider === 'claude_cli' ? '◆'
    : '✎';
  const modelLabel = (agent.model || agent.custom_model || '').trim();
  const accent = agent.color;
  const dim = !agent.enabled;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: '100%',
        minWidth: 0,
        display: 'flex', flexDirection: 'column',
        borderRadius: 16,
        border: `1px solid ${isEditing ? accent + '50' : hover ? accent + '40' : 'var(--panel-border)'}`,
        background: isEditing
          ? `linear-gradient(180deg, ${accent}10, var(--panel))`
          : hover
            ? `linear-gradient(180deg, ${accent}08, var(--panel))`
            : 'var(--panel)',
        boxShadow: hover ? `0 6px 22px -8px ${accent}38` : '0 1px 0 rgba(0,0,0,0.04)',
        transform: hover && !isEditing ? 'translateY(-2px)' : 'none',
        overflow: 'hidden',
        transition: 'all 0.18s ease',
        opacity: dim ? 0.72 : 1,
      }}
    >
      {/* Top accent strip — color-codes the agent at a glance */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}55)` }} />

      {/* Card body — clickable area opens the editor */}
      <div onClick={onEdit} style={{ padding: '14px 14px 10px', cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Top row: character + name + status toggle */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            flexShrink: 0,
            width: 56, height: 56,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 12,
            background: `${accent}10`,
            border: `1px solid ${accent}25`,
          }}>
            <AgentCharIcon palette={agent.palette ?? 0} color={accent} size={42} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-90)', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {localizedAgentLabel(agent, t)}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-35)', marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {agent.role}
            </div>
          </div>
          <div
            onClick={(e) => { e.stopPropagation(); onUpdate({ enabled: !agent.enabled }); }}
            title={agent.enabled ? t('agents.enabled' as Parameters<typeof t>[0]) : t('agents.disabled' as Parameters<typeof t>[0])}
            style={{
              flexShrink: 0,
              width: 36, height: 20, borderRadius: 999,
              background: agent.enabled ? accent : 'var(--panel-border-3)',
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            <div style={{ position: 'absolute', top: 2, left: agent.enabled ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
          </div>
        </div>

        {/* Description */}
        <div style={{ fontSize: 12, color: 'var(--ink-35)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>
          {localizedAgentDescription(agent, t)}
        </div>

        {/* Model badge — bigger and more legible than the inline pill */}
        <div style={{ marginTop: 'auto' }}>
          {modelLabel ? (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 8,
              background: `${accent}12`,
              border: `1px solid ${accent}30`,
              color: accent,
              fontSize: 11, fontWeight: 700,
              maxWidth: '100%',
            }}>
              <span style={{ fontSize: 12 }}>{providerIcon}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelLabel}</span>
            </div>
          ) : (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 8,
              background: 'var(--panel-alt)',
              border: '1px dashed var(--panel-border-3)',
              color: 'var(--ink-30)',
              fontSize: 11, fontWeight: 600,
            }}>
              {t('agents.noModel')}
            </div>
          )}
        </div>
      </div>

      {/* Review history footer — only when there's something to show */}
      {reviewsEnabled && reviewStat && reviewStat.count > 0 && !isEditing && (() => {
        const sevColors: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#60a5fa', clean: '#22c55e' };
        const sevColor = reviewStat.lastSeverity ? (sevColors[reviewStat.lastSeverity] || 'var(--ink-35)') : 'var(--ink-35)';
        return (
          <a href={`/dashboard/reviews?agent_role=${encodeURIComponent(agent.role)}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px',
              borderTop: '1px solid var(--panel-border)',
              background: 'var(--glass)', textDecoration: 'none', fontSize: 11, color: 'var(--ink-50)',
            }}>
            <span style={{ fontSize: 13 }}>🔎</span>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{reviewStat.count}</span>
            <span>review{reviewStat.count > 1 ? 's' : ''}</span>
            {reviewStat.lastSeverity && (
              <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: `${sevColor}1f`, color: sevColor, textTransform: 'uppercase' }}>
                {reviewStat.lastSeverity}
              </span>
            )}
            {reviewStat.avgScore != null && (
              <span style={{ marginLeft: 'auto' }}>
                avg <strong style={{ color: 'var(--ink)' }}>{reviewStat.avgScore}</strong>
              </span>
            )}
          </a>
        );
      })()}

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

