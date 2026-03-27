import { useCallback } from 'react';
import { tr } from './tr';
import { en } from './en';
import { useSettingsStore } from '../stores/settingsStore';

const translations: Record<string, Record<string, string>> = { tr, en };

export function useLocale() {
  const lang = useSettingsStore((s) => s.lang);
  const toggle = useSettingsStore((s) => s.toggle);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let text = translations[lang]?.[key] || translations.tr[key] || key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [lang],
  );

  return { t, lang, toggle };
}
