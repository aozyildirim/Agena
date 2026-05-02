'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale, type TranslationKey } from '@/lib/i18n';
import { ChipSelect, MultiChipSelect, SwitchToggle, SettingsField, SettingsCard } from '@/components/SettingsControls';

type Decision = {
  id: number;
  task_id: number;
  source: string;
  external_id: string;
  ticket_title: string | null;
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

  async function load() {
    try {
      const rows = await apiFetch<Decision[]>('/triage/decisions?status=pending&limit=200');
      setDecisions(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadSettings() {
    try {
      const s = await apiFetch<Settings>('/workflow-settings');
      setSettings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); void loadSettings(); }, []);

  async function scanNow() {
    setScanning(true);
    setError(null);
    try {
      const res = await apiFetch<{
        new_or_refreshed?: number;
        considered?: number;
        threshold_days?: number;
        sources?: string[];
        reason?: string;
      }>('/triage/scan', { method: 'POST' });
      await load();
      // Surface a clear note when the scan was a no-op so the user knows
      // why the queue didn't change. Localised through t() — keys live in
      // every locale file under triage.scan.*.
      if (res && (res.new_or_refreshed ?? 0) === 0) {
        const days = String(res.threshold_days ?? 30);
        const srcs = (res.sources && res.sources.length > 0)
          ? res.sources.join(', ')
          : 'jira/azure';
        let note = '';
        switch (res.reason) {
          case 'triage_disabled':
            note = t('triage.scan.disabled' as TranslationKey);
            break;
          case 'no_sources_configured':
            note = t('triage.scan.noSources' as TranslationKey);
            break;
          case 'all_candidates_have_pending_decisions':
            note = t('triage.scan.allPending' as TranslationKey);
            break;
          case 'no_stale_candidates':
          default:
            note = t('triage.scan.noStale' as TranslationKey, { days, sources: srcs });
        }
        setError(note);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
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
            {scanning ? t('triage.scanning') : t('triage.scanNow')}
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
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: 700 }}>
                    {d.idle_days} {t('triage.daysIdle')}
                  </span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: `${color}22`, color, fontWeight: 700 }}>
                    {VERDICT_ICON[verdict]} AI: {verdict} · {d.ai_confidence}%
                  </span>
                </header>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>
                  {d.ticket_title || '(no title)'}
                </div>
                {d.ai_reasoning && (
                  <p style={{ fontSize: 12, color: 'var(--ink-58)', margin: 0, lineHeight: 1.55, fontStyle: 'italic' }}>
                    🤖 {d.ai_reasoning}
                  </p>
                )}
                <footer style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => void applyOne(d.id, verdict)}
                    style={{ padding: '5px 11px', borderRadius: 8, background: `${color}22`, color, border: `1px solid ${color}55`, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ✓✓ {t('triage.applyAi')}
                  </button>
                  <button
                    onClick={() => void applyOne(d.id, 'close')}
                    style={{ padding: '5px 11px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ✓ {t('triage.close')}
                  </button>
                  <button
                    onClick={() => void applyOne(d.id, 'snooze')}
                    style={{ padding: '5px 11px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    ⏸ {t('triage.snooze')}
                  </button>
                  <button
                    onClick={() => void applyOne(d.id, 'keep')}
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
                </footer>
              </article>
            );
          })}
        </div>
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
