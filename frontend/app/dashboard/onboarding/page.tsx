'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, loadPrefs, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import RemoteRepoSelector, { type RemoteRepoSelection } from '@/components/RemoteRepoSelector';

const TOTAL_STEPS = 6;

const cardStyle: React.CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(20px)',
  border: '1px solid var(--panel-border)',
  borderRadius: 16,
  padding: '40px 36px',
  maxWidth: 560,
  width: '100%',
  margin: '0 auto',
};

const btnPrimary: React.CSSProperties = {
  padding: '12px 32px',
  borderRadius: 12,
  border: 'none',
  background: 'linear-gradient(135deg, #0d9488, #22c55e)',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'opacity 0.2s',
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: 12,
  border: '1px solid var(--panel-border)',
  background: 'transparent',
  color: 'var(--muted)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--panel-border)',
  background: 'var(--panel-alt, rgba(255,255,255,0.04))',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--panel-border)',
  background: 'var(--panel-alt, rgba(255,255,255,0.04))',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none',
  appearance: 'none' as const,
};

function StepIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useLocale();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i + 1 === current ? 36 : 12,
            height: 6,
            borderRadius: 3,
            background: i + 1 <= current
              ? 'linear-gradient(90deg, #0d9488, #22c55e)'
              : 'var(--panel-border)',
            transition: 'all 0.3s ease',
          }}
        />
      ))}
      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
        {t('onboarding.step')} {current}{t('onboarding.of')}{total}
      </span>
    </div>
  );
}

/* ────── Step 1: Welcome ────── */
function StepWelcome({ onNext }: { onNext: () => void }) {
  const { t } = useLocale();
  return (
    <div style={cardStyle}>
      <StepIndicator current={1} total={TOTAL_STEPS} />
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚀</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
          {t('onboarding.welcome.title')}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.6, marginTop: 12, maxWidth: 420, margin: '12px auto 0' }}>
          {t('onboarding.welcome.subtitle')}
        </p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={onNext} style={btnPrimary}>
          {t('onboarding.welcome.start')}
        </button>
      </div>
    </div>
  );
}

/* ────── Step 2: Connect Integration ────── */
function StepIntegration({ onNext, onSkip }: { onNext: (provider: 'azure' | 'jira' | null) => void; onSkip: () => void }) {
  const { t } = useLocale();
  const [provider, setProvider] = useState<'azure' | 'jira' | null>(null);
  const [azureOrg, setAzureOrg] = useState('');
  const [azureProject, setAzureProject] = useState('');
  const [azurePat, setAzurePat] = useState('');
  const [jiraUrl, setJiraUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [azureHasSecret, setAzureHasSecret] = useState(false);
  const [jiraHasSecret, setJiraHasSecret] = useState(false);

  // Pre-fill Azure / Jira fields from already-saved integration configs so
  // onboarding doesn't ask the user to re-enter values they've already given.
  useEffect(() => {
    apiFetch<Array<{ provider: string; base_url?: string; project?: string | null; username?: string | null; has_secret?: boolean }>>('/integrations')
      .then((items) => {
        const azure = items.find((c) => c.provider === 'azure');
        if (azure) {
          if (azure.base_url) setAzureOrg(azure.base_url);
          if (azure.project) setAzureProject(azure.project);
          if (azure.has_secret) {
            setAzureHasSecret(true);
            setProvider('azure');
          }
        }
        const jira = items.find((c) => c.provider === 'jira');
        if (jira) {
          if (jira.base_url) setJiraUrl(jira.base_url);
          if (jira.username) setJiraEmail(jira.username);
          if (jira.has_secret) {
            setJiraHasSecret(true);
            if (!azure?.has_secret) setProvider('jira');
          }
        }
      })
      .catch(() => { /* silent — onboarding still works empty */ });
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      if (provider === 'azure') {
        // Don't send the secret if the user left the field blank — backend
        // keeps the existing PAT in that case. Only submit a new one if typed.
        const body: Record<string, unknown> = { base_url: azureOrg, project: azureProject };
        if (azurePat.trim()) body.secret = azurePat;
        await apiFetch('/integrations/azure', { method: 'PUT', body: JSON.stringify(body) });
      } else if (provider === 'jira') {
        const body: Record<string, unknown> = { base_url: jiraUrl, username: jiraEmail };
        if (jiraToken.trim()) body.secret = jiraToken;
        await apiFetch('/integrations/jira', { method: 'PUT', body: JSON.stringify(body) });
      }
      setSuccess(t('onboarding.integration.saved'));
      const connectedProvider = provider;
      setTimeout(() => onNext(connectedProvider), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('onboarding.integration.failed'));
    } finally {
      setSaving(false);
    }
  }

  // Allow save when the secret already exists (keep-existing mode), even if
  // the input is blank.
  const canSave = provider === 'azure'
    ? !!azureOrg.trim() && (!!azurePat.trim() || azureHasSecret)
    : provider === 'jira'
      ? !!jiraUrl.trim() && (!!jiraToken.trim() || jiraHasSecret)
      : false;

  return (
    <div style={cardStyle}>
      <StepIndicator current={2} total={TOTAL_STEPS} />
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔌</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          {t('onboarding.integration.title')}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8 }}>
          {t('onboarding.integration.subtitle')}
        </p>
      </div>

      {/* Provider selection */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, justifyContent: 'center' }}>
        {(['azure', 'jira'] as const).map((p) => (
          <button
            key={p}
            onClick={() => { setProvider(p); setError(''); setSuccess(''); }}
            style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: provider === p ? '2px solid #0d9488' : '1px solid var(--panel-border)',
              background: provider === p ? 'rgba(13,148,136,0.12)' : 'var(--glass)',
              color: provider === p ? '#0d9488' : 'var(--muted)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {p === 'azure' ? '🔷 ' : '🔵 '}
            {t(`onboarding.integration.${p}`)}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
        {/* Azure form */}
        {provider === 'azure' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                {t('onboarding.integration.orgUrl')}
              </label>
              <input
                style={inputStyle}
                placeholder={t('onboarding.integration.orgUrlPlaceholder')}
                value={azureOrg}
                onChange={(e) => setAzureOrg(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                {t('onboarding.integration.project')}
              </label>
              <input
                style={inputStyle}
                placeholder={t('onboarding.integration.projectPlaceholder')}
                value={azureProject}
                onChange={(e) => setAzureProject(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                {t('onboarding.integration.pat')}
              </label>
              <input
                style={inputStyle}
                type="password"
                placeholder={azureHasSecret ? (t('integrations.keepExistingSecret') || '•••• (keep existing)') : t('onboarding.integration.patPlaceholder')}
                value={azurePat}
                onChange={(e) => setAzurePat(e.target.value)}
              />
              {azureHasSecret && (
                <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4 }}>
                  {t('integrations.secretSavedHint') || 'Secret already saved — leave blank to keep existing.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Jira form */}
        {provider === 'jira' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                {t('onboarding.integration.jiraUrl')}
              </label>
              <input
                style={inputStyle}
                placeholder={t('onboarding.integration.jiraUrlPlaceholder')}
                value={jiraUrl}
                onChange={(e) => setJiraUrl(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                {t('onboarding.integration.jiraEmail')}
              </label>
              <input
                style={inputStyle}
                type="email"
                placeholder={t('onboarding.integration.jiraEmailPlaceholder')}
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                {t('onboarding.integration.jiraToken')}
              </label>
              <input
                style={inputStyle}
                type="password"
                placeholder={jiraHasSecret ? (t('integrations.keepExistingSecret') || '•••• (keep existing)') : t('onboarding.integration.jiraTokenPlaceholder')}
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
              />
              {jiraHasSecret && (
                <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4 }}>
                  {t('integrations.secretSavedHint') || 'Secret already saved — leave blank to keep existing.'}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 13 }}>
            {success}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
          <button type='button' onClick={onSkip} style={btnSecondary}>
            {t('onboarding.integration.skip')}
          </button>
          {provider && (
            <button
              type='submit'
              disabled={!canSave || saving}
              style={{ ...btnPrimary, opacity: !canSave || saving ? 0.5 : 1 }}
            >
              {saving ? t('onboarding.integration.saving') : t('onboarding.integration.save')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/* ────── Step 3: Sprint Selection (Azure only) ────── */
function StepSprint({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { t } = useLocale();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [sprints, setSprints] = useState<{ id: string; name: string; path?: string }[]>([]);
  const [project, setProject] = useState('');
  const [team, setTeam] = useState('');
  const [sprint, setSprint] = useState('');
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ id: string; name: string }[]>('/tasks/azure/projects')
      .then(setProjects)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setTeam('');
    setTeams([]);
    setSprint('');
    setSprints([]);
    if (!project) return;
    setLoadingTeams(true);
    apiFetch<{ id: string; name: string }[]>('/tasks/azure/teams?project=' + encodeURIComponent(project))
      .then(setTeams)
      .catch(() => {})
      .finally(() => setLoadingTeams(false));
  }, [project]);

  useEffect(() => {
    setSprint('');
    setSprints([]);
    if (!project || !team) return;
    setLoadingSprints(true);
    apiFetch<{ id: string; name: string; path?: string }[]>('/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team))
      .then(setSprints)
      .catch(() => {})
      .finally(() => setLoadingSprints(false));
  }, [project, team]);

  async function handleSave() {
    setSaving(true);
    try {
      const selectedSprint = sprints.find((s) => (s.path ?? s.name) === sprint);
      localStorage.setItem('agena_sprint_project', project);
      localStorage.setItem('agena_sprint_team', team);
      localStorage.setItem('agena_sprint_path', sprint);
      await savePrefs({
        azure_project: project,
        azure_team: team,
        azure_sprint_path: selectedSprint?.path ?? sprint,
      });
      onNext();
    } catch {
      // best-effort
      onNext();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={cardStyle}>
      <StepIndicator current={3} total={TOTAL_STEPS} />
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏃</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          {t('onboarding.selectSprint')}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8 }}>
          {t('onboarding.selectSprintDesc')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Project */}
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
            {t('onboarding.selectProject')}
          </label>
          <select
            style={selectStyle}
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">{t('onboarding.selectProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Team */}
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
            {project ? t('onboarding.selectTeam') : t('onboarding.selectTeamFirst')}
          </label>
          <select
            style={{ ...selectStyle, opacity: !project || loadingTeams ? 0.5 : 1 }}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            disabled={!project || loadingTeams}
          >
            <option value="">{project ? t('onboarding.selectTeam') : t('onboarding.selectTeamFirst')}</option>
            {teams.map((tm) => (
              <option key={tm.id} value={tm.name}>{tm.name}</option>
            ))}
          </select>
        </div>

        {/* Sprint */}
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
            {team ? t('onboarding.selectSprint2') : t('onboarding.selectSprintFirst')}
          </label>
          <select
            style={{ ...selectStyle, opacity: !team || loadingSprints ? 0.5 : 1 }}
            value={sprint}
            onChange={(e) => setSprint(e.target.value)}
            disabled={!team || loadingSprints}
          >
            <option value="">{team ? t('onboarding.selectSprint2') : t('onboarding.selectSprintFirst')}</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.path ?? s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
        <button onClick={onSkip} style={btnSecondary}>
          {t('onboarding.skipSprint')}
        </button>
        {sprint && (
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}
          >
            {saving ? '...' : t('onboarding.integration.save')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ────── Step 4: Repo Selection ────── */
function StepRepo({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { t } = useLocale();
  const [selection, setSelection] = useState<RemoteRepoSelection | null>(null);

  function handleSave() {
    if (selection) {
      localStorage.setItem('agena_default_repo', JSON.stringify(selection));
      const mapping = {
        id: `${selection.provider}-${selection.repo}`,
        name: selection.repo,
        local_path: '',
        provider: selection.provider,
        ...(selection.provider === 'azure' ? { azure_project: selection.project || '', azure_repo_name: selection.repo } : {}),
        ...(selection.provider === 'github' ? { github_repo_full_name: selection.repo } : {}),
        default_branch: selection.branch,
      };
      savePrefs({ repo_mappings: [mapping] }).catch(() => {});
    }
    onNext();
  }

  return (
    <div style={cardStyle}>
      <StepIndicator current={4} total={TOTAL_STEPS} />
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          {t('onboarding.repo.title')}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8 }}>
          {t('onboarding.repo.subtitle')}
        </p>
      </div>

      <RemoteRepoSelector onChange={setSelection} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
        <button onClick={onSkip} style={btnSecondary}>
          {t('onboarding.repo.skip')}
        </button>
        {selection && (
          <button onClick={handleSave} style={btnPrimary}>
            {t('onboarding.integration.save')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ────── Step 5: Agent Selection ────── */
const MODELS_MAP: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro'],
};

function StepAgent({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { t } = useLocale();
  const [provider, setProvider] = useState<string>('openai');
  const [model, setModel] = useState<string>('gpt-4o');

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    setModel(MODELS_MAP[newProvider]?.[0] ?? '');
  }

  function handleSave() {
    const config = [
      {
        role: 'developer',
        label: 'Developer',
        icon: '\u{1F468}\u200D\u{1F4BB}',
        provider,
        model,
        custom_model: '',
        enabled: true,
        create_pr: true,
      },
    ];
    localStorage.setItem('agena_agent_configs', JSON.stringify(config));
    savePrefs({ agents: config }).catch(() => {});
    onNext();
  }

  return (
    <div style={cardStyle}>
      <StepIndicator current={5} total={TOTAL_STEPS} />
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          {t('onboarding.agent.title')}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 8 }}>
          {t('onboarding.agent.subtitle')}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Provider */}
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
            {t('onboarding.agent.provider')}
          </label>
          <select
            style={selectStyle}
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>

        {/* Model */}
        <div>
          <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
            {t('onboarding.agent.model')}
          </label>
          <select
            style={selectStyle}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {(MODELS_MAP[provider] ?? []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
        <button onClick={onSkip} style={btnSecondary}>
          {t('onboarding.agent.skip')}
        </button>
        <button onClick={handleSave} style={btnPrimary}>
          {t('onboarding.integration.save')}
        </button>
      </div>
    </div>
  );
}

/* ────── Step 6: Done ────── */
function StepDone({ onFinish }: { onFinish: () => void }) {
  const { t } = useLocale();

  const quickLinks = [
    { href: '/dashboard/tasks', label: t('onboarding.done.createTask'), icon: '✅' },
    { href: '/dashboard/agents', label: t('onboarding.done.configureAgents'), icon: '🤖' },
    { href: '/dashboard/office', label: t('onboarding.done.officeView'), icon: '🏢' },
  ];

  return (
    <div style={cardStyle}>
      <StepIndicator current={6} total={TOTAL_STEPS} />
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 56, marginBottom: 16, animation: 'pulse 1.5s ease-in-out infinite' }}>
          🎉
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink)', margin: 0 }}>
          {t('onboarding.done.title')}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 10 }}>
          {t('onboarding.done.subtitle')}
        </p>
      </div>

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>
          {t('onboarding.done.quickLinks')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {quickLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid var(--panel-border)',
                background: 'var(--glass)',
                color: 'var(--ink)',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 500,
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(13,148,136,0.4)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--panel-border)'; }}
            >
              <span style={{ fontSize: 20 }}>{link.icon}</span>
              {link.label}
              <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 16 }}>→</span>
            </a>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button onClick={onFinish} style={btnPrimary}>
          {t('onboarding.done.goToDashboard')}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.12); }
        }
      `}</style>
    </div>
  );
}

/* ────── Main Onboarding Page ────── */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [connectedProvider, setConnectedProvider] = useState<'azure' | 'jira' | null>(null);

  async function completeOnboarding() {
    try {
      const prefs = await loadPrefs();
      const currentSettings = (prefs.profile_settings || {}) as Record<string, unknown>;
      await savePrefs({
        profile_settings: { ...currentSettings, onboarding_completed: true },
      });
    } catch {
      // Best-effort; do not block navigation
    }
    router.push('/dashboard');
  }

  return (
    <div style={{
      minHeight: 'calc(100vh - 140px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      {step === 1 && <StepWelcome onNext={() => setStep(2)} />}
      {step === 2 && (
        <StepIntegration
          onNext={(provider) => {
            setConnectedProvider(provider);
            setStep(provider === 'azure' ? 3 : 4);
          }}
          onSkip={() => {
            setConnectedProvider(null);
            setStep(4);
          }}
        />
      )}
      {step === 3 && <StepSprint onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
      {step === 4 && <StepRepo onNext={() => setStep(5)} onSkip={() => setStep(5)} />}
      {step === 5 && <StepAgent onNext={() => setStep(6)} onSkip={() => setStep(6)} />}
      {step === 6 && <StepDone onFinish={completeOnboarding} />}
    </div>
  );
}
