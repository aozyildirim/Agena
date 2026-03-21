'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type IntegrationConfig = {
  provider: 'jira' | 'azure' | 'openai' | 'gemini' | 'playbook';
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
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraSecret, setJiraSecret] = useState('');
  const [azureOrgUrl, setAzureOrgUrl] = useState('');
  const [azureProject, setAzureProject] = useState('');
  const [azurePat, setAzurePat] = useState('');
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
    const openai = data.find((c) => c.provider === 'openai');
    const gemini = data.find((c) => c.provider === 'gemini');
    if (jira) { setJiraBaseUrl(jira.base_url); setJiraEmail(jira.username ?? ''); }
    if (azure) { setAzureOrgUrl(azure.base_url); setAzureProject(azure.project ?? ''); }
    if (openai) { setOpenaiBaseUrl(openai.base_url); }
    if (gemini) { setGeminiBaseUrl(gemini.base_url); }
  }

  useEffect(() => {
    setOpenaiKeyPreview(loadSecretPreview('openai'));
    setGeminiKeyPreview(loadSecretPreview('gemini'));
    setAzurePatPreview(loadSecretPreview('azure'));
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
      setJiraSecret(''); setMsg('Jira integration saved');
    }).catch((e) => { setError(e instanceof Error ? e.message : 'Save failed'); });
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
      setAzurePat(''); setMsg('Azure integration saved');
    }).catch((e) => { setError(e instanceof Error ? e.message : 'Save failed'); });
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
      setMsg('OpenAI integration saved');
    }).catch((e) => { setError(e instanceof Error ? e.message : 'Save failed'); });
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
      setMsg('Gemini integration saved');
    }).catch((e) => { setError(e instanceof Error ? e.message : 'Save failed'); });
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
      setMsg('Tenant playbook saved to DB');
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setIsPlaybookSaving(false); }
  }

  const jiraConfig = configs.find((c) => c.provider === 'jira');
  const azureConfig = configs.find((c) => c.provider === 'azure');
  const openaiConfig = configs.find((c) => c.provider === 'openai');
  const geminiConfig = configs.find((c) => c.provider === 'gemini');
  const playbookConfig = configs.find((c) => c.provider === 'playbook');

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      {/* Header */}
      <div>
        <div className='section-label'>Integrations</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          Integration Settings
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
          Connect your project management tools to enable AI-powered task import
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* OpenAI */}
        <IntegrationCard
          title='OpenAI'
          icon='⚡'
          color='#34d399'
          connected={openaiConfig?.has_secret ?? false}
          updatedAt={openaiConfig?.updated_at}
        >
          <FieldGroup label='Base URL'>
            <input value={openaiBaseUrl} onChange={(e) => setOpenaiBaseUrl(e.target.value)} placeholder='https://api.openai.com/v1' />
          </FieldGroup>
          <FieldGroup label='API Key'>
            <input
              type='password'
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={openaiConfig?.has_secret ? `${openaiConfig?.secret_preview || openaiKeyPreview || '****'} (leave empty to keep)` : 'Paste your OpenAI API key'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveOpenAI()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            Save OpenAI Config
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
          <FieldGroup label='Base URL'>
            <input value={geminiBaseUrl} onChange={(e) => setGeminiBaseUrl(e.target.value)} placeholder='https://generativelanguage.googleapis.com' />
          </FieldGroup>
          <FieldGroup label='API Key'>
            <input
              type='password'
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={geminiConfig?.has_secret ? `${geminiConfig?.secret_preview || geminiKeyPreview || '****'} (leave empty to keep)` : 'Paste your Gemini API key'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveGemini()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            Save Gemini Config
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
          <FieldGroup label='Organization URL'>
            <input value={azureOrgUrl} onChange={(e) => setAzureOrgUrl(e.target.value)} placeholder='https://dev.azure.com/your-org' />
          </FieldGroup>
          <FieldGroup label='Project'>
            <input value={azureProject} onChange={(e) => setAzureProject(e.target.value)} placeholder='e.g. MyProject' />
          </FieldGroup>
          <FieldGroup label='Personal Access Token (PAT)'>
            <input
              type='password'
              value={azurePat}
              onChange={(e) => setAzurePat(e.target.value)}
              placeholder={azureConfig?.has_secret ? `${azureConfig?.secret_preview || azurePatPreview || '****'} (leave empty to keep)` : 'Paste your PAT here'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveAzure()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            Save Azure Config
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
          <FieldGroup label='Base URL'>
            <input value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} placeholder='https://your-company.atlassian.net' />
          </FieldGroup>
          <FieldGroup label='Email'>
            <input value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder='you@company.com' />
          </FieldGroup>
          <FieldGroup label='API Token'>
            <input
              type='password'
              value={jiraSecret}
              onChange={(e) => setJiraSecret(e.target.value)}
              placeholder={jiraConfig?.has_secret ? `${jiraConfig?.secret_preview || jiraTokenPreview || '****'} (leave empty to keep)` : 'Paste your API token'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveJira()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            Save Jira Config
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
          <FieldGroup label='Coding Rules'>
            <textarea
              value={playbookText}
              onChange={(e) => setPlaybookText(e.target.value)}
              rows={8}
              placeholder={'Example:\n- Always write tests for new API paths\n- Never edit payment modules without approval\n- Prefer TypeScript strict mode'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void savePlaybook()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            {isPlaybookSaving ? 'Saving...' : 'Save Tenant Playbook'}
          </button>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
            Stored per organization in DB ({playbookConfig?.updated_at ? `updated ${new Date(playbookConfig.updated_at).toLocaleString()}` : 'not saved yet'}).
          </div>
        </IntegrationCard>
      </div>
    </div>
  );
}

function IntegrationCard({
  title, icon, color, connected, updatedAt, children,
}: {
  title: string; icon: string; color: string; connected: boolean; updatedAt?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      borderRadius: 20, border: `1px solid ${color}20`,
      background: `${color}06`, padding: 28,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${color}60, transparent)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, fontSize: 22,
          background: `${color}15`, border: `1px solid ${color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div>
          <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 16 }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#22c55e' : 'rgba(255,255,255,0.2)' }} />
            <span style={{ fontSize: 11, color: connected ? '#22c55e' : 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
              {connected ? 'Connected' : 'Not configured'}
            </span>
          </div>
        </div>
        {updatedAt && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
            {new Date(updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gap: 14 }}>{children}</div>
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
