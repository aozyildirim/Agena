'use client';

import React, { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
type AgentRole = 'lead_developer' | 'pm' | 'qa' | 'manager' | 'developer';

interface FlowStep {
  id: string;
  agent: AgentRole;
  label: string;
  action: string;
  waitForApproval: boolean;
}

interface Flow {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  steps: FlowStep[];
  createdAt: string;
}

const AGENT_META: Record<AgentRole, { label: string; icon: string; color: string }> = {
  manager:        { label: 'Manager',         icon: '👔', color: '#f59e0b' },
  pm:             { label: 'Product Manager', icon: '📋', color: '#a78bfa' },
  lead_developer: { label: 'Lead Developer',  icon: '🧑‍💻', color: '#38bdf8' },
  developer:      { label: 'Developer',       icon: '⚡', color: '#22c55e' },
  qa:             { label: 'QA Engineer',     icon: '🔍', color: '#f472b6' },
};

const PRESET_FLOWS: Flow[] = [
  {
    id: 'full-cycle',
    name: 'Full Dev Cycle',
    description: 'PM analiz → Lead plan → Developer kod → QA test',
    icon: '🔄',
    color: '#0d9488',
    createdAt: new Date().toISOString(),
    steps: [
      { id: '1', agent: 'pm', label: 'Analiz', action: 'İş kalemini analiz et, acceptance criteria yaz', waitForApproval: false },
      { id: '2', agent: 'lead_developer', label: 'Teknik Plan', action: 'Implementasyon planı çıkar, subtask\'lara böl', waitForApproval: true },
      { id: '3', agent: 'developer', label: 'Geliştirme', action: 'Kodu yaz, PR aç', waitForApproval: false },
      { id: '4', agent: 'qa', label: 'Test', action: 'Test senaryoları çalıştır, bug raporu yaz', waitForApproval: false },
    ],
  },
  {
    id: 'quick-fix',
    name: 'Quick Fix',
    description: 'Lead analiz → Developer düzelt → QA onayla',
    icon: '⚡',
    color: '#7c3aed',
    createdAt: new Date().toISOString(),
    steps: [
      { id: '1', agent: 'lead_developer', label: 'Root Cause', action: 'Bug\'ı analiz et, root cause bul', waitForApproval: false },
      { id: '2', agent: 'developer', label: 'Fix', action: 'Fix uygula, PR aç', waitForApproval: false },
      { id: '3', agent: 'qa', label: 'Verify', action: 'Fix\'i doğrula, regression test yap', waitForApproval: false },
    ],
  },
  {
    id: 'review-only',
    name: 'Code Review',
    description: 'Lead Developer PR review yapar',
    icon: '👁',
    color: '#38bdf8',
    createdAt: new Date().toISOString(),
    steps: [
      { id: '1', agent: 'lead_developer', label: 'Review', action: 'PR\'ı incele, yorum yaz, approve/request changes', waitForApproval: false },
    ],
  },
];

const LS_FLOWS = 'tiqr_flows';

function loadFlows(): Flow[] {
  if (typeof window === 'undefined') return PRESET_FLOWS;
  try {
    const saved = localStorage.getItem(LS_FLOWS);
    return saved ? (JSON.parse(saved) as Flow[]) : PRESET_FLOWS;
  } catch { return PRESET_FLOWS; }
}

function saveFlows(flows: Flow[]) {
  localStorage.setItem(LS_FLOWS, JSON.stringify(flows));
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function FlowsPage() {
  const [flows, setFlows] = useState<Flow[]>(PRESET_FLOWS);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { setFlows(loadFlows()); }, []);

  function deleteFlow(id: string) {
    const next = flows.filter((f) => f.id !== id);
    setFlows(next); saveFlows(next);
  }

  function saveFlow(flow: Flow) {
    const exists = flows.some((f) => f.id === flow.id);
    const next = exists ? flows.map((f) => f.id === flow.id ? flow : f) : [...flows, flow];
    setFlows(next); saveFlows(next);
    setEditing(null); setCreating(false);
  }

  const editingFlow = flows.find((f) => f.id === editing);

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="section-label">Flows</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
            Agent Flowları
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', margin: 0 }}>
            İş kalemlerine atayacağın agent akışlarını tanımla
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
          + Yeni Flow
        </button>
      </div>

      {/* Flow listesi */}
      <div style={{ display: 'grid', gap: 12 }}>
        {flows.map((flow) => (
          <FlowCard
            key={flow.id}
            flow={flow}
            isEditing={editing === flow.id}
            onEdit={() => setEditing(editing === flow.id ? null : flow.id)}
            onDelete={() => deleteFlow(flow.id)}
            onSave={saveFlow}
          />
        ))}
      </div>

      {/* Create modal */}
      {creating && (
        <FlowEditor
          flow={null}
          onSave={saveFlow}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Edit modal */}
      {editing && editingFlow && (
        <FlowEditor
          flow={editingFlow}
          onSave={saveFlow}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Info */}
      <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', padding: '16px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Nasıl Kullanılır?</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>
          Sprint board'da bir iş kalemine tıkla → "Flow Ata" butonuna bas → Bu sayfadaki flowlardan birini seç → AI sırayla her adımı çalıştırır.
        </div>
      </div>
    </div>
  );
}

// ── FlowCard ──────────────────────────────────────────────────────────────────
function FlowCard({ flow, isEditing, onEdit, onDelete, onSave }: {
  flow: Flow; isEditing: boolean;
  onEdit: () => void; onDelete: () => void; onSave: (f: Flow) => void;
}) {
  return (
    <div style={{ borderRadius: 18, border: '1px solid ' + (isEditing ? flow.color + '40' : 'rgba(255,255,255,0.07)'), background: 'rgba(255,255,255,0.02)', overflow: 'hidden', transition: 'border-color 0.2s' }}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: flow.color + '18', border: '1px solid ' + flow.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {flow.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.9)', marginBottom: 3 }}>{flow.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{flow.description}</div>
          {/* Step pills */}
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {flow.steps.map((step, i) => {
              const meta = AGENT_META[step.agent];
              return (
                <React.Fragment key={step.id}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: meta.color + '18', border: '1px solid ' + meta.color + '30', color: meta.color }}>
                    {meta.icon} {step.label}
                  </span>
                  {i < flow.steps.length - 1 && (
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', alignSelf: 'center' }}>→</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={onEdit}
            style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            Düzenle
          </button>
          <button onClick={onDelete}
            style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.06)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FlowEditor ────────────────────────────────────────────────────────────────
function FlowEditor({ flow, onSave, onCancel }: {
  flow: Flow | null; onSave: (f: Flow) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(flow?.name ?? '');
  const [description, setDescription] = useState(flow?.description ?? '');
  const [icon, setIcon] = useState(flow?.icon ?? '🔄');
  const [color, setColor] = useState(flow?.color ?? '#0d9488');
  const [steps, setSteps] = useState<FlowStep[]>(flow?.steps ?? []);

  function addStep() {
    setSteps((prev) => [...prev, {
      id: Date.now().toString(),
      agent: 'developer',
      label: 'Yeni Adım',
      action: '',
      waitForApproval: false,
    }]);
  }

  function updateStep(id: string, patch: Partial<FlowStep>) {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }

  function moveStep(id: string, dir: -1 | 1) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function handleSave() {
    if (!name.trim() || steps.length === 0) return;
    onSave({
      id: flow?.id ?? Date.now().toString(),
      name: name.trim(),
      description: description.trim(),
      icon,
      color,
      steps,
      createdAt: flow?.createdAt ?? new Date().toISOString(),
    });
  }

  const ICONS = ['🔄', '⚡', '👁', '🚀', '🛠', '🔍', '📋', '🤖', '🧪', '🔧'];
  const COLORS = ['#0d9488', '#7c3aed', '#38bdf8', '#22c55e', '#f59e0b', '#f472b6', '#fb923c'];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(12px)' }} onClick={onCancel} />
      <div style={{ position: 'relative', width: '100%', maxWidth: 600, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(8,14,30,0.98)', overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.6)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 2, background: 'linear-gradient(90deg, #0d9488, #7c3aed, #22c55e)', flexShrink: 0 }} />

        <div style={{ padding: '24px 28px', overflowY: 'auto', flex: 1 }}>
          <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.95)' }}>
            {flow ? 'Flow Düzenle' : 'Yeni Flow'}
          </h3>

          {/* Name + Icon + Color */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={edLabelStyle}>Flow Adı</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full Dev Cycle"
                style={edInputStyle} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={edLabelStyle}>Açıklama</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kısa açıklama..."
              style={edInputStyle} />
          </div>

          {/* Icon picker */}
          <div style={{ marginBottom: 16 }}>
            <label style={edLabelStyle}>İkon</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICONS.map((ic) => (
                <button key={ic} onClick={() => setIcon(ic)}
                  style={{ width: 36, height: 36, borderRadius: 9, border: '1px solid ' + (icon === ic ? 'rgba(13,148,136,0.5)' : 'rgba(255,255,255,0.08)'), background: icon === ic ? 'rgba(13,148,136,0.15)' : 'rgba(255,255,255,0.03)', fontSize: 18, cursor: 'pointer' }}>
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div style={{ marginBottom: 20 }}>
            <label style={edLabelStyle}>Renk</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: '3px solid ' + (color === c ? '#fff' : 'transparent'), cursor: 'pointer', transition: 'border-color 0.15s' }} />
              ))}
            </div>
          </div>

          {/* Steps */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ ...edLabelStyle, marginBottom: 0 }}>Adımlar ({steps.length})</label>
              <button onClick={addStep}
                style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.1)', color: '#5eead4', cursor: 'pointer', fontWeight: 700 }}>
                + Adım Ekle
              </button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {steps.map((step, idx) => {
                const meta = AGENT_META[step.agent];
                return (
                  <div key={step.id} style={{ borderRadius: 12, border: '1px solid ' + meta.color + '30', background: meta.color + '06', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 14 }}>{meta.icon}</span>
                      <input value={step.label} onChange={(e) => updateStep(step.id, { label: e.target.value })}
                        style={{ flex: 1, padding: '5px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)', fontSize: 12, outline: 'none' }} />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => moveStep(step.id, -1)} disabled={idx === 0}
                          style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: 11, opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                        <button onClick={() => moveStep(step.id, 1)} disabled={idx === steps.length - 1}
                          style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer', fontSize: 11, opacity: idx === steps.length - 1 ? 0.3 : 1 }}>↓</button>
                        <button onClick={() => removeStep(step.id)}
                          style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid rgba(248,113,113,0.2)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>×</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 4 }}>Agent</label>
                        <select value={step.agent} onChange={(e) => updateStep(step.id, { agent: e.target.value as AgentRole })}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none', appearance: 'none' }}>
                          {(Object.keys(AGENT_META) as AgentRole[]).map((r) => (
                            <option key={r} value={r} style={{ background: '#0d1117' }}>{AGENT_META[r].icon} {AGENT_META[r].label}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={step.waitForApproval} onChange={(e) => updateStep(step.id, { waitForApproval: e.target.checked })} />
                          Onay bekle
                        </label>
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 4 }}>Görev</label>
                      <input value={step.action} onChange={(e) => updateStep(step.id, { action: e.target.value })}
                        placeholder="Agent ne yapacak?"
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                );
              })}
              {steps.length === 0 && (
                <div style={{ textAlign: 'center', padding: '24px', color: 'rgba(255,255,255,0.2)', fontSize: 13, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12 }}>
                  Henüz adım yok. "+ Adım Ekle" ile başla.
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 14, cursor: 'pointer' }}>
            İptal
          </button>
          <button onClick={handleSave} disabled={!name.trim() || steps.length === 0}
            style={{ flex: 2, padding: '12px', borderRadius: 12, border: 'none', background: name.trim() && steps.length > 0 ? 'linear-gradient(135deg, #0d9488, #22c55e)' : 'rgba(255,255,255,0.06)', color: name.trim() && steps.length > 0 ? '#fff' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 14, cursor: name.trim() && steps.length > 0 ? 'pointer' : 'not-allowed' }}>
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

const edLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6,
};
const edInputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};
