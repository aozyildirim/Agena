'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type IntegrationConfig = {
  provider: 'jira' | 'azure' | 'openai' | 'gemini' | 'github' | 'playbook';
  base_url: string;
  project?: string | null;
  username?: string | null;
  has_secret: boolean;
  secret_preview?: string | null;
  updated_at: string;
};

const SECRET_PREVIEW_LS_PREFIX = 'tiqr_secret_preview_';

function maskSecretPreview(secret: string): string {
  const s = secret.trim();
  if (!s) return '';
  if (s.length <= 6) {
    const head = s.slice(0, 1);
    const tail = s.slice(-1);
    return `${head}${'*'.repeat(Math.max(2, s.length - 2))}${tail}`;
  }
  const head = s.slice(0, 4);
  const tail = s.slice(-4);
  return `${head}${'*'.repeat(Math.max(4, s.length - 8))}${tail}`;
}

function loadSecretPreview(provider: string): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(`${SECRET_PREVIEW_LS_PREFIX}${provider}`) || '';
}

function saveSecretPreview(provider: string, preview: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${SECRET_PREVIEW_LS_PREFIX}${provider}`, preview);
}

export default function IntegrationsPage() {
  const { t } = useLocale();
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraSecret, setJiraSecret] = useState('');
  const [azureOrgUrl, setAzureOrgUrl] = useState('');
  const [azureProject, setAzureProject] = useState('');
  const [azurePat, setAzurePat] = useState('');
  const [githubBaseUrl, setGithubBaseUrl] = useState('https://api.github.com');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [githubTokenPreview, setGithubTokenPreview] = useState('');
  const [configs, setConfigs] = useState<IntegrationConfig[]>([]);
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiKeyPreview, setOpenaiKeyPreview] = useState('');
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('https://generativelanguage.googleapis.com');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiKeyPreview, setGeminiKeyPreview] = useState('');
  const [azurePatPreview, setAzurePatPreview] = useState('');
  const [jiraTokenPreview, setJiraTokenPreview] = useState('');
  const [playbookText, setPlaybookText] = useState('');
  const [isPlaybookSaving, setIsPlaybookSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function loadIntegrationState() {
    const [data, playbook] = await Promise.all([
      apiFetch<IntegrationConfig[]>('/integrations'),
      apiFetch<{ content: string }>('/integrations/playbook/content'),
    ]);
    setConfigs(data);
    setPlaybookText(playbook.content || '');
    const jira = data.find((c) => c.provider === 'jira');
    const azure = data.find((c) => c.provider === 'azure');
    const github = data.find((c) => c.provider === 'github');
    const openai = data.find((c) => c.provider === 'openai');
    const gemini = data.find((c) => c.provider === 'gemini');
    if (jira) { setJiraBaseUrl(jira.base_url); setJiraEmail(jira.username ?? ''); }
    if (azure) { setAzureOrgUrl(azure.base_url); setAzureProject(azure.project ?? ''); }
    if (github) {
      setGithubBaseUrl(github.base_url || 'https://api.github.com');
      setGithubOwner(github.username ?? '');
    }
    if (openai) { setOpenaiBaseUrl(openai.base_url); }
    if (gemini) { setGeminiBaseUrl(gemini.base_url); }
  }

  useEffect(() => {
    setOpenaiKeyPreview(loadSecretPreview('openai'));
    setGeminiKeyPreview(loadSecretPreview('gemini'));
    setAzurePatPreview(loadSecretPreview('azure'));
    setGithubTokenPreview(loadSecretPreview('github'));
    setJiraTokenPreview(loadSecretPreview('jira'));
    void loadIntegrationState().catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!msg) return;
      setMsg('');
    }, 2400);
    return () => clearTimeout(timer);
  }, [msg]);

  async function saveJira() {
    Promise.all([
      apiFetch('/integrations/jira', {
        method: 'PUT',
        body: JSON.stringify({ base_url: jiraBaseUrl, username: jiraEmail, secret: jiraSecret || undefined }),
      }),
      loadIntegrationState(),
    ]).then(() => {
      if (jiraSecret.trim()) {
        const preview = maskSecretPreview(jiraSecret);
        setJiraTokenPreview(preview);
        saveSecretPreview('jira', preview);
      }
      setJiraSecret(''); setMsg(t('integrations.savedJira'));
    }).catch((e) => { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); });
  }

  async function saveAzure() {
    Promise.all([
      apiFetch('/integrations/azure', {
        method: 'PUT',
        body: JSON.stringify({ base_url: azureOrgUrl, project: azureProject, secret: azurePat || undefined }),
      }),
      loadIntegrationState(),
    ]).then(() => {
      if (azurePat.trim()) {
        const preview = maskSecretPreview(azurePat);
        setAzurePatPreview(preview);
        saveSecretPreview('azure', preview);
      }
      setAzurePat(''); setMsg(t('integrations.savedAzure'));
    }).catch((e) => { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); });
  }

  async function saveGithub() {
    Promise.all([
      apiFetch('/integrations/github', {
        method: 'PUT',
        body: JSON.stringify({ base_url: githubBaseUrl, username: githubOwner, secret: githubToken || undefined }),
      }),
      loadIntegrationState(),
    ]).then(async () => {
      if (githubToken.trim()) {
        const preview = maskSecretPreview(githubToken);
        setGithubTokenPreview(preview);
        saveSecretPreview('github', preview);
      }
      setGithubToken('');
      setMsg(t('integrations.savedGithub'));
    }).catch((e) => {
      const message = e instanceof Error ? e.message : t('integrations.saveFailed');
      if (message.includes('Unsupported provider: github')) {
        setError('Backend henüz yeni kodla çalışmıyor. Lütfen backend servisini restart et.');
        return;
      }
      setError(message);
    });
  }

  async function saveOpenAI() {
    Promise.all([
      apiFetch('/integrations/openai', {
        method: 'PUT',
        body: JSON.stringify({ base_url: openaiBaseUrl, secret: openaiKey || undefined }),
      }),
      loadIntegrationState(),
    ]).then(() => {
      if (openaiKey.trim()) {
        const preview = maskSecretPreview(openaiKey);
        setOpenaiKeyPreview(preview);
        saveSecretPreview('openai', preview);
      }
      setOpenaiKey('');
      setMsg(t('integrations.savedOpenai'));
    }).catch((e) => { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); });
  }

  async function saveGemini() {
    Promise.all([
      apiFetch('/integrations/gemini', {
        method: 'PUT',
        body: JSON.stringify({ base_url: geminiBaseUrl, secret: geminiKey || undefined }),
      }),
      loadIntegrationState(),
    ]).then(() => {
      if (geminiKey.trim()) {
        const preview = maskSecretPreview(geminiKey);
        setGeminiKeyPreview(preview);
        saveSecretPreview('gemini', preview);
      }
      setGeminiKey('');
      setMsg(t('integrations.savedGemini'));
    }).catch((e) => { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); });
  }

  async function savePlaybook() {
    try {
      setIsPlaybookSaving(true);
      await apiFetch('/integrations/playbook', {
        method: 'PUT',
        body: JSON.stringify({ base_url: 'tenant://playbook', secret: playbookText }),
      });
      await loadIntegrationState();
      setError('');
      setMsg(t('integrations.savedPlaybook'));
    } catch (e) { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); }
    finally { setIsPlaybookSaving(false); }
  }

  const jiraConfig = configs.find((c) => c.provider === 'jira');
  const azureConfig = configs.find((c) => c.provider === 'azure');
  const githubConfig = configs.find((c) => c.provider === 'github');
  const openaiConfig = configs.find((c) => c.provider === 'openai');
  const geminiConfig = configs.find((c) => c.provider === 'gemini');
  const playbookConfig = configs.find((c) => c.provider === 'playbook');

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      {/* Header */}
      <div>
        <div className='section-label'>{t('integrations.section')}</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          {t('integrations.title')}
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          {t('integrations.subtitle')}
        </p>
      </div>

      {/* Notification */}
      {(msg || error) && (
        <div style={{
          padding: '12px 16px', borderRadius: 12, fontSize: 13,
          background: error ? 'rgba(248,113,113,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${error ? 'rgba(248,113,113,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: error ? '#f87171' : '#22c55e',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {error || msg}
          <button onClick={() => { setError(''); setMsg(''); }} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}

      <div className='integrations-grid'>
        {/* OpenAI */}
        <IntegrationCard
          title='OpenAI'
          icon='⚡'
          color='#34d399'
          connected={openaiConfig?.has_secret ?? false}
          updatedAt={openaiConfig?.updated_at}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={openaiBaseUrl} onChange={(e) => setOpenaiBaseUrl(e.target.value)} placeholder='https://api.openai.com/v1' />
          </FieldGroup>
          <FieldGroup label={t('integrations.apiKey')}>
            <input
              type='password'
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={openaiConfig?.has_secret ? `${openaiConfig?.secret_preview || openaiKeyPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.openaiKeyPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveOpenAI()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {t('integrations.saveOpenai')}
          </button>
        </IntegrationCard>

        {/* Gemini */}
        <IntegrationCard
          title='Gemini'
          icon='✨'
          color='#22d3ee'
          connected={geminiConfig?.has_secret ?? false}
          updatedAt={geminiConfig?.updated_at}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={geminiBaseUrl} onChange={(e) => setGeminiBaseUrl(e.target.value)} placeholder='https://generativelanguage.googleapis.com' />
          </FieldGroup>
          <FieldGroup label={t('integrations.apiKey')}>
            <input
              type='password'
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={geminiConfig?.has_secret ? `${geminiConfig?.secret_preview || geminiKeyPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.geminiKeyPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveGemini()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {t('integrations.saveGemini')}
          </button>
        </IntegrationCard>

        {/* Azure DevOps */}
        <IntegrationCard
          title='Azure DevOps'
          icon='🔷'
          color='#60a5fa'
          connected={azureConfig?.has_secret ?? false}
          updatedAt={azureConfig?.updated_at}
        >
          <FieldGroup label={t('integrations.azureOrgUrl')}>
            <input value={azureOrgUrl} onChange={(e) => setAzureOrgUrl(e.target.value)} placeholder='https://dev.azure.com/your-org' />
          </FieldGroup>
          <FieldGroup label={t('integrations.project')}>
            <input value={azureProject} onChange={(e) => setAzureProject(e.target.value)} placeholder={t('integrations.projectPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.pat')}>
            <input
              type='password'
              value={azurePat}
              onChange={(e) => setAzurePat(e.target.value)}
              placeholder={azureConfig?.has_secret ? `${azureConfig?.secret_preview || azurePatPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.patPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveAzure()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {t('integrations.saveAzure')}
          </button>
        </IntegrationCard>

        {/* GitHub */}
        <IntegrationCard
          title='GitHub'
          icon='🐙'
          color='#a78bfa'
          connected={githubConfig?.has_secret ?? false}
          updatedAt={githubConfig?.updated_at}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={githubBaseUrl} onChange={(e) => setGithubBaseUrl(e.target.value)} placeholder='https://api.github.com' />
          </FieldGroup>
          <FieldGroup label={t('integrations.githubOwner')}>
            <input value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder={t('integrations.githubOwnerPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.githubToken')}>
            <input
              type='password'
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={githubConfig?.has_secret ? `${githubConfig?.secret_preview || githubTokenPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.githubTokenPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveGithub()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {t('integrations.saveGithub')}
          </button>
        </IntegrationCard>

        {/* Jira */}
        <IntegrationCard
          title='Jira'
          icon='🟦'
          color='#818cf8'
          connected={jiraConfig?.has_secret ?? false}
          updatedAt={jiraConfig?.updated_at}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} placeholder='https://your-company.atlassian.net' />
          </FieldGroup>
          <FieldGroup label={t('integrations.email')}>
            <input value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder='you@company.com' />
          </FieldGroup>
          <FieldGroup label={t('integrations.apiToken')}>
            <input
              type='password'
              value={jiraSecret}
              onChange={(e) => setJiraSecret(e.target.value)}
              placeholder={jiraConfig?.has_secret ? `${jiraConfig?.secret_preview || jiraTokenPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.apiTokenPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveJira()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {t('integrations.saveJira')}
          </button>
        </IntegrationCard>

        {/* Tenant Playbook */}
        <IntegrationCard
          title='Tenant Playbook'
          icon='📘'
          color='#f59e0b'
          connected={playbookConfig?.has_secret ?? false}
          updatedAt={playbookConfig?.updated_at}
        >
          <FieldGroup label={t('integrations.codingRules')}>
            <textarea
              value={playbookText}
              onChange={(e) => setPlaybookText(e.target.value)}
              rows={8}
              placeholder={t('integrations.playbookPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void savePlaybook()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {isPlaybookSaving ? t('integrations.saving') : t('integrations.savePlaybook')}
          </button>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
            {t('integrations.playbookStored')} ({playbookConfig?.updated_at ? `${t('integrations.updated')} ${new Date(playbookConfig.updated_at).toLocaleString()}` : t('integrations.notSavedYet')}).
          </div>
        </IntegrationCard>
      </div>
      <style jsx>{`
        .integrations-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          align-items: stretch;
        }
        @media (max-width: 1320px) {
          .integrations-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 860px) {
          .integrations-grid { grid-template-columns: 1fr; }
        }
        .connected-dot {
          animation: connectedPulse 1.8s ease-out infinite;
          box-shadow: 0 0 0 rgba(34, 197, 94, 0.55);
        }
        @keyframes connectedPulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55); }
          70% { transform: scale(1.12); box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
      `}</style>
    </div>
  );
}

function IntegrationCard({
  title, icon, color, connected, updatedAt, children,
}: {
  title: string; icon: string; color: string; connected: boolean; updatedAt?: string; children: React.ReactNode;
}) {
  const { t } = useLocale();
  const borderColor = connected ? 'rgba(34,197,94,0.72)' : `${color}20`;
  const bgColor = connected ? 'rgba(34,197,94,0.08)' : `${color}06`;
  const glow = connected ? '0 0 0 1px rgba(34,197,94,0.28), 0 0 28px rgba(34,197,94,0.22), inset 0 0 22px rgba(34,197,94,0.08)' : 'none';
  const topLine = connected ? 'linear-gradient(90deg, transparent, rgba(34,197,94,0.9), transparent)' : `linear-gradient(90deg, transparent, ${color}60, transparent)`;

  return (
    <div style={{
      borderRadius: 20, border: `1px solid ${borderColor}`,
      background: bgColor, padding: 18,
      position: 'relative', overflow: 'hidden',
      boxShadow: glow,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: topLine }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, fontSize: 18,
          background: `${color}15`, border: `1px solid ${color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div>
          <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span className={connected ? 'connected-dot' : ''} style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#22c55e' : 'rgba(255,255,255,0.2)' }} />
            <span style={{ fontSize: 11, color: connected ? '#22c55e' : 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
              {connected ? t('integrations.connected') : t('integrations.notConfigured')}
            </span>
          </div>
        </div>
        {updatedAt && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
            {new Date(updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gap: 10, flex: 1 }}>{children}</div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
