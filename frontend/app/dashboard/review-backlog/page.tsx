'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import { ChipSelect, SwitchToggle, SettingsField, SettingsCard } from '@/components/SettingsControls';

type Nudge = {
  id: number;
  pr_id: number;
  pr_external_id: string | null;
  pr_title: string | null;
  pr_author: string | null;
  pr_provider: string | null;
  pr_status: string | null;
  pr_url: string | null;
  repo_mapping_id: string | null;
  repo_display_name: string | null;
  age_hours: number;
  severity: string | null;
  nudge_count: number;
  last_nudged_at: string | null;
  last_nudge_channel: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
};

type Settings = {
  triage_enabled: boolean;
  triage_idle_days: number;
  triage_schedule_cron: string;
  triage_sources: string;
  backlog_enabled: boolean;
  backlog_warn_hours: number;
  backlog_critical_hours: number;
  backlog_nudge_interval_hours: number;
  nudge_comment_language: string;
  nudge_use_ai: boolean;
  backlog_channel: string;
  backlog_exempt_repos: string | null;
};

const SEVERITY_COLOR: Record<string, string> = {
  info: '#6366f1',
  warning: '#f59e0b',
  critical: '#ef4444',
};

const PROVIDER_ICON: Record<string, string> = {
  github: '🐙',
  azure_devops: '🟦',
  azure: '🟦',
  gitlab: '🦊',
  bitbucket: '🟧',
};

export default function ReviewBacklogPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<Nudge[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Repo filter chips — backed by /review-backlog/repos which returns
  // (repo_mapping_id, label, count) for repos that currently have at
  // least one tracked PR. Empty list = no PRs in scope, expected when
  // git_sync hasn't synced any repo's PRs yet.
  const [repoFilter, setRepoFilter] = useState<string>('all');
  const [reposInScope, setReposInScope] = useState<Array<{ repo_mapping_id: string; label: string; count: number }>>([]);

  async function load(repo: string = repoFilter) {
    try {
      // 500 = backend's hard cap on the list endpoint. Scan itself
      // walks every open PR; this just bounds the render slice.
      const params = new URLSearchParams({ limit: '500' });
      if (repo && repo !== 'all') params.set('repo_mapping_id', repo);
      const rows = await apiFetch<Nudge[]>(`/review-backlog?${params.toString()}`);
      setItems(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadRepos() {
    try {
      const rows = await apiFetch<Array<{ repo_mapping_id: string; label: string; count: number }>>('/review-backlog/repos');
      setReposInScope(rows);
    } catch { /* non-fatal */ }
  }

  async function loadSettings() {
    try {
      const s = await apiFetch<Settings>('/workflow-settings');
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); void loadSettings(); void loadRepos(); }, []);
  useEffect(() => { void load(repoFilter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [repoFilter]);

  async function scanNow() {
    setScanning(true);
    setError(null);
    try {
      const res = await apiFetch<{
        open_prs?: number;
        tracked?: number;
        resolved?: number;
      }>('/review-backlog/scan', { method: 'POST' });
      await load();
      await loadRepos();
      // Surface a no-op scan so the user knows why the list is empty
      // (no open PRs over the warn threshold, vs the feature being
      // broken). Localised through t() — keys are backlog.scan.*.
      if (res && (res.tracked ?? 0) === 0) {
        const open = res.open_prs ?? 0;
        if (open === 0) {
          setError(t('backlog.scan.empty' as TranslationKey));
        } else {
          setError(t('backlog.scan.belowThreshold' as TranslationKey, { open: String(open) }));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  // Track in-flight nudges so a fast double-click doesn't fire two
  // requests. Server also rate-limits but the client guard avoids the
  // round-trip and prevents the "two PR comments back-to-back" bug
  // entirely on slow networks.
  const [nudgingIds, setNudgingIds] = useState<Set<number>>(new Set());

  async function nudge(id: number) {
    if (nudgingIds.has(id)) return;
    setNudgingIds((s) => { const next = new Set(s); next.add(id); return next; });
    try {
      const res = await apiFetch<{
        nudge_count: number;
        last_nudged_at: string | null;
        status: string;
      }>(
        `/review-backlog/${id}/nudge`,
        { method: 'POST', body: JSON.stringify({ channel: settings?.backlog_channel || 'slack_dm' }) }
      );
      setItems((prev) => prev?.map((n) => n.id === id ? {
        ...n,
        nudge_count: res.nudge_count,
        last_nudged_at: res.last_nudged_at,
      } : n) ?? null);
      if (res.status === 'rate_limited') {
        setError(t('backlog.nudgeRateLimited' as TranslationKey));
      } else if (res.status === 'comment_failed') {
        setError(t('backlog.nudgeCommentFailed' as TranslationKey));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNudgingIds((s) => { const next = new Set(s); next.delete(id); return next; });
    }
  }

  async function saveSettings(partial: Partial<Settings>) {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await apiFetch<Settings>('/workflow-settings', {
        method: 'PUT',
        body: JSON.stringify(partial),
      });
      setSettings(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSettings(false);
    }
  }

  const open = items?.filter((n) => n.resolved_at === null) ?? null;
  const stats = open ? {
    total: open.length,
    critical: open.filter((n) => n.severity === 'critical').length,
    warning: open.filter((n) => n.severity === 'warning').length,
    avgAge: open.length ? Math.round(open.reduce((s, n) => s + n.age_hours, 0) / open.length) : 0,
    escalated: open.filter((n) => n.escalated_at).length,
  } : null;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 16 }}>
      <header style={{ display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#f59e0b', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>
            {t('backlog.eyebrow')}
          </div>
          <h1 style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: 800, margin: 0, color: 'var(--ink-90)', lineHeight: 1.2 }}>
            ⏱ {t('backlog.title')}
          </h1>
          <p style={{ fontSize: 'clamp(12px, 3.4vw, 14px)', color: 'var(--ink-58)', marginTop: 6, lineHeight: 1.55, maxWidth: 720 }}>
            {t('backlog.longSubtitle')}
          </p>
        </div>

        {/* Inline explanation card — mirrors the one on /dashboard/triage.
            Localised in all 7 languages so first-time users on any
            locale know what scope = which repos, what 'Nudge' does,
            and where the auto-comment lands. */}
        <details
          style={{
            border: '1px solid var(--panel-border)',
            background: 'var(--panel)',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--ink-78)',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--ink-90)' }}>
            💡 {t('backlog.help.title' as TranslationKey)}
          </summary>
          <div style={{ marginTop: 8, lineHeight: 1.55, display: 'grid', gap: 4 }}>
            <div>{t('backlog.help.body' as TranslationKey)}</div>
            <div style={{ marginTop: 6 }}>
              {t('backlog.help.scope' as TranslationKey)}{' '}
              <a href='/dashboard/mappings' style={{ color: '#5eead4', textDecoration: 'underline' }}>
                /dashboard/mappings ↗
              </a>{' · '}
              <a href='/dashboard/dora' style={{ color: '#5eead4', textDecoration: 'underline' }}>
                /dashboard/dora ↗
              </a>
            </div>
            <div>{t('backlog.help.scan' as TranslationKey)}</div>
            <div>{t('backlog.help.nudge' as TranslationKey)}</div>
            <div>{t('backlog.help.cooldown' as TranslationKey)}</div>
            <div>{t('backlog.help.deletion' as TranslationKey)}</div>
            <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
              ⚙️ {t('backlog.help.worker' as TranslationKey)}
            </div>
          </div>
        </details>

        {/* Repo filter chips — show ONLY repos that currently carry
            a tracked PR. Makes "what's actually in scope" obvious;
            mapped repos with zero PRs aren't shown because they'd
            mislead the user. Click to scope the queue to one repo. */}
        {reposInScope.length > 0 && (
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
            <button
              onClick={() => setRepoFilter('all')}
              style={{
                padding: '6px 10px', borderRadius: 7, border: 'none',
                background: repoFilter === 'all' ? 'rgba(245,158,11,0.18)' : 'transparent',
                color: repoFilter === 'all' ? '#f59e0b' : 'var(--ink-58)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {t('triage.source.all' as TranslationKey)} ({reposInScope.reduce((s, r) => s + r.count, 0)})
            </button>
            {reposInScope.map((r) => {
              const isActive = repoFilter === r.repo_mapping_id;
              return (
                <button
                  key={r.repo_mapping_id}
                  onClick={() => setRepoFilter(r.repo_mapping_id)}
                  style={{
                    padding: '6px 10px', borderRadius: 7, border: 'none',
                    background: isActive ? 'rgba(245,158,11,0.18)' : 'transparent',
                    color: isActive ? '#f59e0b' : 'var(--ink-58)',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  📦 {r.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>({r.count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Stat strip — corporate at-a-glance summary */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            <StatTile label={t('backlog.stat.total')} value={stats.total} accent='#6366f1' />
            <StatTile label={t('backlog.stat.critical')} value={stats.critical} accent='#ef4444' />
            <StatTile label={t('backlog.stat.warning')} value={stats.warning} accent='#f59e0b' />
            <StatTile label={t('backlog.stat.avgAge')} value={`${stats.avgAge}h`} accent='#06b6d4' />
            <StatTile label={t('backlog.stat.escalated')} value={stats.escalated} accent='#a855f7' />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={scanNow}
            disabled={scanning}
            style={{
              padding: '8px 14px', borderRadius: 10,
              background: scanning ? 'var(--panel)' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
              color: scanning ? 'var(--ink-58)' : '#fff',
              border: scanning ? '1px solid var(--panel-border)' : 'none',
              fontSize: 12, fontWeight: 700, cursor: scanning ? 'wait' : 'pointer',
            }}
          >
            {scanning ? t('backlog.scanning') : t('backlog.scanNow')}
          </button>
          {settings && (
            <span style={{
              fontSize: 11, color: 'var(--ink-58)', padding: '6px 10px',
              background: 'var(--panel)', border: '1px solid var(--panel-border)',
              borderRadius: 8,
            }}>
              ⏱ {t('backlog.cadenceHint' as TranslationKey, {
                hours: String(settings.backlog_nudge_interval_hours),
              })}
            </span>
          )}
          <button
            onClick={() => setShowSettings((v) => !v)}
            style={{
              padding: '8px 12px', borderRadius: 10,
              background: showSettings ? 'rgba(99,102,241,0.12)' : 'var(--panel)',
              color: showSettings ? '#818cf8' : 'var(--ink-78)',
              border: '1px solid var(--panel-border)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ⚙ {t('backlog.settings')}
          </button>
        </div>
      </header>

      {showSettings && settings && (
        <SettingsCard title={`${t('backlog.settingsTitle')}${savingSettings ? ' · ' + t('common.saving') : ''}`}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              columnGap: 18,
              rowGap: 0,
            }}
          >
          <SettingsField label={t('backlog.set.enabled')} hint={t('backlog.set.enabledHint')}>
            <SwitchToggle
              value={settings.backlog_enabled}
              onChange={(v) => void saveSettings({ backlog_enabled: v })}
              accent='#f59e0b'
            />
          </SettingsField>
          <SettingsField label={t('backlog.set.warnHours')} hint={t('backlog.set.warnHint')}>
            <ChipSelect<number>
              value={settings.backlog_warn_hours}
              onChange={(v) => void saveSettings({ backlog_warn_hours: v })}
              accent='#f59e0b'
              options={[
                { value: 6, label: t('duration.6h') },
                { value: 12, label: t('duration.12h') },
                { value: 24, label: t('duration.1d') },
                { value: 48, label: t('duration.2d') },
                { value: 72, label: t('duration.3d') },
                { value: 168, label: t('duration.1w') },
              ]}
              allowCustom
              customLabel={t('common.custom')}
              customPlaceholder={t('duration.hoursPlaceholder')}
            />
          </SettingsField>
          <SettingsField label={t('backlog.set.critHours')} hint={t('backlog.set.critHint')}>
            <ChipSelect<number>
              value={settings.backlog_critical_hours}
              onChange={(v) => void saveSettings({ backlog_critical_hours: v })}
              accent='#ef4444'
              options={[
                { value: 24, label: t('duration.1d') },
                { value: 48, label: t('duration.2d') },
                { value: 72, label: t('duration.3d') },
                { value: 168, label: t('duration.1w') },
                { value: 336, label: t('duration.2w') },
              ]}
              allowCustom
              customLabel={t('common.custom')}
              customPlaceholder={t('duration.hoursPlaceholder')}
            />
          </SettingsField>
          <SettingsField label={t('backlog.set.nudgeInterval')} hint={t('backlog.set.nudgeIntervalHint')}>
            <ChipSelect<number>
              value={settings.backlog_nudge_interval_hours}
              onChange={(v) => void saveSettings({ backlog_nudge_interval_hours: v })}
              accent='#6366f1'
              options={[
                { value: 1, label: t('duration.1h') },
                { value: 3, label: t('duration.3h') },
                { value: 6, label: t('duration.6h') },
                { value: 12, label: t('duration.12h') },
                { value: 24, label: t('duration.1d') },
              ]}
              allowCustom
              customLabel={t('common.custom')}
              customPlaceholder={t('duration.hoursPlaceholder')}
            />
          </SettingsField>
          <SettingsField label={t('backlog.set.channel')} hint={t('backlog.set.channelHint')}>
            {(() => {
              // Multi-select: backlog_channel is a comma-separated list.
              // Each chip toggles independently. At least one must stay
              // selected — empty list falls back to 'manual'.
              const selected = new Set(
                (settings.backlog_channel || '').split(',').map((s) => s.trim()).filter(Boolean),
              );
              const channels: Array<{ value: string; label: string }> = [
                { value: 'pr_comment', label: t('backlog.set.channel.prComment') },
                { value: 'slack_dm', label: '💬 Slack DM' },
                { value: 'slack_channel', label: '#️⃣ Slack Channel' },
                { value: 'email', label: '📧 Email' },
                { value: 'whatsapp', label: '🟢 WhatsApp' },
                { value: 'telegram', label: '✈️ Telegram' },
                { value: 'manual', label: '✋ ' + t('backlog.set.manual') },
              ];
              const toggle = (v: string) => {
                const next = new Set(selected);
                if (next.has(v)) next.delete(v); else next.add(v);
                if (next.size === 0) next.add('manual');
                void saveSettings({ backlog_channel: Array.from(next).join(',') });
              };
              return (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {channels.map((c) => {
                    const on = selected.has(c.value);
                    return (
                      <button
                        key={c.value}
                        type='button'
                        onClick={() => toggle(c.value)}
                        style={{
                          padding: '6px 10px', borderRadius: 8,
                          border: '1px solid ' + (on ? 'rgba(99,102,241,0.55)' : 'var(--panel-border)'),
                          background: on ? 'rgba(99,102,241,0.16)' : 'var(--panel)',
                          color: on ? '#818cf8' : 'var(--ink-78)',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {on ? '✓ ' : ''}{c.label}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </SettingsField>
          <SettingsField label={t('backlog.set.exemptRepos')} hint={t('backlog.set.exemptHint')}>
            <input
              type='text'
              value={settings.backlog_exempt_repos || ''}
              onChange={(e) => void saveSettings({ backlog_exempt_repos: e.target.value })}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, width: '100%', maxWidth: 320 }}
              placeholder='1, 3, 7'
            />
          </SettingsField>
          <SettingsField
            label={t('backlog.set.commentLanguage' as TranslationKey)}
            hint={t('backlog.set.commentLanguageHint' as TranslationKey)}
          >
            <ChipSelect<string>
              value={settings.nudge_comment_language || 'en'}
              onChange={(v) => void saveSettings({ nudge_comment_language: v })}
              accent='#06b6d4'
              options={[
                { value: 'en', label: 'English' },
                { value: 'tr', label: 'Türkçe' },
                { value: 'de', label: 'Deutsch' },
                { value: 'es', label: 'Español' },
                { value: 'it', label: 'Italiano' },
                { value: 'ja', label: '日本語' },
                { value: 'zh', label: '中文' },
              ]}
            />
          </SettingsField>
          <SettingsField
            label={t('backlog.set.useAi' as TranslationKey)}
            hint={t('backlog.set.useAiHint' as TranslationKey)}
          >
            <SwitchToggle
              value={!!settings.nudge_use_ai}
              onChange={(v) => void saveSettings({ nudge_use_ai: v })}
            />
          </SettingsField>
          </div>
        </SettingsCard>
      )}

      {error && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 13 }}>
          {error}
        </div>
      )}

      {open === null ? (
        <div style={{ padding: 24, color: 'var(--ink-58)', fontSize: 14 }}>{t('backlog.loading')}</div>
      ) : open.length === 0 ? (
        <div style={{ padding: 32, borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 4 }}>{t('backlog.empty.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-58)', maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
            {t('backlog.empty.body')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {open.map((n) => {
            const sev = n.severity || 'info';
            const color = SEVERITY_COLOR[sev] || '#6366f1';
            return (
              <article
                key={n.id}
                style={{
                  borderRadius: 12,
                  background: 'var(--panel)',
                  border: '1px solid var(--panel-border)',
                  borderLeft: `4px solid ${color}`,
                  padding: 14,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <header style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{PROVIDER_ICON[n.pr_provider || ''] || '🔀'}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-58)', fontFamily: 'ui-monospace, monospace' }}>
                    PR #{n.pr_external_id || n.pr_id}
                  </span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `${color}22`, color, fontWeight: 700, textTransform: 'uppercase' }}>
                    {sev} · {n.age_hours}h
                  </span>
                  {n.pr_status && (() => {
                    const s = n.pr_status.toLowerCase();
                    const palette: Record<string, { bg: string; fg: string }> = {
                      active:    { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      open:      { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      opened:    { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      pending:   { bg: 'rgba(245,158,11,0.15)',  fg: '#f59e0b' },
                      in_review: { bg: 'rgba(168,85,247,0.15)',  fg: '#a855f7' },
                      review_required: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7' },
                      abandoned: { bg: 'rgba(148,163,184,0.18)', fg: '#94a3b8' },
                      declined:  { bg: 'rgba(148,163,184,0.18)', fg: '#94a3b8' },
                      closed:    { bg: 'rgba(148,163,184,0.18)', fg: '#94a3b8' },
                      completed: { bg: 'rgba(96,165,250,0.18)',  fg: '#60a5fa' },
                      merged:    { bg: 'rgba(96,165,250,0.18)',  fg: '#60a5fa' },
                    };
                    const c = palette[s] || { bg: 'rgba(148,163,184,0.18)', fg: '#94a3b8' };
                    return (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        {n.pr_status}
                      </span>
                    );
                  })()}
                  {n.nudge_count > 0 && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(99,102,241,0.12)', color: '#818cf8', fontWeight: 700 }}>
                      🔔 {n.nudge_count}
                    </span>
                  )}
                  {n.escalated_at && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 700 }}>
                      ⚠ {t('backlog.escalated')}
                    </span>
                  )}
                </header>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>
                  {n.pr_url ? (
                    <a
                      href={n.pr_url}
                      target='_blank'
                      rel='noopener noreferrer'
                      style={{ color: 'var(--ink-90)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                    >
                      {n.pr_title || '(no title)'} ↗
                    </a>
                  ) : (
                    n.pr_title || '(no title)'
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-58)' }}>
                  {n.pr_author && <>👤 {n.pr_author}</>}
                  {n.repo_display_name && <> · 📦 {n.repo_display_name}</>}
                  {n.last_nudged_at && <> · {t('backlog.lastNudged')}: {new Date(n.last_nudged_at).toLocaleString()} ({n.last_nudge_channel})</>}
                </div>
                {(() => {
                  // "Tekrar dürtme şu kadar saat sonra" göstergesi —
                  // interval (settings) - last_nudged'den bu yana geçen saat.
                  // Hiç dürtülmediyse hemen müsait. Negatife düşerse "şimdi".
                  const interval = settings?.backlog_nudge_interval_hours ?? 6;
                  if (!n.last_nudged_at) {
                    return (
                      <div style={{ fontSize: 11, color: '#5eead4', fontWeight: 600 }}>
                        ⏰ {t('backlog.nextNudgeReady' as TranslationKey)}
                      </div>
                    );
                  }
                  const lastMs = new Date(n.last_nudged_at).getTime();
                  const elapsedHours = (Date.now() - lastMs) / 3_600_000;
                  const remainingHours = Math.max(0, interval - elapsedHours);
                  const ready = remainingHours <= 0;
                  return (
                    <div
                      style={{
                        fontSize: 11,
                        color: ready ? '#5eead4' : 'var(--ink-50)',
                        fontWeight: ready ? 700 : 500,
                      }}
                    >
                      {ready
                        ? `⏰ ${t('backlog.nextNudgeReady' as TranslationKey)}`
                        : `⏰ ${t('backlog.nextNudgeIn' as TranslationKey, { hours: String(Math.ceil(remainingHours)) })}`}
                    </div>
                  );
                })()}
                {(() => {
                  // Cooldown gating for the button: if we're still
                  // inside the configured nudge interval since the
                  // last successful delivery, the server will reject
                  // the click anyway. Disable the button + show a
                  // wait cursor so the user doesn't bother.
                  const interval = settings?.backlog_nudge_interval_hours ?? 6;
                  let inCooldown = false;
                  if (n.last_nudged_at) {
                    const elapsedH = (Date.now() - new Date(n.last_nudged_at).getTime()) / 3_600_000;
                    inCooldown = elapsedH < interval;
                  }
                  const inFlight = nudgingIds.has(n.id);
                  const disabled = inFlight || inCooldown;
                  return (
                    <footer style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => void nudge(n.id)}
                        disabled={disabled}
                        title={inCooldown ? t('backlog.nudgeRateLimited' as TranslationKey) : ''}
                        style={{
                          padding: '5px 11px', borderRadius: 8,
                          background: disabled ? 'var(--panel)' : `${color}22`,
                          color: disabled ? 'var(--ink-35)' : color,
                          border: `1px solid ${disabled ? 'var(--panel-border)' : `${color}55`}`,
                          fontSize: 11, fontWeight: 700,
                          cursor: inFlight ? 'wait' : (inCooldown ? 'not-allowed' : 'pointer'),
                          opacity: disabled ? 0.55 : 1,
                        }}
                      >
                        {inFlight
                          ? t('backlog.nudging' as TranslationKey)
                          : `🔔 ${t('backlog.nudgeNow')}`}
                      </button>
                    </footer>
                  );
                })()}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: 'var(--panel)', border: '1px solid var(--panel-border)',
      borderLeft: `3px solid ${accent}`,
      display: 'grid', gap: 4,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'var(--ink-42)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}
