'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type Settings = {
  br_emails: string[];
  rubric: string | null;
  epic_rule: string | null;
  auto_eval: boolean;
  azure_pat_set: boolean;
  azure_base_url: string | null;
};

const PAT_KEEP = '__keep__';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)',
  color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 4, display: 'block',
};
const hintStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--ink-35)', marginTop: 4, lineHeight: 1.5,
};

export default function BRSettingsPage() {
  const { t } = useLocale();
  const [emails, setEmails] = useState('');
  const [rubric, setRubric] = useState('');
  const [epicRule, setEpicRule] = useState('');
  const [autoEval, setAutoEval] = useState(false);
  const [patSet, setPatSet] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [patTouched, setPatTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2800);
  };

  useEffect(() => {
    const run = async () => {
      try {
        const s = await apiFetch<Settings>('/br-management/settings');
        setEmails((s.br_emails || []).join('\n'));
        setRubric(s.rubric || '');
        setEpicRule(s.epic_rule || '');
        setAutoEval(s.auto_eval);
        setPatSet(s.azure_pat_set);
        setBaseUrl(s.azure_base_url || '');
      } catch { /* fresh org — defaults */ }
      finally { setLoading(false); }
    };
    void run();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const list = emails.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean);
      const body: Record<string, unknown> = {
        br_emails: list,
        rubric: rubric.trim() || null,
        epic_rule: epicRule.trim() || null,
        auto_eval: autoEval,
        azure_base_url: baseUrl.trim() || null,
        azure_pat: patTouched ? patInput : PAT_KEEP,
      };
      const s = await apiFetch<Settings>('/br-management/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setEmails((s.br_emails || []).join('\n'));
      setPatSet(s.azure_pat_set);
      setPatInput('');
      setPatTouched(false);
      flash(t('br.settings.saved'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--ink-30)', fontSize: 14, padding: '40px 0' }}>{t('br.loading')}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 720 }}>
      <div>
        <div className="section-label">{t('br.sectionLabel')}</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 4 }}>
          {t('br.settings.title')}
        </h1>
        <p style={{ color: 'var(--ink-35)', fontSize: 14, margin: 0 }}>{t('br.settings.subtitle')}</p>
      </div>

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 9999, padding: '12px 20px', borderRadius: 8, background: 'var(--surface)', border: '1px solid ' + (toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57'), color: toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57', fontSize: 13, fontWeight: 600 }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'grid', gap: 20, padding: 20, borderRadius: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-90)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <NavIcon name="users" size={15} /> {t('br.settings.teamSection')}
          </div>
          <div style={{ ...hintStyle, marginTop: 4 }}>{t('br.settings.teamSectionHint')}</div>
        </div>
        {/* BR people */}
        <div>
          <label style={labelStyle}>{t('br.settings.emails')}</label>
          <textarea value={emails} onChange={(e) => setEmails(e.target.value)} rows={5}
            placeholder={'ahmet@flo.com.tr\nmehmet@flo.com.tr'}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }} />
          <div style={hintStyle}>{t('br.settings.emailsHint')}</div>
        </div>

        {/* Rubric */}
        <div>
          <label style={labelStyle}>{t('br.settings.rubric')}</label>
          <textarea value={rubric} onChange={(e) => setRubric(e.target.value)} rows={4}
            placeholder={t('br.settings.rubricPlaceholder')}
            style={{ ...inputStyle, resize: 'vertical' }} />
          <div style={hintStyle}>{t('br.settings.rubricHint')}</div>
        </div>

        {/* Epic rule */}
        <div>
          <label style={labelStyle}>{t('br.settings.epicRule')}</label>
          <textarea value={epicRule} onChange={(e) => setEpicRule(e.target.value)} rows={3}
            placeholder={t('br.settings.epicRulePlaceholder')}
            style={{ ...inputStyle, resize: 'vertical' }} />
          <div style={hintStyle}>{t('br.settings.epicRuleHint')}</div>
        </div>

        {/* Auto eval */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoEval} onChange={(e) => setAutoEval(e.target.checked)} style={{ accentColor: 'var(--acc)', marginTop: 2 }} />
          <span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>{t('br.settings.autoEval')}</span>
            <span style={{ ...hintStyle, marginTop: 2, display: 'block' }}>{t('br.settings.autoEvalHint')}</span>
          </span>
        </label>
      </div>

      {/* Azure PAT block */}
      <div style={{ display: 'grid', gap: 16, padding: 20, borderRadius: 12, border: '1px solid var(--panel-border)', background: 'var(--panel)' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-90)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <NavIcon name="lock" size={15} /> {t('br.settings.azureSection')}
          </div>
          <div style={{ ...hintStyle, marginTop: 4 }}>{t('br.settings.azureSectionHint')}</div>
        </div>
        <div>
          <label style={labelStyle}>{t('br.settings.azurePat')}</label>
          <input type="password" value={patTouched ? patInput : ''}
            onChange={(e) => { setPatInput(e.target.value); setPatTouched(true); }}
            placeholder={patSet ? t('br.settings.azurePatSet') : t('br.settings.azurePatPlaceholder')}
            style={inputStyle} autoComplete="new-password" />
          <div style={hintStyle}>{t('br.settings.azurePatHint')}</div>
        </div>
        <div>
          <label style={labelStyle}>{t('br.settings.azureBaseUrl')}</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://dev.azure.com/your-org"
            style={inputStyle} />
          <div style={hintStyle}>{t('br.settings.azureBaseUrlHint')}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <a href="/dashboard/br-management" style={{ padding: '11px 18px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-65)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          {t('br.settings.back')}
        </a>
        <button onClick={() => void save()} disabled={saving}
          style={{ padding: '11px 22px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
          {saving ? t('br.settings.saving') : t('br.settings.save')}
        </button>
      </div>
    </div>
  );
}
