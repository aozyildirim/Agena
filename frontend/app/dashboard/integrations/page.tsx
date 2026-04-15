'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type IntegrationConfig = {
  provider: 'jira' | 'azure' | 'openai' | 'gemini' | 'github' | 'playbook' | 'slack' | 'teams' | 'telegram' | 'hal' | 'newrelic' | 'sentry';
  extra_config?: Record<string, string> | null;
  base_url: string;
  project?: string | null;
  username?: string | null;
  has_secret: boolean;
  secret_preview?: string | null;
  updated_at: string;
};

const SECRET_PREVIEW_LS_PREFIX = 'agena_secret_preview_';

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
  const [activeTab, setActiveTab] = useState<'ai' | 'task' | 'notifications' | 'cli'>('ai');
  const [cliBridgeStatus, setCliBridgeStatus] = useState<{ ok: boolean; codex: boolean; claude: boolean; codex_auth?: boolean; claude_auth?: boolean } | null>(null);
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
  const [slackWebhook, setSlackWebhook] = useState('');
  const [slackBotToken, setSlackBotToken] = useState('');
  const [slackSigningSecret, setSlackSigningSecret] = useState('');
  const [teamsWebhook, setTeamsWebhook] = useState('');
  const [teamsBotAppId, setTeamsBotAppId] = useState('');
  const [teamsBotSecret, setTeamsBotSecret] = useState('');
  const [slackPreview, setSlackPreview] = useState('');
  const [teamsPreview, setTeamsPreview] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramPreview, setTelegramPreview] = useState('');
  const [telegramSetupMsg, setTelegramSetupMsg] = useState('');
  const [halServiceUrl, setHalServiceUrl] = useState('');
  const [halLoginUrl, setHalLoginUrl] = useState('');
  const [halChatUrl, setHalChatUrl] = useState('');
  const [halUsername, setHalUsername] = useState('');
  const [halPassword, setHalPassword] = useState('');
  const [halPasswordPreview, setHalPasswordPreview] = useState('');
  const [newrelicApiKey, setNewrelicApiKey] = useState('');
  const [newrelicApiKeyPreview, setNewrelicApiKeyPreview] = useState('');
  const [newrelicAccountId, setNewrelicAccountId] = useState('');
  const [newrelicRegion, setNewrelicRegion] = useState('eu');
  const [sentryBaseUrl, setSentryBaseUrl] = useState('https://sentry.io/api/0');
  const [sentryToken, setSentryToken] = useState('');
  const [sentryTokenPreview, setSentryTokenPreview] = useState('');
  const [sentryOrgSlug, setSentryOrgSlug] = useState('');
  const [notifyTesting, setNotifyTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [help, setHelp] = useState<{ title: string; steps: string[]; link?: string; note?: string } | null>(null);

  const helpByProvider: Record<IntegrationConfig['provider'], { title: string; steps: string[]; link?: string; note?: string }> = {
    jira: {
      title: t('integrations.helpJiraTitle'),
      steps: [
        t('integrations.helpJiraStep1'),
        t('integrations.helpJiraStep2'),
        t('integrations.helpJiraStep3'),
        t('integrations.helpJiraStep4'),
        t('integrations.helpJiraStep5'),
      ],
      link: 'https://id.atlassian.com/manage-profile/security/api-tokens',
      note: t('integrations.helpJiraNote'),
    },
    azure: {
      title: t('integrations.helpAzureTitle'),
      steps: [
        t('integrations.helpAzureStep1'),
        t('integrations.helpAzureStep2'),
        t('integrations.helpAzureStep3'),
        t('integrations.helpAzureStep4'),
        t('integrations.helpAzureStep5'),
      ],
      link: 'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate',
    },
    github: {
      title: t('integrations.helpGithubTitle'),
      steps: [
        t('integrations.helpGithubStep1'),
        t('integrations.helpGithubStep2'),
        t('integrations.helpGithubStep3'),
        t('integrations.helpGithubStep4'),
        t('integrations.helpGithubStep5'),
      ],
      link: 'https://docs.github.com/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
    },
    openai: {
      title: t('integrations.helpOpenaiTitle'),
      steps: [
        t('integrations.helpOpenaiStep1'),
        t('integrations.helpOpenaiStep2'),
        t('integrations.helpOpenaiStep3'),
        t('integrations.helpOpenaiStep4'),
      ],
      link: 'https://platform.openai.com/api-keys',
    },
    gemini: {
      title: t('integrations.helpGeminiTitle'),
      steps: [
        t('integrations.helpGeminiStep1'),
        t('integrations.helpGeminiStep2'),
        t('integrations.helpGeminiStep3'),
        t('integrations.helpGeminiStep4'),
      ],
      link: 'https://ai.google.dev/gemini-api/docs/api-key',
    },
    slack: {
      title: 'Slack Integration Setup',
      steps: [
        '1. Go to api.slack.com/apps and create a new app',
        '2. Under "Incoming Webhooks", enable and create a webhook URL for notifications',
        '3. Under "OAuth & Permissions", copy the Bot User OAuth Token (xoxb-...)',
        '4. Under "Basic Information", copy the Signing Secret',
        '5. Enable "Event Subscriptions" and set Request URL to: https://api.agena.dev/webhooks/slack',
        '6. Subscribe to bot events: message.channels, app_mention',
      ],
      link: 'https://api.slack.com/apps',
      note: 'Webhook URL = notifications only. Bot Token + Signing Secret = ChatOps commands.',
    },
    teams: {
      title: 'Microsoft Teams Bot Setup',
      steps: [
        '1. Go to Azure Portal → Azure Bot Service → Create',
        '2. Choose Multi-Tenant, get the App ID and generate an App Secret',
        '3. Under Channels, enable Microsoft Teams',
        '4. Set the Messaging Endpoint to: https://api.agena.dev/webhooks/teams',
        '5. Paste App ID and App Secret below',
        '6. In Teams, search for your bot by App ID and start chatting',
      ],
      link: 'https://learn.microsoft.com/azure/bot-service/bot-service-quickstart-registration',
      note: 'Webhook URL = notifications only. Bot App ID + Secret = ChatOps commands.',
    },
    playbook: {
      title: t('integrations.helpPlaybookTitle'),
      steps: [
        t('integrations.helpPlaybookStep1'),
        t('integrations.helpPlaybookStep2'),
        t('integrations.helpPlaybookStep3'),
      ],
    },
    telegram: {
      title: 'Telegram Bot Setup',
      steps: [
        '1. Open Telegram and search for @BotFather',
        '2. Send /newbot and follow the prompts to create your bot',
        '3. Copy the Bot Token (e.g. 7123456789:AAH...)',
        '4. Paste it below and save',
        '5. Add the bot to your group chat or DM it directly',
        '6. Use /help to see available commands',
      ],
      link: 'https://core.telegram.org/bots#botfather',
      note: 'ChatOps commands: /fix, /status, /queue, /recent, /stats',
    },
    hal: {
      title: t('integrations.helpHalTitle'),
      steps: [
        t('integrations.helpHalStep1'),
        t('integrations.helpHalStep2'),
        t('integrations.helpHalStep3'),
        t('integrations.helpHalStep4'),
      ],
    },
    newrelic: {
      title: t('integrations.helpNewrelicTitle'),
      steps: [
        t('integrations.helpNewrelicStep1'),
        t('integrations.helpNewrelicStep2'),
        t('integrations.helpNewrelicStep3'),
        t('integrations.helpNewrelicStep4'),
      ],
      link: 'https://docs.newrelic.com/docs/apis/intro-apis/new-relic-api-keys/',
    },
    sentry: {
      title: t('integrations.helpSentryTitle'),
      steps: [
        t('integrations.helpSentryStep1'),
        t('integrations.helpSentryStep2'),
        t('integrations.helpSentryStep3'),
        t('integrations.helpSentryStep4'),
      ],
      link: 'https://docs.sentry.io/api/guides/create-auth-token/',
    },
  };

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
    const slack = data.find((c) => c.provider === 'slack');
    const teams = data.find((c) => c.provider === 'teams');
    if (jira) { setJiraBaseUrl(jira.base_url); setJiraEmail(jira.username ?? ''); }
    if (azure) { setAzureOrgUrl(azure.base_url); setAzureProject(azure.project ?? ''); }
    if (github) {
      setGithubBaseUrl(github.base_url || 'https://api.github.com');
      setGithubOwner(github.username ?? '');
    }
    if (openai) { setOpenaiBaseUrl(openai.base_url); }
    if (gemini) { setGeminiBaseUrl(gemini.base_url); }
    const telegram = data.find((c) => c.provider === 'telegram');
    const hal = data.find((c) => c.provider === 'hal');
    if (slack) { setSlackWebhook(''); setSlackBotToken(''); setSlackSigningSecret(''); }
    if (teams) { setTeamsWebhook(''); setTeamsBotAppId(teams.project ?? ''); setTeamsBotSecret(''); }
    if (telegram) { setTelegramToken(''); setTelegramChatId(telegram.username ?? ''); }
    if (hal) {
      setHalServiceUrl(hal.base_url || '');
      setHalUsername(hal.username ?? '');
      setHalLoginUrl(hal.extra_config?.login_url ?? '');
      setHalChatUrl(hal.extra_config?.chat_url ?? '');
    }
    const newrelic = data.find((c) => c.provider === 'newrelic');
    if (newrelic) {
      setNewrelicAccountId(newrelic.extra_config?.account_id ?? '');
      setNewrelicRegion(newrelic.base_url?.includes('eu.newrelic') ? 'eu' : 'us');
    }
    const sentry = data.find((c) => c.provider === 'sentry');
    if (sentry) {
      setSentryBaseUrl(sentry.base_url || 'https://sentry.io/api/0');
      setSentryOrgSlug(sentry.extra_config?.organization_slug ?? '');
    }
  }

  useEffect(() => {
    setOpenaiKeyPreview(loadSecretPreview('openai'));
    setGeminiKeyPreview(loadSecretPreview('gemini'));
    setAzurePatPreview(loadSecretPreview('azure'));
    setGithubTokenPreview(loadSecretPreview('github'));
    setJiraTokenPreview(loadSecretPreview('jira'));
    setSlackPreview(loadSecretPreview('slack'));
    setTeamsPreview(loadSecretPreview('teams'));
    setTelegramPreview(loadSecretPreview('telegram'));
    setHalPasswordPreview(loadSecretPreview('hal'));
    setNewrelicApiKeyPreview(loadSecretPreview('newrelic'));
    setSentryTokenPreview(loadSecretPreview('sentry'));
    void loadIntegrationState().catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!msg) return;
      setMsg('');
    }, 2400);
    return () => clearTimeout(timer);
  }, [msg]);

  async function deleteIntegration(provider: string) {
    if (!confirm(t('integrations.deleteConfirm').replace('{provider}', provider))) return;
    try {
      await apiFetch(`/integrations/${provider}`, { method: 'DELETE' });
      setConfigs((prev) => prev.filter((c) => c.provider !== provider));
      // Clear local previews
      localStorage.removeItem(`${SECRET_PREVIEW_LS_PREFIX}${provider}`);
      setMsg(t('integrations.deleted').replace('{provider}', provider));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('integrations.deleteFailed'));
    }
  }

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
        setError(t('integrations.backendRestartRequired'));
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

  async function saveSlack() {
    try {
      await apiFetch('/integrations/slack', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: slackWebhook || undefined,                   // webhook URL for notifications
          secret: slackBotToken || undefined,                     // Bot User OAuth Token for ChatOps
          project: slackSigningSecret || undefined,               // Signing Secret for verification
        }),
      });
      if (slackBotToken.trim()) {
        const preview = maskSecretPreview(slackBotToken);
        setSlackPreview(preview);
        saveSecretPreview('slack', preview);
      }
      setSlackWebhook(''); setSlackBotToken(''); setSlackSigningSecret('');
      await loadIntegrationState();
      setMsg(t('integrations.savedSlack'));
    } catch (e) { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); }
  }

  async function saveTeams() {
    try {
      await apiFetch('/integrations/teams', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: teamsWebhook || undefined,                    // webhook URL for notifications
          secret: teamsBotSecret || undefined,                    // Bot App Secret for ChatOps
          project: teamsBotAppId || undefined,                    // Bot App ID
        }),
      });
      if (teamsBotSecret.trim()) {
        const preview = maskSecretPreview(teamsBotSecret);
        setTeamsPreview(preview);
        saveSecretPreview('teams', preview);
      }
      setTeamsWebhook(''); setTeamsBotSecret('');
      await loadIntegrationState();
      setMsg(t('integrations.savedTeams'));
    } catch (e) { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); }
  }

  async function saveTelegram() {
    setTelegramSetupMsg('');
    try {
      await apiFetch('/integrations/telegram', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: 'https://api.telegram.org',
          secret: telegramToken || undefined,
          username: telegramChatId || undefined,
        }),
      });
      if (telegramToken.trim()) {
        const preview = maskSecretPreview(telegramToken);
        setTelegramPreview(preview);
        saveSecretPreview('telegram', preview);
      }
      setTelegramToken('');
      await loadIntegrationState();
      // Auto-register webhook
      try {
        const res = await apiFetch<{ status: string; bot_username?: string }>('/webhooks/telegram/setup?base_url=' + encodeURIComponent(window.location.origin.replace('agena.dev', 'api.agena.dev').replace(/:\d+$/, ':8010')), { method: 'POST' });
        setTelegramSetupMsg(`Bot @${res.bot_username || '?'} webhook registered.`);
      } catch { setTelegramSetupMsg('Saved. Webhook registration may need manual setup.'); }
      setMsg('Telegram saved');
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  }

  async function saveHal() {
    try {
      await apiFetch('/integrations/hal', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: halServiceUrl || undefined,
          username: halUsername || undefined,
          secret: halPassword || undefined,
          extra_config: {
            login_url: halLoginUrl || undefined,
            chat_url: halChatUrl || undefined,
          },
        }),
      });
      if (halPassword.trim()) {
        const preview = maskSecretPreview(halPassword);
        setHalPasswordPreview(preview);
        saveSecretPreview('hal', preview);
      }
      setHalPassword('');
      await loadIntegrationState();
      setMsg(t('integrations.savedHal'));
    } catch (e) { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); }
  }

  async function saveNewrelic() {
    try {
      const nrBaseUrl = newrelicRegion === 'eu' ? 'https://api.eu.newrelic.com/graphql' : 'https://api.newrelic.com/graphql';
      await apiFetch('/integrations/newrelic', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: nrBaseUrl,
          secret: newrelicApiKey || undefined,
          extra_config: { account_id: newrelicAccountId || undefined },
        }),
      });
      if (newrelicApiKey.trim()) {
        const preview = maskSecretPreview(newrelicApiKey);
        setNewrelicApiKeyPreview(preview);
        saveSecretPreview('newrelic', preview);
      }
      setNewrelicApiKey('');
      await loadIntegrationState();
      setMsg(t('integrations.savedNewrelic'));
    } catch (e) { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); }
  }

  async function saveSentry() {
    try {
      await apiFetch('/integrations/sentry', {
        method: 'PUT',
        body: JSON.stringify({
          base_url: sentryBaseUrl || 'https://sentry.io/api/0',
          secret: sentryToken || undefined,
          extra_config: {
            organization_slug: sentryOrgSlug || undefined,
          },
        }),
      });
      if (sentryToken.trim()) {
        const preview = maskSecretPreview(sentryToken);
        setSentryTokenPreview(preview);
        saveSecretPreview('sentry', preview);
      }
      setSentryToken('');
      await loadIntegrationState();
      setMsg(t('integrations.savedSentry'));
    } catch (e) { setError(e instanceof Error ? e.message : t('integrations.saveFailed')); }
  }

  async function sendTestNotification() {
    setNotifyTesting(true);
    setError('');
    try {
      await apiFetch('/notifications/event', {
        method: 'POST',
        body: JSON.stringify({
          event_type: 'task_completed',
          title: t('integrations.testNotificationTitle'),
          message: t('integrations.testNotificationMessage'),
          severity: 'success',
        }),
      });
      setMsg(t('integrations.sentTestNotify'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('integrations.saveFailed'));
    } finally {
      setNotifyTesting(false);
    }
  }

  const jiraConfig = configs.find((c) => c.provider === 'jira');
  const azureConfig = configs.find((c) => c.provider === 'azure');
  const githubConfig = configs.find((c) => c.provider === 'github');
  const openaiConfig = configs.find((c) => c.provider === 'openai');
  const geminiConfig = configs.find((c) => c.provider === 'gemini');
  const playbookConfig = configs.find((c) => c.provider === 'playbook');
  const slackConfig = configs.find((c) => c.provider === 'slack');
  const teamsConfig = configs.find((c) => c.provider === 'teams');
  const telegramConfig = configs.find((c) => c.provider === 'telegram');
  const halConfig = configs.find((c) => c.provider === 'hal');
  const newrelicConfig = configs.find((c) => c.provider === 'newrelic');
  const sentryConfig = configs.find((c) => c.provider === 'sentry');
  const taskProviders: IntegrationConfig['provider'][] = ['azure', 'github', 'jira', 'newrelic', 'sentry'];
  const aiProviders: IntegrationConfig['provider'][] = ['openai', 'gemini', 'hal', 'playbook'];
  const notificationProviders: IntegrationConfig['provider'][] = ['slack', 'teams', 'telegram'];
  const connectedCount = configs.filter((c) => c.has_secret).length;
  const totalCount = configs.length;
  const tabMeta = {
    ai: { icon: '⚡', color: '#34d399', label: t('integrations.tabAi'), count: configs.filter((c) => aiProviders.includes(c.provider)).filter((c) => c.has_secret).length },
    task: { icon: '🔗', color: '#60a5fa', label: t('integrations.tabTask'), count: configs.filter((c) => taskProviders.includes(c.provider)).filter((c) => c.has_secret).length },
    notifications: { icon: '🔔', color: '#fb923c', label: t('integrations.tabNotifications'), count: configs.filter((c) => notificationProviders.includes(c.provider)).filter((c) => c.has_secret).length },
    cli: { icon: '⌨', color: '#a855f7', label: t('integrations.tabCli'), count: Number(Boolean(cliBridgeStatus?.ok)) },
  } as const;

  return (
    <div className='integrations-root' style={{ display: 'grid', gap: 14 }}>
      <div className='int-hero'>
        <div className='section-label'>{t('integrations.section')}</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
          {t('integrations.title')}
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 13, maxWidth: 680, lineHeight: 1.5 }}>
          {t('integrations.subtitle')}
        </p>
        <div className='int-summary'>
          <div className='summary-pill'>
            <span>Connected</span>
            <strong>{connectedCount}/{totalCount}</strong>
          </div>
          <div className='summary-pill'>
            <span>Task Stack</span>
            <strong>{tabMeta.task.count}</strong>
          </div>
          <div className='summary-pill'>
            <span>AI Stack</span>
            <strong>{tabMeta.ai.count}</strong>
          </div>
          <div className='summary-pill'>
            <span>Notify Stack</span>
            <strong>{tabMeta.notifications.count}</strong>
          </div>
        </div>
      </div>

      {(msg || error) && (
        <div
          style={{
            position: 'fixed',
            right: 12,
            bottom: 12,
            left: 'auto',
            zIndex: 80,
            minWidth: 180,
            maxWidth: 'min(320px, calc(100vw - 24px))',
            padding: '8px 12px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.2,
            color: error ? '#fecaca' : '#86efac',
            border: error ? '1px solid rgba(248,113,113,0.35)' : '1px solid rgba(34,197,94,0.35)',
            background: error ? 'rgba(127,29,29,0.92)' : 'rgba(20,83,45,0.92)',
            boxShadow: error
              ? '0 10px 30px rgba(127,29,29,0.35)'
              : '0 10px 30px rgba(20,83,45,0.35)',
            backdropFilter: 'blur(8px)',
            animation: 'toastSlideUp 180ms ease-out',
          }}
        >
          {error || msg}
        </div>
      )}

      <div className='int-tab-bar'>
        {(['ai', 'task', 'notifications', 'cli'] as const).map((key) => {
          const tab = tabMeta[key];
          const active = activeTab === key;
          return (
            <button
              key={key}
              type='button'
              onClick={() => {
                setActiveTab(key);
                if (key === 'cli') {
                  fetch('http://localhost:9876/health').then(r => r.json()).then(d => setCliBridgeStatus({ ok: true, codex: d.codex, claude: d.claude, codex_auth: d.codex_auth, claude_auth: d.claude_auth })).catch(() => setCliBridgeStatus({ ok: false, codex: false, claude: false, codex_auth: false, claude_auth: false }));
                }
              }}
              className='int-tab-btn'
              data-active={active ? '1' : '0'}
              style={{ ['--tab-color' as string]: tab.color }}
            >
              <span className='int-tab-icon'>{tab.icon}</span>
              <span>{tab.label}</span>
              <span className='int-tab-count'>{tab.count}</span>
            </button>
          );
        })}
      </div>

      <div className='integrations-grid'>
        {/* OpenAI */}
        {activeTab === 'ai' && <IntegrationCard
          title={t('integrations.providerOpenai')}
          icon='⚡'
          color='#34d399'
          connected={openaiConfig?.has_secret ?? false}
          updatedAt={openaiConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.openai)}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={openaiBaseUrl} onChange={(e) => setOpenaiBaseUrl(e.target.value)} placeholder={t('integrations.openaiBaseUrlPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.apiKey')}>
            <input
              type='password'
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder={openaiConfig?.has_secret ? `${openaiConfig?.secret_preview || openaiKeyPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.openaiKeyPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveOpenAI()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveOpenai')}
          </button>
          {configs.find(c => c.provider === 'openai')?.has_secret && (
            <button onClick={() => void deleteIntegration('openai')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteOpenaiConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* Gemini */}
        {activeTab === 'ai' && <IntegrationCard
          title={t('integrations.providerGemini')}
          icon='✨'
          color='#22d3ee'
          connected={geminiConfig?.has_secret ?? false}
          updatedAt={geminiConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.gemini)}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={geminiBaseUrl} onChange={(e) => setGeminiBaseUrl(e.target.value)} placeholder={t('integrations.geminiBaseUrlPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.apiKey')}>
            <input
              type='password'
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={geminiConfig?.has_secret ? `${geminiConfig?.secret_preview || geminiKeyPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.geminiKeyPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveGemini()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveGemini')}
          </button>
        </IntegrationCard>}

        {/* Azure DevOps */}
        {activeTab === 'task' && <IntegrationCard
          title={t('integrations.providerAzure')}
          icon='🔷'
          color='#60a5fa'
          connected={azureConfig?.has_secret ?? false}
          updatedAt={azureConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.azure)}
        >
          <FieldGroup label={t('integrations.azureOrgUrl')}>
            <input value={azureOrgUrl} onChange={(e) => setAzureOrgUrl(e.target.value)} placeholder={t('integrations.azureOrgUrlPlaceholder')} />
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
          <button className='button button-primary' onClick={() => void saveAzure()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveAzure')}
          </button>
          {configs.find(c => c.provider === 'azure')?.has_secret && (
            <button onClick={() => void deleteIntegration('azure')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteAzureConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* GitHub */}
        {activeTab === 'task' && <IntegrationCard
          title={t('integrations.providerGithub')}
          icon='🐙'
          color='#a78bfa'
          connected={githubConfig?.has_secret ?? false}
          updatedAt={githubConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.github)}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={githubBaseUrl} onChange={(e) => setGithubBaseUrl(e.target.value)} placeholder={t('integrations.githubBaseUrlPlaceholder')} />
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
          <button className='button button-primary' onClick={() => void saveGithub()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveGithub')}
          </button>
          {configs.find(c => c.provider === 'github')?.has_secret && (
            <button onClick={() => void deleteIntegration('github')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteGithubConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* Jira */}
        {activeTab === 'task' && <IntegrationCard
          title={t('integrations.providerJira')}
          icon='🟦'
          color='#818cf8'
          connected={jiraConfig?.has_secret ?? false}
          updatedAt={jiraConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.jira)}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} placeholder={t('integrations.jiraBaseUrlPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.email')}>
            <input value={jiraEmail} onChange={(e) => setJiraEmail(e.target.value)} placeholder={t('integrations.jiraEmailPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.apiToken')}>
            <input
              type='password'
              value={jiraSecret}
              onChange={(e) => setJiraSecret(e.target.value)}
              placeholder={jiraConfig?.has_secret ? `${jiraConfig?.secret_preview || jiraTokenPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.apiTokenPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveJira()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveJira')}
          </button>
          {configs.find(c => c.provider === 'jira')?.has_secret && (
            <button onClick={() => void deleteIntegration('jira')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteJiraConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* New Relic */}
        {activeTab === 'task' && <IntegrationCard
          title={t('integrations.providerNewrelic')}
          icon='📊'
          color='#1CE783'
          connected={newrelicConfig?.has_secret ?? false}
          updatedAt={newrelicConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.newrelic)}
        >
          <FieldGroup label="Region">
            <select value={newrelicRegion} onChange={(e) => setNewrelicRegion(e.target.value)} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 13 }}>
              <option value="eu">EU (api.eu.newrelic.com)</option>
              <option value="us">US (api.newrelic.com)</option>
            </select>
          </FieldGroup>
          <FieldGroup label={t('integrations.newrelicAccountId')}>
            <input value={newrelicAccountId} onChange={(e) => setNewrelicAccountId(e.target.value)} placeholder={t('integrations.newrelicAccountIdPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.newrelicApiKey')}>
            <input
              type='password'
              value={newrelicApiKey}
              onChange={(e) => setNewrelicApiKey(e.target.value)}
              placeholder={newrelicConfig?.has_secret ? `${newrelicConfig?.secret_preview || newrelicApiKeyPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.newrelicApiKeyPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveNewrelic()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveNewrelic')}
          </button>
          {configs.find(c => c.provider === 'newrelic')?.has_secret && (
            <button onClick={() => void deleteIntegration('newrelic')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteNewrelicConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* Sentry */}
        {activeTab === 'task' && <IntegrationCard
          title={t('integrations.providerSentry')}
          icon='🚨'
          color='#f97316'
          connected={sentryConfig?.has_secret ?? false}
          updatedAt={sentryConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.sentry)}
        >
          <FieldGroup label={t('integrations.baseUrl')}>
            <input value={sentryBaseUrl} onChange={(e) => setSentryBaseUrl(e.target.value)} placeholder='https://sentry.io/api/0' />
          </FieldGroup>
          <FieldGroup label={t('integrations.sentryOrgSlug')}>
            <input value={sentryOrgSlug} onChange={(e) => setSentryOrgSlug(e.target.value)} placeholder={t('integrations.sentryOrgSlugPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.sentryApiToken')}>
            <input
              type='password'
              value={sentryToken}
              onChange={(e) => setSentryToken(e.target.value)}
              placeholder={sentryConfig?.has_secret ? `${sentryConfig?.secret_preview || sentryTokenPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.sentryApiTokenPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveSentry()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveSentry')}
          </button>
          {configs.find(c => c.provider === 'sentry')?.has_secret && (
            <button onClick={() => void deleteIntegration('sentry')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteSentryConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* HAL */}
        {activeTab === 'ai' && <IntegrationCard
          title={t('integrations.providerHal')}
          icon='🤖'
          color='#f472b6'
          connected={halConfig?.has_secret ?? false}
          updatedAt={halConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.hal)}
        >
          <FieldGroup label={t('integrations.halServiceUrl')}>
            <input value={halServiceUrl} onChange={(e) => setHalServiceUrl(e.target.value)} placeholder={t('integrations.halServiceUrlPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.halLoginUrl')}>
            <input value={halLoginUrl} onChange={(e) => setHalLoginUrl(e.target.value)} placeholder={t('integrations.halLoginUrlPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.halChatUrl')}>
            <input value={halChatUrl} onChange={(e) => setHalChatUrl(e.target.value)} placeholder={t('integrations.halChatUrlPlaceholder')} />
          </FieldGroup>
          <FieldGroup label={t('integrations.email')}>
            <input value={halUsername} onChange={(e) => setHalUsername(e.target.value)} placeholder='username@company.com' />
          </FieldGroup>
          <FieldGroup label={t('integrations.halPassword')}>
            <input
              type='password'
              value={halPassword}
              onChange={(e) => setHalPassword(e.target.value)}
              placeholder={halConfig?.has_secret ? `${halConfig?.secret_preview || halPasswordPreview || '****'} (${t('integrations.keepExisting')})` : t('integrations.halPasswordPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveHal()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveHal')}
          </button>
          {halConfig?.has_secret && (
            <button onClick={() => void deleteIntegration('hal')} style={{ width: '100%', marginTop: 4, padding: '7px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.15)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
              {t('integrations.deleteHalConnection')}
            </button>
          )}
        </IntegrationCard>}

        {/* Tenant Playbook */}
        {activeTab === 'ai' && <IntegrationCard
          title={t('integrations.providerPlaybook')}
          icon='📘'
          color='#f59e0b'
          connected={playbookConfig?.has_secret ?? false}
          updatedAt={playbookConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.playbook)}
        >
          <FieldGroup label={t('integrations.codingRules')}>
            <textarea
              value={playbookText}
              onChange={(e) => setPlaybookText(e.target.value)}
              rows={8}
              placeholder={t('integrations.playbookPlaceholder')}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void savePlaybook()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {isPlaybookSaving ? t('integrations.saving') : t('integrations.savePlaybook')}
          </button>
          <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 4 }}>
            {t('integrations.playbookStored')} ({playbookConfig?.updated_at ? `${t('integrations.updated')} ${new Date(playbookConfig.updated_at).toLocaleString()}` : t('integrations.notSavedYet')}).
          </div>
        </IntegrationCard>}

        {activeTab === 'notifications' && <IntegrationCard
          title={t('integrations.providerSlack')}
          icon='💬'
          color='#22c55e'
          connected={slackConfig?.has_secret ?? false}
          updatedAt={slackConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.slack)}
        >
          <FieldGroup label='Webhook URL (notifications)'>
            <input
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
              placeholder={slackConfig?.base_url && slackConfig.base_url !== 'https://hooks.slack.com/services' ? slackConfig.base_url : 'https://hooks.slack.com/services/T.../B.../xxx'}
            />
          </FieldGroup>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', margin: '10px 0 6px', letterSpacing: 0.5, textTransform: 'uppercase' }}>ChatOps (commands)</div>
          <FieldGroup label='Bot User OAuth Token (xoxb-...)'>
            <input
              type='password'
              value={slackBotToken}
              onChange={(e) => setSlackBotToken(e.target.value)}
              placeholder={slackConfig?.has_secret ? `${slackConfig?.secret_preview || slackPreview || '****'} (keep existing)` : 'xoxb-...'}
            />
          </FieldGroup>
          <FieldGroup label='Signing Secret'>
            <input
              type='password'
              value={slackSigningSecret}
              onChange={(e) => setSlackSigningSecret(e.target.value)}
              placeholder='e.g. a1b2c3d4e5...'
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveSlack()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveSlack')}
          </button>
          <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 8, lineHeight: 1.5 }}>
            Endpoint: <code>https://api.agena.dev/webhooks/slack</code>
          </div>
        </IntegrationCard>}

        {activeTab === 'notifications' && <IntegrationCard
          title={t('integrations.providerTeams')}
          icon='🟪'
          color='#60a5fa'
          connected={teamsConfig?.has_secret ?? false}
          updatedAt={teamsConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.teams)}
        >
          <FieldGroup label='Webhook URL (notifications)'>
            <input
              value={teamsWebhook}
              onChange={(e) => setTeamsWebhook(e.target.value)}
              placeholder={teamsConfig?.base_url && teamsConfig.base_url !== 'https://outlook.office.com/webhook' ? teamsConfig.base_url : 'https://outlook.office.com/webhook/...'}
            />
          </FieldGroup>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#5eead4', margin: '10px 0 6px', letterSpacing: 0.5, textTransform: 'uppercase' }}>ChatOps — Bot Framework</div>
          <FieldGroup label='Bot App ID'>
            <input
              value={teamsBotAppId}
              onChange={(e) => setTeamsBotAppId(e.target.value)}
              placeholder={teamsConfig?.project || 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
            />
          </FieldGroup>
          <FieldGroup label='Bot App Secret'>
            <input
              type='password'
              value={teamsBotSecret}
              onChange={(e) => setTeamsBotSecret(e.target.value)}
              placeholder={teamsConfig?.has_secret ? `${teamsConfig?.secret_preview || teamsPreview || '****'} (keep existing)` : 'App Secret from Azure'}
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveTeams()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            {t('integrations.saveTeams')}
          </button>
          <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 8, lineHeight: 1.5 }}>
            Messaging Endpoint: <code>https://api.agena.dev/webhooks/teams</code>
          </div>
        </IntegrationCard>}

        {activeTab === 'notifications' && <IntegrationCard
          title='Telegram ChatOps'
          icon='✈️'
          color='#38bdf8'
          connected={telegramConfig?.has_secret ?? false}
          updatedAt={telegramConfig?.updated_at}
          onHelp={() => setHelp(helpByProvider.telegram)}
        >
          <FieldGroup label='Bot Token (from @BotFather)'>
            <input
              type='password'
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder={telegramConfig?.has_secret ? `${telegramConfig?.secret_preview || telegramPreview || '****'} (keep existing)` : '7123456789:AAH...'}
            />
          </FieldGroup>
          <FieldGroup label='Chat / Group ID (optional, for org mapping)'>
            <input
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder='e.g. -100123456789'
            />
          </FieldGroup>
          <button className='button button-primary' onClick={() => void saveTelegram()} style={{ width: '100%', justifyContent: 'center', marginTop: 4, padding: '8px 0', fontSize: 12 }}>
            Save Telegram
          </button>
          {telegramSetupMsg && <div style={{ fontSize: 11, color: '#5eead4', marginTop: 6 }}>{telegramSetupMsg}</div>}
          <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 8, lineHeight: 1.5 }}>
            Commands: <code>/help</code> <code>/fix</code> <code>/status</code> <code>/queue</code> <code>/recent</code> <code>/stats</code> <code>/cancel</code>
          </div>
        </IntegrationCard>}

        {activeTab === 'notifications' && <IntegrationCard
          title={t('integrations.notificationRouter')}
          icon='🔔'
          color='#fb923c'
          connected={Boolean(slackConfig?.has_secret || teamsConfig?.has_secret)}
        >
          <div style={{ fontSize: 12, color: 'var(--ink-50)', lineHeight: 1.5 }}>
            {t('integrations.notificationRouterDesc')}
          </div>
          <button
            className='button button-primary'
            onClick={() => void sendTestNotification()}
            disabled={notifyTesting}
            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
          >
            {notifyTesting ? t('integrations.sending') : t('integrations.sendTestNotify')}
          </button>
        </IntegrationCard>}

        {/* CLI Agents */}
        {activeTab === 'cli' && (
          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 16 }}>
            <div style={{ borderRadius: 16, border: '1px solid rgba(168,85,247,0.25)', background: 'var(--surface)', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{t('integrations.cliBridgeTitle')}</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                    {t('integrations.cliBridgeDesc')}
                  </p>
                </div>
                <div style={{
                  padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                  background: cliBridgeStatus?.ok ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                  color: cliBridgeStatus?.ok ? '#22c55e' : '#f87171',
                  border: `1px solid ${cliBridgeStatus?.ok ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}`,
                }}>
                  {cliBridgeStatus === null ? t('integrations.cliUnchecked') : cliBridgeStatus.ok ? t('integrations.cliConnected') : t('integrations.cliDisconnected')}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ borderRadius: 12, border: '1px solid var(--panel-border-2)', padding: '14px 16px', background: 'var(--panel)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>⌘</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{t('integrations.codexCliTitle')}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: cliBridgeStatus?.codex ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                      color: cliBridgeStatus?.codex ? '#22c55e' : '#f87171',
                    }}>
                      {cliBridgeStatus?.codex ? t('integrations.cliInstalled') : t('integrations.cliNotFound')}
                    </span>
                    {cliBridgeStatus?.codex && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: cliBridgeStatus?.codex_auth ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                        color: cliBridgeStatus?.codex_auth ? '#22c55e' : '#f59e0b',
                      }}>
                        {cliBridgeStatus?.codex_auth ? t('integrations.cliAuthOk') : t('integrations.cliAuthRequired')}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                    {t('integrations.codexCliDesc')}
                  </p>
                  {cliBridgeStatus?.codex && cliBridgeStatus?.codex_auth && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className='button button-outline'
                        style={{ width: '100%', padding: '9px 14px', fontSize: 12, justifyContent: 'center' }}
                        onClick={() => {
                          fetch('http://localhost:9876/codex/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                            .then(async (r) => {
                              const text = await r.text();
                              let data: Record<string, unknown> = {};
                              if (text) {
                                try { data = JSON.parse(text) as Record<string, unknown>; }
                                catch { data = { message: text }; }
                              }
                              const status = typeof data.status === 'string' ? data.status : (r.ok ? 'ok' : 'error');
                              return { status, message: typeof data.message === 'string' ? data.message : '', detail: typeof data.detail === 'string' ? data.detail : '' };
                            })
                            .then((d) => {
                              if (d.status === 'ok') {
                                setMsg(t('integrations.codexSessionCleared'));
                                setCliBridgeStatus(s => s ? { ...s, codex_auth: false } : s);
                              } else {
                                setError(d.message || d.detail || t('integrations.codexLogoutFailed'));
                              }
                            })
                            .catch(() => setError(t('integrations.codexLogoutRequestFailed')))
                            .finally(() => {
                              fetch('http://localhost:9876/health')
                                .then(r => r.json())
                                .then(h => setCliBridgeStatus({
                                  ok: true,
                                  codex: h.codex,
                                  claude: h.claude,
                                  codex_auth: h.codex_auth,
                                  claude_auth: h.claude_auth,
                                }))
                                .catch(() => {});
                            });
                        }}
                      >
                        {t('integrations.clearSession')}
                      </button>
                    </div>
                  )}
                  {cliBridgeStatus?.codex && !cliBridgeStatus?.codex_auth && (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      <button style={{ width: '100%', padding: '11px 14px', fontSize: 13, fontWeight: 700, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => {
                        const popup = window.open('', '_blank');
                        setMsg('Starting device auth...');
                        fetch('http://localhost:9876/codex/device-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                          .then(r => r.json()).then(d => {
                            if (d.login_url) {
                              if (popup) popup.location.href = d.login_url;
                              else window.open(d.login_url, '_blank');
                              const codeEl = document.getElementById('codex-device-code');
                              const section = document.getElementById('codex-device-section');
                              if (codeEl && d.device_code) (codeEl as HTMLElement).textContent = d.device_code;
                              if (section) section.style.display = 'grid';
                              setMsg(d.device_code ? `Enter code: ${d.device_code}` : 'Complete login in browser');
                              const poll = setInterval(() => {
                                fetch('http://localhost:9876/health').then(r => r.json()).then(h => {
                                  if (h.codex_auth) { clearInterval(poll); setMsg('Login successful!'); setCliBridgeStatus(s => s ? { ...s, codex_auth: true } : s); if (section) section.style.display = 'none'; }
                                }).catch(() => {});
                              }, 3000);
                              setTimeout(() => clearInterval(poll), 300000);
                            } else if (d.already_auth) { setMsg('Already logged in'); setCliBridgeStatus(s => s ? { ...s, codex_auth: true } : s); }
                            else setMsg(d.message || 'Device auth started');
                          }).catch(() => setError(t('integrations.cliBridgeConnectionFailed')));
                      }}>Connect with ChatGPT</button>
                      <div id='codex-device-section' style={{ display: 'none', gap: 6, textAlign: 'center', padding: '16px', borderRadius: 12, border: '1px solid rgba(94,234,212,0.3)', background: 'rgba(94,234,212,0.06)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Enter this code in the browser:</div>
                        <div id='codex-device-code' style={{ fontSize: 28, fontWeight: 800, letterSpacing: 6, color: '#5eead4', fontFamily: 'monospace', padding: '10px 0' }}>----</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Waiting for confirmation...</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}><div style={{ flex: 1, height: 1, background: 'var(--panel-border-3)' }} /> {t('integrations.or')} <div style={{ flex: 1, height: 1, background: 'var(--panel-border-3)' }} /></div>
                      <div style={{ display: 'none', gap: 6 }}>
                        <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>{t('integrations.codexCallbackHint')}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input id='codex-callback-url' type='text' placeholder={t('integrations.codexCallbackPlaceholder')} style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 10, fontFamily: 'monospace' }} />
                          <button className='button button-primary' style={{ padding: '7px 12px', fontSize: 11, flexShrink: 0 }} onClick={() => {
                            const cbUrl = (document.getElementById('codex-callback-url') as HTMLInputElement)?.value;
                            if (!cbUrl || !cbUrl.includes('code=')) { setError(t('integrations.validCallbackRequired')); return; }
                            try {
                              const parsed = new URL(cbUrl);
                              fetch(`http://localhost:9876/auth/callback${parsed.search}`).then(() => {
                                setMsg(t('integrations.loginCompleting'));
                                setTimeout(() => fetch('http://localhost:9876/health').then(r => r.json()).then(h => {
                                  if (h.codex_auth) { setMsg(t('integrations.codexLoginSuccess')); setCliBridgeStatus(s => s ? { ...s, codex_auth: true } : s); }
                                  else setMsg(t('integrations.waitFewSeconds'));
                                }), 2000);
                              });
                            } catch { setError(t('integrations.invalidUrl')); }
                          }}>{t('integrations.complete')}</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}><div style={{ flex: 1, height: 1, background: 'var(--panel-border-3)' }} /> {t('integrations.or')} <div style={{ flex: 1, height: 1, background: 'var(--panel-border-3)' }} /></div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input id='codex-key' type='password' placeholder={t('integrations.codexApiKeyPlaceholder')} style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 12 }} />
                        <button className='button button-outline' style={{ padding: '7px 14px', fontSize: 12 }} onClick={() => {
                          const key = (document.getElementById('codex-key') as HTMLInputElement)?.value;
                          if (!key) { setError(t('integrations.apiKeyRequired')); return; }
                          fetch('http://localhost:9876/codex/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) })
                            .then(r => r.json()).then(d => { if (d.status === 'ok') { setMsg(t('integrations.codexApiKeySaved')); setCliBridgeStatus(s => s ? { ...s, codex_auth: true } : s); } else setError(d.message); })
                            .catch(() => setError(t('integrations.cliBridgeConnectionFailed')));
                        }}>{t('integrations.connectWithApiKey')}</button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ borderRadius: 12, border: '1px solid var(--panel-border-2)', padding: '14px 16px', background: 'var(--panel)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>◆</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{t('integrations.claudeCliTitle')}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: cliBridgeStatus?.claude ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                      color: cliBridgeStatus?.claude ? '#22c55e' : '#f87171',
                    }}>
                      {cliBridgeStatus?.claude ? t('integrations.cliInstalled') : t('integrations.cliNotFound')}
                    </span>
                    {cliBridgeStatus?.claude && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: cliBridgeStatus?.claude_auth ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                        color: cliBridgeStatus?.claude_auth ? '#22c55e' : '#f59e0b',
                      }}>
                        {cliBridgeStatus?.claude_auth ? t('integrations.cliAuthOk') : t('integrations.cliAuthRequired')}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                    {t('integrations.claudeCliDesc')}
                  </p>
                  {cliBridgeStatus?.claude && !cliBridgeStatus?.claude_auth && (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      <button className='button button-primary' style={{ width: '100%', padding: '9px 14px', fontSize: 12, justifyContent: 'center' }} onClick={() => {
                        const popup = window.open('', '_blank');
                        setMsg(t('integrations.claudeLoginStarting'));
                        fetch('http://localhost:9876/claude/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
                          .then(r => r.json()).then(d => {
                            if (d.login_url) {
                              if (popup) popup.location.href = d.login_url;
                              else window.open(d.login_url, '_blank');
                              setMsg(t('integrations.claudeLoginPageOpened'));
                              const poll = setInterval(() => {
                                fetch('http://localhost:9876/health').then(r => r.json()).then(h => {
                                  if (h.claude_auth) { clearInterval(poll); setMsg(t('integrations.claudeLoginSuccess')); setCliBridgeStatus(s => s ? { ...s, claude_auth: true } : s); }
                                }).catch(() => {});
                              }, 3000);
                              setTimeout(() => clearInterval(poll), 180000);
                            } else if (d.already_auth) { setMsg(t('integrations.cliAlreadyLoggedIn')); setCliBridgeStatus(s => s ? { ...s, claude_auth: true } : s); }
                            else setMsg(d.message || t('integrations.cliLoginStarted'));
                          }).catch(() => setError(t('integrations.cliBridgeConnectionFailed')));
                      }}>{t('integrations.connectWithAnthropic')}</button>
                      <div style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.5, padding: '6px 2px' }}>
                        Sign in from the opened browser tab. When complete, this status will update automatically.
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input id='claude-login-code' type='text' placeholder='If Claude gave a code, paste it here' style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 10, fontFamily: 'monospace' }} />
                        <button className='button button-primary' style={{ padding: '7px 12px', fontSize: 11, flexShrink: 0 }} onClick={() => {
                          const code = ((document.getElementById('claude-login-code') as HTMLInputElement)?.value || '').trim();
                          if (!code) { setError('Login code is required'); return; }
                          fetch('http://localhost:9876/claude/login/code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code }),
                          }).then(r => r.json()).then(d => {
                            if (d.status !== 'ok') { setError(d.message || 'Could not submit code'); return; }
                            setMsg('Code submitted, completing login...');
                            setTimeout(() => fetch('http://localhost:9876/health').then(r => r.json()).then(h => {
                              if (h.claude_auth) { setMsg(t('integrations.claudeLoginSuccess')); setCliBridgeStatus(s => s ? { ...s, claude_auth: true } : s); }
                              else setMsg(t('integrations.waitFewSeconds'));
                            }), 3000);
                          }).catch(() => setError(t('integrations.cliBridgeConnectionFailed')));
                        }}>{t('integrations.complete')}</button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}><div style={{ flex: 1, height: 1, background: 'var(--panel-border-3)' }} /> {t('integrations.or')} <div style={{ flex: 1, height: 1, background: 'var(--panel-border-3)' }} /></div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input id='claude-key' type='password' placeholder={t('integrations.claudeApiKeyPlaceholder')} style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 12 }} />
                        <button className='button button-outline' style={{ padding: '7px 14px', fontSize: 12 }} onClick={() => {
                          const key = (document.getElementById('claude-key') as HTMLInputElement)?.value;
                          if (!key) { setError(t('integrations.apiKeyRequired')); return; }
                          fetch('http://localhost:9876/claude/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) })
                            .then(r => r.json()).then(d => { if (d.status === 'ok') { setMsg(t('integrations.claudeApiKeySaved')); setCliBridgeStatus(s => s ? { ...s, claude_auth: true } : s); } else setError(d.message); })
                            .catch(() => setError(t('integrations.cliBridgeConnectionFailed')));
                        }}>{t('integrations.connectWithApiKey')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ borderRadius: 12, border: '1px solid rgba(168,85,247,0.2)', background: 'rgba(168,85,247,0.05)', padding: '14px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{t('integrations.bridgeHowToTitle')}</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--ink-72)', lineHeight: 1.8 }}>
                  <li>{t('integrations.bridgeStep1')}</li>
                </ol>
                <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 8, background: 'var(--terminal-bg)', fontFamily: 'monospace', fontSize: 11, color: 'var(--ink-65)' }}>
                  python3 cli_bridge.py
                </div>
                <ol start={2} style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--ink-72)', lineHeight: 1.8 }}>
                  <li>{t('integrations.bridgeStep2')}</li>
                  <li>{t('integrations.bridgeStep3')}</li>
                </ol>
              </div>

              <button
                className='button button-outline'
                style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  fetch('http://localhost:9876/health').then(r => r.json()).then(d => { setCliBridgeStatus({ ok: true, codex: d.codex, claude: d.claude, codex_auth: d.codex_auth, claude_auth: d.claude_auth }); setMsg(t('integrations.bridgeConnected')); }).catch(() => { setCliBridgeStatus({ ok: false, codex: false, claude: false, codex_auth: false, claude_auth: false }); setError(t('integrations.bridgeDisconnected')); });
                }}
              >
                {t('integrations.checkBridgeStatus')}
              </button>
            </div>
          </div>
        )}
      </div>
      {help && (
        <div
          onClick={() => setHelp(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 520,
              borderRadius: 14,
              border: '1px solid var(--panel-border)',
              background: 'var(--surface)',
              padding: 16,
              color: 'var(--ink-90)',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{help.title}</div>
              <button
                onClick={() => setHelp(null)}
                style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--panel-alt)', border: '1px solid var(--panel-border)', color: 'var(--ink-50)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              {help.steps.map((step, idx) => (
                <div key={step} style={{ fontSize: 12, color: 'var(--ink-72)', lineHeight: 1.5, display: 'flex', gap: 6 }}>
                  <span style={{ color: 'var(--ink-30)', fontWeight: 700, flexShrink: 0, minWidth: 16 }}>{idx + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
            {help.note && (
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', fontSize: 11, color: 'rgba(251,191,36,0.85)', lineHeight: 1.5 }}>
                {help.note}
              </div>
            )}
            {help.link && (
              <a
                href={help.link}
                target='_blank'
                rel='noreferrer'
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 10, color: '#93c5fd', fontSize: 11, textDecoration: 'none', fontWeight: 600 }}
              >
                {t('integrations.openDocumentation')} ↗
              </a>
            )}
          </div>
        </div>
      )}
      <style jsx>{`
        .integrations-root {
          position: relative;
        }
        .integrations-root::before {
          content: '';
          position: absolute;
          top: -80px;
          right: -120px;
          width: 340px;
          height: 340px;
          border-radius: 999px;
          background: radial-gradient(circle at center, rgba(56, 189, 248, 0.22) 0%, rgba(56, 189, 248, 0) 65%);
          pointer-events: none;
        }
        .integrations-root::after {
          content: '';
          position: absolute;
          top: 120px;
          left: -110px;
          width: 300px;
          height: 300px;
          border-radius: 999px;
          background: radial-gradient(circle at center, rgba(251, 146, 60, 0.16) 0%, rgba(251, 146, 60, 0) 62%);
          pointer-events: none;
        }
        .int-hero {
          border: 1px solid var(--panel-border);
          border-radius: 18px;
          padding: 18px 18px 16px;
          background:
            linear-gradient(120deg, rgba(28, 231, 131, 0.06), rgba(96, 165, 250, 0.05)),
            var(--surface);
          position: relative;
          overflow: hidden;
        }
        .int-hero::after {
          content: '';
          position: absolute;
          width: 280px;
          height: 280px;
          right: -90px;
          top: -140px;
          border-radius: 999px;
          background: radial-gradient(circle at center, rgba(167, 139, 250, 0.25), rgba(167, 139, 250, 0));
          pointer-events: none;
        }
        .int-summary {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .summary-pill {
          border-radius: 999px;
          border: 1px solid var(--panel-border-2);
          background: var(--glass);
          color: var(--ink-55);
          font-size: 11px;
          font-weight: 600;
          padding: 6px 11px;
          display: inline-flex;
          gap: 8px;
          align-items: center;
        }
        .summary-pill strong {
          color: var(--ink);
          font-size: 12px;
          letter-spacing: 0.2px;
        }
        .integrations-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          align-items: stretch;
          position: relative;
          z-index: 1;
        }
        @media (max-width: 1500px) {
          .integrations-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 768px) {
          .integrations-grid { grid-template-columns: 1fr; gap: 10px; }
        }
        .integrations-grid :global(.int-card:hover) {
          border-color: color-mix(in oklab, var(--border) 82%, white 18%);
          box-shadow: 0 18px 40px rgba(2, 6, 23, 0.18);
          transform: translateY(-2px);
        }
        .integrations-grid :global(.int-card) {
          backdrop-filter: blur(8px);
        }
        .integrations-grid :global(input),
        .integrations-grid :global(select) {
          width: 100%;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--panel-border-2);
          background: color-mix(in oklab, var(--glass) 78%, white 22%);
          color: var(--ink);
          font-size: 12px;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
          outline: none;
        }
        .integrations-grid :global(input:focus),
        .integrations-grid :global(select:focus) {
          border-color: var(--border);
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
          background: color-mix(in oklab, var(--surface) 92%, white 8%);
        }
        .integrations-grid :global(input::placeholder) {
          color: var(--ink-20);
          font-size: 11px;
        }
        .integrations-grid :global(.button-primary) {
          min-height: 32px;
          padding: 6px 10px !important;
          font-size: 11px !important;
          border-radius: 10px;
          font-weight: 700;
          letter-spacing: 0.1px;
          transition: opacity 0.15s, transform 0.15s;
        }
        .integrations-grid :global(.button-primary:hover) {
          opacity: 0.92;
          transform: translateY(-0.5px);
        }
        .integrations-grid :global(.button-outline) {
          min-height: 32px;
          padding: 6px 10px !important;
          font-size: 11px !important;
          border-radius: 10px;
        }
        .integrations-grid :global(textarea) {
          width: 100%;
          padding: 9px 10px;
          border-radius: 10px;
          border: 1px solid var(--panel-border-2);
          background: color-mix(in oklab, var(--glass) 78%, white 22%);
          color: var(--ink);
          font-size: 12px;
          line-height: 1.5;
          resize: vertical;
        }
        .connected-dot {
          animation: connectedPulse 2s ease-out infinite;
          box-shadow: 0 0 0 rgba(34, 197, 94, 0.55);
        }
        @keyframes connectedPulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55); }
          70% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        @keyframes toastSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .int-tab-bar {
          display: inline-flex;
          gap: 8px;
          padding: 6px;
          border-radius: 14px;
          background: color-mix(in oklab, var(--panel) 90%, white 10%);
          border: 1px solid var(--panel-border-2);
          width: fit-content;
          max-width: 100%;
        }
        .int-tab-btn {
          --tab-color: #22d3ee;
          border: 1px solid transparent;
          background: transparent;
          border-radius: 11px;
          min-width: 126px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--ink-45);
          cursor: pointer;
          padding: 8px 12px;
          transition: all 0.2s ease;
          font-size: 12px;
          font-weight: 600;
        }
        .int-tab-btn[data-active='1'] {
          border-color: color-mix(in oklab, var(--tab-color) 35%, transparent);
          color: var(--tab-color);
          background: color-mix(in oklab, var(--tab-color) 12%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--tab-color) 22%, transparent);
        }
        .int-tab-icon {
          width: 20px;
          height: 20px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in oklab, var(--tab-color) 16%, transparent);
          font-size: 11px;
          line-height: 1;
          flex-shrink: 0;
        }
        .int-tab-count {
          margin-left: auto;
          min-width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 1px solid color-mix(in oklab, var(--tab-color) 35%, transparent);
          background: color-mix(in oklab, var(--tab-color) 16%, transparent);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
        }
        @media (max-width: 768px) {
          .int-tab-bar {
            display: flex;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            width: 100%;
          }
          .int-tab-bar::-webkit-scrollbar { display: none; }
          .int-tab-bar button { white-space: nowrap; flex-shrink: 0; }
          .int-tab-btn { min-width: 112px; }
          .int-hero { padding: 14px; }
        }
      `}</style>
    </div>
  );
}

function IntegrationCard({
  title, icon, color, connected, updatedAt, children, onHelp,
}: {
  title: string; icon: string; color: string; connected: boolean; updatedAt?: string; children: React.ReactNode; onHelp?: () => void;
}) {
  const { t } = useLocale();
  const statusText = connected ? t('integrations.connected') : t('integrations.notConfigured');
  return (
    <div className="int-card" style={{
      borderRadius: 18,
      border: `1px solid ${connected ? 'color-mix(in oklab, #22c55e 40%, var(--panel-border))' : 'var(--panel-border)'}`,
      background: `linear-gradient(140deg, color-mix(in oklab, ${color} 10%, transparent), transparent 46%), var(--surface)`,
      padding: '12px 12px 12px 16px',
      position: 'relative',
      overflow: 'hidden',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s, background 0.2s',
    }}>
      <div style={{
        position: 'absolute',
        top: 10,
        left: 6,
        bottom: 10,
        width: 3,
        borderRadius: 999,
        background: connected ? '#22c55e' : color,
        opacity: connected ? 0.95 : 0.7,
      }} />
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '2px 2px 10px 4px',
        borderBottom: '1px dashed var(--panel-border-2)',
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: `linear-gradient(150deg, ${color}2f, ${color}14)`,
          border: `1px solid ${color}4a`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, lineHeight: 1, flexShrink: 0,
        }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, color: 'var(--ink)', fontSize: 13, letterSpacing: 0.1 }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              borderRadius: 999,
              border: `1px solid ${connected ? 'rgba(34,197,94,0.35)' : 'var(--panel-border-2)'}`,
              background: connected ? 'rgba(34,197,94,0.1)' : 'var(--panel)',
              color: connected ? '#22c55e' : 'var(--ink-35)',
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.25,
              padding: '2px 7px',
            }}>
              <span className={connected ? 'connected-dot' : ''} style={{
                width: 5, height: 5, borderRadius: '50%',
                background: connected ? '#22c55e' : 'var(--ink-20)', flexShrink: 0,
              }} />
              {statusText}
            </span>
            {connected && updatedAt && (
              <span style={{ fontSize: 9, color: 'var(--ink-30)', fontWeight: 600 }}>
                {new Date(updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {onHelp && (
          <button type='button' onClick={onHelp} title={t('integrations.help')}
            style={{
              width: 22, height: 22, borderRadius: 7,
              border: `1px solid ${color}52`,
              background: 'var(--glass)', color: 'var(--ink-35)',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
            ?
          </button>
        )}
      </div>
      <div style={{
        display: 'grid',
        gap: 9,
        flex: 1,
        padding: '12px 6px 4px 4px',
      }}>{children}</div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{
        fontSize: 10, color: 'var(--ink-45)', fontWeight: 700,
        letterSpacing: 0.2, textTransform: 'uppercase',
        display: 'block', marginBottom: 5,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}
