'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const COPY: Record<string, { title: string; body: string; back: string }> = {
  tr: { title: 'Erişim yetkin yok', body: 'Bu sayfaya erişmek için yeterli rolün veya iznin bulunmuyor.', back: 'Panele dön' },
  en: { title: 'Access denied', body: "You don't have the role or permission needed to view this page.", back: 'Back to dashboard' },
  es: { title: 'Acceso denegado', body: 'No tienes el rol o permiso necesario para ver esta página.', back: 'Volver al panel' },
  de: { title: 'Zugriff verweigert', body: 'Sie haben nicht die nötige Rolle oder Berechtigung für diese Seite.', back: 'Zum Dashboard' },
  it: { title: 'Accesso negato', body: 'Non hai il ruolo o l’autorizzazione necessaria per questa pagina.', back: 'Torna alla dashboard' },
  zh: { title: '访问被拒绝', body: '您没有查看此页面所需的角色或权限。', back: '返回仪表板' },
  ja: { title: 'アクセス拒否', body: 'このページを表示するための役割または権限がありません。', back: 'ダッシュボードに戻る' },
};

export default function Forbidden({ message }: { message?: string }) {
  const [lang, setLang] = useState<string>('en');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('agena_lang') || 'en';
      setLang(v);
    }
  }, []);
  const c = COPY[lang] || COPY.en;
  return (
    <div style={{ padding: '60px 24px', maxWidth: 560, margin: '60px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 8 }}>{c.title}</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-58)', lineHeight: 1.5, marginBottom: 20 }}>{message || c.body}</p>
      <Link
        href="/dashboard"
        style={{
          display: 'inline-block', padding: '10px 16px', borderRadius: 10,
          background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
          color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
        }}
      >
        {c.back}
      </Link>
    </div>
  );
}
