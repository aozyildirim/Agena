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

function starterTemplates(t: ReturnType<typeof useLocale>['t']): Array<{ name: string; description: string; flow: Record<string, unknown> }> {
  return [
    {
      name: t('flows.preset.prReviewLoop.name'),
      description: t('templates.preset.prReviewLoop.description'),
      flow: {
        id: 'template-pr-review-loop',
        name: t('flows.preset.prReviewLoop.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'p1', type: 'trigger', role: 'trigger', label: t('flows.preset.prReviewLoop.p1.label'), icon: '🧾', color: '#f59e0b', action: t('flows.preset.prReviewLoop.p1.action'), waitForApproval: false, x: 60, y: 150 },
          { id: 'p2', type: 'agent', role: 'developer', label: t('flows.preset.prReviewLoop.p2.label'), icon: '⚡', color: '#22c55e', action: t('flows.preset.prReviewLoop.p2.action'), execute_task_pipeline: true, create_pr: true, waitForApproval: false, x: 280, y: 150 },
          { id: 'p3', type: 'github', role: 'github', label: t('flows.preset.prReviewLoop.p3.label'), icon: '🐙', color: '#6e40c9', action: t('flows.preset.prReviewLoop.p3.action'), github_action: 'create_pr', pr_title: 'AI: {{title}}', waitForApproval: false, x: 500, y: 150 },
          { id: 'p4', type: 'agent', role: 'lead_developer', label: t('flows.preset.prReviewLoop.p4.label'), icon: '🧑‍💻', color: '#38bdf8', action: t('flows.preset.prReviewLoop.p4.action'), review_only: true, auto_fix_from_comments: true, waitForApproval: true, x: 720, y: 150 },
        ],
        edges: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'p3' }, { from: 'p3', to: 'p4' }],
      },
    },
    {
      name: t('templates.preset.enterprise.name'),
      description: t('templates.preset.enterprise.description'),
      flow: {
        id: 'template-enterprise',
        name: t('templates.preset.enterprise.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'n1', type: 'agent', role: 'pm', label: t('templates.preset.enterprise.n1.label'), icon: '📋', color: '#a78bfa', action: t('templates.preset.enterprise.n1.action'), waitForApproval: false, x: 60, y: 120 },
          { id: 'n2', type: 'agent', role: 'lead_developer', label: t('templates.preset.enterprise.n2.label'), icon: '🧑‍💻', color: '#38bdf8', action: t('templates.preset.enterprise.n2.action'), waitForApproval: true, x: 280, y: 120 },
          { id: 'n3', type: 'condition', role: 'condition', label: t('templates.preset.enterprise.n3.label'), icon: '🔐', color: '#22c55e', action: t('templates.preset.enterprise.n3.action'), waitForApproval: true, x: 500, y: 120 },
          { id: 'n4', type: 'agent', role: 'developer', label: t('templates.preset.enterprise.n4.label'), icon: '⚡', color: '#22c55e', action: t('templates.preset.enterprise.n4.action'), waitForApproval: false, x: 720, y: 120 },
        ],
        edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
      },
    },
    {
      name: t('templates.preset.hotfix.name'),
      description: t('templates.preset.hotfix.description'),
      flow: {
        id: 'template-hotfix',
        name: t('templates.preset.hotfix.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'h1', type: 'trigger', role: 'trigger', label: t('templates.preset.hotfix.h1.label'), icon: '🚨', color: '#f59e0b', action: t('templates.preset.hotfix.h1.action'), waitForApproval: false, x: 60, y: 180 },
          { id: 'h2', type: 'agent', role: 'lead_developer', label: t('templates.preset.hotfix.h2.label'), icon: '🧑‍💻', color: '#38bdf8', action: t('templates.preset.hotfix.h2.action'), waitForApproval: true, x: 280, y: 180 },
          { id: 'h3', type: 'agent', role: 'developer', label: t('templates.preset.hotfix.h3.label'), icon: '⚡', color: '#22c55e', action: t('templates.preset.hotfix.h3.action'), waitForApproval: false, x: 500, y: 180 },
          { id: 'h4', type: 'notify', role: 'notify', label: t('templates.preset.hotfix.h4.label'), icon: '🔔', color: '#fb923c', action: t('templates.preset.hotfix.h4.action'), waitForApproval: false, x: 720, y: 180 },
        ],
        edges: [{ from: 'h1', to: 'h2' }, { from: 'h2', to: 'h3' }, { from: 'h3', to: 'h4' }],
      },
    },
    /* ── New Templates ── */
    {
      name: t('templates.preset.bugTriage.name'),
      description: t('templates.preset.bugTriage.description'),
      flow: {
        id: 'template-bug-triage',
        name: t('templates.preset.bugTriage.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'bt1', type: 'trigger', role: 'trigger', label: t('templates.preset.bugTriage.bt1.label'), icon: '🐛', color: '#f59e0b', action: t('templates.preset.bugTriage.bt1.action'), waitForApproval: false, x: 60, y: 150 },
          { id: 'bt2', type: 'agent', role: 'analyzer', label: t('templates.preset.bugTriage.bt2.label'), icon: '🔍', color: '#a78bfa', action: t('templates.preset.bugTriage.bt2.action'), waitForApproval: false, x: 280, y: 150 },
          { id: 'bt3', type: 'condition', role: 'condition', label: t('templates.preset.bugTriage.bt3.label'), icon: '🎯', color: '#f59e0b', action: t('templates.preset.bugTriage.bt3.action'), condition_field: 'severity', condition_operator: 'eq', condition_value: 'critical', true_target: 'bt4', false_target: 'bt5', waitForApproval: false, x: 500, y: 150 },
          { id: 'bt4', type: 'agent', role: 'developer', label: t('templates.preset.bugTriage.bt4.label'), icon: '⚡', color: '#ef4444', action: t('templates.preset.bugTriage.bt4.action'), execute_task_pipeline: true, create_pr: true, waitForApproval: false, x: 720, y: 80 },
          { id: 'bt5', type: 'agent', role: 'planner', label: t('templates.preset.bugTriage.bt5.label'), icon: '📝', color: '#38bdf8', action: t('templates.preset.bugTriage.bt5.action'), waitForApproval: true, x: 720, y: 220 },
        ],
        edges: [{ from: 'bt1', to: 'bt2' }, { from: 'bt2', to: 'bt3' }, { from: 'bt3', to: 'bt4' }, { from: 'bt3', to: 'bt5' }],
      },
    },
    {
      name: t('templates.preset.codeRefactor.name'),
      description: t('templates.preset.codeRefactor.description'),
      flow: {
        id: 'template-code-refactor',
        name: t('templates.preset.codeRefactor.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'cr1', type: 'agent', role: 'analyzer', label: t('templates.preset.codeRefactor.cr1.label'), icon: '🔬', color: '#a78bfa', action: t('templates.preset.codeRefactor.cr1.action'), waitForApproval: false, x: 60, y: 150 },
          { id: 'cr2', type: 'agent', role: 'planner', label: t('templates.preset.codeRefactor.cr2.label'), icon: '📐', color: '#38bdf8', action: t('templates.preset.codeRefactor.cr2.action'), waitForApproval: true, x: 280, y: 150 },
          { id: 'cr3', type: 'agent', role: 'developer', label: t('templates.preset.codeRefactor.cr3.label'), icon: '⚡', color: '#22c55e', action: t('templates.preset.codeRefactor.cr3.action'), execute_task_pipeline: true, create_pr: true, waitForApproval: false, x: 500, y: 150 },
          { id: 'cr4', type: 'agent', role: 'reviewer', label: t('templates.preset.codeRefactor.cr4.label'), icon: '🧪', color: '#f59e0b', action: t('templates.preset.codeRefactor.cr4.action'), review_only: true, waitForApproval: true, x: 720, y: 150 },
        ],
        edges: [{ from: 'cr1', to: 'cr2' }, { from: 'cr2', to: 'cr3' }, { from: 'cr3', to: 'cr4' }],
      },
    },
    {
      name: t('templates.preset.featureFullCycle.name'),
      description: t('templates.preset.featureFullCycle.description'),
      flow: {
        id: 'template-feature-full-cycle',
        name: t('templates.preset.featureFullCycle.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'fc1', type: 'trigger', role: 'trigger', label: t('templates.preset.featureFullCycle.fc1.label'), icon: '🎫', color: '#f59e0b', action: t('templates.preset.featureFullCycle.fc1.action'), waitForApproval: false, x: 60, y: 150 },
          { id: 'fc2', type: 'agent', role: 'pm', label: t('templates.preset.featureFullCycle.fc2.label'), icon: '📋', color: '#a78bfa', action: t('templates.preset.featureFullCycle.fc2.action'), waitForApproval: true, x: 240, y: 150 },
          { id: 'fc3', type: 'agent', role: 'developer', label: t('templates.preset.featureFullCycle.fc3.label'), icon: '⚡', color: '#22c55e', action: t('templates.preset.featureFullCycle.fc3.action'), execute_task_pipeline: true, waitForApproval: false, x: 420, y: 150 },
          { id: 'fc4', type: 'agent', role: 'qa', label: t('templates.preset.featureFullCycle.fc4.label'), icon: '🧪', color: '#f472b6', action: t('templates.preset.featureFullCycle.fc4.action'), waitForApproval: false, x: 600, y: 150 },
          { id: 'fc5', type: 'github', role: 'github', label: t('templates.preset.featureFullCycle.fc5.label'), icon: '🐙', color: '#6e40c9', action: t('templates.preset.featureFullCycle.fc5.action'), github_action: 'create_pr', waitForApproval: false, x: 780, y: 150 },
        ],
        edges: [{ from: 'fc1', to: 'fc2' }, { from: 'fc2', to: 'fc3' }, { from: 'fc3', to: 'fc4' }, { from: 'fc4', to: 'fc5' }],
      },
    },
    {
      name: t('templates.preset.azureDevOps.name'),
      description: t('templates.preset.azureDevOps.description'),
      flow: {
        id: 'template-azure-devops',
        name: t('templates.preset.azureDevOps.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'az1', type: 'trigger', role: 'trigger', label: t('templates.preset.azureDevOps.az1.label'), icon: '🎫', color: '#f59e0b', action: t('templates.preset.azureDevOps.az1.action'), waitForApproval: false, x: 60, y: 150 },
          { id: 'az2', type: 'agent', role: 'developer', label: t('templates.preset.azureDevOps.az2.label'), icon: '⚡', color: '#22c55e', action: t('templates.preset.azureDevOps.az2.action'), execute_task_pipeline: true, waitForApproval: false, x: 280, y: 150 },
          { id: 'az3', type: 'azure', role: 'azure', label: t('templates.preset.azureDevOps.az3.label'), icon: '🔷', color: '#0078d4', action: t('templates.preset.azureDevOps.az3.action'), azure_action: 'create_branch', waitForApproval: false, x: 500, y: 150 },
          { id: 'az4', type: 'azure', role: 'azure', label: t('templates.preset.azureDevOps.az4.label'), icon: '🔷', color: '#0078d4', action: t('templates.preset.azureDevOps.az4.action'), azure_action: 'create_pr', waitForApproval: false, x: 720, y: 150 },
        ],
        edges: [{ from: 'az1', to: 'az2' }, { from: 'az2', to: 'az3' }, { from: 'az3', to: 'az4' }],
      },
    },
    {
      name: t('templates.preset.jiraSync.name'),
      description: t('templates.preset.jiraSync.description'),
      flow: {
        id: 'template-jira-sync',
        name: t('templates.preset.jiraSync.name'),
        createdAt: new Date().toISOString(),
        nodes: [
          { id: 'js1', type: 'trigger', role: 'trigger', label: t('templates.preset.jiraSync.js1.label'), icon: '📥', color: '#f59e0b', action: t('templates.preset.jiraSync.js1.action'), waitForApproval: false, x: 60, y: 150 },
          { id: 'js2', type: 'agent', role: 'pm', label: t('templates.preset.jiraSync.js2.label'), icon: '📋', color: '#a78bfa', action: t('templates.preset.jiraSync.js2.action'), waitForApproval: false, x: 280, y: 150 },
          { id: 'js3', type: 'agent', role: 'developer', label: t('templates.preset.jiraSync.js3.label'), icon: '⚡', color: '#22c55e', action: t('templates.preset.jiraSync.js3.action'), execute_task_pipeline: true, create_pr: true, waitForApproval: false, x: 500, y: 150 },
          { id: 'js4', type: 'http', role: 'http', label: t('templates.preset.jiraSync.js4.label'), icon: '🔄', color: '#38bdf8', action: t('templates.preset.jiraSync.js4.action'), http_method: 'PUT', waitForApproval: false, x: 720, y: 150 },
        ],
        edges: [{ from: 'js1', to: 'js2' }, { from: 'js2', to: 'js3' }, { from: 'js3', to: 'js4' }],
      },
    },
  ];
}

const TEMPLATE_LOCALE_MAP: Record<string, { nameKey: string; descKey: string }> = {
  'template-pr-review-loop': { nameKey: 'flows.preset.prReviewLoop.name', descKey: 'templates.preset.prReviewLoop.description' },
  'template-enterprise': { nameKey: 'templates.preset.enterprise.name', descKey: 'templates.preset.enterprise.description' },
  'template-hotfix': { nameKey: 'templates.preset.hotfix.name', descKey: 'templates.preset.hotfix.description' },
  'template-bug-triage': { nameKey: 'templates.preset.bugTriage.name', descKey: 'templates.preset.bugTriage.description' },
  'template-code-refactor': { nameKey: 'templates.preset.codeRefactor.name', descKey: 'templates.preset.codeRefactor.description' },
  'template-feature-full-cycle': { nameKey: 'templates.preset.featureFullCycle.name', descKey: 'templates.preset.featureFullCycle.description' },
  'template-azure-devops': { nameKey: 'templates.preset.azureDevOps.name', descKey: 'templates.preset.azureDevOps.description' },
  'template-jira-sync': { nameKey: 'templates.preset.jiraSync.name', descKey: 'templates.preset.jiraSync.description' },
};

function localizeTemplateMeta(template: FlowTemplate, t: ReturnType<typeof useLocale>['t']) {
  const flow = template.flow as unknown as FlowLite | null;
  const flowId = flow?.id ?? '';
  const mapping = TEMPLATE_LOCALE_MAP[flowId];
  if (mapping) {
    return { name: t(mapping.nameKey), description: t(mapping.descKey) };
  }
  return { name: template.name, description: template.description || '' };
}

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
      setError(e instanceof Error ? e.message : t('templates.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function installStarters() {
    setError('');
    try {
      const existing = await listFlowTemplates();
      const existingIds = new Set(
        existing.map((tp) => ((tp.flow as unknown as FlowLite)?.id ?? '')).filter(Boolean)
      );
      const starters = starterTemplates(t);
      const toInstall = starters.filter((s) => !existingIds.has((s.flow as unknown as FlowLite).id));
      if (toInstall.length === 0) {
        setMessage(t('templates.alreadyInstalled'));
        return;
      }
      for (const s of toInstall) {
        await createFlowTemplate({ name: s.name, description: s.description, flow: s.flow });
      }
      setMessage(t('flows.templatesInstalled'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('templates.installFailed'));
    }
  }

  async function removeTemplate(id: number) {
    try {
      await deleteFlowTemplate(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('templates.deleteFailed'));
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
        name: localizeTemplateMeta(template, t).name,
        createdAt: new Date().toISOString(),
        nodes,
        edges,
      };
      await savePrefs({ flows: [...flows, imported] as unknown as Record<string, unknown>[] });
      setMessage(`${t('flows.templatesImported')}: ${localizeTemplateMeta(template, t).name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('templates.importFailed'));
    }
  }

  const empty = useMemo(() => !loading && templates.length === 0, [loading, templates.length]);

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div>
        <div className='section-label'>{t('nav.templates')}</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-90)', marginTop: 6 }}>{t('flows.templateMarketplace')}</h1>
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
        <div style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 18, color: 'var(--ink-50)', fontSize: 13 }}>
          {t('flows.templatesEmpty')}
        </div>
      )}

      <div className="dash-grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))', gap: 12 }}>
        {templates.map((tp) => (
          <div key={tp.id} style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', padding: 14 }}>
            <div style={{ fontWeight: 700, color: 'var(--ink-90)', marginBottom: 6 }}>{localizeTemplateMeta(tp, t).name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-42)', marginBottom: 12 }}>{localizeTemplateMeta(tp, t).description || t('templates.noDescription')}</div>
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
