'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Alert = {
  id: number; source: string; metric_kind: string; entity_name?: string; entity_ref: string;
  scope: string; severity: string; title: string; status: string; task_id?: number | null;
  detail?: Record<string, any>; suggested_fix?: Record<string, any> | null; opened_at?: string | null;
};
type Rule = {
  id: number; name: string; metric_kind: string; comparison: string; threshold: number;
  severity: string; baseline_mode: string; auto_fix: string; is_active: boolean;
};
type Repo = { id: number; provider: string; owner: string; repo_name: string; display_name?: string };

const SEV: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#eab308', low: '#38bdf8' };
const METRICS = ['latency_p95', 'error_rate', 'throughput', 'db_time', 'apdex'];
const COMPARISONS = ['pct_up', 'pct_down', 'abs_above', 'abs_below', 'anomaly'];
const fmt = (n: unknown, u = '') => (typeof n === 'number' ? `${n}${u}` : '—');

export default function SentinelPage() {
  const { t, lang } = useLocale();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [open, setOpen] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Rule | null>(null);
  const [form, setForm] = useState({ name: '', metric_kind: 'latency_p95', comparison: 'pct_up', threshold: 30, min_abs: '' as string, consecutive: 2, severity: 'high', baseline_mode: 'both', repo_mapping_id: '' as string });

  const load = useCallback(async () => {
    try {
      const [a, r, s, rp] = await Promise.all([
        apiFetch<Alert[]>('/alerts'),
        apiFetch<Rule[]>('/alert-rules'),
        apiFetch<{ open: number }>('/alerts/stats'),
        apiFetch<Repo[]>('/repo-mappings').catch(() => []),
      ]);
      setAlerts(a ?? []); setRules(r ?? []); setOpen(s?.open ?? 0); setRepos(rp ?? []);
    } catch { /* */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id: number, what: string) => {
    const q = what === 'suggest' ? `?lang=${lang}` : '';
    try { await apiFetch(`/alerts/${id}/${what}${q}`, { method: 'POST' }); await load(); } catch { /* */ }
  };
  const seed = async () => { try { await apiFetch('/alert-rules/seed-defaults', { method: 'POST' }); await load(); } catch { /* */ } };
  const delRule = async (id: number) => { try { await apiFetch(`/alert-rules/${id}`, { method: 'DELETE' }); await load(); } catch { /* */ } };
  const createRule = async () => {
    try {
      await apiFetch('/alert-rules', { method: 'POST', body: JSON.stringify({
        ...form, threshold: Number(form.threshold), consecutive: Number(form.consecutive),
        min_abs: form.min_abs !== '' ? Number(form.min_abs) : null,
        repo_mapping_id: form.repo_mapping_id ? Number(form.repo_mapping_id) : null,
        name: form.name || `${form.metric_kind} ${form.comparison} ${form.threshold}`,
      }) });
      setShowForm(false); setForm({ ...form, name: '' }); await load();
    } catch { /* */ }
  };

  const dot = (sev: string) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEV[sev] || 'var(--ink-30)', display: 'inline-block', flexShrink: 0 }} />;
  const sel = { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--panel-border-2)', background: 'var(--panel)', color: 'var(--ink-85)', fontSize: 13 } as const;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 0 40px' }}>
      <div className='section-label'>{t('sentinel.title')}</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink-90)', margin: '6px 0 4px' }}>
        🛡️ {t('sentinel.title')}
        {open > 0 && <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', padding: '3px 10px', borderRadius: 999 }}>{open} {t('sentinel.open')}</span>}
      </h1>
      <p style={{ color: 'var(--ink-50)', fontSize: 13.5, lineHeight: 1.6, margin: '0 0 22px', maxWidth: 680 }}>{t('sentinel.subtitle')}</p>

      {loading ? <p style={{ color: 'var(--ink-40)' }}>…</p> : alerts.length === 0 ? (
        <div style={{ padding: '40px 24px', textAlign: 'center', border: '1px dashed var(--panel-border)', borderRadius: 14, color: 'var(--ink-45)' }}>{t('sentinel.noAlerts')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alerts.map((a) => {
            const d = a.detail || {};
            return (
              <div key={a.id} style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid var(--panel-border)', background: 'var(--panel)', opacity: a.status === 'resolved' ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div style={{ marginTop: 5 }}>{dot(a.severity)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-90)' }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-45)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{a.source} · {a.metric_kind}{d.trigger === 'deploy' ? ' · deploy' : ''}</span>
                      <span>{t('sentinel.current')}: <b style={{ color: 'var(--ink-78)' }}>{fmt(d.current, String(d.unit || ''))}</b></span>
                      <span>{t('sentinel.baseline')}: {fmt(d.baseline, String(d.unit || ''))}</span>
                      {typeof d.pct_change === 'number' && <span style={{ color: SEV[a.severity] }}>{d.pct_change > 0 ? '+' : ''}{d.pct_change}%</span>}
                      {d.repo && <span style={{ color: '#5eead4', fontWeight: 600 }}>→ {d.repo}</span>}
                      {d.nr_link && <a href={d.nr_link} target='_blank' rel='noopener noreferrer' style={{ color: '#a78bfa', fontWeight: 600, textDecoration: 'none' }}>New Relic ↗</a>}
                      {d.sentry_link && <a href={d.sentry_link} target='_blank' rel='noopener noreferrer' style={{ color: '#a78bfa', fontWeight: 600, textDecoration: 'none' }}>Sentry ↗</a>}
                      <span>· {a.status}</span>
                    </div>
                    {a.suggested_fix && !a.task_id && (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-65)', background: 'rgba(94,234,212,0.06)', border: '1px solid rgba(94,234,212,0.2)', borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                        <b style={{ color: '#5eead4' }}>💡 {t('sentinel.fixProposed')}{a.suggested_fix.provider ? ` · ${a.suggested_fix.provider}` : ''}</b>
                        {'\n'}{a.suggested_fix.ai || a.suggested_fix.summary}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {a.task_id ? (
                      <a href={`/dashboard/tasks?task=${a.task_id}`} className='button button-outline' style={{ fontSize: 12, padding: '6px 12px' }}>{t('sentinel.viewTask')}{a.task_id}</a>
                    ) : a.status !== 'resolved' && (
                      <>
                        {!a.suggested_fix && <button onClick={() => act(a.id, 'suggest')} className='button button-outline' style={{ fontSize: 12, padding: '6px 12px' }}>{t('sentinel.suggestFix')}</button>}
                        <button onClick={() => act(a.id, 'create-fix')} className='button button-primary' style={{ fontSize: 12, padding: '6px 12px' }}>{t('sentinel.createFix')}</button>
                      </>
                    )}
                    {a.status === 'open' && <button onClick={() => act(a.id, 'resolve')} className='button button-outline' style={{ fontSize: 12, padding: '6px 12px' }}>{t('sentinel.resolve')}</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rules */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '32px 0 12px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink-85)', margin: 0 }}>{t('sentinel.rules')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {rules.length === 0 && <button onClick={seed} className='button button-outline' style={{ fontSize: 13, padding: '8px 14px' }}>{t('sentinel.seedRules')}</button>}
          <button onClick={() => setShowForm((v) => !v)} className='button button-primary' style={{ fontSize: 13, padding: '8px 14px' }}>{showForm ? t('sentinel.cancel') : `+ ${t('sentinel.newRule')}`}</button>
        </div>
      </div>

      {showForm && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', padding: 16, borderRadius: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)', marginBottom: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.ruleName')}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='p95 +30%' style={{ ...sel, width: 150 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.metric')}
            <select value={form.metric_kind} onChange={(e) => setForm({ ...form, metric_kind: e.target.value })} style={sel}>{METRICS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.comparison')}
            <select value={form.comparison} onChange={(e) => setForm({ ...form, comparison: e.target.value })} style={sel}>{COMPARISONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.threshold')}
            <input type='number' value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} style={{ ...sel, width: 80 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.minAbs')}
            <input type='number' value={form.min_abs} onChange={(e) => setForm({ ...form, min_abs: e.target.value })} placeholder='—' style={{ ...sel, width: 90 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.consecutive')}
            <input type='number' min={1} value={form.consecutive} onChange={(e) => setForm({ ...form, consecutive: Number(e.target.value) })} style={{ ...sel, width: 70 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.severityLbl')}
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} style={sel}>{['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--ink-45)' }}>{t('sentinel.repoLbl')}
            <select value={form.repo_mapping_id} onChange={(e) => setForm({ ...form, repo_mapping_id: e.target.value })} style={sel}>
              <option value=''>{t('sentinel.anyRepo')}</option>
              {repos.map((r) => <option key={r.id} value={r.id}>{r.display_name || `${r.owner}/${r.repo_name}`}</option>)}</select></label>
          <button onClick={createRule} className='button button-primary' style={{ fontSize: 13, padding: '9px 18px' }}>{t('sentinel.create')}</button>
        </div>
      )}

      {rules.length === 0 ? <p style={{ color: 'var(--ink-45)', fontSize: 13 }}>{t('sentinel.noRules')}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rules.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 10, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
              {dot(r.severity)}
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-85)' }}>{r.name}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-45)', fontFamily: 'ui-monospace, monospace' }}>{r.metric_kind} {r.comparison} {r.threshold}{r.comparison.startsWith('pct') ? '%' : ''}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-40)' }}>{r.baseline_mode} · fix: {r.auto_fix}</span>
              <button onClick={() => setConfirmDel(r)} style={{ background: 'none', border: 'none', color: 'var(--ink-35)', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      )}

      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 14, padding: 24, maxWidth: 400, width: '90%', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 6 }}>{t('sentinel.deleteRuleQ')}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-55)', marginBottom: 20 }}>
              <b style={{ color: 'var(--ink-78)' }}>{confirmDel.name}</b> — {confirmDel.metric_kind} {confirmDel.comparison} {confirmDel.threshold}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDel(null)} className='button button-outline' style={{ fontSize: 13, padding: '8px 18px' }}>{t('sentinel.cancel')}</button>
              <button onClick={async () => { const id = confirmDel.id; setConfirmDel(null); await delRule(id); }} className='button button-primary' style={{ fontSize: 13, padding: '8px 18px', background: '#ef4444', borderColor: '#ef4444' }}>{t('sentinel.deleteBtn')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
