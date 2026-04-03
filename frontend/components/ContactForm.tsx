'use client';

import { useState, FormEvent } from 'react';

const inputStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 10,
  border: '1px solid rgba(13,148,136,0.25)',
  background: 'rgba(7,15,26,0.5)',
  color: 'var(--ink-90)',
  fontSize: 14,
  width: '100%',
  outline: 'none',
  fontFamily: 'inherit',
};

export default function ContactForm() {
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
      if (res.ok) {
        setStatus('ok');
        setName('');
        setEmail('');
        setMessage('');
      } else {
        setStatus('err');
      }
    } catch {
      setStatus('err');
    }
  }

  if (status === 'ok') {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
        <h3 style={{ color: '#5EEAD4', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Message sent!</h3>
        <p style={{ color: 'var(--ink-45)', fontSize: 14 }}>We&apos;ll get back to you soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className='contact-form-row' style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <input
          type='text'
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Name'
          required
          style={inputStyle}
        />
        <input
          type='email'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder='Email'
          required
          style={inputStyle}
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder='Your message...'
        required
        rows={5}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink-45)' }}>
        <input
          type='checkbox'
          checked={newsletter}
          onChange={(e) => setNewsletter(e.target.checked)}
          style={{ accentColor: '#0d9488' }}
        />
        Subscribe to newsletter for agentic AI updates
      </label>
      <button
        type='submit'
        className='button button-primary'
        disabled={status === 'sending'}
        style={{ padding: '13px 28px', fontSize: 15, alignSelf: 'flex-start' }}
      >
        {status === 'sending' ? 'Sending...' : 'Send Message'}
      </button>
      {status === 'err' && (
        <p style={{ color: '#f87171', fontSize: 13 }}>Something went wrong. Please try again.</p>
      )}
    </form>
  );
}
