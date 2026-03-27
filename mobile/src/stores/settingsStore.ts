import { create } from 'zustand';
import { setLang as persistLang } from '../utils/storage';

interface SettingsState {
  lang: string;
  setLang: (lang: string) => void;
  toggle: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  lang: 'tr',
  setLang: (lang) => {
    set({ lang });
    void persistLang(lang);
  },
  toggle: () => {
    const next = get().lang === 'tr' ? 'en' : 'tr';
    set({ lang: next });
    void persistLang(next);
  },
}));
