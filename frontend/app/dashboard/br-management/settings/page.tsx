'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch, resolveApiBase } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';

type Section = { title: string; critical: boolean };
type Pack = { key: string; name: string; applies_to: string; sections: Section[] };

type Settings = {
  br_emails: string[];
  rubric: string | null;
  epic_rule: string | null;
  decision_pack_sections: Section[];
  decision_packs: Pack[];
  included_states: string[];
  azure_field_map: Record<string, string>;
  eval_prompt: string | null;
  intake_prompt: string | null;
  auto_eval: boolean;
  azure_project: string | null;
  auto_eval_interval_minutes: number;
  last_auto_eval_at: string | null;
  provider: string | null;
  model: string | null;
  azure_pat_set: boolean;
  azure_base_url: string | null;
  webhook_token: string | null;
  default_decision_pack_sections: Section[];
  default_eval_prompt: string;
  default_intake_prompt: string;
  sections_token: string;
  submit_threshold: number;
  closed_states: string[];
};

// The states Azure ships out of the box across its process templates. The
// picker is free-text too, because a customized process can name its own.
const COMMON_STATES = [
  'New', 'Approved', 'Committed', 'Active', 'Resolved', 'Done', 'Closed', 'Removed',
];
const APPLIES_TO = ['default', 'epic', 'improvement'] as const;

const PAT_KEEP = '__keep__';

const PROVIDERS = [
  { value: 'claude_cli', label: 'Claude CLI', model: 'sonnet' },
  { value: 'codex_cli', label: 'Codex CLI', model: 'gpt-5-codex' },
  { value: 'anthropic', label: 'Anthropic API', model: 'claude-sonnet-5' },
  { value: 'openai', label: 'OpenAI API', model: 'gpt-5' },
  { value: 'gemini', label: 'Gemini API', model: 'gemini-2.5-pro' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid var(--panel-border-3)', background: 'var(--panel-alt)',
  color: 'var(--ink-90)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit',
};
const cardStyle: React.CSSProperties = {
  padding: 18, borderRadius: 16, border: '1px solid var(--panel-border)',
  background: 'var(--panel)', display: 'grid', gap: 14,
};
const eyebrow: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, color: 'var(--ink-35)',
  textTransform: 'uppercase', letterSpacing: 0.7,
};
const fieldLabel: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 700, color: 'var(--ink-78)', marginBottom: 5, display: 'block',
};
const hintStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--ink-35)', marginTop: 4, lineHeight: 1.55,
};

/** Card header: eyebrow + the one line that says what this card decides. */
function CardHead({ icon, label, purpose, aside }: {
  icon: string; label: string; purpose: string; aside?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{
        width: 28, height: 28, borderRadius: 9, flexShrink: 0, marginTop: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--panel-alt)', border: '1px solid var(--panel-border-3)',
        color: 'var(--acc)',
      }}><NavIcon name={icon} size={14} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...eyebrow, display: 'block' }}>{label}</span>
        <span style={{ ...hintStyle, marginTop: 3, display: 'block' }}>{purpose}</span>
      </span>
      {aside}
    </div>
  );
}

export default function BRSettingsPage() {
  const { t } = useLocale();
  const [initial, setInitial] = useState<Settings | null>(null);
  const [emails, setEmails] = useState('');
  const [rubric, setRubric] = useState('');
  const [epicRule, setEpicRule] = useState('');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [activePack, setActivePack] = useState(0);
  const [states, setStates] = useState<string[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [evalPrompt, setEvalPrompt] = useState<string | null>(null);
  const [intakePrompt, setIntakePrompt] = useState<string | null>(null);
  const [openPrompt, setOpenPrompt] = useState<'eval' | 'intake' | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [autoEval, setAutoEval] = useState(false);
  const [azureProject, setAzureProject] = useState('');
  const [interval, setIntervalMin] = useState(5);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [patSet, setPatSet] = useState(false);
  const [patInput, setPatInput] = useState('');
  const [patTouched, setPatTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2800);
  };

  const hydrate = useCallback((s: Settings) => {
    setInitial(s);
    setEmails((s.br_emails || []).join('\n'));
    setRubric(s.rubric || '');
    setEpicRule(s.epic_rule || '');
    setPacks((s.decision_packs || []).map((p) => ({ ...p, sections: p.sections.map((x) => ({ ...x })) })));
    setActivePack(0);
    setStates(s.included_states || []);
    setFieldMap({ ...(s.azure_field_map || {}) });
    setEvalPrompt(s.eval_prompt);
    setIntakePrompt(s.intake_prompt);
    setProvider(s.provider || '');
    setModel(s.model || '');
    setAutoEval(s.auto_eval);
    setAzureProject(s.azure_project || '');
    setIntervalMin(s.auto_eval_interval_minutes || 5);
    setLastScan(s.last_auto_eval_at);
    setPatSet(s.azure_pat_set);
    setPatInput('');
    setPatTouched(false);
    setBaseUrl(s.azure_base_url || '');
    setWebhookToken(s.webhook_token);
  }, []);

  // The API base without its trailing path, so the URL shown is the one
  // Azure will actually call — not a localhost guess.
  const hookUrl = useMemo(
    () => `${resolveApiBase().replace(/\/+$/, '')}/webhooks/br-evaluate/${webhookToken || ''}`,
    [webhookToken],
  );

  const rotateToken = async () => {
    setRotating(true);
    try {
      const s = await apiFetch<Settings>('/br-management/webhook-token', { method: 'POST' });
      setWebhookToken(s.webhook_token);
      setInitial(s);
      flash(t('br.settings.hookRotated'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally {
      setRotating(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        hydrate(await apiFetch<Settings>('/br-management/settings'));
      } catch { /* fresh org — the API still returns defaults */ }
      finally { setLoading(false); }
      try {
        const list = await apiFetch<{ id: string; name: string }[]>('/br-management/azure/projects');
        setProjects(list.map((p) => p.name));
      } catch { /* no Azure creds yet — the free-text input still works */ }
    };
    void run();
  }, [hydrate]);

  const emailList = useMemo(
    () => emails.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean),
    [emails],
  );
  const pack = packs[activePack] || { key: 'default', name: '', applies_to: 'default', sections: [] };
  const sections = pack.sections;
  const criticalCount = sections.filter((s) => s.critical).length;
  const totalSections = packs.reduce((n, p) => n + p.sections.length, 0);

  /** Every pack edit goes through here so the array stays immutable. */
  const editPack = (changes: Partial<Pack>) =>
    setPacks(packs.map((p, i) => (i === activePack ? { ...p, ...changes } : p)));
  const setSections = (next: Section[]) => editPack({ sections: next });
  const providerLabel = PROVIDERS.find((p) => p.value === provider)?.label || '';
  const isDefaultPack = useMemo(() => (
    JSON.stringify(sections) === JSON.stringify(initial?.default_decision_pack_sections || [])
  ), [sections, initial]);

  const addPack = () => {
    const key = `pack${packs.length + 1}`;
    setPacks([...packs, {
      key, name: '', applies_to: 'default',
      sections: (initial?.default_decision_pack_sections || []).map((x) => ({ ...x })),
    }]);
    setActivePack(packs.length);
  };
  const removePack = () => {
    if (packs.length <= 1) return;
    setPacks(packs.filter((_, i) => i !== activePack));
    setActivePack(Math.max(0, activePack - 1));
  };

  const dirty = useMemo(() => {
    if (!initial) return false;
    return (
      JSON.stringify(emailList) !== JSON.stringify(initial.br_emails || [])
      || rubric.trim() !== (initial.rubric || '')
      || epicRule.trim() !== (initial.epic_rule || '')
      || JSON.stringify(packs) !== JSON.stringify(initial.decision_packs || [])
      || JSON.stringify(states) !== JSON.stringify(initial.included_states || [])
      || JSON.stringify(fieldMap) !== JSON.stringify(initial.azure_field_map || {})
      || (evalPrompt || '') !== (initial.eval_prompt || '')
      || (intakePrompt || '') !== (initial.intake_prompt || '')
      || provider !== (initial.provider || '')
      || model !== (initial.model || '')
      || autoEval !== initial.auto_eval
      || azureProject.trim() !== (initial.azure_project || '')
      || interval !== (initial.auto_eval_interval_minutes || 5)
      || baseUrl.trim() !== (initial.azure_base_url || '')
      || patTouched
    );
  }, [initial, emailList, rubric, epicRule, packs, states, fieldMap, evalPrompt, intakePrompt,
    provider, model, autoEval, azureProject, interval, baseUrl, patTouched]);

  const save = async () => {
    setSaving(true);
    try {
      const s = await apiFetch<Settings>('/br-management/settings', {
        method: 'PUT',
        body: JSON.stringify({
          br_emails: emailList,
          rubric: rubric.trim() || null,
          epic_rule: epicRule.trim() || null,
          decision_packs: packs.map((p) => ({ ...p, sections: p.sections.filter((x) => x.title.trim()) })),
          included_states: states,
          azure_field_map: Object.fromEntries(
            Object.entries(fieldMap).filter(([k, v]) => k.trim() && v.trim()),
          ),
          eval_prompt: evalPrompt,
          intake_prompt: intakePrompt,
          provider: provider || null,
          model: model.trim() || null,
          auto_eval: autoEval,
          azure_project: azureProject.trim() || null,
          auto_eval_interval_minutes: interval,
          azure_base_url: baseUrl.trim() || null,
          azure_pat: patTouched ? patInput : PAT_KEEP,
        }),
      });
      hydrate(s);
      flash(t('br.settings.saved'));
    } catch (e) {
      flash(e instanceof Error ? e.message : t('br.error'), 'err');
    } finally {
      setSaving(false);
    }
  };

  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setSections(next);
  };

  if (loading) {
    return <div style={{ color: 'var(--ink-30)', fontSize: 14, padding: '40px 0' }}>{t('br.loading')}</div>;
  }

  const promptRow = (
    which: 'eval' | 'intake', value: string | null,
    setValue: (v: string | null) => void, fallback: string,
    title: string, purpose: string,
  ) => {
    const open = openPrompt === which;
    const custom = Boolean(value && value.trim());
    return (
      <div style={{
        borderRadius: 12, border: '1px solid var(--panel-border-3)',
        background: 'var(--panel-alt)', overflow: 'hidden',
      }}>
        <button type="button" onClick={() => setOpenPrompt(open ? null : which)} aria-expanded={open}
          className="brsrow"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px',
            background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
            fontFamily: 'inherit', color: 'var(--ink-90)',
          }}>
          <span style={{
            display: 'inline-flex', color: 'var(--ink-30)',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease',
          }}><NavIcon name="chevron-right" size={13} /></span>
          <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{title}</span>
          <span className={custom ? 'brschip brschip-on' : 'brschip'} style={{ cursor: 'inherit' }}>
            {custom ? t('br.settings.promptCustom') : t('br.settings.promptDefault')}
          </span>
        </button>
        {open && (
          <div style={{ padding: '0 13px 13px', display: 'grid', gap: 10 }}>
            <div style={{ ...hintStyle, marginTop: 0 }}>{purpose}</div>
            {custom ? (
              <textarea value={value || ''} onChange={(e) => setValue(e.target.value)} rows={15} spellCheck={false}
                style={{ ...inputStyle, background: 'var(--panel)', fontSize: 11.5, lineHeight: 1.65, resize: 'vertical' }} />
            ) : (
              <pre style={{
                margin: 0, padding: 12, maxHeight: 260, overflow: 'auto', borderRadius: 10,
                background: 'var(--panel)', border: '1px solid var(--panel-border-2)',
                fontSize: 11, lineHeight: 1.65, color: 'var(--ink-58)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
              }}>{fallback}</pre>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="brsghost"
                onClick={() => setValue(custom ? null : fallback)}>
                {custom ? t('br.settings.promptReset') : t('br.settings.promptCustomize')}
              </button>
              <span style={{ ...hintStyle, marginTop: 0, flex: 1, minWidth: 160 }}>
                {t('br.settings.promptTokenHint', { token: initial?.sections_token || '' })}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const statRow = (value: React.ReactNode, caption: string) => (
    <div style={{ display: 'grid', gap: 1 }}>
      <span style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink-90)', lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 10.5, color: 'var(--ink-35)', fontWeight: 600 }}>{caption}</span>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div className="section-label">{t('br.sectionLabel')}</div>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--ink-90)', marginTop: 8, marginBottom: 2 }}>
          {t('br.settings.title')}
        </h1>
        <p style={{ color: 'var(--ink-35)', fontSize: 13.5, margin: 0 }}>{t('br.settings.subtitle')}</p>
      </div>

      <div className="brsgrid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 304px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>

          {/* ── BR team ─────────────────────────────────────── */}
          <div className="brscard" style={cardStyle}>
            <CardHead icon="users" label={t('br.settings.stage1')} purpose={t('br.settings.stage1Hint')}
              aside={<span style={{ ...eyebrow, color: 'var(--ink-30)' }}>{emailList.length}</span>} />
            <div>
              <textarea id="br-emails" value={emails} onChange={(e) => setEmails(e.target.value)} rows={4}
                placeholder={'ahmet@flo.com.tr\nmehmet@flo.com.tr'} spellCheck={false}
                style={{ ...inputStyle, resize: 'vertical', fontSize: 12.5, lineHeight: 1.75 }} />
              <div style={hintStyle}>{t('br.settings.emailsHint')}</div>
            </div>
          </div>

          {/* ── Decision Pack: the standard itself ──────────── */}
          <div className="brscard" style={cardStyle}>
            <CardHead icon="clipboard" label={t('br.settings.pack')} purpose={t('br.settings.packHint')}
              aside={
                <span style={{ ...eyebrow, color: 'var(--ink-30)', whiteSpace: 'nowrap' }}>
                  {t('br.settings.packCount', { count: sections.length, critical: criticalCount })}
                </span>
              } />

            {/* One tab per pack: a project BR is held to a heavier standard
                than a small improvement. */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {packs.map((p, i) => (
                <button key={i} type="button" onClick={() => setActivePack(i)}
                  className={i === activePack ? 'brschip brschip-on' : 'brschip'}>
                  {p.name || p.key} · {p.sections.length}
                </button>
              ))}
              <button type="button" className="brsghost" style={{ padding: '5px 10px' }} onClick={addPack}>
                + {t('br.settings.packAddPack')}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(150px, 1fr) auto', gap: 10, alignItems: 'end' }}>
              <div>
                <label style={fieldLabel}>{t('br.settings.packName')}</label>
                <input value={pack.name} onChange={(e) => editPack({ name: e.target.value })}
                  placeholder={t('br.settings.packNamePlaceholder')} style={inputStyle} />
              </div>
              <div>
                <label style={fieldLabel}>{t('br.settings.packAppliesTo')}</label>
                <select value={pack.applies_to} onChange={(e) => editPack({ applies_to: e.target.value })}
                  style={{ ...inputStyle, cursor: 'pointer' }}>
                  {APPLIES_TO.map((a) => (
                    <option key={a} value={a}>{t(('br.settings.applies.' + a) as 'br.settings.applies.default')}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="brsghost" onClick={removePack} disabled={packs.length <= 1}>
                {t('br.settings.packRemovePack')}
              </button>
            </div>
            <div style={hintStyle}>{t('br.settings.packAppliesToHint')}</div>

            <div style={{ display: 'grid', gap: 5 }}>
              {sections.map((s, i) => (
                <div key={i} className="brssec" style={{
                  display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center',
                  padding: '5px 7px 5px 9px', borderRadius: 10, background: 'var(--panel-alt)',
                  border: '1px solid ' + (s.critical ? 'color-mix(in srgb, var(--warn) 45%, transparent)' : 'var(--panel-border-2)'),
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: 'var(--ink-30)', minWidth: 16,
                    textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  }}>{i + 1}</span>
                  <input value={s.title}
                    onChange={(e) => setSections(sections.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                    placeholder={t('br.settings.packPlaceholder')}
                    style={{ ...inputStyle, border: 'none', background: 'transparent', padding: '5px 0', fontSize: 12.5 }} />
                  <button type="button" title={t('br.settings.packCriticalHint')}
                    aria-pressed={s.critical}
                    onClick={() => setSections(sections.map((x, j) => j === i ? { ...x, critical: !x.critical } : x))}
                    className={s.critical ? 'brschip brschip-warn' : 'brschip'}>
                    {t('br.settings.packCritical')}
                  </button>
                  <span style={{ display: 'flex', gap: 1 }}>
                    <button type="button" className="brsicon" onClick={() => moveSection(i, i - 1)} disabled={i === 0}
                      aria-label={t('br.settings.packUp')} title={t('br.settings.packUp')}>↑</button>
                    <button type="button" className="brsicon" onClick={() => moveSection(i, i + 1)} disabled={i === sections.length - 1}
                      aria-label={t('br.settings.packDown')} title={t('br.settings.packDown')}>↓</button>
                    <button type="button" className="brsicon brsicon-del" onClick={() => setSections(sections.filter((_, j) => j !== i))}
                      aria-label={t('br.settings.packRemove')} title={t('br.settings.packRemove')}>×</button>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="brsghost"
                onClick={() => setSections([...sections, { title: '', critical: false }])}>
                + {t('br.settings.packAdd')}
              </button>
              {!isDefaultPack && (
                <button type="button" className="brsghost"
                  onClick={() => setSections((initial?.default_decision_pack_sections || []).map((x) => ({ ...x })))}>
                  {t('br.settings.packReset')}
                </button>
              )}
            </div>

            <div style={{ height: 1, background: 'var(--panel-border)' }} />

            <div>
              <label style={fieldLabel} htmlFor="br-rubric">{t('br.settings.rubric')}</label>
              <textarea id="br-rubric" value={rubric} onChange={(e) => setRubric(e.target.value)} rows={3}
                placeholder={t('br.settings.rubricPlaceholder')}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
              <div style={hintStyle}>{t('br.settings.rubricHint')}</div>
            </div>
            <div>
              <label style={fieldLabel} htmlFor="br-epic">{t('br.settings.epicRule')}</label>
              <textarea id="br-epic" value={epicRule} onChange={(e) => setEpicRule(e.target.value)} rows={2}
                placeholder={t('br.settings.epicRulePlaceholder')}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
              <div style={hintStyle}>{t('br.settings.epicRuleHint')}</div>
            </div>
          </div>

          {/* ── Which states count ─────────────────────────── */}
          <div className="brscard" style={cardStyle}>
            <CardHead icon="activity" label={t('br.settings.states')} purpose={t('br.settings.statesHint')}
              aside={
                <span style={{ ...eyebrow, color: 'var(--ink-30)', whiteSpace: 'nowrap' }}>
                  {states.length ? states.length : t('br.settings.statesAllOpen')}
                </span>
              } />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Array.from(new Set([...COMMON_STATES, ...states])).map((st) => {
                const on = states.includes(st);
                const closed = (initial?.closed_states || []).includes(st);
                return (
                  <button key={st} type="button"
                    onClick={() => setStates(on ? states.filter((x) => x !== st) : [...states, st])}
                    className={on ? 'brschip brschip-on' : 'brschip'}
                    title={closed ? t('br.settings.statesClosedHint') : ''}>
                    {st}{closed ? ' ·' : ''}
                  </button>
                );
              })}
            </div>
            {states.length > 0 && (
              <button type="button" className="brsghost" style={{ justifySelf: 'start' }}
                onClick={() => setStates([])}>
                {t('br.settings.statesReset')}
              </button>
            )}
          </div>

          {/* ── Azure custom fields ────────────────────────── */}
          <div className="brscard" style={cardStyle}>
            <CardHead icon="database" label={t('br.settings.fieldMap')} purpose={t('br.settings.fieldMapHint')}
              aside={
                <span style={{ ...eyebrow, color: 'var(--ink-30)', whiteSpace: 'nowrap' }}>
                  {Object.values(fieldMap).filter((v) => v.trim()).length}
                </span>
              } />
            <div style={{ display: 'grid', gap: 5 }}>
              {sections.filter((s) => s.title.trim()).map((s) => (
                <div key={s.title} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, 210px)',
                  gap: 8, alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: 12, color: 'var(--ink-65)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={s.title}>{s.title.split('(')[0].trim()}</span>
                  <input value={fieldMap[s.title] || ''}
                    onChange={(e) => setFieldMap({ ...fieldMap, [s.title]: e.target.value })}
                    placeholder="Custom.FieldName"
                    style={{ ...inputStyle, fontSize: 12, padding: '7px 10px' }} />
                </div>
              ))}
            </div>
            <div style={hintStyle}>{t('br.settings.fieldMapNote')}</div>
          </div>

          {/* ── The judge ──────────────────────────────────── */}
          <div className="brscard" style={cardStyle}>
            <CardHead icon="agents" label={t('br.settings.stage3')} purpose={t('br.settings.stage3Hint')} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <div>
                <label style={fieldLabel} htmlFor="br-provider">{t('br.settings.provider')}</label>
                <select id="br-provider" value={provider} style={{ ...inputStyle, cursor: 'pointer' }}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    if (!model.trim()) setModel(PROVIDERS.find((p) => p.value === e.target.value)?.model || '');
                  }}>
                  <option value="">{t('br.settings.providerAuto')}</option>
                  {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <div style={hintStyle}>{t('br.settings.providerHint')}</div>
              </div>
              <div>
                <label style={fieldLabel} htmlFor="br-model">{t('br.settings.model')}</label>
                <input id="br-model" value={model} onChange={(e) => setModel(e.target.value)}
                  placeholder={PROVIDERS.find((p) => p.value === provider)?.model || t('br.settings.modelPlaceholder')}
                  style={inputStyle} />
                <div style={hintStyle}>{t('br.settings.modelHint')}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {promptRow('eval', evalPrompt, setEvalPrompt, initial?.default_eval_prompt || '',
                t('br.settings.promptEval'), t('br.settings.promptEvalHint'))}
              {promptRow('intake', intakePrompt, setIntakePrompt, initial?.default_intake_prompt || '',
                t('br.settings.promptIntake'), t('br.settings.promptIntakeHint'))}
            </div>
          </div>

          {/* ── Running + access ───────────────────────────── */}
          <div className="brscard" style={cardStyle}>
            <CardHead icon="zap" label={t('br.settings.stage4')} purpose={t('br.settings.stage4Hint')} />
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoEval} onChange={(e) => setAutoEval(e.target.checked)}
                style={{ accentColor: 'var(--acc)', marginTop: 2 }} />
              <span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-90)' }}>{t('br.settings.autoEval')}</span>
                <span style={{ ...hintStyle, marginTop: 2, display: 'block' }}>{t('br.settings.autoEvalHint')}</span>
              </span>
            </label>
            {autoEval && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 130px', gap: 12,
                padding: 13, borderRadius: 12, background: 'var(--panel-alt)',
                border: '1px solid var(--panel-border-2)',
              }}>
                <div>
                  <label style={fieldLabel} htmlFor="br-project">{t('br.settings.azureProject')}</label>
                  <input id="br-project" value={azureProject} onChange={(e) => setAzureProject(e.target.value)}
                    list="br-azure-projects" placeholder={t('br.settings.azureProjectPlaceholder')}
                    style={{ ...inputStyle, background: 'var(--panel)' }} />
                  <datalist id="br-azure-projects">
                    {projects.map((p) => <option key={p} value={p} />)}
                  </datalist>
                  <div style={hintStyle}>{t('br.settings.azureProjectHint')}</div>
                </div>
                <div>
                  <label style={fieldLabel} htmlFor="br-interval">{t('br.settings.autoEvalInterval')}</label>
                  <input id="br-interval" type="number" min={1} max={1440} value={interval}
                    onChange={(e) => setIntervalMin(Math.max(1, Math.min(1440, Number(e.target.value) || 5)))}
                    style={{ ...inputStyle, background: 'var(--panel)' }} />
                </div>
              </div>
            )}

            <div style={{ height: 1, background: 'var(--panel-border)' }} />

            {/* Instant trigger. Polling above stays on as the safety net. */}
            <CardHead icon="plug" label={t('br.settings.hook')} purpose={t('br.settings.hookHint')} />
            {webhookToken ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px',
                  borderRadius: 10, background: 'var(--panel-alt)',
                  border: '1px solid var(--panel-border-2)',
                }}>
                  <code style={{
                    flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--ink-78)',
                    overflowX: 'auto', whiteSpace: 'nowrap',
                  }}>{hookUrl}</code>
                  <button type="button" className="brsghost" onClick={() => {
                    void navigator.clipboard?.writeText(hookUrl);
                    flash(t('br.settings.hookCopied'));
                  }}>{t('br.settings.hookCopy')}</button>
                </div>
                <ol style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>
                  {[t('br.settings.hookStep1'), t('br.settings.hookStep2'), t('br.settings.hookStep3')].map((s) => (
                    <li key={s} style={{ ...hintStyle, marginTop: 0 }}>{s}</li>
                  ))}
                </ol>
                <div>
                  <button type="button" className="brsghost" onClick={() => void rotateToken()} disabled={rotating}>
                    {t('br.settings.hookRotate')}
                  </button>
                  <div style={hintStyle}>{t('br.settings.hookRotateHint')}</div>
                </div>
              </div>
            ) : (
              <div>
                <button type="button" className="brsghost" onClick={() => void rotateToken()} disabled={rotating}>
                  {t('br.settings.hookCreate')}
                </button>
                <div style={hintStyle}>{t('br.settings.hookCreateHint')}</div>
              </div>
            )}

            <div style={{ height: 1, background: 'var(--panel-border)' }} />

            <CardHead icon="lock" label={t('br.settings.azureSection')} purpose={t('br.settings.azureSectionHint')} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              <div>
                <label style={fieldLabel} htmlFor="br-pat">{t('br.settings.azurePat')}</label>
                <input id="br-pat" type="password" value={patTouched ? patInput : ''}
                  onChange={(e) => { setPatInput(e.target.value); setPatTouched(true); }}
                  placeholder={patSet ? t('br.settings.azurePatSet') : t('br.settings.azurePatPlaceholder')}
                  style={inputStyle} autoComplete="new-password" />
                <div style={hintStyle}>{t('br.settings.azurePatHint')}</div>
              </div>
              <div>
                <label style={fieldLabel} htmlFor="br-baseurl">{t('br.settings.azureBaseUrl')}</label>
                <input id="br-baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://dev.azure.com/your-org" style={inputStyle} />
                <div style={hintStyle}>{t('br.settings.azureBaseUrlHint')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Inspector rail: the config, read back as policy ── */}
        <div style={{ display: 'grid', gap: 12, position: 'sticky', top: 12, alignContent: 'start' }}>
          <div className="brscard" style={{ ...cardStyle, gap: 12 }}>
            <div style={eyebrow}>{t('br.settings.policyLabel')}</div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--ink-78)' }}>
              {emailList.length === 0
                ? t('br.settings.policy.noPeople')
                : t('br.settings.policy.line', { people: emailList.length, sections: totalSections })}
              {criticalCount > 0 && ' ' + t('br.settings.policy.critical', { count: criticalCount })}
              {' '}
              {provider
                ? t('br.settings.policy.judge', { model: model.trim() || providerLabel })
                : t('br.settings.policy.judgeAuto')}
              {' '}
              {autoEval
                ? t('br.settings.policy.autoOn', { minutes: interval })
                : t('br.settings.policy.autoOff')}
            </p>
            <div style={{ height: 1, background: 'var(--panel-border)' }} />
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {statRow(emailList.length, t('br.settings.statPeople'))}
              {statRow(totalSections, t('br.settings.statSections'))}
              {packs.length > 1 && statRow(packs.length, t('br.settings.statPacks'))}
              {statRow(
                <span style={{ color: criticalCount ? 'var(--warn)' : 'var(--ink-90)' }}>{criticalCount}</span>,
                t('br.settings.statCritical'),
              )}
              {statRow(initial?.submit_threshold ?? 70, t('br.settings.statGate'))}
            </div>
            {autoEval && (
              <div style={{ ...hintStyle, marginTop: 0 }}>
                {t('br.settings.lastAutoScan')}{' '}
                <span style={{ color: 'var(--ink-65)', fontWeight: 600 }}>
                  {lastScan ? new Date(lastScan + 'Z').toLocaleString() : t('br.settings.lastAutoScanNever')}
                </span>
              </div>
            )}
          </div>

          <div className="brscard" style={{ ...cardStyle, gap: 10 }}>
            <button type="button" onClick={() => void save()} disabled={saving || !dirty} className="brsbtn"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 11, border: 'none',
                background: dirty ? 'var(--acc)' : 'var(--panel-alt)',
                color: dirty ? '#fff' : 'var(--ink-30)', fontWeight: 700, fontSize: 13,
                fontFamily: 'inherit', cursor: dirty && !saving ? 'pointer' : 'default',
                boxShadow: dirty ? '0 8px 18px -8px var(--acc)' : 'none',
                transition: 'background .25s ease',
              }}>
              {saving ? t('br.settings.saving') : t('br.settings.save')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="brsghost" style={{ flex: 1 }}
                onClick={() => initial && hydrate(initial)} disabled={!dirty || saving}>
                {t('br.settings.discard')}
              </button>
              <a href="/dashboard/br-management" className="brsghost"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>
                {t('br.settings.back')}
              </a>
            </div>
            <div style={{ ...hintStyle, marginTop: 0, textAlign: 'center' }}>
              {dirty ? t('br.settings.unsaved') : t('br.settings.allSaved')}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, background: 'var(--surface)',
          border: '1px solid ' + (toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57'),
          color: toast.kind === 'ok' ? '#3f9d6a' : '#cf5b57', fontSize: 13, fontWeight: 600,
          boxShadow: '0 16px 40px -20px rgba(15,23,42,.4)',
        }}>{toast.msg}</div>
      )}

      <style>{`
        .brscard { box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 16px 40px -28px rgba(15,23,42,.22); }
        .brssec { transition: border-color .15s ease, background .15s ease; }
        .brssec:focus-within { border-color: var(--acc); background: var(--panel); }
        .brschip { padding: 4px 11px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
                   line-height: 1.4; cursor: pointer; white-space: nowrap; font-family: inherit;
                   border: 1px solid var(--panel-border-3); background: var(--panel);
                   color: var(--ink-35); transition: border-color .15s ease, color .15s ease,
                   background .15s ease, transform .1s ease; }
        .brschip:hover { border-color: var(--acc); color: var(--acc); }
        .brschip:active { transform: scale(.95); }
        .brschip-on, .brschip-on:hover { border-color: transparent; background: var(--acc-soft); color: var(--acc); }
        .brschip-warn, .brschip-warn:hover { border-color: transparent;
                   background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
        .brsghost { padding: 8px 13px; border-radius: 9px; font-size: 12px; font-weight: 600;
                    font-family: inherit; cursor: pointer; border: 1px solid var(--panel-border-3);
                    background: var(--panel-alt); color: var(--ink-65);
                    transition: border-color .15s ease, color .15s ease; }
        .brsghost:hover:not(:disabled) { border-color: var(--acc); color: var(--acc); }
        .brsghost:disabled { opacity: .45; cursor: default; }
        .brsicon { width: 24px; height: 24px; border-radius: 7px; border: none; background: transparent;
                   color: var(--ink-30); font-size: 13px; line-height: 1; cursor: pointer;
                   font-family: inherit; transition: background .15s ease, color .15s ease; }
        .brsicon:hover:not(:disabled) { background: var(--panel-border-2); color: var(--ink-90); }
        .brsicon:disabled { opacity: .25; cursor: default; }
        .brsicon-del:hover { color: #cf5b57; }
        .brsrow:hover { background: var(--panel) !important; }
        .brsbtn:hover:not(:disabled) { filter: brightness(1.07); }
        .brsbtn:active:not(:disabled) { transform: translateY(1px); }
        @media (max-width: 1080px) {
          .brsgrid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
