'use client';

import { useEffect, useMemo, useState } from 'react';
import { createFlowTemplate, deleteFlowTemplate, FlowTemplate, listFlowTemplates, loadPrefs, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type FlowLite = {
  id: string;
  name: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  createdAt: string;
};

const STARTER_TEMPLATES: Array<{ name: string; description: string; flow: Record<string, unknown> }> = [
  {
    name: 'Task to PR Review Loop',
    description: 'Task intake -> developer implementation -> GitHub PR creation -> reviewer approval.',
    flow: {
      id: 'template-pr-review-loop',
      name: 'Task to PR Review Loop',
      createdAt: new Date().toISOString(),
      nodes: [
        { id: 'p1', type: 'trigger', role: 'trigger', label: 'Task Intake', icon: '🧾', color: '#f59e0b', action: 'Receive task from board', waitForApproval: false, x: 60, y: 150 },
        { id: 'p2', type: 'agent', role: 'developer', label: 'Developer Build', icon: '⚡', color: '#22c55e', action: 'Implement task and prepare changes', waitForApproval: false, x: 280, y: 150 },
        { id: 'p3', type: 'github', role: 'github', label: 'Open PR', icon: '🐙', color: '#6e40c9', action: 'Create pull request', github_action: 'create_pr', pr_title: 'AI: {{title}}', waitForApproval: false, x: 500, y: 150 },
        { id: 'p4', type: 'agent', role: 'lead_developer', label: 'PR Review', icon: '🧑‍💻', color: '#38bdf8', action: 'Review PR and approve or request changes', waitForApproval: true, x: 720, y: 150 },
      ],
      edges: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'p3' }, { from: 'p3', to: 'p4' }],
    },
  },
  {
    name: 'Enterprise Delivery',
    description: 'PM -> Lead Dev -> Security Gate -> Dev -> QA -> GitHub PR chain.',
    flow: {
      id: 'template-enterprise',
      name: 'Enterprise Delivery',
      createdAt: new Date().toISOString(),
      nodes: [
        { id: 'n1', type: 'agent', role: 'pm', label: 'PM Discovery', icon: '📋', color: '#a78bfa', action: 'Scope and acceptance criteria', waitForApproval: false, x: 60, y: 120 },
        { id: 'n2', type: 'agent', role: 'lead_developer', label: 'Tech Plan', icon: '🧑‍💻', color: '#38bdf8', action: 'Architecture and task breakdown', waitForApproval: true, x: 280, y: 120 },
        { id: 'n3', type: 'condition', role: 'condition', label: 'Security Gate', icon: '🔐', color: '#22c55e', action: 'Security checklist', waitForApproval: true, x: 500, y: 120 },
        { id: 'n4', type: 'agent', role: 'developer', label: 'Implementation', icon: '⚡', color: '#22c55e', action: 'Code and tests', waitForApproval: false, x: 720, y: 120 },
      ],
      edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
    },
  },
  {
    name: 'Hotfix Response',
    description: 'Incident trigger -> root cause -> patch -> verify -> notify.',
    flow: {
      id: 'template-hotfix',
      name: 'Hotfix Response',
      createdAt: new Date().toISOString(),
      nodes: [
        { id: 'h1', type: 'trigger', role: 'trigger', label: 'Incident Trigger', icon: '🚨', color: '#f59e0b', action: 'Prod alarm', waitForApproval: false, x: 60, y: 180 },
        { id: 'h2', type: 'agent', role: 'lead_developer', label: 'Root Cause', icon: '🧑‍💻', color: '#38bdf8', action: 'Root cause analysis', waitForApproval: true, x: 280, y: 180 },
        { id: 'h3', type: 'agent', role: 'developer', label: 'Patch', icon: '⚡', color: '#22c55e', action: 'Fast patch', waitForApproval: false, x: 500, y: 180 },
        { id: 'h4', type: 'notify', role: 'notify', label: 'Team Notify', icon: '🔔', color: '#fb923c', action: 'Send incident update', waitForApproval: false, x: 720, y: 180 },
      ],
      edges: [{ from: 'h1', to: 'h2' }, { from: 'h2', to: 'h3' }, { from: 'h3', to: 'h4' }],
    },
  },
];

export default function TemplatesPage() {
  const { t } = useLocale();
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setTemplates(await listFlowTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function installStarters() {
    setError('');
    try {
      for (const s of STARTER_TEMPLATES) {
        await createFlowTemplate({ name: s.name, description: s.description, flow: s.flow });
      }
      setMessage(t('flows.templatesInstalled'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Install failed');
    }
  }

  async function removeTemplate(id: number) {
    try {
      await deleteFlowTemplate(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function importToFlows(template: FlowTemplate) {
    try {
      const prefs = await loadPrefs();
      const flows = (prefs.flows ?? []) as unknown as FlowLite[];
      const raw = template.flow as unknown as FlowLite;
      const flowId = String(Date.now());
      const nodes = (raw.nodes ?? []).map((n, i) => ({ ...n, id: `n_${flowId}_${i}` }));
      const oldNodes = raw.nodes ?? [];
      const edges = (raw.edges ?? []).map((e) => {
        const from = String((e as Record<string, unknown>).from ?? '');
        const to = String((e as Record<string, unknown>).to ?? '');
        const fromIdx = oldNodes.findIndex((n) => String((n as Record<string, unknown>).id ?? '') === from);
        const toIdx = oldNodes.findIndex((n) => String((n as Record<string, unknown>).id ?? '') === to);
        return { from: `n_${flowId}_${fromIdx}`, to: `n_${flowId}_${toIdx}` };
      });
      const imported: FlowLite = {
        id: flowId,
        name: template.name,
        createdAt: new Date().toISOString(),
        nodes,
        edges,
      };
      await savePrefs({ flows: [...flows, imported] as unknown as Record<string, unknown>[] });
      setMessage(`${t('flows.templatesImported')}: ${template.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  }

  const empty = useMemo(() => !loading && templates.length === 0, [loading, templates.length]);

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div>
        <div className='section-label'>{t('nav.templates')}</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.94)', marginTop: 6 }}>{t('flows.templateMarketplace')}</h1>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => void installStarters()} className='button button-primary' style={{ padding: '9px 14px', fontSize: 13 }}>
          {t('flows.templatesInstallStarter')}
        </button>
        <button onClick={() => void load()} className='button button-outline' style={{ padding: '9px 14px', fontSize: 13 }}>
          {t('flows.templatesRefresh')}
        </button>
      </div>

      {(message || error) && (
        <div style={{ borderRadius: 10, padding: '10px 12px', border: '1px solid ' + (error ? 'rgba(248,113,113,0.35)' : 'rgba(34,197,94,0.3)'), background: error ? 'rgba(248,113,113,0.08)' : 'rgba(34,197,94,0.08)', color: error ? '#f87171' : '#22c55e', fontSize: 13 }}>
          {error || message}
        </div>
      )}

      {empty && (
        <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: 18, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          {t('flows.templatesEmpty')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: 12 }}>
        {templates.map((tp) => (
          <div key={tp.id} style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: 14 }}>
            <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 6 }}>{tp.name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', marginBottom: 12 }}>{tp.description || '-'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void importToFlows(tp)} style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                {t('flows.importTemplate')}
              </button>
              <button onClick={() => void removeTemplate(tp.id)} style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                {t('flows.templatesDelete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
