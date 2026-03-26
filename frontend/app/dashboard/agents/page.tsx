'use client';

import React, { useState, useEffect } from 'react';
import { loadPrefs, savePrefs, getAgentAnalytics } from '@/lib/api';
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

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    role: 'manager',
    label: 'Manager',
    icon: '👔',
    color: '#f59e0b',
    description: 'Manages project execution, priorities, and team coordination',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'You are a project manager. Analyze work items, prioritize them, and suggest ownership.',
    enabled: true,
  },
  {
    role: 'pm',
    label: 'Product Manager',
    icon: '📋',
    color: '#a78bfa',
    description: 'Analyzes product requirements, writes user stories, and defines acceptance criteria',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'You are a product manager. Analyze work from the user perspective and define acceptance criteria.',
    enabled: true,
  },
  {
    role: 'lead_developer',
    label: 'Lead Developer',
    icon: '🧑‍💻',
    color: '#38bdf8',
    description: 'Performs technical analysis, architecture decisions, and code review guidance',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'You are a lead developer. Analyze tasks technically, propose implementation plans, and identify risks.',
    enabled: true,
  },
  {
    role: 'developer',
    label: 'Developer',
    icon: '⚡',
    color: '#22c55e',
    description: 'Implements code changes and prepares pull request outputs',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'You are a software developer. Implement the task and prepare changes suitable for a PR.',
    enabled: true,
  },
  {
    role: 'qa',
    label: 'QA Engineer',
    icon: '🔍',
    color: '#f472b6',
    description: 'Designs test scenarios, finds bugs, and improves quality confidence',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'You are a QA engineer. Test the work item, define scenarios, and cover edge cases.',
    enabled: true,
  },
];

const LS_AGENTS = 'tiqr_agent_configs';

function loadAgents(): AgentConfig[] {
  if (typeof window === 'undefined') return DEFAULT_AGENTS;
  try {
    const saved = localStorage.getItem(LS_AGENTS);
    if (!saved) return DEFAULT_AGENTS;
    const parsed = JSON.parse(saved) as Partial<AgentConfig>[];
    const mergedDefaults = DEFAULT_AGENTS.map((def) => {
      const found = parsed.find((p) => p.role === def.role);
      return found ? { ...def, ...found } : def;
    });
    const extras = parsed
      .filter((p) => p.role && !DEFAULT_AGENTS.some((d) => d.role === p.role))
      .map((p) => ({
        role: String(p.role),
        label: p.label || 'Custom Agent',
        icon: p.icon || '🤖',
        color: p.color || '#5eead4',
        description: p.description || 'Custom agent',
        provider: (p.provider as AgentConfig['provider']) || 'custom',
        model: p.model || '',
        custom_model: p.custom_model || '',
        system_prompt: p.system_prompt || '',
        enabled: p.enabled ?? true,
      }));
    return [...mergedDefaults, ...extras];
  } catch {
    return DEFAULT_AGENTS;
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

// ── Component ─────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>(DEFAULT_AGENTS);
  const [editing, setEditing] = useState<AgentRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
  });
  const { t } = useLocale();

  useEffect(() => {
    const boot = async () => {
      setAgents(loadAgents());
      try {
        const prefs = await loadPrefs();
        if (prefs.agents?.length) {
          localStorage.setItem(LS_AGENTS, JSON.stringify(prefs.agents));
          const merged = loadAgents();
          setAgents(merged);
          saveAgents(merged);
        }
      } catch {
        // fallback to local storage only
      }
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
  }, []);

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
      },
    ];
    setAgents(next);
    saveAgents(next);
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

      {/* Agent Cards */}
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
                  <span>{a.icon}</span>
                  <span style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 12 }}>{a.label}</span>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8, alignItems: 'stretch' }}>
        {agents.map((agent) => {
          const isEditing = editing === agent.role;
          return (
            <div key={agent.role} style={{ gridColumn: isEditing ? '1 / -1' : 'auto' }}>
              <AgentCard
                agent={agent}
                isEditing={isEditing}
                onEdit={() => setEditing(isEditing ? null : agent.role)}
                onUpdate={(patch) => updateAgent(agent.role, patch)}
              />
            </div>
          );
        })}
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
          tiqr agent run --role lead_developer --task &lt;task-id&gt; --model {agents.find(a => a.role === 'lead_developer')?.model || 'gpt-4o'}
        </div>
      </div>

      {showNewAgent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(640px, 100%)', borderRadius: 16, border: '1px solid var(--panel-border-3)', background: 'var(--surface)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)', padding: 16, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-90)' }}>{t('agents.createTitle')}</div>
              <button onClick={() => setShowNewAgent(false)} style={{ border: 'none', background: 'transparent', color: 'var(--ink-45)', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} placeholder={t('agents.newLabelPlaceholder')} style={inputStyle} />
              <input value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} placeholder={t('agents.newRolePlaceholder')} style={inputStyle} />
              <input value={draft.icon} onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))} placeholder={t('agents.newIconPlaceholder')} style={inputStyle} />
              <input value={draft.color} onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} placeholder={t('agents.newColorPlaceholder')} style={inputStyle} />
            </div>
            <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={2} placeholder={t('agents.newDescriptionPlaceholder')} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <select value={draft.provider} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value as AgentConfig['provider'] }))} style={inputStyle}>
                <option value='custom'>{t('agents.providerCustom')}</option>
                <option value='openai'>OpenAI</option>
                <option value='gemini'>Gemini</option>
                <option value='codex_cli'>Codex CLI (local)</option>
                <option value='claude_cli'>Claude CLI (local)</option>
              </select>
              <input value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value, custom_model: e.target.value }))} placeholder={t('agents.newModelPlaceholder')} style={inputStyle} />
            </div>
            <textarea value={draft.system_prompt} onChange={(e) => setDraft((d) => ({ ...d, system_prompt: e.target.value }))} rows={3} placeholder={t('agents.newPromptPlaceholder')} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShowNewAgent(false)} className='button button-outline'>{t('agents.cancel')}</button>
              <button onClick={createNewAgent} disabled={!draft.label.trim() || !(draft.model.trim() || draft.custom_model.trim())} className='button button-primary'>{t('agents.create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────────
function AgentCard({ agent, isEditing, onEdit, onUpdate }: {
  agent: AgentConfig;
  isEditing: boolean;
  onEdit: () => void;
  onUpdate: (patch: Partial<AgentConfig>) => void;
}) {
  const { t } = useLocale();
  const models = agent.provider === 'openai' ? OPENAI_MODELS : agent.provider === 'gemini' ? GEMINI_MODELS : [];

  return (
    <div style={{ width: '100%', minWidth: 0, minHeight: isEditing ? 'auto' : 118, borderRadius: 14, border: '1px solid ' + (isEditing ? agent.color + '40' : 'var(--panel-border)'), background: isEditing ? agent.color + '08' : 'var(--panel)', overflow: 'hidden', transition: 'all 0.2s' }}>
      {/* Card header */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }} onClick={onEdit}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: agent.color + '18', border: '1px solid ' + agent.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
          {agent.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-90)' }}>{agent.label}</span>
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
          <div style={{ fontSize: 11, color: 'var(--ink-35)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 30 }}>{agent.description}</div>
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
          {/* Provider seçimi */}
          <div>
            <label style={labelStyle}>{t('agents.provider')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {(['openai', 'gemini', 'custom', 'codex_cli'] as const).map((p) => (
                <button key={p} onClick={() => onUpdate({ provider: p, model: '', custom_model: '' })}
                  style={{ padding: '8px 9px', borderRadius: 10, border: '1px solid ' + (agent.provider === p ? agent.color + '60' : 'var(--panel-border-2)'), background: agent.provider === p ? agent.color + '12' : 'var(--panel)', color: agent.provider === p ? 'var(--ink-90)' : 'var(--ink-35)', fontWeight: agent.provider === p ? 700 : 500, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {p === 'openai' ? '⚡ OpenAI' : p === 'gemini' ? '✦ Gemini' : p === 'codex_cli' ? '⌘ Codex CLI' : '✎ Custom'}
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

          {/* System prompt */}
          <div>
            <label style={labelStyle}>{t('agents.systemPrompt')}</label>
            <textarea
              value={agent.system_prompt}
              onChange={(e) => onUpdate({ system_prompt: e.target.value })}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
            />
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
