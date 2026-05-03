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

// Provider + model dropdown options. Splitting these out so the profile
// form stops being a free-text trap — the previous version saved
// whatever the user typed, which is how `preferred_provider="openai"`
// got stuck on accounts that had no OpenAI integration plugged in.
const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'claude_cli', label: 'Claude CLI (subscription)' },
  { value: 'codex_cli', label: 'Codex CLI (subscription)' },
  { value: 'openai', label: 'OpenAI (API key)' },
  { value: 'anthropic', label: 'Anthropic (API key)' },
  { value: 'gemini', label: 'Google Gemini (API key)' },
  { value: 'hal', label: 'HAL (self-hosted)' },
];

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  claude_cli: ['sonnet', 'opus', 'haiku'],
  codex_cli: ['gpt-5', 'gpt-5-mini'],
  openai: ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o3-mini'],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  hal: ['hal'],
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
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

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

  // Auto-dismiss toast after 2.8s. Using a fresh effect per toast value
  // means setting a new toast immediately replaces the timer rather than
  // racing with the previous one.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  function patch<K extends keyof ProfileSettings>(key: K, value: ProfileSettings[K]) {
    setProfileSettings((p) => ({ ...p, [key]: value }));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await savePrefs({
        profile_settings: {
          ...extraSettings,
          ...(profileSettings as unknown as Record<string, unknown>),
        },
      });
      setDirty(false);
      setToast({ kind: 'ok', msg: t('profile.saved') });
    } catch (e) {
      setToast({ kind: 'err', msg: e instanceof Error ? e.message : t('profile.saveFailed') });
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    removeToken();
    router.push('/');
  }

  const branchPreviewSrc = profileSettings.branch_prefix || 'feature/AB#{ext_id}-{title_slug}';

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 1200, margin: '0 auto' }}>
      {/* ── Sticky header: title + Save button always reachable ── */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 5,
          padding: '14px 18px',
          marginLeft: -18, marginRight: -18, marginTop: -18,
          background: 'var(--surface, var(--panel-alt))',
          borderBottom: '1px solid var(--panel-border-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className='section-label'>{t('profile.section')}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginTop: 4, marginBottom: 2 }}>
            {t('profile.title')}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--ink-30)' }}>{t('profile.subtitle')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && (
            <span style={{ fontSize: 11, color: '#fde68a', fontWeight: 600 }}>
              ● {t('profile.unsavedChanges' as Parameters<typeof t>[0]) || 'Unsaved changes'}
            </span>
          )}
          <button
            type='button'
            onClick={() => void save()}
            disabled={saving || !dirty}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none',
              background: saving
                ? 'rgba(124,58,237,0.4)'
                : (!dirty ? 'rgba(148,163,184,0.18)' : 'linear-gradient(135deg, #7c3aed, #a78bfa)'),
              color: !dirty && !saving ? 'var(--ink-50)' : '#fff',
              fontWeight: 700, fontSize: 13,
              cursor: saving || !dirty ? 'not-allowed' : 'pointer',
              minWidth: 130, transition: 'all 0.2s',
            }}
          >
            {saving ? `⏳ ${t('profile.saving')}` : `💾 ${t('profile.save')}`}
          </button>
        </div>
      </div>

      {/* ── User card ── */}
      {user && (
        <div style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: 18, display: 'flex', alignItems: 'center', gap: 16, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.4), transparent)' }} />
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            {(user.full_name?.[0] || user.email[0]).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 3 }}>{user.full_name || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-35)' }}>{user.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
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

      {/* ── Two-column body: workspace preferences (left) + notification matrix (right) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* LEFT: workspace preferences */}
        <div style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: 18, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14 }}>{t('profile.workspacePreferences')}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 2 }}>{t('profile.workspacePreferencesDesc')}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ToggleRow label={t('profile.emailNotifications')} checked={profileSettings.email_notifications} onChange={(v) => patch('email_notifications', v)} />
            <ToggleRow label={t('profile.webPushNotifications')} checked={profileSettings.web_push_notifications} onChange={(v) => patch('web_push_notifications', v)} />
            <ToggleRow label={t('profile.dailySummaryEmail')} checked={profileSettings.daily_summary} onChange={(v) => patch('daily_summary', v)} />
            <ToggleRow label={t('profile.autoAssignNewTasks')} checked={profileSettings.auto_assign_new_tasks} onChange={(v) => patch('auto_assign_new_tasks', v)} />
            <ToggleRow label={t('profile.createPrByDefault')} checked={profileSettings.default_create_pr} onChange={(v) => patch('default_create_pr', v)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ProfileSelect
              label={t('profile.preferredProvider')}
              value={profileSettings.preferred_provider}
              onChange={(v) => {
                // Switching provider also resets the model to that
                // provider's default so a stale "gpt-5" doesn't follow
                // the user into Claude CLI and silently break runs.
                const fallbackModel = MODELS_BY_PROVIDER[v]?.[0] || profileSettings.preferred_model;
                setProfileSettings((p) => ({ ...p, preferred_provider: v, preferred_model: fallbackModel }));
                setDirty(true);
              }}
              options={PROVIDER_OPTIONS}
            />
            <ProfileSelect
              label={t('profile.preferredModel')}
              value={profileSettings.preferred_model}
              onChange={(v) => patch('preferred_model', v)}
              options={(MODELS_BY_PROVIDER[profileSettings.preferred_provider] || MODELS_BY_PROVIDER.openai).map((m) => ({ value: m, label: m }))}
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
                <button key={p.label} onClick={() => patch('branch_prefix', p.label)}
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
              onChange={(e) => patch('branch_prefix', e.target.value)}
              placeholder={t('profile.branchPatternPlaceholder')}
              style={{ width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'var(--glass)', color: 'var(--ink-90)', fontSize: 12, fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 10, color: 'var(--ink-25)', marginTop: 6, fontFamily: 'monospace' }}>
              {t('profile.preview')}: {branchPreviewSrc
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
              if (Number.isFinite(n)) patch('queue_warn_threshold', Math.max(1, Math.floor(n)));
            }}
            placeholder={t('profile.queueWarningThresholdPlaceholder')}
          />
        </div>

        {/* RIGHT: notification matrix */}
        <div style={{ borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel-alt)', padding: 18, display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--ink-90)', fontSize: 14 }}>{t('profile.eventNotificationMatrix')}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-35)', marginTop: 2 }}>
              {t('profile.eventNotificationMatrixDesc' as Parameters<typeof t>[0]) || t('profile.workspacePreferencesDesc')}
            </div>
          </div>
          <div style={{ border: '1px solid var(--panel-border-2)', borderRadius: 12, padding: 10, background: 'var(--panel)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.7fr', gap: 8, fontSize: 11, color: 'var(--ink-35)', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <div>{t('profile.event')}</div><div>{t('profile.inApp')}</div><div>{t('profile.email')}</div><div>{t('profile.webPush')}</div>
            </div>
            {Object.keys(EVENT_PREF_DEFAULTS).map((eventKey) => {
              const channels = profileSettings.notification_preferences[eventKey] || EVENT_PREF_DEFAULTS[eventKey];
              const updateChannel = (k: 'in_app' | 'email' | 'web_push', v: boolean) => {
                setProfileSettings((p) => ({
                  ...p,
                  notification_preferences: {
                    ...p.notification_preferences,
                    [eventKey]: { ...channels, [k]: v },
                  },
                }));
                setDirty(true);
              };
              return (
                <div key={eventKey} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.7fr', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--panel-alt)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-78)' }}>{t(`profile.event.${eventKey}` as Parameters<typeof t>[0])}</div>
                  <MiniToggle checked={channels.in_app} onChange={(v) => updateChannel('in_app', v)} />
                  <MiniToggle checked={channels.email} onChange={(v) => updateChannel('email', v)} />
                  <MiniToggle checked={channels.web_push} onChange={(v) => updateChannel('web_push', v)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Integrations footer ── */}
      <div style={{ borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--panel)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-72)' }}>{t('profile.integrations')}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-30)', marginTop: 2 }}>{t('profile.integrationsDesc')}</div>
        </div>
        <a href='/dashboard/integrations' style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--panel-border-3)', background: 'transparent', color: 'var(--ink-50)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
          {t('profile.settings')}
        </a>
      </div>

      {/* ── Toast: pinned bottom-right, auto-dismiss ── */}
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 100,
            minWidth: 240, maxWidth: 380,
            padding: '12px 16px', borderRadius: 12,
            background: toast.kind === 'ok' ? 'rgba(34,197,94,0.18)' : 'rgba(248,113,113,0.18)',
            border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.5)' : 'rgba(248,113,113,0.5)'}`,
            color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
            fontSize: 13, fontWeight: 600,
            display: 'flex', gap: 10, alignItems: 'center',
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(10px)',
            animation: 'profileToastIn 0.2s ease-out',
          }}
          onClick={() => setToast(null)}
        >
          <span style={{ fontSize: 18 }}>{toast.kind === 'ok' ? '✓' : '⚠'}</span>
          <span>{toast.msg}</span>
        </div>
      )}
      <style jsx>{`
        @keyframes profileToastIn {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
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

function ProfileSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--panel-border-3)',
          background: 'var(--glass)', color: 'var(--ink-90)',
          fontSize: 13, outline: 'none', boxSizing: 'border-box',
          cursor: 'pointer',
        }}
      >
        {/* Show the saved value even if it's not in the options list, so
            we never silently mutate stored settings the first time the
            user opens the page after a release. */}
        {options.some((o) => o.value === value) ? null : (
          <option value={value}>{value} (custom)</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
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
