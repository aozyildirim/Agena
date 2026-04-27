'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Props = {
  taskId: number;
  taskTitle: string;
  open: boolean;
  onClose: () => void;
};

type ShareTokenResponse = { url: string; token: string };

export default function ShareTaskModal({ taskId, taskTitle, open, onClose }: Props) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [maxUses, setMaxUses] = useState(3);

  useEffect(() => {
    if (!open) {
      // Reset modal state on close so reopening shows the config screen.
      setShareUrl('');
      setError('');
      setCopied(false);
      setBusy(false);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const shareText = `${taskTitle}\n${shareUrl}`;
  const enc = encodeURIComponent;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(540px, 100%)', background: 'var(--surface)',
          border: '1px solid var(--panel-border-2)', borderRadius: 16,
          padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
          {t('taskDetail.share.title' as never)}
        </h2>
        <p style={{ marginTop: 6, marginBottom: 16, fontSize: 12, color: 'var(--ink-58)', lineHeight: 1.5 }}>
          {t('taskDetail.share.description' as never)}
        </p>

        {!shareUrl && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-58)', fontWeight: 600 }}>
                  {t('taskDetail.share.expiresIn' as never)}
                </span>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', fontSize: 13 }}
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-58)', fontWeight: 600 }}>
                  {t('taskDetail.share.maxUses' as never)}
                </span>
                <select
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink-90)', fontSize: 13 }}
                >
                  <option value={1}>1</option>
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
              </label>
            </div>
            {error && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className='button button-outline'
                onClick={onClose}
                style={{ padding: '7px 14px', fontSize: 12 }}
                disabled={busy}
              >
                {t('tasks.cancel' as never)}
              </button>
              <button
                className='button button-primary'
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const r = await apiFetch<ShareTokenResponse>(`/tasks/${taskId}/share`, {
                      method: 'POST',
                      body: JSON.stringify({ expires_in_days: expiresInDays, max_uses: maxUses }),
                    });
                    const origin = typeof window !== 'undefined' ? window.location.origin : '';
                    setShareUrl(`${origin}${r.url}`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to create share link');
                  } finally {
                    setBusy(false);
                  }
                }}
                style={{ padding: '7px 14px', fontSize: 12 }}
                disabled={busy}
              >
                {busy ? t('taskDetail.share.creating' as never) : t('taskDetail.share.create' as never)}
              </button>
            </div>
          </>
        )}

        {shareUrl && (
          <>
            <div style={{
              display: 'flex', gap: 8, alignItems: 'stretch',
              padding: 8, borderRadius: 10, background: 'var(--panel)',
              border: '1px solid var(--panel-border)', marginBottom: 8,
            }}>
              <input
                readOnly
                value={shareUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1, fontSize: 12, padding: '6px 8px', border: 'none',
                  background: 'transparent', color: 'var(--ink-90)', outline: 'none',
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                  border: '1px solid var(--panel-border)', background: 'var(--surface)',
                  color: 'var(--ink-90)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {copied ? t('taskDetail.share.copied' as never) : t('taskDetail.share.copy' as never)}
              </button>
            </div>
            <p style={{ marginTop: 0, marginBottom: 14, fontSize: 11, color: 'var(--ink-58)' }}>
              {t('taskDetail.share.note' as never)}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginBottom: 14 }}>
              <ShareButton
                href={`https://wa.me/?text=${enc(shareText)}`}
                label='WhatsApp'
                bg='#25D366'
                icon={<WhatsAppIcon />}
              />
              <ShareButton
                href={`https://teams.microsoft.com/share?href=${enc(shareUrl)}&msgText=${enc(taskTitle)}`}
                label='Teams'
                bg='#5059C9'
                icon={<TeamsIcon />}
              />
              <ShareButton
                href='#'
                label='Slack'
                bg='#4A154B'
                icon={<SlackIcon />}
                onClick={(e) => {
                  e.preventDefault();
                  navigator.clipboard.writeText(shareText).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                title={t('taskDetail.share.slackHint' as never)}
              />
              <ShareButton
                href={`https://t.me/share/url?url=${enc(shareUrl)}&text=${enc(taskTitle)}`}
                label='Telegram'
                bg='#229ED9'
                icon={<TelegramIcon />}
              />
              <ShareButton
                href={`mailto:?subject=${enc(taskTitle)}&body=${enc(shareText)}`}
                label='Email'
                bg='#475569'
                icon={<EmailIcon />}
              />
              <ShareButton
                href={`https://twitter.com/intent/tweet?text=${enc(shareText)}`}
                label='X'
                bg='#0f172a'
                icon={<XIcon />}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className='button button-outline'
                onClick={onClose}
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                {t('tasks.close' as never)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}


function ShareButton({
  href,
  label,
  bg,
  icon,
  onClick,
  title,
}: {
  href: string;
  label: string;
  bg: string;
  icon: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      onClick={onClick}
      title={title || label}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700,
        background: bg, color: '#fff', textDecoration: 'none',
        boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.25)',
        transition: 'transform 0.12s, filter 0.12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.1)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ''; }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18 }}>
        {icon}
      </span>
      <span>{label}</span>
    </a>
  );
}


// All icons are sized to 18×18 with currentColor=#fff so they pair with the colored buttons.

function WhatsAppIcon() {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='#fff' aria-hidden='true'>
      <path d='M19.05 4.91A10 10 0 0 0 12.04 2C6.51 2 2.02 6.49 2.02 12.02c0 1.77.46 3.5 1.34 5.02L2 22l5.07-1.33a10 10 0 0 0 4.96 1.27h.01c5.53 0 10.02-4.49 10.02-10.02 0-2.68-1.04-5.2-2.92-7.01zM12.04 20.13h-.01a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.01.79.8-2.93-.2-.3a8.07 8.07 0 0 1-1.24-4.36c0-4.46 3.63-8.09 8.09-8.09 2.16 0 4.19.84 5.72 2.37a8.05 8.05 0 0 1 2.37 5.72c0 4.46-3.63 8.11-8.09 8.11zm4.43-6.06c-.24-.12-1.43-.71-1.65-.79-.22-.08-.38-.12-.54.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.95-1.2-.72-.64-1.21-1.43-1.35-1.67-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41-.14-.01-.3-.01-.46-.01-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2 0 1.18.86 2.32.98 2.48.12.16 1.69 2.58 4.09 3.62.57.25 1.02.4 1.37.51.57.18 1.1.16 1.51.1.46-.07 1.43-.58 1.63-1.14.2-.57.2-1.05.14-1.15-.06-.1-.22-.16-.46-.28z'/>
    </svg>
  );
}

function TeamsIcon() {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='#fff' aria-hidden='true'>
      <path d='M19.5 8.5h-3v-2a1.5 1.5 0 1 1 3 0v2zm1.5 1H15v6.5a3.5 3.5 0 1 1-7 0V9.5H3v9A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5v-9zM12.25 11h-1.5v6.5a.75.75 0 0 0 1.5 0V11zm-1-7A1.5 1.5 0 1 0 9.75 5.5 1.5 1.5 0 0 0 11.25 4z'/>
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true'>
      <g fill='#fff'>
        <path d='M5.04 14.93a2.07 2.07 0 1 1-2.07-2.07h2.07v2.07zM6.07 14.93a2.07 2.07 0 1 1 4.13 0v5.18a2.07 2.07 0 1 1-4.13 0v-5.18z'/>
        <path d='M8.13 6.6a2.07 2.07 0 1 1 2.07-2.07v2.07H8.13zM8.13 7.62a2.07 2.07 0 1 1 0 4.13H2.95a2.07 2.07 0 1 1 0-4.13h5.18z'/>
        <path d='M16.45 9.69a2.07 2.07 0 1 1 2.07 2.07h-2.07V9.69zM15.42 9.69a2.07 2.07 0 1 1-4.13 0V4.51a2.07 2.07 0 1 1 4.13 0v5.18z'/>
        <path d='M13.36 18.02a2.07 2.07 0 1 1-2.07 2.07v-2.07h2.07zM13.36 17a2.07 2.07 0 1 1 0-4.13h5.18a2.07 2.07 0 1 1 0 4.13h-5.18z'/>
      </g>
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='#fff' aria-hidden='true'>
      <path d='M9.78 16.27 9.6 19.4c.27 0 .39-.12.53-.26l1.27-1.21 2.63 1.93c.48.27.83.13.97-.45l1.76-8.27c.16-.72-.26-1-.72-.83L5.36 13.86c-.7.27-.69.66-.12.83l2.62.82 6.08-3.83c.29-.18.55-.08.34.1z'/>
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='3' y='5' width='18' height='14' rx='2' />
      <path d='m3 7 9 6 9-6' />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox='0 0 24 24' width='16' height='16' fill='#fff' aria-hidden='true'>
      <path d='M18.244 2H21.5l-7.51 8.59L23 22h-6.84l-5.36-7.02L4.66 22H1.4l8.04-9.2L1 2h7.02l4.84 6.4L18.24 2zm-1.2 18h1.86L7.06 4H5.13l11.91 16z'/>
    </svg>
  );
}
