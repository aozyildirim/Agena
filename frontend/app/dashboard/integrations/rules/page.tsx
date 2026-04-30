'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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
interface JiraReporter { email: string; display_name: string }
interface JiraIssueType { name: string; icon_url: string | null }
interface AzureUser { email: string; display_name: string }
interface AzureWorkItemType { name: string; color: string | null }

function Pill({ children, color = '#94a3b8' }: { children: React.ReactNode; color?: string }) {
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
  jira: { icon: '📋', color: '#0052cc', gradient: 'linear-gradient(135deg, rgba(0,82,204,0.20), rgba(38,132,255,0.12) 60%, rgba(56,189,248,0.08))' },
  azure: { icon: '☁️', color: '#0078d4', gradient: 'linear-gradient(135deg, rgba(0,120,212,0.20), rgba(56,189,248,0.12) 60%, rgba(28,231,131,0.06))' },
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
  const [azureUsers, setAzureUsers] = useState<AzureUser[]>([]);
  const [azureWITypes, setAzureWITypes] = useState<AzureWorkItemType[]>([]);
  const [azureProject, setAzureProject] = useState<string>('');

  const [editingRule, setEditingRule] = useState<IntegrationRule | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    void loadRules();
    void loadRepos();
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
  }, [provider]);

  useEffect(() => {
    if (provider !== 'azure') return;
    apiFetch<{ azure_project?: string | null }>('/preferences')
      .then((p) => {
        const proj = (p?.azure_project || '').trim();
        setAzureProject(proj);
        if (proj) {
          void apiFetch<AzureUser[]>(`/integrations/azure/users?project=${encodeURIComponent(proj)}`).then(setAzureUsers).catch(() => setAzureUsers([]));
          void apiFetch<AzureWorkItemType[]>(`/integrations/azure/work-item-types?project=${encodeURIComponent(proj)}`).then(setAzureWITypes).catch(() => setAzureWITypes([]));
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

  const filtered = rules.filter((r) => r.provider === provider);
  const brand = PROVIDER_BRAND[provider];

  const cardStyle: React.CSSProperties = {
    background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 16,
  };
  const btnSmall: React.CSSProperties = {
    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--panel-border)',
    background: 'transparent', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 8, border: 'none', background: brand.color, color: '#fff',
    fontSize: 12, fontWeight: 700, cursor: 'pointer',
  };

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <style>{`@keyframes rules-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Hero */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 16,
        border: '1px solid var(--panel-border)', background: 'var(--panel)',
        backgroundImage: brand.gradient, padding: '20px 22px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${brand.color}, ${brand.color}99, #1CE783)` }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${brand.color}29`, border: `1px solid ${brand.color}66`, fontSize: 22,
          }}>{brand.icon}</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', letterSpacing: -0.3 }}>
              {t('integrationRules.title') || 'Integration Rules'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.5 }}>
              {t('integrationRules.heroSubtitle') || 'Auto-tag and auto-route imported tasks based on reporter, issue type, project, or labels.'}
            </div>
          </div>
        </div>
      </div>

      {/* Floating toast */}
      {(msg || error) && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          zIndex: 9999, maxWidth: 'min(94vw, 460px)',
          padding: '12px 18px', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 700,
          color: error ? '#fecaca' : '#bbf7d0',
          background: error ? 'rgba(127,29,29,0.95)' : 'rgba(20,83,45,0.95)',
          border: `1px solid ${error ? 'rgba(248,113,113,0.4)' : 'rgba(34,197,94,0.4)'}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(8px)',
        }}>
          <span>{error ? '✗' : '✓'}</span>
          <span style={{ flex: 1 }}>{error || msg}</span>
          <button onClick={() => { setError(''); setMsg(''); }} style={{ background: 'transparent', border: 'none', color: error ? '#fca5a5' : '#86efac', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
        </div>,
        document.body
      )}

      {/* Provider tabs */}
      <div style={{ display: 'flex', gap: 0, background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 4 }}>
        {(['jira', 'azure'] as const).map((p) => (
          <button key={p} onClick={() => setProvider(p)}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
              background: provider === p ? PROVIDER_BRAND[p].color : 'transparent',
              color: provider === p ? '#fff' : 'var(--ink-58)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <span>{PROVIDER_BRAND[p].icon}</span>
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
          <button onClick={() => setShowAdd(true)} style={btnPrimary}>
            + {t('integrationRules.addRule') || 'Add rule'}
          </button>
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 16, textAlign: 'center' }}>{t('integrations.common.loading') || 'Loading...'}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', borderRadius: 12, background: 'var(--glass)', border: '1px dashed var(--panel-border)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
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
              if (rule.match.reporter) matchPills.push({ label: 'reporter', value: rule.match.reporter, color: '#a78bfa' });
              if (rule.match.issue_type) matchPills.push({ label: 'type', value: rule.match.issue_type, color: '#60a5fa' });
              if (rule.match.project) matchPills.push({ label: 'project', value: rule.match.project, color: '#22c55e' });
              if (rule.match.labels && rule.match.labels.length) matchPills.push({ label: 'labels', value: rule.match.labels.join(','), color: '#f59e0b' });
              return (
                <div key={rule.id} style={{
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--glass)',
                  border: `1px solid ${rule.is_active ? 'var(--panel-border)' : 'var(--panel-border)'}`,
                  opacity: rule.is_active ? 1 : 0.55,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: rule.is_active ? 'rgba(28,231,131,0.12)' : 'rgba(148,163,184,0.10)',
                      border: `1px solid ${rule.is_active ? 'rgba(28,231,131,0.30)' : 'var(--panel-border)'}`,
                      fontSize: 14,
                    }}>{rule.is_active ? '⚡' : '⏸'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{rule.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: 'var(--ink-35)' }}>{t('integrationRules.matches') || 'when'}</span>
                        {matchPills.map((p) => (
                          <Pill key={p.label} color={p.color}><span style={{ opacity: 0.7 }}>{p.label}=</span>{p.value}</Pill>
                        ))}
                        <span style={{ color: 'var(--ink-35)', marginLeft: 4 }}>{t('integrationRules.then') || '→'}</span>
                        {rule.action.tags && rule.action.tags.map((tg) => (
                          <Pill key={tg} color='#22c55e'>tag:{tg}</Pill>
                        ))}
                        {rule.action.priority && <Pill color='#ef4444'>priority:{rule.action.priority}</Pill>}
                        {rule.action.repo_mapping_id != null && (() => {
                          const r = repos.find((x) => x.id === rule.action.repo_mapping_id);
                          return <Pill color='#60a5fa'>repo:{r ? `${r.owner}/${r.repo_name}` : `#${rule.action.repo_mapping_id}`}</Pill>;
                        })()}
                        {rule.action.flow_id && <Pill color='#8b5cf6'>flow:{rule.action.flow_id}</Pill>}
                        {rule.action.agent_role && <Pill color='#f59e0b'>agent:{rule.action.agent_role}</Pill>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => void toggleActive(rule)} style={btnSmall}>
                        {rule.is_active ? (t('integrationRules.disable') || 'Disable') : (t('integrationRules.enable') || 'Enable')}
                      </button>
                      <button onClick={() => setEditingRule(rule)} style={btnSmall}>
                        ✏️
                      </button>
                      <button onClick={() => void deleteRule(rule.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.2)' }}>
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(showAdd || editingRule) && typeof document !== 'undefined' && createPortal(
        <RuleEditor
          provider={provider}
          existing={editingRule}
          repos={repos}
          jiraReporters={jiraReporters}
          jiraIssueTypes={jiraIssueTypes}
          azureUsers={azureUsers}
          azureWITypes={azureWITypes}
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

function RuleEditor({ provider, existing, repos, jiraReporters, jiraIssueTypes, azureUsers, azureWITypes, onClose, onSaved, setError }: {
  provider: Provider;
  existing: IntegrationRule | null;
  repos: RepoMapping[];
  jiraReporters: JiraReporter[];
  jiraIssueTypes: JiraIssueType[];
  azureUsers: AzureUser[];
  azureWITypes: AzureWorkItemType[];
  onClose: () => void;
  onSaved: () => void;
  setError: (s: string) => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(existing?.name ?? '');
  const [reporter, setReporter] = useState(existing?.match.reporter ?? '');
  const [issueType, setIssueType] = useState(existing?.match.issue_type ?? '');
  const [project, setProject] = useState(existing?.match.project ?? '');
  const [labelsInput, setLabelsInput] = useState((existing?.match.labels || []).join(','));
  const [tagsInput, setTagsInput] = useState((existing?.action.tags || []).join(','));
  const [priority, setPriority] = useState(existing?.action.priority ?? '');
  const [repoMappingId, setRepoMappingId] = useState<string>(existing?.action.repo_mapping_id ? String(existing.action.repo_mapping_id) : '');
  const [agentRole, setAgentRole] = useState(existing?.action.agent_role ?? '');
  const [saving, setSaving] = useState(false);

  const reporterList = provider === 'jira' ? jiraReporters.map((r) => ({ value: r.email || r.display_name, label: r.display_name + (r.email ? ` (${r.email})` : '') })) : azureUsers.map((u) => ({ value: u.email || u.display_name, label: u.display_name + (u.email ? ` (${u.email})` : '') }));
  const typeList = provider === 'jira' ? jiraIssueTypes.map((i) => i.name) : azureWITypes.map((t) => t.name);

  async function save() {
    setSaving(true);
    try {
      const labelsArr = labelsInput.split(',').map((s) => s.trim()).filter(Boolean);
      const tagsArr = tagsInput.split(',').map((s) => s.trim()).filter(Boolean);
      const body = {
        provider,
        name: name.trim(),
        match: {
          reporter: reporter.trim() || undefined,
          issue_type: issueType.trim() || undefined,
          project: project.trim() || undefined,
          labels: labelsArr.length ? labelsArr : undefined,
        },
        action: {
          tags: tagsArr,
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
    background: 'var(--glass)', color: 'var(--ink)', fontSize: 13,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 4, display: 'block',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)' }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 14,
        width: 'min(640px, calc(100vw - 32px))', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>
              {existing ? (t('integrationRules.editRule') || 'Edit rule') : (t('integrationRules.addRule') || 'Add rule')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-45)', marginTop: 2 }}>
              {provider === 'jira' ? 'Jira' : 'Azure DevOps'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--ink-58)' }}>×</button>
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
                <input value={project} onChange={(e) => setProject(e.target.value)} style={inputStyle} placeholder='e.g. SEC' />
              </div>
              <div>
                <label style={labelStyle}>{t('integrationRules.labels') || 'Labels (comma separated)'}</label>
                <input value={labelsInput} onChange={(e) => setLabelsInput(e.target.value)} style={inputStyle} placeholder='security,urgent' />
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-58)', marginBottom: 8 }}>
              {t('integrationRules.actionSection') || 'Then do'}
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label style={labelStyle}>{t('integrationRules.tags') || 'Apply tags (comma separated)'}</label>
                <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} style={inputStyle} placeholder='security_review,p0' />
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
                <input value={agentRole} onChange={(e) => setAgentRole(e.target.value)} style={inputStyle} placeholder='reviewer / qa / lead_developer' />
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'transparent', color: 'var(--ink-58)', fontSize: 12, cursor: 'pointer' }}>
            {t('integrations.common.cancel') || 'Cancel'}
          </button>
          <button onClick={() => void save()} disabled={saving || !name.trim()}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: PROVIDER_BRAND[provider].color, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving || !name.trim() ? 0.5 : 1 }}>
            {saving ? '…' : (t('integrationRules.save') || 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
