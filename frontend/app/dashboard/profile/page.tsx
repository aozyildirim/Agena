'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, removeToken, loadPrefs, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Opt = { id: string; name: string; path?: string };
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

  const [projects, setProjects] = useState<Opt[]>([]);
  const [teams, setTeams] = useState<Opt[]>([]);
  const [sprints, setSprints] = useState<Opt[]>([]);
  const [project, setProject] = useState('');
  const [team, setTeam] = useState('');
  const [sprint, setSprint] = useState('');
  const [ltm, setLtm] = useState(false);
  const [lsp, setLsp] = useState(false);
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch<MeRes>('/auth/me').then(setUser).catch(() => {});
    apiFetch<Opt[]>('/tasks/azure/projects').then(setProjects).catch(() => {});

    loadPrefs().then(async (prefs) => {
      const p = prefs.azure_project || '';
      const t2 = prefs.azure_team || '';
      const s = prefs.azure_sprint_path || '';
      const rawSettings = (prefs.profile_settings || {}) as Record<string, unknown>;
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

      if (!p) return;
      setProject(p);
      if (!t2) return;
      const tms = await apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(p)).catch(() => [] as Opt[]);
      setTeams(tms);
      setTeam(t2);
      if (!s) return;
      const sps = await apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(p) + '&team=' + encodeURIComponent(t2)).catch(() => [] as Opt[]);
      setSprints(sps);
      setSprint(s);
    }).catch(() => {});
  }, []);

  const onProjectChange = useCallback((v: string) => {
    setProject(v);
    setTeam('');
    setTeams([]);
    setSprint('');
    setSprints([]);
    setSaved(false);
    if (!v) return;
    setLtm(true);
    apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(v))
      .then(setTeams)
      .catch(() => {})
      .finally(() => setLtm(false));
  }, []);

  const onTeamChange = useCallback((v: string) => {
    setTeam(v);
    setSprint('');
    setSprints([]);
    setSaved(false);
    if (!v || !project) return;
    setLsp(true);
    apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(v))
      .then(setSprints)
      .catch(() => {})
      .finally(() => setLsp(false));
  }, [project]);

  const onSprintChange = useCallback((v: string) => {
    setSprint(v);
    setSaved(false);
  }, []);

  async function save() {
    setSaving(true);
    setErr('');
    try {
      await savePrefs({
        azure_project: project,
        azure_team: team,
        azure_sprint_path: sprint,
        profile_settings: profileSettings as unknown as Record<string, unknown>,
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

  const selS = sprints.find((s) => (s.path ?? s.name) === sprint);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 1100 }}>
      <div>
        <div className='section-label'>{t('profile.section')}</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          {t('profile.title')}
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', margin: 0 }}>{t('profile.subtitle')}</p>
      </div>

      {user && (
        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 18, display: 'flex', alignItems: 'center', gap: 16, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.4), transparent)' }} />
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            {(user.full_name?.[0] || user.email[0]).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 3 }}>{user.full_name || '—'}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{user.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(13,148,136,0.15)', border: '1px solid rgba(13,148,136,0.3)', color: '#5eead4' }}>Pro Plan</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '3px 10px' }}>Org #{user.organization_id}</span>
            </div>
          </div>
          <button onClick={logout} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.06)', color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            {t('profile.logout')}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 18, display: 'grid', gap: 12, height: 520, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>◎</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>{t('profile.activeSprint')}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {sprint && selS ? selS.name : sprint ? sprint.split('\\').pop() : t('profile.noSprint')}
              </div>
            </div>
            {sprint && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>{t('profile.active')}</span>}
          </div>

          <ProfileSel label='Project' value={project} onChange={onProjectChange}
            options={projects.map((p) => ({ id: p.name, name: p.name }))}
            placeholder={t('profile.selectProject')} loading={false} disabled={false} />
          <ProfileSel label='Team' value={team} onChange={onTeamChange}
            options={teams.map((t2) => ({ id: t2.name, name: t2.name }))}
            placeholder={project ? t('profile.selectTeam') : t('profile.selectTeamFirst')} loading={ltm} disabled={!project} />
          <ProfileSel label='Sprint' value={sprint} onChange={onSprintChange}
            options={sprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))}
            placeholder={team ? t('profile.selectSprint') : t('profile.selectSprintFirst')} loading={lsp} disabled={!team} />

          <div style={{ marginTop: 2 }}>
            <button onClick={() => router.push('/dashboard/sprints')} disabled={!sprint}
              style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.08)', color: sprint ? '#5eead4' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 12, cursor: sprint ? 'pointer' : 'not-allowed' }}>
              {t('profile.sprintBoard')}
            </button>
          </div>
        </div>

        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 18, display: 'grid', gap: 10, height: 520, overflow: 'auto' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>Workspace Preferences</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>DB-backed defaults used during AI assignment.</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ToggleRow label='Email notifications' checked={profileSettings.email_notifications} onChange={(v) => { setProfileSettings((p) => ({ ...p, email_notifications: v })); setSaved(false); }} />
            <ToggleRow label='Web push notifications' checked={profileSettings.web_push_notifications} onChange={(v) => { setProfileSettings((p) => ({ ...p, web_push_notifications: v })); setSaved(false); }} />
            <ToggleRow label='Daily summary email' checked={profileSettings.daily_summary} onChange={(v) => { setProfileSettings((p) => ({ ...p, daily_summary: v })); setSaved(false); }} />
            <ToggleRow label='Auto-assign new tasks' checked={profileSettings.auto_assign_new_tasks} onChange={(v) => { setProfileSettings((p) => ({ ...p, auto_assign_new_tasks: v })); setSaved(false); }} />
            <ToggleRow label='Create PR by default' checked={profileSettings.default_create_pr} onChange={(v) => { setProfileSettings((p) => ({ ...p, default_create_pr: v })); setSaved(false); }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ProfileInput
              label='Preferred provider'
              value={profileSettings.preferred_provider}
              onChange={(v) => { setProfileSettings((p) => ({ ...p, preferred_provider: v })); setSaved(false); }}
              placeholder='openai | gemini | codex_cli'
            />
            <ProfileInput
              label='Preferred model'
              value={profileSettings.preferred_model}
              onChange={(v) => { setProfileSettings((p) => ({ ...p, preferred_model: v })); setSaved(false); }}
              placeholder='gpt-5'
            />
          </div>
          <ProfileInput
            label='Default branch prefix'
            value={profileSettings.branch_prefix}
            onChange={(v) => { setProfileSettings((p) => ({ ...p, branch_prefix: v })); setSaved(false); }}
            placeholder='ai/task'
          />
          <ProfileInput
            label='Queue warning threshold'
            value={String(profileSettings.queue_warn_threshold)}
            onChange={(v) => {
              const n = Number(v);
              setProfileSettings((p) => ({ ...p, queue_warn_threshold: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : p.queue_warn_threshold }));
              setSaved(false);
            }}
            placeholder='5'
          />
          <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 700, marginBottom: 8 }}>Event Notification Matrix</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.7fr', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
              <div>Event</div><div>In-App</div><div>Email</div><div>Web Push</div>
            </div>
            {Object.keys(EVENT_PREF_DEFAULTS).map((eventKey) => {
              const channels = profileSettings.notification_preferences[eventKey] || EVENT_PREF_DEFAULTS[eventKey];
              return (
                <div key={eventKey} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.7fr', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>{eventKey.replace(/_/g, ' ')}</div>
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

      <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{t('profile.integrations')}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{t('profile.integrationsDesc')}</div>
        </div>
        <a href='/dashboard/integrations' style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
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
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '9px 10px', background: checked ? 'rgba(13,148,136,0.12)' : 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
    >
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', textAlign: 'left' }}>{label}</span>
      <span style={{ width: 34, height: 18, borderRadius: 999, background: checked ? 'rgba(13,148,136,0.9)' : 'rgba(255,255,255,0.2)', padding: 2, display: 'inline-flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', transition: 'all 0.2s' }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
      </span>
    </button>
  );
}

function ProfileInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
      />
    </div>
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type='button' onClick={() => onChange(!checked)}
      style={{ width: 34, height: 18, borderRadius: 999, background: checked ? 'rgba(13,148,136,0.9)' : 'rgba(255,255,255,0.2)', padding: 2, border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', cursor: 'pointer' }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
    </button>
  );
}

function ProfileSel({ label, value, onChange, options, placeholder, loading, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Opt[]; placeholder: string; loading: boolean; disabled: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>
        {label} {loading ? <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>loading…</span> : null}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || loading}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid ' + (value ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'), background: value ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.04)', color: value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', fontSize: 13, outline: 'none', appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}>
        <option value='' style={{ background: '#0d1117' }}>{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id} style={{ background: '#0d1117' }}>{o.name}</option>)}
      </select>
    </div>
  );
}
