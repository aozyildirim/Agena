'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type ModuleItem = {
  slug: string;
  name: string;
  description: string | null;
  icon: string;
  is_core: boolean;
  default_enabled: boolean;
  enabled: boolean;
};

const MODULE_HELP: Record<string, { features: string[]; useCases: string[] }> = {
  core: { features: ['Task creation & management', 'Agent configuration', 'Repo mappings', 'Permissions & RBAC'], useCases: ['Always enabled — foundation of the platform'] },
  boss_mode: { features: ['Pixel-art office visualization', 'Visual agent management', 'Drag & drop task assignment', 'Real-time agent status'], useCases: ['Managing AI agents visually', 'Quick task assignment from office view'] },
  sprints: { features: ['Sprint board (Kanban)', 'Sprint import from Azure/Jira', 'Sprint Performance tracking', 'Team management'], useCases: ['Agile teams using sprints', 'Importing work items from project tools'] },
  refinement: { features: ['AI-powered task refinement', 'Story point estimation', 'Acceptance criteria generation', 'Edge case analysis'], useCases: ['Preparing tasks before AI development', 'Improving task quality for better AI output'] },
  skills: { features: ['Auto-extract patterns from completed tasks', 'Qdrant vector search for relevance', 'Injected into agent system prompts', 'Manual create + edit + tags'], useCases: ['Building a team knowledge base over time', 'Enforcing team coding conventions on new agent runs', 'Reducing rediscovery on similar tasks'] },
  runtimes: { features: ['Register local + cloud compute environments', 'Token-based daemon auth', '30s heartbeat + live status', 'Available-CLI reporting'], useCases: ['Visibility into where agents can actually run', 'Multi-machine teams sharing one dashboard', 'Foundation for the upcoming agena CLI'] },
  flows: { features: ['Visual flow builder (drag & drop)', 'Flow templates', 'Multi-step automation', 'Condition nodes & branching'], useCases: ['Custom AI pipelines', 'Automated code review workflows'] },
  prompt_studio: { features: ['Edit system prompts at runtime', 'Per-agent prompt customization', 'Version history', 'No code deploy needed'], useCases: ['Fine-tuning AI behavior', 'A/B testing different prompts'] },
  dora: { features: ['Deployment Frequency', 'Lead Time for Changes', 'Change Failure Rate', 'Mean Time to Recovery (MTTR)'], useCases: ['Engineering team performance metrics', 'DevOps maturity assessment'] },
  github: { features: ['PR creation on GitHub', 'Branch management', 'Repo sync', 'Webhook support'], useCases: ['Teams using GitHub for source control'] },
  azure: { features: ['Azure DevOps PR creation', 'Sprint/work item import', 'Branch management', 'Service hook support'], useCases: ['Teams using Azure DevOps'] },
  jira: { features: ['Jira sprint import', 'Issue sync', 'Status mapping'], useCases: ['Teams using Jira for project management'] },
  openai: { features: ['GPT-4o, GPT-5, o3, o4-mini models', 'API key or org-level config', 'Token usage tracking'], useCases: ['Primary LLM provider for code generation'] },
  gemini: { features: ['Google Gemini models', 'API key config', 'Fallback provider'], useCases: ['Alternative/backup LLM provider'] },
  cli_agents: { features: ['Claude CLI (Anthropic)', 'Codex CLI (OpenAI)', 'Local repo access', 'Real-time streaming logs'], useCases: ['Running AI agents locally on your machine', 'Using Claude/Codex subscription instead of API keys'] },
  hal: { features: ['Custom AI service endpoint', 'Configurable login/chat URLs', 'Bearer auth'], useCases: ['Enterprise with custom LLM deployments'] },
  playbook: { features: ['Organization-level coding rules', 'Injected into every AI prompt', 'Style guides & conventions'], useCases: ['Enforcing coding standards across AI-generated code'] },
  sentry: { features: ['Auto-import Sentry errors as tasks', 'Targeted fix prompts with file content', 'Resolve/unresolve from dashboard', 'PR comment on Sentry issue', 'Auto-resolve on PR merge'], useCases: ['Automated production error fixing', 'Sentry → AI → PR → merge → resolved loop'] },
  newrelic: { features: ['Auto-import New Relic APM errors', 'Entity-to-repo mapping', 'Targeted fix prompts', 'Periodic polling'], useCases: ['Automated production error fixing from New Relic'] },
  datadog: { features: ['Import Datadog Error Tracking issues', 'Stack trace parsing', 'Auto-priority from occurrence count', 'Resolve/unresolve from dashboard'], useCases: ['Automated production error fixing from Datadog APM'] },
  appdynamics: { features: ['Import AppDynamics error snapshots', 'Health rule violation tracking', 'Stack trace + file path parsing', 'Business transaction mapping'], useCases: ['Automated production error fixing from AppDynamics'] },
  slack: { features: ['Webhook notifications', 'Bot token for ChatOps', 'Task status alerts'], useCases: ['Team notifications in Slack'] },
  teams: { features: ['Bot notifications', 'Teams webhook', 'ChatOps commands'], useCases: ['Team notifications in Microsoft Teams'] },
  telegram: { features: ['Bot notifications', 'ChatOps commands (/fix, /status)', 'Group chat support'], useCases: ['Lightweight mobile notifications'] },
  notifications: { features: ['Slack, Teams, Telegram integrations', 'Webhook notifications'], useCases: ['Team communication channels'] },
  insights: { features: ['Cross-source event correlation engine', 'PR + deploy + Sentry/NewRelic/Datadog/AppDynamics + Jira/Azure clusters', 'Confidence-scored timeline view', '5-minute polling'], useCases: ['Root-cause hunting after a deploy', 'Connecting "this Sentry error came from PR #4519"', 'Seeing how multiple monitoring signals correlate'] },
  triage: { features: ['Weekly AI scan of stale Jira / Azure tickets', 'Verdict per ticket: close / snooze / keep', 'Bulk-approve from /dashboard/triage', 'Configurable idle threshold + sources'], useCases: ['Eliminating Friday triage meetings', 'Keeping the backlog honest without manual review'] },
  review_backlog: { features: ['Detects PRs sitting unreviewed past warn/critical thresholds', 'Slack / email reviewer nudges', 'Escalation flag at critical age', 'Per-repo exempt list'], useCases: ['Killing review-bottleneck velocity drops', 'Surfacing PRs that fall through the cracks'] },
  reviews: { features: ['🔎 Review button on every task', 'is_reviewer toggle on agents', 'Per-agent review history with severity distribution', 'Custom reviewer personas (security_developer, qa, lead_developer)'], useCases: ['OWASP-aware AI code review', 'Custom reviewer personas (perf, a11y, style cop)', 'Audit-trail per agent'] },
};

export default function ModulesPage() {
  const { t } = useLocale();
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [helpModule, setHelpModule] = useState<ModuleItem | null>(null);

  useEffect(() => {
    apiFetch<ModuleItem[]>('/modules')
      .then(setModules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(slug: string, enabled: boolean) {
    setToggling(slug);
    try {
      const updated = await apiFetch<ModuleItem>(`/modules/${slug}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      setModules((prev) => prev.map((m) => m.slug === slug ? { ...m, enabled: updated.enabled } : m));
      // Notify layout to refresh sidebar
      window.dispatchEvent(new CustomEvent('agena:modules-changed'));
      setMsg(`${updated.name} ${updated.enabled ? t('modules.toggleEnabled') : t('modules.toggleDisabled')}`);
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg(t('modules.updateFailed'));
      setTimeout(() => setMsg(''), 2000);
    } finally {
      setToggling(null);
    }
  }

  const enabledCount = modules.filter((m) => m.enabled).length;

  const MODULE_GROUPS: { labelKey: string; slugs: string[] }[] = [
    { labelKey: 'modules.group.core', slugs: ['core', 'boss_mode', 'sprints', 'refinement', 'skills', 'runtimes', 'permissions'] },
    { labelKey: 'modules.group.ai', slugs: ['flows', 'prompt_studio', 'playbook', 'reviews'] },
    { labelKey: 'modules.group.workflows', slugs: ['insights', 'triage', 'review_backlog'] },
    { labelKey: 'modules.group.llm', slugs: ['openai', 'gemini', 'hal', 'cli_agents'] },
    { labelKey: 'modules.group.scm', slugs: ['github', 'gitlab', 'bitbucket', 'azure'] },
    { labelKey: 'modules.group.issues', slugs: ['jira', 'sentry', 'newrelic', 'datadog', 'appdynamics'] },
    { labelKey: 'modules.group.analytics', slugs: ['dora'] },
    { labelKey: 'modules.group.notifications', slugs: ['slack', 'teams', 'telegram', 'notifications'] },
  ];

  // Catch-all: any module the DB returns but isn't slotted into a group
  // above gets surfaced under "Other" so we never silently hide a feature
  // again like we did with the new workflow modules.
  const KNOWN = new Set(MODULE_GROUPS.flatMap((g) => g.slugs));
  const orphans = modules.filter((m) => !KNOWN.has(m.slug)).map((m) => m.slug);
  if (orphans.length) MODULE_GROUPS.push({ labelKey: 'modules.group.other', slugs: orphans });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>
          {t('modules.pageTitle')}
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-30)', marginLeft: 10 }}>
            {enabledCount}/{modules.length} {t('modules.active')}
          </span>
        </h1>
        <p style={{ fontSize: 12, color: 'var(--ink-40)', marginTop: 4 }}>
          {t('modules.subtitle')}
        </p>
      </div>

      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#3f9d6a', background: 'var(--acc-soft)', border: '1px solid var(--panel-border)' }}>
          {msg}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink-25)' }}>{t('modules.loading')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {MODULE_GROUPS.map((group) => {
            const groupModules = group.slugs.map((s) => modules.find((m) => m.slug === s)).filter(Boolean) as ModuleItem[];
            if (!groupModules.length) return null;
            return (
              <div key={group.labelKey}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>{t(group.labelKey as Parameters<typeof t>[0])}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                  {groupModules.map((m) => (
            <div key={m.slug} style={{
              borderRadius: 10,
              border: `1px solid ${m.enabled ? 'var(--acc)' : 'var(--panel-border)'}`,
              background: m.enabled ? 'var(--acc-soft)' : 'var(--surface)',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'all 0.2s',
              opacity: toggling === m.slug ? 0.5 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>{m.name}</div>
                </div>
                <button onClick={() => setHelpModule(m)} style={{ width: 18, height: 18, borderRadius: 6, border: '1px solid var(--panel-border-2)', background: 'transparent', color: 'var(--ink-30)', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>?</button>
                {m.is_core ? (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: 'var(--acc-soft)', color: '#5b9bd5' }}>{t('modules.coreBadge')}</span>
                ) : (
                  <div
                    onClick={() => !toggling && toggle(m.slug, !m.enabled)}
                    style={{
                      width: 36, height: 20, borderRadius: 999,
                      background: m.enabled ? '#3f9d6a' : 'var(--panel-border-3)',
                      position: 'relative', cursor: toggling ? 'wait' : 'pointer',
                      transition: 'background 0.2s', flexShrink: 0,
                    }}>
                    <div style={{
                      position: 'absolute', top: 2, left: m.enabled ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s',
                    }} />
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.4 }}>
                {m.description}
              </div>
            </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {helpModule && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }} onClick={() => setHelpModule(null)}>
          <div style={{ width: 'min(460px, calc(100% - 40px))', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--panel-border)', padding: 24, boxSizing: 'border-box', maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 28 }}>{helpModule.icon}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)' }}>{helpModule.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-40)' }}>{helpModule.description}</div>
              </div>
              <button onClick={() => setHelpModule(null)} style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: 6, border: '1px solid var(--panel-border)', background: 'var(--panel-alt)', color: 'var(--ink-50)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><NavIcon name="close" size={16} /></button>
            </div>
            {MODULE_HELP[helpModule.slug] && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{t('modules.features' as Parameters<typeof t>[0]) || 'Features'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {MODULE_HELP[helpModule.slug].features.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-70)' }}>
                        <span style={{ color: '#3f9d6a', display: 'inline-flex' }}><NavIcon name="dot" size={10} /></span> {f}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{t('modules.useCases' as Parameters<typeof t>[0]) || 'Use Cases'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {MODULE_HELP[helpModule.slug].useCases.map((u, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-60)' }}>
                        <span style={{ color: 'var(--acc)', display: 'inline-flex' }}><NavIcon name="chevron-right" size={10} /></span> {u}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
