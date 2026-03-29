'use client';

import { useLocale } from '@/lib/i18n';

export default function LangToggle({ style }: { style?: React.CSSProperties }) {
  const { lang, setLang } = useLocale();

  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as 'tr' | 'en' | 'es' | 'zh' | 'it' | 'de' | 'ja')}
      title='Language'
      suppressHydrationWarning
      style={{
        padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
        border: '1px solid var(--border)',
        background: 'var(--glass)',
        color: 'var(--muted)', fontSize: 12, fontWeight: 700,
        letterSpacing: 0.2, transition: 'all 0.2s',
        appearance: 'none',
        ...style,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLSelectElement).style.borderColor = 'rgba(13,148,136,0.4)'; (e.currentTarget as HTMLSelectElement).style.color = '#0d9488'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLSelectElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLSelectElement).style.color = 'var(--muted)'; }}
    >
      <option value='tr'>🇹🇷 TR</option>
      <option value='en'>🇬🇧 EN</option>
      <option value='es'>🇪🇸 ES</option>
      <option value='zh'>🇨🇳 中文</option>
      <option value='it'>🇮🇹 IT</option>
      <option value='de'>🇩🇪 DE</option>
      <option value='ja'>🇯🇵 日本語</option>
    </select>
  );
}
