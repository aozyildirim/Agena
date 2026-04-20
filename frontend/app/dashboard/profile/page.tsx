'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, removeToken, loadPrefs, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type MeRes = { user_id: number; email: string; full_name: string; organization_id: number };
type ProfileSettings = {
  email_notifications: boolean;
  web_push_notifications: boolean;
  daily_summary: boolean;
  auto_assign_new_tasks: boolean;
  default_create_pr: boolean;
  preferred_provider: string;
  preferred_model: string;
  branch_prefix: string;
  queue_warn_threshold: number;
  notification_preferences: Record<string, { in_app: boolean; email: boolean; web_push: boolean }>;
};

const EVENT_PREF_DEFAULTS: Record<string, { in_app: boolean; email: boolean; web_push: boolean }> = {
  task_queued: { in_app: true, email: false, web_push: false },
  task_running: { in_app: true, email: false, web_push: false },
  task_completed: { in_app: true, email: true, web_push: true },
  task_failed: { in_app: true, email: true, web_push: true },
  pr_created: { in_app: true, email: false, web_push: true },
  pr_failed: { in_app: true, email: true, web_push: true },
  approval_required: { in_app: true, email: false, web_push: true },
  approval_decision: { in_app: true, email: false, web_push: true },
  integration_auth_expired: { in_app: true, email: true, web_push: true },
  queue_backlog_warning: { in_app: true, email: false, web_push: true },
};

export default function ProfilePage() {
  const router = useRouter();
  const { t } = useLocale();
  const [user, setUser] = useState<MeRes | null>(null);
  const [profileSettings, setProfileSettings] = useState<ProfileSettings>({
    email_notifications: true,
    web_push_notifications: true,
    daily_summary: false,
    auto_assign_new_tasks: false,
    default_create_pr: true,
    preferred_provider: 'openai',
    preferred_model: 'gpt-5',
    branch_prefix: 'ai/task',
    queue_warn_threshold: 5,
    notification_preferences: EVENT_PREF_DEFAULTS,
  });
  const [extraSettings, setExtraSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<MeRes>('/auth/me').then(setUser).catch(() => {});

    loadPrefs().then((prefs) => {
      const rawSettings = (prefs.profile_settings || {}) as Record<string, unknown>;
      setExtraSettings(rawSettings);
      setProfileSettings((prev) => ({
        ...prev,
        email_notifications: rawSettings.email_notifications !== false,
        web_push_notifications: rawSettings.web_push_notifications !== false,
        daily_summary: rawSettings.daily_summary === true,
        auto_assign_new_tasks: rawSettings.auto_assign_new_tasks === true,
        default_create_pr: rawSettings.default_create_pr !== false,
        preferred_provider: typeof rawSettings.preferred_provider === 'string' ? rawSettings.preferred_provider : prev.preferred_provider,
        preferred_model: typeof rawSettings.preferred_model === 'string' ? rawSettings.preferred_model : prev.preferred_model,
        branch_prefix: typeof rawSettings.branch_prefix === 'string' ? rawSettings.branch_prefix : prev.branch_prefix,
        queue_warn_threshold: typeof rawSettings.queue_warn_threshold === 'number' ? Math.max(1, Math.floor(rawSettings.queue_warn_threshold)) : prev.queue_warn_threshold,
        notification_preferences: (typeof rawSettings.notification_preferences === 'object' && rawSettings.notification_preferences)
          ? {
            ...EVENT_PREF_DEFAULTS,
            ...(rawSettings.notification_preferences as Record<string, { in_app: boolean; email: boolean; web_push: boolean }>),
          }
          : prev.notification_preferences,
      }));
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await savePrefs({
        profile_settings: {
          ...extraSettings,
          ...(profileSettings as unknown as Record<string, unknown>),
        },
      });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    removeToken();
    router.push('/');
  }

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 1100 }}>
      <div>
        <div className='section-label'>{t('profile.section')}</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
          {t('profile.title')}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink-30)', margin: 0 }}>{t('profile.subtitle')}</p>
      </div>

      {user && (
        <div style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: 18, display: 'flex', alignItems: 'center', gap: 16, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.4), transparent)' }} />
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            {(user.full_name?.[0] || user.email[0]).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 3 }}>{user.full_name || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>{user.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(13,148,136,0.15)', border: '1px solid rgba(13,148,136,0.3)', color: '#5eead4' }}>{t('profile.proPlan')}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-25)', padding: '3px 10px' }}>{t('profile.org')} #{user.organization_id}</span>
            </div>
          </div>
          <button onClick={logout} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.06)', color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            {t('profile.logout')}
          </button>
        </div>
      )}

      <div style={{ borderRadius: 14, border: '1px dashed var(--panel-border-2)', background: 'var(--panel)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 18 }}>🗂</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-78)' }}>{t('profile.activeSprintMoved')}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 2 }}>{t('profile.activeSprintMovedDesc')}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14, alignItems: 'start' }}>
        <div style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: 18, display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14 }}>{t('profile.workspacePreferences')}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 2 }}>{t('profile.workspacePreferencesDesc')}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ToggleRow label={t('profile.emailNotifications')} checked={profileSettings.email_notifications} onChange={(v) => { setProfileSettings((p) => ({ ...p, email_notifications: v })); setSaved(false); }} />
            <ToggleRow label={t('profile.webPushNotifications')} checked={profileSettings.web_push_notifications} onChange={(v) => { setProfileSettings((p) => ({ ...p, web_push_notifications: v })); setSaved(false); }} />
            <ToggleRow label={t('profile.dailySummaryEmail')} checked={profileSettings.daily_summary} onChange={(v) => { setProfileSettings((p) => ({ ...p, daily_summary: v })); setSaved(false); }} />
            <ToggleRow label={t('profile.autoAssignNewTasks')} checked={profileSettings.auto_assign_new_tasks} onChange={(v) => { setProfileSettings((p) => ({ ...p, auto_assign_new_tasks: v })); setSaved(false); }} />
            <ToggleRow label={t('profile.createPrByDefault')} checked={profileSettings.default_create_pr} onChange={(v) => { setProfileSettings((p) => ({ ...p, default_create_pr: v })); setSaved(false); }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ProfileInput
              label={t('profile.preferredProvider')}
              value={profileSettings.preferred_provider}
              onChange={(v) => { setProfileSettings((p) => ({ ...p, preferred_provider: v })); setSaved(false); }}
              placeholder={t('profile.preferredProviderPlaceholder')}
            />
            <ProfileInput
              label={t('profile.preferredModel')}
              value={profileSettings.preferred_model}
              onChange={(v) => { setProfileSettings((p) => ({ ...p, preferred_model: v })); setSaved(false); }}
              placeholder={t('profile.preferredModelPlaceholder')}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-50)', marginBottom: 6 }}>{t('profile.branchPattern')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                { label: 'feature/AB#{ext_id}-{title_slug}', desc: 'feature/AB#61717-merchant-status' },
                { label: 'feature/{ext_id}-{title_slug}', desc: 'feature/61717-merchant-status' },
                { label: 'bugfix/{ext_id}', desc: 'bugfix/61717' },
                { label: '{ext_id}/{title_slug}', desc: '61717/merchant-status' },
                { label: 'ai-task/{id}-{timestamp}', desc: 'ai-task/47-20260327' },
                { label: 'feature/{title_slug}', desc: 'feature/merchant-status' },
              ].map((p) => (
                <button key={p.label} onClick={() => { setProfileSettings((prev) => ({ ...prev, branch_prefix: p.label })); setSaved(false); }}
                  style={{
                    padding: '6px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                    border: profileSettings.branch_prefix === p.label ? '1px solid rgba(94,234,212,0.5)' : '1px solid var(--panel-border-3)',
                    background: profileSettings.branch_prefix === p.label ? 'rgba(94,234,212,0.12)' : 'var(--panel)',
                    color: profileSettings.branch_prefix === p.label ? '#5eead4' : 'var(--ink-50)',
                    fontFamily: 'monospace', fontWeight: 600,
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
            <input
              value={profileSettings.branch_prefix}
              onChange={(e) => { setProfileSettings((p) => ({ ...p, branch_prefix: e.target.value })); setSaved(false); }}
              placeholder={t('profile.branchPatternPlaceholder')}
              style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 10, color: 'var(--ink-25)', marginTop: 6, fontFamily: 'monospace' }}>
              {t('profile.preview')}: {(profileSettings.branch_prefix || 'feature/AB#{ext_id}-{title_slug}')
                .replace('{ext_id}', '61717')
                .replace('{title_slug}', 'merchant-status')
                .replace('{id}', '47')
                .replace('{timestamp}', '20260327')}
            </div>
          </div>
          <ProfileInput
            label={t('profile.queueWarningThreshold')}
            value={String(profileSettings.queue_warn_threshold)}
            onChange={(v) => {
              const n = Number(v);
              setProfileSettings((p) => ({ ...p, queue_warn_threshold: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : p.queue_warn_threshold }));
              setSaved(false);
            }}
            placeholder={t('profile.queueWarningThresholdPlaceholder')}
          />
          <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 10, background: 'var(--panel)' }}>
            <div style={{ fontSize: 12, color: 'var(--ink-78)', fontWeight: 700, marginBottom: 8 }}>{t('profile.eventNotificationMatrix')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.7fr', gap: 8, fontSize: 11, color: 'var(--ink-35)', marginBottom: 6 }}>
              <div>{t('profile.event')}</div><div>{t('profile.inApp')}</div><div>{t('profile.email')}</div><div>{t('profile.webPush')}</div>
            </div>
            {Object.keys(EVENT_PREF_DEFAULTS).map((eventKey) => {
              const channels = profileSettings.notification_preferences[eventKey] || EVENT_PREF_DEFAULTS[eventKey];
              return (
                <div key={eventKey} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.7fr', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--panel-alt)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-78)' }}>{t(`profile.event.${eventKey}` as Parameters<typeof t>[0])}</div>
                  <MiniToggle checked={channels.in_app} onChange={(v) => { setProfileSettings((p) => ({ ...p, notification_preferences: { ...p.notification_preferences, [eventKey]: { ...channels, in_app: v } } })); setSaved(false); }} />
                  <MiniToggle checked={channels.email} onChange={(v) => { setProfileSettings((p) => ({ ...p, notification_preferences: { ...p.notification_preferences, [eventKey]: { ...channels, email: v } } })); setSaved(false); }} />
                  <MiniToggle checked={channels.web_push} onChange={(v) => { setProfileSettings((p) => ({ ...p, notification_preferences: { ...p.notification_preferences, [eventKey]: { ...channels, web_push: v } } })); setSaved(false); }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {err ? <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{err}</div> : null}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => void save()} disabled={saving}
          style={{ padding: '11px 16px', borderRadius: 12, border: 'none', background: saved ? 'rgba(34,197,94,0.3)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.3s', minWidth: 170 }}>
          {saving ? t('profile.saving') : saved ? t('profile.saved') : t('profile.save')}
        </button>
      </div>

      <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-72)' }}>{t('profile.integrations')}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-30)', marginTop: 2 }}>{t('profile.integrationsDesc')}</div>
        </div>
        <a href='/dashboard/integrations' style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-50)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
          {t('profile.settings')}
        </a>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type='button'
      onClick={() => onChange(!checked)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--panel-border-2)', borderRadius: 10, padding: '9px 10px', background: checked ? 'rgba(13,148,136,0.12)' : 'var(--panel)', cursor: 'pointer' }}
    >
      <span style={{ fontSize: 12, color: 'var(--ink-78)', textAlign: 'left' }}>{label}</span>
      <span style={{ width: 34, height: 18, borderRadius: 999, background: checked ? 'rgba(13,148,136,0.9)' : 'var(--ink-25)', padding: 2, display: 'inline-flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'all 0.2s' }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
      </span>
    </button>
  );
}

function ProfileInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type='button' onClick={() => onChange(!checked)}
      style={{ width: 34, height: 18, borderRadius: 999, background: checked ? 'rgba(13,148,136,0.9)' : 'var(--ink-25)', padding: 2, border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', cursor: 'pointer' }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
    </button>
  );
}
