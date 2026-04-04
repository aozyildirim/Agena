'use client';

import { useState, FormEvent } from 'react';
import { useLocale } from '@/lib/i18n';

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(13,148,136,0.25)',
  background: 'rgba(7,15,26,0.5)',
  color: 'var(--ink-90)',
  fontSize: 14,
  width: '100%',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

export default function ContactForm() {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [newsletter, setNewsletter] = useState(true);
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, newsletter }),
      });
      setStatus(res.ok ? 'ok' : 'err');
      if (res.ok) { setName(''); setEmail(''); setMessage(''); }
    } catch {
      setStatus('err');
    }
  }

  if (status === 'ok') {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>&#10003;</div>
        <h3 style={{ color: '#5EEAD4', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{t('contact.form.success')}</h3>
        <p style={{ color: 'var(--ink-45)', fontSize: 13 }}>{t('contact.form.successSub')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input type='text' value={name} onChange={(e) => setName(e.target.value)} placeholder={t('contact.form.name')} required style={{ ...inputStyle, flex: '1 1 140px' }} />
        <input type='email' value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('contact.form.email')} required style={{ ...inputStyle, flex: '1 1 180px' }} />
      </div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('contact.form.message')} required rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--ink-45)' }}>
        <input type='checkbox' checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} style={{ accentColor: '#0d9488', flexShrink: 0 }} />
        {t('contact.form.newsletter')}
      </label>
      <button type='submit' className='button button-primary' disabled={status === 'sending'} style={{ padding: '11px 24px', fontSize: 14, alignSelf: 'flex-start' }}>
        {status === 'sending' ? t('contact.form.sending') : t('contact.form.send')}
      </button>
      {status === 'err' && <p style={{ color: '#f87171', fontSize: 12 }}>{t('contact.form.error')}</p>}
    </form>
  );
}
