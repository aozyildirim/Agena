'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, loadPrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

const FALLBACK_AGENT_ROLES = ['manager', 'pm', 'analyzer', 'planner', 'developer', 'lead_developer', 'reviewer', 'qa', 'security_developer'];

type Provider = 'jira' | 'azure';

interface RuleMatch {
  reporter?: string;
  issue_type?: string;
  project?: string;
  labels?: string[];
}

interface RuleAction {
  tags?: string[];
  priority?: string;
  repo_mapping_id?: number | null;
  flow_id?: string;
  agent_role?: string;
}

interface IntegrationRule {
  id: number;
  provider: Provider;
  name: string;
  match: RuleMatch;
  action: RuleAction;
  is_active: boolean;
  sort_order: number;
}

interface RepoMapping { id: number; provider: string; owner: string; repo_name: string }
interface RuleTestResult {
  found: boolean;
  external_id: string;
  title?: string;
  fields?: { project: string; type: string; reporter: string; labels: string[] };
  matched_rule_ids?: number[];
  action?: { tags: string[]; priority: string | null; repo_mapping_id: number | null; flow_id: string | null; agent_role: string | null };
}
interface JiraReporter { email: string; display_name: string }
interface JiraIssueType { name: string; icon_url: string | null }
interface JiraLabel { name: string }
interface JiraProject { key: string; name: string }
interface AzureUser { email: string; display_name: string }
interface AzureWorkItemType { name: string; color: string | null }
interface AzureProject { id: string; name: string }
interface AzureTag { name: string }

function ChipInput({
  values,
  onChange,
  suggestions,
  placeholder,
  inputStyle,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  inputStyle: React.CSSProperties;
}) {
  const [draft, setDraft] = useState('');
  const datalistId = `chip-suggest-${Math.abs(values.join(',').length + suggestions.length)}-${suggestions.length}`;

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };

  const remove = (v: string) => {
    onChange(values.filter((x) => x !== v));
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
      padding: '4px 6px', minHeight: 36,
      borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--surface)',
    }}>
      {values.map((v) => (
        <span key={v} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 6,
          background: 'var(--acc-soft)', border: '1px solid var(--panel-border)',
          color: 'var(--acc)', fontSize: 12, fontWeight: 700,
        }}>
          {v}
          <button
            type='button'
            onClick={() => remove(v)}
            style={{ background: 'transparent', border: 'none', color: 'var(--acc)', cursor: 'pointer', padding: 0, lineHeight: 1, opacity: 0.75, display: 'inline-flex' }}
          ><NavIcon name="close" size={12} /></button>
        </span>
      ))}
      <input
        list={suggestions.length > 0 ? datalistId : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
            if (draft.trim()) {
              e.preventDefault();
              add(draft);
            }
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            remove(values[values.length - 1]);
          }
        }}
        onBlur={() => { if (draft.trim()) add(draft); }}
        placeholder={values.length === 0 ? placeholder : ''}
        style={{
          ...inputStyle,
          flex: 1, minWidth: 120, border: 'none', background: 'transparent',
          padding: '4px 6px',
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={datalistId}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}


function Pill({ children, color = '#5b9bd5' }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 4,
      color, background: `${color}1f`,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

const PROVIDER_BRAND: Record<Provider, { icon: string; color: string; gradient: string }> = {
  jira: { icon: 'clipboard', color: '#5b9bd5', gradient: 'var(--panel-alt)' },
  azure: { icon: 'box', color: '#5b9bd5', gradient: 'var(--panel-alt)' },
};

export default function IntegrationRulesPage() {
  const { t } = useLocale();
  const [provider, setProvider] = useState<Provider>('jira');
  const [rules, setRules] = useState<IntegrationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [repos, setRepos] = useState<RepoMapping[]>([]);
  const [jiraReporters, setJiraReporters] = useState<JiraReporter[]>([]);
  const [jiraIssueTypes, setJiraIssueTypes] = useState<JiraIssueType[]>([]);
  const [jiraLabels, setJiraLabels] = useState<JiraLabel[]>([]);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [azureUsers, setAzureUsers] = useState<AzureUser[]>([]);
  const [azureWITypes, setAzureWITypes] = useState<AzureWorkItemType[]>([]);
  const [azureProjects, setAzureProjects] = useState<AzureProject[]>([]);
  const [azureTags, setAzureTags] = useState<AzureTag[]>([]);
  const [azureProject, setAzureProject] = useState<string>('');
  const [agentRoles, setAgentRoles] = useState<{ role: string; label: string }[]>([]);

  const [editingRule, setEditingRule] = useState<IntegrationRule | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const [testInput, setTestInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);

  useEffect(() => {
    void loadRules();
    void loadRepos();
    // Pull the user's configured agents so the rule editor can offer a
    // proper dropdown rather than a free-text box.
    loadPrefs()
      .then((prefs) => {
        const agents = (prefs.agents || []) as Array<{ role?: string; label?: string; enabled?: boolean }>;
        const roles = agents
          .filter((a) => a.role && a.enabled !== false)
          .map((a) => ({ role: String(a.role), label: String(a.label || a.role) }));
        if (roles.length > 0) {
          setAgentRoles(roles);
        } else {
          setAgentRoles(FALLBACK_AGENT_ROLES.map((r) => ({ role: r, label: r })));
        }
      })
      .catch(() => setAgentRoles(FALLBACK_AGENT_ROLES.map((r) => ({ role: r, label: r }))));
  }, []);

  useEffect(() => {
    if (!msg) return;
    const tm = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(tm);
  }, [msg]);

  useEffect(() => {
    if (provider !== 'jira') return;
    void apiFetch<JiraReporter[]>('/integrations/jira/reporters').then(setJiraReporters).catch(() => setJiraReporters([]));
    void apiFetch<JiraIssueType[]>('/integrations/jira/issuetypes').then(setJiraIssueTypes).catch(() => setJiraIssueTypes([]));
    void apiFetch<JiraLabel[]>('/integrations/jira/labels').then(setJiraLabels).catch(() => setJiraLabels([]));
    void apiFetch<JiraProject[]>('/integrations/jira/projects').then(setJiraProjects).catch(() => setJiraProjects([]));
  }, [provider]);

  useEffect(() => {
    if (provider !== 'azure') return;
    void apiFetch<AzureProject[]>('/integrations/azure/projects').then(setAzureProjects).catch(() => setAzureProjects([]));
    apiFetch<{ azure_project?: string | null }>('/preferences')
      .then((p) => {
        const proj = (p?.azure_project || '').trim();
        setAzureProject(proj);
        if (proj) {
          void apiFetch<AzureUser[]>(`/integrations/azure/users?project=${encodeURIComponent(proj)}`).then(setAzureUsers).catch(() => setAzureUsers([]));
          void apiFetch<AzureWorkItemType[]>(`/integrations/azure/work-item-types?project=${encodeURIComponent(proj)}`).then(setAzureWITypes).catch(() => setAzureWITypes([]));
          void apiFetch<AzureTag[]>(`/integrations/azure/tags?project=${encodeURIComponent(proj)}`).then(setAzureTags).catch(() => setAzureTags([]));
        }
      })
      .catch(() => {});
  }, [provider]);

  async function loadRules() {
    setLoading(true);
    try {
      const data = await apiFetch<IntegrationRule[]>('/integration-rules');
      setRules(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }

  async function loadRepos() {
    try {
      const data = await apiFetch<RepoMapping[]>('/repo-mappings');
      setRepos(data);
    } catch { /* ignore */ }
  }

  async function deleteRule(id: number) {
    try {
      await apiFetch(`/integration-rules/${id}`, { method: 'DELETE' });
      setMsg(t('integrationRules.deleted') || 'Rule deleted');
      void loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function toggleActive(rule: IntegrationRule) {
    try {
      await apiFetch(`/integration-rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      void loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  }

  function parseItemId(input: string): string {
    const s = input.trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) {
      const m = s.match(/([A-Za-z][A-Za-z0-9]*-\d+|\d+)(?:[/?#].*)?$/);
      if (m) return m[1];
      return s.split('/').filter(Boolean).pop() || '';
    }
    return s;
  }

  async function runTest() {
    const id = parseItemId(testInput);
    if (!id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<RuleTestResult>('/integration-rules/test', {
        method: 'POST',
        body: JSON.stringify({ provider, work_item_id: id }),
      });
      setTestResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  const filtered = rules.filter((r) => r.provider === provider);
  const brand = PROVIDER_BRAND[provider];

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 16,
  };
  const btnSmall: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--panel-border)',
    background: 'transparent', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  };

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <style>{`@keyframes rules-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Hero */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 10,
        border: '1px solid var(--panel-border)', background: 'var(--surface)',
        padding: '20px 22px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--panel-border)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--acc-soft)', border: '1px solid var(--panel-border)', color: 'var(--acc)',
          }}><NavIcon name={brand.icon} size={22} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', letterSpacing: -0.3 }}>
              {t('integrationRules.title') || 'Integration Rules'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.5 }}>
              {t('integrationRules.heroSubtitle') || 'Auto-tag and auto-route imported tasks based on reporter, issue type, project, or labels.'}
            </div>
          </div>
        </div>
      </div>

      {/* How it works — explainer */}
      <div style={{ borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: 'var(--acc)', display: 'inline-flex' }}><NavIcon name='alert' size={16} /></span>
          <span style={{ fontWeight: 600, color: 'var(--ink-90)', fontSize: 13 }}>{t('integrationRules.howTitle')}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-65)', lineHeight: 1.55, marginBottom: 12 }}>{t('integrationRules.howBody')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
          {[
            { icon: 'sliders', text: t('integrationRules.howMatch') },
            { icon: 'zap', text: t('integrationRules.howAction') },
            { icon: 'activity', text: t('integrationRules.howExample') },
          ].map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)' }}>
              <span style={{ color: 'var(--acc)', flexShrink: 0, marginTop: 1, display: 'inline-flex' }}><NavIcon name={b.icon} size={14} /></span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-72)', lineHeight: 1.5 }}>{b.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Floating toast */}
      {(msg || error) && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          zIndex: 9999, maxWidth: 'min(94vw, 460px)',
          padding: '12px 18px', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 700,
          color: error ? '#cf5b57' : '#3f9d6a',
          background: 'var(--surface)',
          border: `1px solid var(--panel-border)`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}>
          <span style={{ display: 'inline-flex' }}><NavIcon name={error ? 'alert' : 'activity'} size={16} /></span>
          <span style={{ flex: 1 }}>{error || msg}</span>
          <button onClick={() => { setError(''); setMsg(''); }} style={{ background: 'transparent', border: 'none', color: error ? '#cf5b57' : '#3f9d6a', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><NavIcon name="close" size={16} /></button>
        </div>,
        document.body
      )}

      {/* Provider tabs */}
      <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 4 }}>
        {(['jira', 'azure'] as const).map((p) => (
          <button key={p} onClick={() => setProvider(p)}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
              background: provider === p ? 'var(--acc)' : 'transparent',
              color: provider === p ? '#fff' : 'var(--ink-65)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <span style={{ display: 'inline-flex' }}><NavIcon name={PROVIDER_BRAND[p].icon} size={14} /></span>
            <span>{p === 'jira' ? 'Jira' : 'Azure DevOps'}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>({rules.filter((r) => r.provider === p).length})</span>
          </button>
        ))}
      </div>

      {/* Rules list */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>
            {(t('integrationRules.rulesCount') || '{n} Rules').replace('{n}', String(filtered.length))}
          </div>
          <button onClick={() => setShowAdd(true)} style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <NavIcon name="plus" size={14} /> {t('integrationRules.addRule') || 'Add rule'}
          </button>
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 16, textAlign: 'center' }}>{t('integrations.common.loading') || 'Loading...'}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', borderRadius: 10, background: 'var(--surface)', border: '1px dashed var(--panel-border)' }}>
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', color: 'var(--ink-42)' }}><NavIcon name="sliders" size={32} /></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)' }}>
              {t('integrationRules.emptyTitle') || 'No rules yet'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4, lineHeight: 1.5, maxWidth: 420, margin: '4px auto 0' }}>
              {t('integrationRules.emptyHint') || 'Add a rule to auto-tag tasks coming in from this provider — for example: tasks reported by your security team get a "security" tag and auto-route to the security review flow.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map((rule) => {
              const matchPills: { label: string; value: string; color: string }[] = [];
              if (rule.match.reporter) matchPills.push({ label: 'reporter', value: rule.match.reporter, color: '#5b9bd5' });
              if (rule.match.issue_type) matchPills.push({ label: 'type', value: rule.match.issue_type, color: '#5b9bd5' });
              if (rule.match.project) matchPills.push({ label: 'project', value: rule.match.project, color: '#3f9d6a' });
              if (rule.match.labels && rule.match.labels.length) matchPills.push({ label: 'labels', value: rule.match.labels.join(','), color: '#c98a2b' });
              return (
                <div key={rule.id} style={{
                  padding: '12px 14px', borderRadius: 10,
                  background: 'var(--surface)',
                  border: `1px solid ${rule.is_active ? 'var(--panel-border)' : 'var(--panel-border)'}`,
                  opacity: rule.is_active ? 1 : 0.55,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: rule.is_active ? 'var(--acc-soft)' : 'var(--panel-alt)',
                      border: `1px solid var(--panel-border)`,
                      color: rule.is_active ? 'var(--acc)' : 'var(--ink-42)',
                    }}><NavIcon name={rule.is_active ? 'zap' : 'dot'} size={14} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)' }}>{rule.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: 'var(--ink-35)' }}>{t('integrationRules.matches') || 'when'}</span>
                        {matchPills.map((p) => (
                          <Pill key={p.label} color={p.color}><span style={{ opacity: 0.7 }}>{p.label}=</span>{p.value}</Pill>
                        ))}
                        <span style={{ color: 'var(--ink-35)', marginLeft: 4 }}>{t('integrationRules.then') || '→'}</span>
                        {rule.action.tags && rule.action.tags.map((tg) => (
                          <Pill key={tg} color='#3f9d6a'>tag:{tg}</Pill>
                        ))}
                        {rule.action.priority && <Pill color='#cf5b57'>priority:{rule.action.priority}</Pill>}
                        {rule.action.repo_mapping_id != null && (() => {
                          const r = repos.find((x) => x.id === rule.action.repo_mapping_id);
                          return <Pill color='#5b9bd5'>repo:{r ? `${r.owner}/${r.repo_name}` : `#${rule.action.repo_mapping_id}`}</Pill>;
                        })()}
                        {rule.action.flow_id && <Pill color='#5b9bd5'>flow:{rule.action.flow_id}</Pill>}
                        {rule.action.agent_role && <Pill color='#c98a2b'>agent:{rule.action.agent_role}</Pill>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => void toggleActive(rule)} style={btnSmall}>
                        {rule.is_active ? (t('integrationRules.disable') || 'Disable') : (t('integrationRules.enable') || 'Enable')}
                      </button>
                      <button onClick={() => setEditingRule(rule)} style={{ ...btnSmall, display: 'inline-flex', alignItems: 'center' }}>
                        <NavIcon name="pencil" size={14} />
                      </button>
                      <button onClick={() => void deleteRule(rule.id)} style={{ ...btnSmall, color: '#cf5b57', borderColor: 'var(--panel-border)', display: 'inline-flex', alignItems: 'center' }}>
                        <NavIcon name="close" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Test against a live item (dry-run, no import) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: 'var(--acc)', display: 'inline-flex' }}><NavIcon name='activity' size={16} /></span>
          <span style={{ fontWeight: 600, color: 'var(--ink-90)', fontSize: 13 }}>{t('integrationRules.testTitle')}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-58)', lineHeight: 1.5, marginBottom: 10 }}>{t('integrationRules.testHint')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runTest(); }}
            placeholder={provider === 'jira' ? 'PROJ-123  ·  https://…/browse/PROJ-123' : '63318  ·  https://dev.azure.com/…/_workitems/edit/63318'}
            style={{ flex: 1, minWidth: 240, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--surface)', color: 'var(--ink-90)', fontSize: 13 }}
          />
          <button onClick={() => void runTest()} disabled={testing || !testInput.trim()} style={{ ...btnPrimary, opacity: testing || !testInput.trim() ? 0.5 : 1 }}>
            {testing ? '…' : t('integrationRules.testBtn')}
          </button>
        </div>
        {testResult && (testResult.found ? (
          <div style={{ marginTop: 12, border: '1px solid var(--panel-border)', borderRadius: 8, background: 'var(--surface)', padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', marginBottom: 6 }}>#{testResult.external_id} {testResult.title}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {testResult.fields?.project && <Pill color='#3f9d6a'><span style={{ opacity: 0.7 }}>project=</span>{testResult.fields.project}</Pill>}
              {testResult.fields?.type && <Pill color='#5b9bd5'><span style={{ opacity: 0.7 }}>type=</span>{testResult.fields.type}</Pill>}
              {testResult.fields?.reporter && <Pill color='#5b9bd5'><span style={{ opacity: 0.7 }}>reporter=</span>{testResult.fields.reporter}</Pill>}
              {testResult.fields?.labels?.map((l) => <Pill key={l} color='#c98a2b'>{l}</Pill>)}
            </div>
            {(testResult.matched_rule_ids?.length ?? 0) === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink-50)' }}>{t('integrationRules.testNoMatch')}</div>
            ) : (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{t('integrationRules.testMatched')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {testResult.matched_rule_ids!.map((id) => { const r = rules.find((x) => x.id === id); return <Pill key={id} color='#5b9bd5'>{r ? r.name : `#${id}`}</Pill>; })}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 6 }}>{t('integrationRules.testWillApply')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {testResult.action?.tags?.map((tg) => <Pill key={tg} color='#3f9d6a'>tag:{tg}</Pill>)}
                  {testResult.action?.priority && <Pill color='#cf5b57'>priority:{testResult.action.priority}</Pill>}
                  {testResult.action?.repo_mapping_id != null && (() => { const r = repos.find((x) => x.id === testResult.action!.repo_mapping_id); return <Pill color='#5b9bd5'>repo:{r ? `${r.owner}/${r.repo_name}` : `#${testResult.action!.repo_mapping_id}`}</Pill>; })()}
                  {testResult.action?.agent_role && <Pill color='#c98a2b'>agent:{testResult.action.agent_role}</Pill>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 12, color: '#cf5b57' }}>{t('integrationRules.testNotFound')}</div>
        ))}
      </div>

      {(showAdd || editingRule) && typeof document !== 'undefined' && createPortal(
        <RuleEditor
          provider={provider}
          existing={editingRule}
          repos={repos}
          jiraReporters={jiraReporters}
          jiraIssueTypes={jiraIssueTypes}
          jiraLabels={jiraLabels}
          jiraProjects={jiraProjects}
          azureUsers={azureUsers}
          azureWITypes={azureWITypes}
          azureProjects={azureProjects}
          azureTags={azureTags}
          agentRoles={agentRoles}
          onClose={() => { setShowAdd(false); setEditingRule(null); }}
          onSaved={() => {
            setShowAdd(false);
            setEditingRule(null);
            setMsg(t('integrationRules.saved') || 'Rule saved');
            void loadRules();
          }}
          setError={setError}
        />,
        document.body,
      )}
    </div>
  );
}

function RuleEditor({ provider, existing, repos, jiraReporters, jiraIssueTypes, jiraLabels, jiraProjects, azureUsers, azureWITypes, azureProjects, azureTags, agentRoles, onClose, onSaved, setError }: {
  provider: Provider;
  existing: IntegrationRule | null;
  repos: RepoMapping[];
  jiraReporters: JiraReporter[];
  jiraIssueTypes: JiraIssueType[];
  jiraLabels: JiraLabel[];
  jiraProjects: JiraProject[];
  azureUsers: AzureUser[];
  azureWITypes: AzureWorkItemType[];
  azureProjects: AzureProject[];
  azureTags: AzureTag[];
  agentRoles: { role: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
  setError: (s: string) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(existing?.name ?? '');
  const [reporter, setReporter] = useState(existing?.match.reporter ?? '');
  const [issueType, setIssueType] = useState(existing?.match.issue_type ?? '');
  const [project, setProject] = useState(existing?.match.project ?? '');
  const [labels, setLabels] = useState<string[]>(existing?.match.labels || []);
  const [tags, setTags] = useState<string[]>(existing?.action.tags || []);
  const [priority, setPriority] = useState(existing?.action.priority ?? '');
  const [repoMappingId, setRepoMappingId] = useState<string>(existing?.action.repo_mapping_id ? String(existing.action.repo_mapping_id) : '');
  const [agentRole, setAgentRole] = useState(existing?.action.agent_role ?? '');
  const [saving, setSaving] = useState(false);

  const reporterList = provider === 'jira' ? jiraReporters.map((r) => ({ value: r.email || r.display_name, label: r.display_name + (r.email ? ` (${r.email})` : '') })) : azureUsers.map((u) => ({ value: u.email || u.display_name, label: u.display_name + (u.email ? ` (${u.email})` : '') }));
  const typeList = provider === 'jira' ? jiraIssueTypes.map((i) => i.name) : azureWITypes.map((t) => t.name);

  async function save() {
    setSaving(true);
    try {
      const body = {
        provider,
        name: name.trim(),
        match: {
          reporter: reporter.trim() || undefined,
          issue_type: issueType.trim() || undefined,
          project: project.trim() || undefined,
          labels: labels.length ? labels : undefined,
        },
        action: {
          tags,
          priority: priority || undefined,
          repo_mapping_id: repoMappingId ? parseInt(repoMappingId) : undefined,
          agent_role: agentRole.trim() || undefined,
        },
        is_active: existing?.is_active ?? true,
        sort_order: existing?.sort_order ?? 100,
      };
      if (existing) {
        await apiFetch(`/integration-rules/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/integration-rules', { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)',
    background: 'var(--surface)', color: 'var(--ink-90)', fontSize: 13,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4, display: 'block',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)' }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10,
        width: 'min(640px, calc(100vw - 32px))', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)' }}>
              {existing ? (t('integrationRules.editRule') || 'Edit rule') : (t('integrationRules.addRule') || 'Add rule')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-45)', marginTop: 2 }}>
              {provider === 'jira' ? 'Jira' : 'Azure DevOps'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-58)', display: 'inline-flex', alignItems: 'center' }}><NavIcon name="close" size={18} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'grid', gap: 14 }}>
          <div>
            <label style={labelStyle}>{t('integrationRules.fieldName') || 'Rule name'}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle}
              placeholder={t('integrationRules.namePlaceholder') || 'e.g. Security tasks → security tag'} />
          </div>

          <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-58)', marginBottom: 8 }}>
              {t('integrationRules.matchSection') || 'Match (when ALL filled fields match)'}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={labelStyle}>{provider === 'jira' ? (t('integrationRules.reporter') || 'Reporter') : (t('integrationRules.createdBy') || 'Created by')}</label>
                <select value={reporter} onChange={(e) => setReporter(e.target.value)} style={inputStyle}>
                  <option value=''>—</option>
                  {reporterList.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{provider === 'jira' ? (t('integrationRules.issueType') || 'Issue type') : (t('integrationRules.workItemType') || 'Work item type')}</label>
                <select value={issueType} onChange={(e) => setIssueType(e.target.value)} style={inputStyle}>
                  <option value=''>—</option>
                  {typeList.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('integrationRules.project') || 'Project key / name'}</label>
                {provider === 'jira' && jiraProjects.length > 0 ? (
                  <select value={project} onChange={(e) => setProject(e.target.value)} style={inputStyle}>
                    <option value=''>—</option>
                    {jiraProjects.map((p) => (
                      <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
                    ))}
                  </select>
                ) : provider === 'azure' && azureProjects.length > 0 ? (
                  <select value={project} onChange={(e) => setProject(e.target.value)} style={inputStyle}>
                    <option value=''>—</option>
                    {azureProjects.map((p) => (
                      <option key={p.id || p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <input value={project} onChange={(e) => setProject(e.target.value)} style={inputStyle} placeholder='e.g. SEC' />
                )}
              </div>
              <div>
                <label style={labelStyle}>{t('integrationRules.labels') || 'Labels'}</label>
                <ChipInput
                  values={labels}
                  onChange={setLabels}
                  suggestions={provider === 'jira' ? jiraLabels.map((l) => l.name) : provider === 'azure' ? azureTags.map((t) => t.name) : []}
                  placeholder={provider === 'jira' ? (t('integrationRules.labelsPlaceholderJira') || 'Pick or type a label') : provider === 'azure' ? (t('integrationRules.labelsPlaceholderAzure') || 'Pick or type a tag') : (t('integrationRules.labelsPlaceholder') || 'security, urgent')}
                  inputStyle={inputStyle}
                />
                {((provider === 'jira' && jiraLabels.length === 0) || (provider === 'azure' && azureTags.length === 0)) && (
                  <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 4 }}>
                    {provider === 'azure'
                      ? (t('integrationRules.tagsHintAzure') || 'Suggestions appear after Azure tags load (requires a default project in /dashboard/sprints).')
                      : (t('integrationRules.labelsHint') || 'Suggestions appear after Jira labels load.')}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-58)', marginBottom: 8 }}>
              {t('integrationRules.actionSection') || 'Then do'}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={labelStyle}>{t('integrationRules.tags') || 'Apply tags'}</label>
                <ChipInput
                  values={tags}
                  onChange={setTags}
                  suggestions={[]}
                  placeholder={t('integrationRules.tagsPlaceholder') || 'security_review, p0'}
                  inputStyle={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('integrationRules.priorityOverride') || 'Priority override'}</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={inputStyle}>
                  <option value=''>{t('integrationRules.noChange') || '— no change —'}</option>
                  <option value='critical'>critical</option>
                  <option value='high'>high</option>
                  <option value='medium'>medium</option>
                  <option value='low'>low</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('integrationRules.repoOverride') || 'Route to repo'}</label>
                <select value={repoMappingId} onChange={(e) => setRepoMappingId(e.target.value)} style={inputStyle}>
                  <option value=''>{t('integrationRules.noChange') || '— no change —'}</option>
                  {repos.map((r) => <option key={r.id} value={String(r.id)}>{r.provider}:{r.owner}/{r.repo_name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('integrationRules.agentRole') || 'Agent role'}</label>
                <select value={agentRole} onChange={(e) => setAgentRole(e.target.value)} style={inputStyle}>
                  <option value=''>{t('integrationRules.noChange') || '— no change —'}</option>
                  {agentRoles.map((a) => <option key={a.role} value={a.role}>{a.label} ({a.role})</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--ink-58)', fontSize: 12, cursor: 'pointer' }}>
            {t('integrations.common.cancel') || 'Cancel'}
          </button>
          <button onClick={() => void save()} disabled={saving || !name.trim()}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving || !name.trim() ? 0.5 : 1 }}>
            {saving ? '…' : (t('integrationRules.save') || 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
