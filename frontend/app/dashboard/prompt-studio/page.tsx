'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { loadPromptCatalog, savePromptOverrides, type PromptCatalog } from '@/lib/api';
import { useLocale, type Lang } from '@/lib/i18n';

type PromptMeta = {
  title: string;
  summary: string;
};

const PROMPT_ORDER = [
  'PM_SYSTEM_PROMPT',
  'AI_PLAN_SYSTEM_PROMPT',
  'AI_CODE_SYSTEM_PROMPT',
  'DEV_SYSTEM_PROMPT',
  'REVIEWER_SYSTEM_PROMPT',
  'FETCH_CONTEXT_SYSTEM_PROMPT',
  'FINALIZE_SYSTEM_PROMPT',
  'DEV_DIRECT_SYSTEM_PROMPT',
  'FLOW_PRODUCT_REVIEW_SYSTEM_PROMPT',
  'FLOW_AGENT_NODE_SYSTEM_PROMPT_TEMPLATE',
  'FLOW_LEAD_PR_REVIEW_SYSTEM_PROMPT',
] as const;

// Language-aware prompt labels for non-technical users.
const PROMPT_LABELS: Record<'tr' | 'en', Record<string, PromptMeta>> = {
  tr: {
    PM_SYSTEM_PROMPT: { title: 'PM Analiz Promptu', summary: 'Teknik analiz ve kapsam çıkarımı.' },
    AI_PLAN_SYSTEM_PROMPT: { title: 'Planlama Promptu', summary: 'Değişecek dosyaları ve planı belirler.' },
    AI_CODE_SYSTEM_PROMPT: { title: 'Kod Üretim Promptu', summary: 'Planı patch çıktısına dönüştürür.' },
    DEV_SYSTEM_PROMPT: { title: 'Developer Promptu (Flow)', summary: 'Flow modundaki geliştirici davranışı.' },
    REVIEWER_SYSTEM_PROMPT: { title: 'Kod Review Promptu', summary: 'Patch kalitesini denetler.' },
    FETCH_CONTEXT_SYSTEM_PROMPT: { title: 'Context Promptu', summary: 'Görev öncesi kısa bağlam üretir.' },
    FINALIZE_SYSTEM_PROMPT: { title: 'Finalize Promptu', summary: 'Çıktıyı commit’e uygun biçime getirir.' },
    DEV_DIRECT_SYSTEM_PROMPT: { title: 'Direct Developer Promptu', summary: 'Direct mod geliştirici davranışı.' },
    FLOW_PRODUCT_REVIEW_SYSTEM_PROMPT: { title: 'Flow Product Review', summary: 'Flow review node davranışı.' },
    FLOW_AGENT_NODE_SYSTEM_PROMPT_TEMPLATE: { title: 'Flow Agent Template', summary: 'Flow generic agent sistem şablonu.' },
    FLOW_LEAD_PR_REVIEW_SYSTEM_PROMPT: { title: 'Flow Lead PR Review', summary: 'PR review üslubu ve kalite standardı.' },
  },
  en: {
    PM_SYSTEM_PROMPT: { title: 'PM Analysis Prompt', summary: 'Technical analysis and scope extraction.' },
    AI_PLAN_SYSTEM_PROMPT: { title: 'Planning Prompt', summary: 'Defines files and implementation plan.' },
    AI_CODE_SYSTEM_PROMPT: { title: 'Code Generation Prompt', summary: 'Converts plan into patch output.' },
    DEV_SYSTEM_PROMPT: { title: 'Developer Prompt (Flow)', summary: 'Developer behavior in flow mode.' },
    REVIEWER_SYSTEM_PROMPT: { title: 'Code Review Prompt', summary: 'Validates patch quality and safety.' },
    FETCH_CONTEXT_SYSTEM_PROMPT: { title: 'Context Prompt', summary: 'Builds concise execution context.' },
    FINALIZE_SYSTEM_PROMPT: { title: 'Finalize Prompt', summary: 'Normalizes output to commit-ready format.' },
    DEV_DIRECT_SYSTEM_PROMPT: { title: 'Direct Developer Prompt', summary: 'Developer behavior for direct mode.' },
    FLOW_PRODUCT_REVIEW_SYSTEM_PROMPT: { title: 'Flow Product Review', summary: 'Behavior for flow review node.' },
    FLOW_AGENT_NODE_SYSTEM_PROMPT_TEMPLATE: { title: 'Flow Agent Template', summary: 'System template for generic flow nodes.' },
    FLOW_LEAD_PR_REVIEW_SYSTEM_PROMPT: { title: 'Flow Lead PR Review', summary: 'Quality/tone for PR review comments.' },
  },
};

export default function PromptStudioPage() {
  const { lang } = useLocale();
  const [catalog, setCatalog] = useState<PromptCatalog | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const update = () => setIsNarrow(window.innerWidth < 1100);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    let mounted = true;
    loadPromptCatalog()
      .then((data) => {
        if (!mounted) return;
        setCatalog(data);
        setDraft({ ...data.overrides });
        setActiveKey(orderPromptKeys(Object.keys(data.defaults))[0] || '');
      })
      .catch(() => {
        if (!mounted) return;
        setNotice({
          type: 'err',
          text: lang === 'tr' ? 'Prompt kataloğu yüklenemedi.' : 'Could not load prompt catalog.',
        });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [lang]);

  const promptKeys = useMemo(() => {
    const ordered = orderPromptKeys(Object.keys(catalog?.defaults || {}));
    if (!query.trim()) return ordered;
    const q = query.trim().toLowerCase();
    return ordered.filter((k) => {
      const meta = promptMeta(k, lang);
      return (
        k.toLowerCase().includes(q)
        || meta.title.toLowerCase().includes(q)
        || meta.summary.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, lang]);

  useEffect(() => {
    if (!activeKey && promptKeys.length) setActiveKey(promptKeys[0]);
    if (activeKey && !promptKeys.includes(activeKey) && promptKeys.length) setActiveKey(promptKeys[0]);
  }, [activeKey, promptKeys]);

  const defaultText = (catalog?.defaults?.[activeKey] || '').trim();
  const customText = (draft[activeKey] || '').trim();
  const effectiveText = customText || defaultText;
  const meta = promptMeta(activeKey, lang);

  const dirty = useMemo(() => {
    const current = normalizeDraft(draft);
    const initial = normalizeDraft(catalog?.overrides || {});
    return JSON.stringify(current) !== JSON.stringify(initial);
  }, [catalog, draft]);

  async function onSave() {
    setSaving(true);
    setNotice(null);
    try {
      const normalized = normalizeDraft(draft);
      // Only save entries that differ from defaults
      const payload: Record<string, string> = {};
      Object.entries(normalized).forEach(([key, value]) => {
        if (value !== (catalog?.defaults?.[key] || '').trim()) {
          payload[key] = value;
        }
      });
      const next = await savePromptOverrides(payload);
      setCatalog(next);
      setDraft({ ...next.overrides });
      setNotice({
        type: 'ok',
        text: lang === 'tr' ? 'Kaydedildi.' : 'Saved.',
      });
    } catch {
      setNotice({
        type: 'err',
        text: lang === 'tr' ? 'Kaydetme başarısız.' : 'Save failed.',
      });
    } finally {
      setSaving(false);
    }
  }

  function resetActive() {
    if (!activeKey) return;
    setDraft((prev) => {
      const next = { ...prev };
      delete next[activeKey];
      return next;
    });
  }

  if (loading) {
    return <div style={plainInfoStyle}>{lang === 'tr' ? 'Yükleniyor...' : 'Loading...'}</div>;
  }
  if (!catalog) {
    return <div style={{ ...plainInfoStyle, color: '#b91c1c' }}>{lang === 'tr' ? 'Açılamadı.' : 'Unavailable.'}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={topBarStyle}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--ink-90)' }}>Prompt Studio</div>
          <div style={{ fontSize: 12, color: 'var(--ink-58)' }}>
            {lang === 'tr'
              ? 'Sade görünüm: prompt seç, düzenle, kaydet.'
              : 'Simple mode: select prompt, edit, save.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={resetActive} style={btnGhost} disabled={!activeKey || saving}>
            {lang === 'tr' ? 'Aktifi Sıfırla' : 'Reset Active'}
          </button>
          <button onClick={onSave} style={{ ...btnPrimary, opacity: saving || !dirty ? 0.6 : 1 }} disabled={saving || !dirty}>
            {saving ? (lang === 'tr' ? 'Kaydediliyor...' : 'Saving...') : (lang === 'tr' ? 'Kaydet' : 'Save')}
          </button>
        </div>
      </div>

      {notice ? (
        <div style={{
          borderRadius: 10,
          border: `1px solid ${notice.type === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          background: notice.type === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
          color: notice.type === 'ok' ? 'var(--brand-2)' : 'var(--danger)',
          fontSize: 12,
          padding: '8px 10px',
        }}
        >
          {notice.text}
        </div>
      ) : null}

      <div style={{ ...gridStyle, gridTemplateColumns: isNarrow ? '1fr' : '320px minmax(0,1fr)' }}>
        <div style={panelStyle}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={lang === 'tr' ? 'Prompt ara...' : 'Search prompt...'}
            style={inputStyle}
          />
          <div style={{ display: 'grid', gap: 6, marginTop: 8, maxHeight: '64vh', overflow: 'auto' }}>
            {promptKeys.map((key) => {
              const item = promptMeta(key, lang);
              const selected = key === activeKey;
              const draftVal = (draft[key] || '').trim();
              const defaultVal = (catalog?.defaults?.[key] || '').trim();
              const customized = !!draftVal && draftVal !== defaultVal;
              return (
                <button
                  key={key}
                  onClick={() => setActiveKey(key)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 10,
                    border: selected ? '1px solid var(--accent)' : '1px solid var(--panel-border)',
                    background: selected ? 'var(--nav-active-bg)' : 'var(--panel)',
                    padding: '9px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-90)' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2 }}>{item.summary}</div>
                  <div style={{ fontSize: 10, marginTop: 4, color: customized ? 'var(--accent)' : 'var(--ink-42)' }}>
                    {customized ? (lang === 'tr' ? 'Özel' : 'Custom') : (lang === 'tr' ? 'Varsayılan' : 'Default')}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={panelStyle}>
          {activeKey ? (
            <>
              <div style={{ display: 'grid', gap: 3 }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink-90)' }}>{meta.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-58)' }}>{meta.summary}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-42)' }}>{activeKey}</div>
              </div>

              {customText ? (
                <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8, fontWeight: 600 }}>
                  {lang === 'tr' ? '✏️ Özelleştirilmiş — değişiklikler kaydedilecek' : '✏️ Customized — changes will be saved'}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--ink-42)', marginTop: 8 }}>
                  {lang === 'tr' ? '📄 Sistem varsayılanı — düzenleyerek özelleştirin' : '📄 System default — edit to customize'}
                </div>
              )}
              <textarea
                value={activeKey in draft ? draft[activeKey] : defaultText}
                onChange={(e) => setDraft((prev) => ({ ...prev, [activeKey]: e.target.value }))}
                rows={20}
                style={{
                  ...inputStyle,
                  minHeight: 430,
                  marginTop: 8,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1.45,
                  resize: 'vertical',
                  borderColor: customText ? 'var(--accent)' : 'var(--panel-border)',
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--ink-42)', marginTop: 6 }}>
                {lang === 'tr'
                  ? 'Sıfırla butonuyla sistem varsayılanına dönebilirsiniz.'
                  : 'Use Reset to revert to system default.'}
              </div>
            </>
          ) : (
            <div style={plainInfoStyle}>{lang === 'tr' ? 'Prompt seçin.' : 'Select a prompt.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function orderPromptKeys(keys: string[]) {
  const orderIndex = new Map(PROMPT_ORDER.map((k, idx) => [k, idx]));
  return [...keys].sort((a, b) => {
    const ai = orderIndex.has(a) ? (orderIndex.get(a) as number) : 999 + a.charCodeAt(0);
    const bi = orderIndex.has(b) ? (orderIndex.get(b) as number) : 999 + b.charCodeAt(0);
    return ai - bi || a.localeCompare(b);
  });
}

function promptMeta(key: string, lang: Lang): PromptMeta {
  const base = lang === 'tr' ? 'tr' : 'en';
  const mapped = PROMPT_LABELS[base][key];
  if (mapped) return mapped;
  return {
    title: key,
    summary: base === 'tr' ? 'Sistem prompt tanımı.' : 'System prompt definition.',
  };
}

function normalizeDraft(raw: Record<string, string>) {
  const out: Record<string, string> = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    const text = String(value || '').trim();
    if (text) out[key] = text;
  });
  return out;
}

const plainInfoStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--ink-50)',
};

const topBarStyle: CSSProperties = {
  border: '1px solid var(--panel-border)',
  borderRadius: 12,
  background: 'var(--panel)',
  padding: 10,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const panelStyle: CSSProperties = {
  border: '1px solid var(--panel-border)',
  borderRadius: 12,
  background: 'var(--panel)',
  padding: 10,
};

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--panel-border)',
  borderRadius: 10,
  padding: '9px 10px',
  background: 'var(--bg)',
  color: 'var(--ink-90)',
  fontSize: 12,
  outline: 'none',
};

const btnPrimary: CSSProperties = {
  border: 'none',
  borderRadius: 10,
  background: 'var(--brand)',
  color: '#fff',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

const btnGhost: CSSProperties = {
  border: '1px solid var(--panel-border)',
  borderRadius: 10,
  background: 'var(--panel)',
  color: 'var(--ink-75)',
  padding: '8px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
