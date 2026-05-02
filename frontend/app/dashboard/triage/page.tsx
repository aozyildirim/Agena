'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import { ChipSelect, MultiChipSelect, SwitchToggle, SettingsField, SettingsCard } from '@/components/SettingsControls';

type Decision = {
  id: number;
  task_id: number | null;
  source: string;
  external_id: string;
  project_key: string | null;
  ticket_state: string | null;
  ticket_title: string | null;
  ticket_url: string | null;
  idle_days: number;
  ai_verdict: string | null;
  ai_confidence: number;
  ai_reasoning: string | null;
  status: string;
  applied_verdict: string | null;
  applied_at: string | null;
  created_at: string;
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
  backlog_channel: string;
  backlog_exempt_repos: string | null;
};

const VERDICT_COLOR: Record<string, string> = {
  close: '#10b981',
  snooze: '#f59e0b',
  keep: '#6366f1',
};

const VERDICT_ICON: Record<string, string> = {
  close: '✓',
  snooze: '⏸',
  keep: '⛔',
};

const SOURCE_ICON: Record<string, string> = {
  jira: '🪐',
  azure_devops: '🟦',
  azure: '🟦',
};

export default function TriagePage() {
  const { t } = useLocale();
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filter: which decision status the list shows. Defaults to pending
  // (the to-do queue), but the user can switch to applied / skipped to
  // audit what was actioned previously.
  const [statusFilter, setStatusFilter] = useState<'pending' | 'applied' | 'skipped'>('pending');
  // Source tab — separates Jira / Azure queues so the user can triage
  // one platform at a time.
  const [sourceFilter, setSourceFilter] = useState<'all' | 'jira' | 'azure'>('all');
  // Project / board filter (Jira project key or Azure project name).
  // Populated from /triage/projects so the dropdown only shows what
  // exists in the queue.
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [projectsList, setProjectsList] = useState<Array<{ source: string; project_key: string; count: number }>>([]);

  async function load(
    filter: typeof statusFilter = statusFilter,
    src: typeof sourceFilter = sourceFilter,
    proj: string = projectFilter,
  ) {
    try {
      const params = new URLSearchParams({ status: filter, limit: '200' });
      if (src && src !== 'all') params.set('source', src);
      if (proj && proj !== 'all') params.set('project', proj);
      const rows = await apiFetch<Decision[]>(`/triage/decisions?${params.toString()}`);
      setDecisions(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadProjects() {
    try {
      const rows = await apiFetch<Array<{ source: string; project_key: string; count: number }>>('/triage/projects');
      setProjectsList(rows);
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

  useEffect(() => { void load(); void loadSettings(); void loadProjects(); }, []);
  useEffect(() => { void load(statusFilter, sourceFilter, projectFilter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, sourceFilter, projectFilter]);
  // Reset project pick when source tab changes — the previous project
  // probably doesn't belong to the new source.
  useEffect(() => { setProjectFilter('all'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sourceFilter]);

  // Source-side scans walk hundreds of tickets through the LLM, so we
  // run them in the background. POST returns immediately with
  // status='running'; a polling effect tracks progress until 'done'
  // / 'failed' so the user can keep navigating.
  const [scanProgress, setScanProgress] = useState<{
    status: 'idle' | 'running' | 'done' | 'failed' | 'disabled' | 'no_sources' | 'already_running';
    considered?: number;
    decided?: number;
    reason?: string;
    error?: string;
  } | null>(null);

  async function scanNow() {
    setScanning(true);
    setError(null);
    try {
      const res = await apiFetch<{
        status: string;
        considered?: number;
        decided?: number;
        threshold_days?: number;
        reason?: string;
      }>('/triage/scan', { method: 'POST' });
      setScanProgress({
        status: (res.status as 'running' | 'already_running' | 'disabled' | 'no_sources') || 'running',
        considered: res.considered, decided: res.decided, reason: res.reason,
      });
      if (res.status === 'disabled') {
        setError(t('triage.scan.disabled' as TranslationKey));
        setScanning(false);
      } else if (res.status === 'no_sources') {
        setError(t('triage.scan.noSources' as TranslationKey));
        setScanning(false);
      }
      // 'running' / 'already_running' → poller below takes over.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setScanning(false);
    }
  }

  // Poll the scan progress endpoint while a scan is in flight. Updates
  // the button label ('Taranıyor… 47/120') and reloads the decisions
  // list every poll so new rows appear as the LLM verdict trickles in.
  useEffect(() => {
    if (scanProgress?.status !== 'running' && scanProgress?.status !== 'already_running') return;
    let alive = true;
    const tick = async () => {
      while (alive) {
        try {
          const p = await apiFetch<{
            status: string;
            considered?: number;
            decided?: number;
            reason?: string;
            error?: string;
          }>('/triage/scan/status');
          if (!alive) return;
          setScanProgress({
            status: (p.status as 'running' | 'done' | 'failed' | 'idle') || 'idle',
            considered: p.considered, decided: p.decided,
            reason: p.reason, error: p.error,
          });
          await load();
          await loadProjects();
          if (p.status === 'done' || p.status === 'failed' || p.status === 'idle') {
            setScanning(false);
            if (p.status === 'failed' && p.error) setError(p.error);
            if (p.status === 'done' && (p.decided ?? 0) === 0 && p.reason === 'no_stale_candidates') {
              setError(t('triage.scan.noStale' as TranslationKey, {
                days: String(settings?.triage_idle_days ?? 30),
                sources: 'jira/azure',
              }));
            }
            return;
          }
        } catch (e) {
          if (alive) {
            setError(e instanceof Error ? e.message : String(e));
            setScanning(false);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanProgress?.status]);

  // Confirm-before-apply: clicking a verdict button opens a modal so
  // the user has one last chance to back out before AGENA flips the
  // task / posts a comment / etc. State holds the pending intent.
  const [confirmIntent, setConfirmIntent] = useState<{
    id: number;
    verdict: string;
    decision: Decision;
  } | null>(null);

  function requestApply(d: Decision, verdict: string) {
    setConfirmIntent({ id: d.id, verdict, decision: d });
  }

  async function applyOne(id: number, verdict: string) {
    try {
      await apiFetch(`/triage/decisions/${id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ verdict }),
      });
      setDecisions((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function skipOne(id: number) {
    try {
      await apiFetch(`/triage/decisions/${id}/skip`, { method: 'POST' });
      setDecisions((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function applyAll() {
    if (!decisions || decisions.length === 0) return;
    try {
      const res = await apiFetch<{ applied: number }>('/triage/apply-all-ai-suggestions', {
        method: 'POST',
        body: JSON.stringify({ decision_ids: decisions.map((d) => d.id) }),
      });
      await load();
      alert(`${res.applied} ${t('triage.applied')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 16 }}>
      <header style={{ display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#10b981', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>
            {t('triage.eyebrow')}
          </div>
          <h1 style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: 800, margin: 0, color: 'var(--ink-90)', lineHeight: 1.2 }}>
            🧹 {t('triage.title')}
          </h1>
          <p style={{ fontSize: 'clamp(12px, 3.4vw, 14px)', color: 'var(--ink-58)', marginTop: 6, lineHeight: 1.55, maxWidth: 720 }}>
            {t('triage.longSubtitle')}
          </p>
        </div>

        {/* Info card — explain what the action buttons do. Localised
            in all 7 languages so first-time users on any locale know
            'close' acts on AGENA only, 'snooze' pauses the row, etc. */}
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
            💡 {t('triage.help.title' as TranslationKey)}
          </summary>
          <div style={{ marginTop: 8, lineHeight: 1.55, display: 'grid', gap: 4 }}>
            <div>{t('triage.help.body' as TranslationKey)}</div>
            <div style={{ marginTop: 6 }}>{t('triage.help.applyAi' as TranslationKey)}</div>
            <div>{t('triage.help.close' as TranslationKey)}</div>
            <div>{t('triage.help.snooze' as TranslationKey)}</div>
            <div>{t('triage.help.keep' as TranslationKey)}</div>
            <div>{t('triage.help.skip' as TranslationKey)}</div>
          </div>
        </details>

        {decisions && decisions.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            <TriageStatTile label={t('triage.stat.total')} value={decisions.length} accent='#6366f1' />
            <TriageStatTile label={t('triage.stat.suggestClose')} value={decisions.filter((d) => d.ai_verdict === 'close').length} accent='#10b981' />
            <TriageStatTile label={t('triage.stat.suggestSnooze')} value={decisions.filter((d) => d.ai_verdict === 'snooze').length} accent='#f59e0b' />
            <TriageStatTile label={t('triage.stat.suggestKeep')} value={decisions.filter((d) => d.ai_verdict === 'keep').length} accent='#818cf8' />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={scanNow}
            disabled={scanning}
            style={{
              padding: '8px 14px', borderRadius: 10,
              background: scanning ? 'var(--panel)' : 'linear-gradient(135deg, #10b981, #06b6d4)',
              color: scanning ? 'var(--ink-58)' : '#fff',
              border: scanning ? '1px solid var(--panel-border)' : 'none',
              fontSize: 12, fontWeight: 700, cursor: scanning ? 'wait' : 'pointer',
            }}
          >
            {scanning
              ? `${t('triage.scanning')}${
                  scanProgress && (scanProgress.considered ?? 0) > 0
                    ? ` ${scanProgress.decided ?? 0}/${scanProgress.considered}`
                    : ''
                }`
              : t('triage.scanNow')}
          </button>
          {decisions && decisions.length > 0 && (
            <button
              onClick={() => void applyAll()}
              style={{
                padding: '8px 14px', borderRadius: 10,
                background: 'rgba(16,185,129,0.12)', color: '#10b981',
                border: '1px solid rgba(16,185,129,0.3)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ✓✓ {t('triage.applyAll')} ({decisions.length})
            </button>
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
            ⚙ {t('triage.settings')}
          </button>
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10 }}>
            {(['pending', 'applied', 'skipped'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 10px', borderRadius: 7, border: 'none',
                  background: statusFilter === s ? 'rgba(16,185,129,0.16)' : 'transparent',
                  color: statusFilter === s ? '#10b981' : 'var(--ink-58)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t(('triage.filter.' + s) as TranslationKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Project chips — visible only when there are projects to
            pick from in the current source filter. Filters the queue
            down to one Jira project (SCRUM) or one Azure project
            (EcomBackend). 'All' means cross-project queue. */}
        {(() => {
          const visible = projectsList.filter((p) => {
            if (sourceFilter === 'all') return true;
            if (sourceFilter === 'jira') return p.source === 'jira';
            return p.source === 'azure' || p.source === 'azure_devops';
          });
          if (visible.length === 0) return null;
          return (
            <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              <button
                onClick={() => setProjectFilter('all')}
                style={{
                  padding: '6px 10px', borderRadius: 7, border: 'none',
                  background: projectFilter === 'all' ? 'rgba(94,234,212,0.16)' : 'transparent',
                  color: projectFilter === 'all' ? '#5eead4' : 'var(--ink-58)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t('triage.source.all' as TranslationKey)}
              </button>
              {visible.map((p) => {
                const isActive = projectFilter === p.project_key;
                return (
                  <button
                    key={`${p.source}:${p.project_key}`}
                    onClick={() => setProjectFilter(p.project_key)}
                    style={{
                      padding: '6px 10px', borderRadius: 7, border: 'none',
                      background: isActive ? 'rgba(94,234,212,0.16)' : 'transparent',
                      color: isActive ? '#5eead4' : 'var(--ink-58)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {p.source === 'jira' ? '📋' : '☁️'} {p.project_key}
                    <span style={{ opacity: 0.6, marginLeft: 4 }}>({p.count})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Source tabs — All / Jira / Azure. The decision counts come
            from the loaded `decisions` slice (filtered by the active
            status), so the count next to each tab matches what the
            user is about to see if they switch. */}
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 10, alignSelf: 'flex-start' }}>
          {([
            { key: 'all', label: t('triage.source.all' as TranslationKey), icon: '⌭', accent: '#6366f1' },
            { key: 'jira', label: 'Jira', icon: '📋', accent: '#0052cc' },
            { key: 'azure', label: 'Azure DevOps', icon: '☁️', accent: '#0078d4' },
          ] as const).map((tab) => {
            const isActive = sourceFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setSourceFilter(tab.key)}
                style={{
                  padding: '6px 12px', borderRadius: 7, border: 'none',
                  background: isActive ? `${tab.accent}26` : 'transparent',
                  color: isActive ? tab.accent : 'var(--ink-58)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {showSettings && settings && (
        <SettingsCard title={`${t('triage.settingsTitle')}${savingSettings ? ' · ' + t('common.saving') : ''}`}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              columnGap: 18,
              rowGap: 0,
            }}
          >
          <SettingsField label={t('triage.set.enabled')} hint={t('triage.set.enabledHint')}>
            <SwitchToggle
              value={settings.triage_enabled}
              onChange={(v) => void saveSettings({ triage_enabled: v })}
              accent='#10b981'
            />
          </SettingsField>
          <SettingsField label={t('triage.set.idleDays')} hint={t('triage.set.idleDaysHint')}>
            <ChipSelect<number>
              value={settings.triage_idle_days}
              onChange={(v) => void saveSettings({ triage_idle_days: v })}
              accent='#10b981'
              options={[
                { value: 1, label: t('duration.1d') },
                { value: 3, label: t('duration.3d') },
                { value: 7, label: t('duration.7d') },
                { value: 14, label: t('duration.14d') },
                { value: 30, label: t('duration.30d') },
                { value: 60, label: t('duration.60d') },
                { value: 90, label: t('duration.90d') },
              ]}
              allowCustom
              customLabel={t('common.custom')}
              customPlaceholder={t('duration.daysPlaceholder')}
            />
          </SettingsField>
          <SettingsField label={t('triage.set.sources')} hint={t('triage.set.sourcesHint')}>
            <MultiChipSelect
              value={settings.triage_sources}
              onChange={(csv) => void saveSettings({ triage_sources: csv })}
              accent='#6366f1'
              options={[
                { value: 'jira', label: 'Jira', icon: '🪐' },
                { value: 'azure_devops', label: 'Azure DevOps', icon: '🟦' },
                { value: 'github', label: 'GitHub Issues', icon: '🐙' },
                { value: 'linear', label: 'Linear', icon: '📐' },
              ]}
            />
          </SettingsField>
          <SettingsField label={t('triage.set.scheduleHint')} hint={t('triage.set.scheduleSubhint')}>
            <ChipSelect<string>
              value={settings.triage_schedule_cron}
              onChange={(v) => void saveSettings({ triage_schedule_cron: v })}
              accent='#10b981'
              options={[
                { value: '0 */6 * * *', label: t('schedule.every6h') },
                { value: '0 */12 * * *', label: t('schedule.every12h') },
                { value: '0 9 * * *', label: t('schedule.dailyMorning') },
                { value: '0 18 * * 0', label: t('schedule.weeklySunday') },
                { value: '0 9 1 * *', label: t('schedule.monthly') },
              ]}
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

      {decisions === null ? (
        <div style={{ padding: 24, color: 'var(--ink-58)', fontSize: 14 }}>{t('triage.loading')}</div>
      ) : decisions.length === 0 ? (
        <div style={{ padding: 32, borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--panel-border)', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>✨</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 4 }}>{t('triage.empty.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-58)', maxWidth: 480, margin: '0 auto', lineHeight: 1.55 }}>
            {t('triage.empty.body')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {decisions.map((d) => {
            const verdict = d.ai_verdict || 'keep';
            const color = VERDICT_COLOR[verdict] || '#6366f1';
            return (
              <article
                key={d.id}
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
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{SOURCE_ICON[d.source] || '📋'}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-58)', fontFamily: 'ui-monospace, monospace' }}>
                    {d.external_id}
                  </span>
                  {d.project_key && (
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: 'rgba(99,102,241,0.10)', color: '#818cf8', fontWeight: 700, letterSpacing: 0.4 }}>
                      {d.project_key}
                    </span>
                  )}
                  {d.ticket_state && (() => {
                    // Source ticket state badge — colour mapping mirrors
                    // the review-backlog convention for consistency.
                    const s = d.ticket_state.toLowerCase();
                    const palette: Record<string, { bg: string; fg: string }> = {
                      active:        { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      open:          { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      new:           { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      'to do':       { bg: 'rgba(34,197,94,0.15)',   fg: '#22c55e' },
                      'in progress': { bg: 'rgba(56,189,248,0.15)',  fg: '#38bdf8' },
                      committed:     { bg: 'rgba(56,189,248,0.15)',  fg: '#38bdf8' },
                      'code review': { bg: 'rgba(167,139,250,0.15)', fg: '#a78bfa' },
                      'in review':   { bg: 'rgba(167,139,250,0.15)', fg: '#a78bfa' },
                      review:        { bg: 'rgba(167,139,250,0.15)', fg: '#a78bfa' },
                      'qa to do':    { bg: 'rgba(244,114,182,0.15)', fg: '#f472b6' },
                      'in qa':       { bg: 'rgba(244,114,182,0.15)', fg: '#f472b6' },
                      blocked:       { bg: 'rgba(239,68,68,0.15)',   fg: '#ef4444' },
                      pending:       { bg: 'rgba(245,158,11,0.15)',  fg: '#f59e0b' },
                    };
                    const c = palette[s] || { bg: 'rgba(148,163,184,0.18)', fg: '#94a3b8' };
                    return (
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: c.bg, color: c.fg, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        {d.ticket_state}
                      </span>
                    );
                  })()}
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700 }}>
                    {d.idle_days} {t('triage.daysIdle')}
                  </span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `${color}22`, color, fontWeight: 700 }}>
                    {VERDICT_ICON[verdict]} AI: {verdict} · {d.ai_confidence}%
                  </span>
                </header>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>
                  {d.ticket_url ? (
                    <a href={d.ticket_url} target='_blank' rel='noopener noreferrer'
                      style={{ color: 'var(--ink-90)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                      {d.ticket_title || '(no title)'} ↗
                    </a>
                  ) : (
                    d.ticket_title || '(no title)'
                  )}
                </div>
                {d.ai_reasoning && (
                  <p style={{ fontSize: 12, color: 'var(--ink-58)', margin: 0, lineHeight: 1.55, fontStyle: 'italic' }}>
                    🤖 {d.ai_reasoning}
                  </p>
                )}
                <footer style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {statusFilter === 'pending' ? (
                    <>
                      <button
                        onClick={() => requestApply(d, verdict)}
                        style={{ padding: '5px 11px', borderRadius: 8, background: `${color}22`, color, border: `1px solid ${color}55`, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ✓✓ {t('triage.applyAi')}
                      </button>
                      <button
                        onClick={() => requestApply(d, 'close')}
                        style={{ padding: '5px 11px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ✓ {t('triage.close')}
                      </button>
                      <button
                        onClick={() => requestApply(d, 'snooze')}
                        style={{ padding: '5px 11px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ⏸ {t('triage.snooze')}
                      </button>
                      <button
                        onClick={() => requestApply(d, 'keep')}
                        style={{ padding: '5px 11px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ⛔ {t('triage.keep')}
                      </button>
                      <button
                        onClick={() => void skipOne(d.id)}
                        style={{ padding: '5px 11px', borderRadius: 8, background: 'transparent', color: 'var(--ink-58)', border: '1px solid var(--panel-border)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ↩ {t('triage.skip')}
                      </button>
                    </>
                  ) : (
                    <span
                      style={{
                        padding: '4px 10px', borderRadius: 999,
                        background: d.applied_verdict === 'close' ? 'rgba(16,185,129,0.16)'
                                  : d.applied_verdict === 'snooze' ? 'rgba(245,158,11,0.16)'
                                  : d.applied_verdict === 'keep'   ? 'rgba(99,102,241,0.16)'
                                  : 'rgba(148,163,184,0.16)',
                        color:      d.applied_verdict === 'close' ? '#10b981'
                                  : d.applied_verdict === 'snooze' ? '#f59e0b'
                                  : d.applied_verdict === 'keep'   ? '#818cf8'
                                  : 'var(--ink-58)',
                        fontSize: 11, fontWeight: 700,
                      }}
                    >
                      {d.applied_verdict
                        ? `✓ ${t(('triage.' + d.applied_verdict) as TranslationKey)}`
                        : `↩ ${t('triage.skip')}`}
                      {d.applied_at && (
                        <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 500 }}>
                          · {new Date(d.applied_at).toLocaleString()}
                        </span>
                      )}
                    </span>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {confirmIntent && typeof document !== 'undefined' && createPortal(
        <div
          onClick={() => setConfirmIntent(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(6px)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 'min(480px, 100%)', borderRadius: 14, padding: 20,
            background: 'var(--surface)', border: '1px solid var(--panel-border)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)', display: 'grid', gap: 12,
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)' }}>
              {t(('triage.confirm.' + confirmIntent.verdict) as TranslationKey, { defaultValue: '' }) ||
               t('triage.confirm.title' as TranslationKey)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-78)', lineHeight: 1.5 }}>
              <strong>{confirmIntent.decision.source}</strong>:{' '}
              <span style={{ fontFamily: 'monospace' }}>{confirmIntent.decision.external_id}</span>
              {confirmIntent.decision.ticket_title && (
                <> — {confirmIntent.decision.ticket_title}</>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', lineHeight: 1.5,
                          padding: '8px 10px', background: 'var(--panel)',
                          border: '1px solid var(--panel-border)', borderRadius: 8 }}>
              {t(('triage.help.' + confirmIntent.verdict) as TranslationKey)}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmIntent(null)}
                style={{ padding: '8px 14px', borderRadius: 8,
                         background: 'transparent', color: 'var(--ink-58)',
                         border: '1px solid var(--panel-border)',
                         fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {t('triage.confirm.cancel' as TranslationKey)}
              </button>
              <button
                onClick={async () => {
                  const intent = confirmIntent;
                  setConfirmIntent(null);
                  await applyOne(intent.id, intent.verdict);
                }}
                style={{ padding: '8px 14px', borderRadius: 8,
                         background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                         color: '#fff', border: 'none',
                         fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {t('triage.confirm.confirm' as TranslationKey)}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function TriageStatTile({ label, value, accent }: { label: string; value: number | string; accent: string }) {
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
