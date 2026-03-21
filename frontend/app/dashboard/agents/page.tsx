'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = 'lead_developer' | 'pm' | 'qa' | 'manager' | 'developer';

interface AgentConfig {
  role: AgentRole;
  label: string;
  icon: string;
  color: string;
  description: string;
  provider: 'openai' | 'gemini' | 'custom' | '';
  model: string;
  custom_model: string;
  system_prompt: string;
  enabled: boolean;
}

const OPENAI_MODELS = [
  { id: 'o3', name: 'o3' },
  { id: 'o4-mini', name: 'o4-mini' },
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
    description: 'Projeyi yönetir, öncelikleri belirler, ekibi koordine eder',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'Sen bir proje yöneticisisin. İş kalemlerini analiz et, önceliklendirme yap ve ekibe görev dağılımı öner.',
    enabled: true,
  },
  {
    role: 'pm',
    label: 'Product Manager',
    icon: '📋',
    color: '#a78bfa',
    description: 'Ürün gereksinimlerini analiz eder, user story yazar, kabul kriterleri belirler',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'Sen bir ürün yöneticisisin. İş kalemlerini kullanıcı perspektifinden analiz et, acceptance criteria yaz.',
    enabled: true,
  },
  {
    role: 'lead_developer',
    label: 'Lead Developer',
    icon: '🧑‍💻',
    color: '#38bdf8',
    description: 'Teknik analiz yapar, mimari kararlar alır, kod review eder',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'Sen bir lead developer\'sın. İş kalemlerini teknik açıdan analiz et, implementasyon planı çıkar, potansiyel riskleri belirt.',
    enabled: true,
  },
  {
    role: 'developer',
    label: 'Developer',
    icon: '⚡',
    color: '#22c55e',
    description: 'Kodu yazar, PR açar, implementasyonu gerçekleştirir',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'Sen bir yazılım geliştiricisisin. Verilen iş kalemini implement et, kod yaz, PR açmak için gerekli adımları belirt.',
    enabled: true,
  },
  {
    role: 'qa',
    label: 'QA Engineer',
    icon: '🔍',
    color: '#f472b6',
    description: 'Test senaryoları yazar, bug\'ları tespit eder, kalite güvencesi sağlar',
    provider: '',
    model: '',
    custom_model: '',
    system_prompt: 'Sen bir QA mühendisisin. İş kalemini test et, test senaryoları yaz, edge case\'leri belirle.',
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
    // Merge with defaults to handle new fields
    return DEFAULT_AGENTS.map((def) => {
      const found = parsed.find((p) => p.role === def.role);
      return found ? { ...def, ...found } : def;
    });
  } catch {
    return DEFAULT_AGENTS;
  }
}

function saveAgents(agents: AgentConfig[]) {
  localStorage.setItem(LS_AGENTS, JSON.stringify(agents));
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>(DEFAULT_AGENTS);
  const [editing, setEditing] = useState<AgentRole | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAgents(loadAgents());
  }, []);

  function updateAgent(role: AgentRole, patch: Partial<AgentConfig>) {
    setAgents((prev) => {
      const next = prev.map((a) => a.role === role ? { ...a, ...patch } : a);
      saveAgents(next);
      return next;
    });
  }

  function handleSave() {
    saveAgents(agents);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const editingAgent = agents.find((a) => a.role === editing);

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 900 }}>
      {/* Header */}
      <div>
        <div className="section-label">Agents</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          Agent Yönetimi
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', margin: 0 }}>
          Her role bir AI modeli ata. İş kalemlerini bu agentlar işleyecek.
        </p>
      </div>

      {/* Agent Cards */}
      <div style={{ display: 'grid', gap: 12 }}>
        {agents.map((agent) => (
          <AgentCard
            key={agent.role}
            agent={agent}
            isEditing={editing === agent.role}
            onEdit={() => setEditing(editing === agent.role ? null : agent.role)}
            onUpdate={(patch) => updateAgent(agent.role, patch)}
          />
        ))}
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleSave}
          style={{ padding: '12px 28px', borderRadius: 12, border: 'none', background: saved ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all 0.3s' }}>
          {saved ? '✓ Kaydedildi' : 'Kaydet'}
        </button>
      </div>

      {/* CLI hint */}
      <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', padding: '16px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>CLI Kullanımı</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
          Codex CLI veya başka bir CLI ile çalışmak için agent konfigürasyonunu export edebilirsin:
        </div>
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', fontFamily: 'monospace', fontSize: 12, color: '#5eead4' }}>
          tiqr agent run --role lead_developer --task &lt;task-id&gt; --model {agents.find(a => a.role === 'lead_developer')?.model || 'gpt-4o'}
        </div>
      </div>
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
  const models = agent.provider === 'openai' ? OPENAI_MODELS : agent.provider === 'gemini' ? GEMINI_MODELS : [];

  return (
    <div style={{ borderRadius: 18, border: '1px solid ' + (isEditing ? agent.color + '40' : 'rgba(255,255,255,0.07)'), background: isEditing ? agent.color + '06' : 'rgba(255,255,255,0.02)', overflow: 'hidden', transition: 'all 0.2s' }}>
      {/* Card header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={onEdit}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: agent.color + '18', border: '1px solid ' + agent.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {agent.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.9)' }}>{agent.label}</span>
            {agent.provider && agent.model ? (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: agent.color + '18', border: '1px solid ' + agent.color + '35', color: agent.color }}>
                {agent.provider === 'openai' ? '⚡' : '✦'} {agent.model || agent.custom_model}
              </span>
            ) : (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' }}>
                Model seçilmedi
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.2)', transform: isEditing ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>⌄</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{agent.description}</div>
        </div>
        {/* Toggle */}
        <div onClick={(e) => { e.stopPropagation(); onUpdate({ enabled: !agent.enabled }); }}
          style={{ width: 36, height: 20, borderRadius: 999, background: agent.enabled ? agent.color : 'rgba(255,255,255,0.1)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 2, left: agent.enabled ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
        </div>
      </div>

      {/* Expanded editor */}
      {isEditing && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '20px 20px 24px', display: 'grid', gap: 16 }}>
          {/* Provider seçimi */}
          <div>
            <label style={labelStyle}>Provider</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {(['openai', 'gemini', 'custom'] as const).map((p) => (
                <button key={p} onClick={() => onUpdate({ provider: p, model: '', custom_model: '' })}
                  style={{ padding: '10px', borderRadius: 10, border: '1px solid ' + (agent.provider === p ? agent.color + '60' : 'rgba(255,255,255,0.08)'), background: agent.provider === p ? agent.color + '12' : 'rgba(255,255,255,0.02)', color: agent.provider === p ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', fontWeight: agent.provider === p ? 700 : 400, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s' }}>
                  {p === 'openai' ? '⚡ OpenAI' : p === 'gemini' ? '✦ Gemini' : '✎ Custom'}
                </button>
              ))}
            </div>
          </div>

          {/* Model seçimi */}
          {agent.provider && agent.provider !== 'custom' && (
            <div>
              <label style={labelStyle}>Model</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {models.map((m) => (
                  <button key={m.id} onClick={() => onUpdate({ model: m.id })}
                    style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid ' + (agent.model === m.id ? agent.color + '60' : 'rgba(255,255,255,0.08)'), background: agent.model === m.id ? agent.color + '12' : 'rgba(255,255,255,0.02)', color: agent.model === m.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', fontWeight: agent.model === m.id ? 700 : 400, fontSize: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                    {agent.model === m.id && <span style={{ color: agent.color, marginRight: 6 }}>✓</span>}
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom model input */}
          {agent.provider === 'custom' && (
            <div>
              <label style={labelStyle}>Model Adı</label>
              <input
                value={agent.custom_model}
                onChange={(e) => onUpdate({ custom_model: e.target.value, model: e.target.value })}
                placeholder="örn: claude-3-5-sonnet, llama-3.3-70b..."
                style={inputStyle}
              />
            </div>
          )}

          {/* System prompt */}
          <div>
            <label style={labelStyle}>System Prompt</label>
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
  color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};
