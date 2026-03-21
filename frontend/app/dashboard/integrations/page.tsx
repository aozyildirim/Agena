'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type IntegrationConfig = {
  provider: 'jira' | 'azure';
  base_url: string;
  project?: string | null;
  username?: string | null;
  has_secret: boolean;
  updated_at: string;
};

export default function IntegrationsPage() {
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraSecret, setJiraSecret] = useState('');
  const [azureOrgUrl, setAzureOrgUrl] = useState('');
  const [azureProject, setAzureProject] = useState('');
  const [azurePat, setAzurePat] = useState('');
  const [configs, setConfigs] = useState<IntegrationConfig[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<IntegrationConfig[]>('/integrations').then((data) => {
      setConfigs(data);
      const jira = data.find((c) => c.provider === 'jira');
      const azure = data.find((c) => c.provider === 'azure');
      if (jira) { setJiraBaseUrl(jira.base_url); setJiraEmail(jira.username ?? ''); }
      if (azure) { setAzureOrgUrl(azure.base_url); setAzureProject(azure.project ?? ''); }
    }).catch(() => {});
  }, []);

  async function saveJira() {
    try {
      await apiFetch('/integrations/jira', {
        method: 'PUT',
        body: JSON.stringify({ base_url: jiraBaseUrl, username: jiraEmail, secret: jiraSecret || undefined }),
      });
      setJiraSecret(''); setMsg('Jira integration saved');
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function saveAzure() {
    try {
      await apiFetch('/integrations/azure', {
        method: 'PUT',
        body: JSON.stringify({ base_url: azureOrgUrl, project: azureProject, secret: azurePat || undefined }),
      });
      setAzurePat(''); setMsg('Azure integration saved');
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  }

  const jiraConfig = configs.find((c) => c.provider === 'jira');
  const azureConfig = configs.find((c) => c.provider === 'azure');

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
              placeholder={azureConfig?.has_secret ? '••••••••  (leave empty to keep)' : 'Paste your PAT here'}
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
              placeholder={jiraConfig?.has_secret ? '••••••••  (leave empty to keep)' : 'Paste your API token'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveJira()} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
            Save Jira Config
          </button>
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
