'use client';

import { useState, useEffect, useCallback } from 'react';
import tr from '@/locales/tr.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import zh from '@/locales/zh.json';
import it from '@/locales/it.json';
import de from '@/locales/de.json';
import ja from '@/locales/ja.json';

const LS_KEY = 'agena_lang';

export type Lang = 'tr' | 'en' | 'es' | 'zh' | 'it' | 'de' | 'ja';

const translations = { tr, en, es, zh, it, de, ja } as const;

export type TranslationKey = keyof typeof translations.tr;

const dicts: Record<Lang, Record<string, string>> = {
  tr: translations.tr as Record<string, string>,
  en: translations.en as Record<string, string>,
  es: translations.es as Record<string, string>,
  zh: translations.zh as Record<string, string>,
  it: translations.it as Record<string, string>,
  de: translations.de as Record<string, string>,
  ja: translations.ja as Record<string, string>,
};

const _listeners: Set<() => void> = new Set();

function getLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const raw = localStorage.getItem(LS_KEY);
  if (raw === 'tr' || raw === 'en' || raw === 'es' || raw === 'zh' || raw === 'it' || raw === 'de' || raw === 'ja') return raw;
  return 'en';
}

function setLang(l: Lang) {
  if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, l);
  _listeners.forEach((fn) => fn());
}

export function useLocale() {
  // Keep initial render deterministic for SSR hydration.
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    setLangState(getLang());
    const update = () => setLangState(getLang());
    _listeners.add(update);
    return () => { _listeners.delete(update); };
  }, []);

  const t = useCallback((key: TranslationKey, vars?: Record<string, string | number>): string => {
    const dict = dicts[lang] ?? dicts.tr;
    let str = dict[key] ?? dicts.en[key] ?? dicts.tr[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, String(v)); });
    }
    return str;
  }, [lang]);

  const toggle = useCallback(() => {
    const order: Lang[] = ['tr', 'en', 'es', 'zh', 'it', 'de', 'ja'];
    const idx = order.indexOf(lang);
    setLang(order[(idx + 1) % order.length]);
  }, [lang]);

  return { lang, t, toggle, setLang };
}
