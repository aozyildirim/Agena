'use client';

import { useState } from 'react';
import { resolveApiBase } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

interface WebhookEndpoint {
  name: string;
  method: string;
  path: string;
  description: string;
  headers: Record<string, string>;
  sampleBody: string;
}

const endpoints: WebhookEndpoint[] = [
  {
    name: 'PR Comment Webhook',
    method: 'POST',
    path: '/webhooks/pr-comment',
    description: 'Trigger autofix from a GitHub PR review comment. Validates PR URL and executes feedback-based code fix.',
    headers: { 'Content-Type': 'application/json', 'X-Agena-Webhook-Secret': '<your-secret>' },
    sampleBody: JSON.stringify({ pr_url: 'https://github.com/owner/repo/pull/1', comment: 'Fix the null check on line 42' }, null, 2),
  },
  {
    name: 'Slack Events',
    method: 'POST',
    path: '/webhooks/slack',
    description: 'Receive Slack Events API payloads. Handles url_verification challenge and app_mention events for ChatOps.',
    headers: { 'Content-Type': 'application/json' },
    sampleBody: JSON.stringify({ type: 'url_verification', challenge: 'test_challenge_token' }, null, 2),
  },
  {
    name: 'Microsoft Teams',
    method: 'POST',
    path: '/webhooks/teams',
    description: 'Receive Microsoft Teams Bot Framework Activity messages for ChatOps commands.',
    headers: { 'Content-Type': 'application/json' },
    sampleBody: JSON.stringify({ type: 'message', text: '/agena status', from: { name: 'User' }, channelId: 'msteams' }, null, 2),
  },
  {
    name: 'Telegram',
    method: 'POST',
    path: '/webhooks/telegram',
    description: 'Receive Telegram Bot API updates. Supports /start, /task, /status commands.',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': '<your-secret>' },
    sampleBody: JSON.stringify({ update_id: 1, message: { text: '/status', chat: { id: 123 }, from: { first_name: 'User' } } }, null, 2),
  },
  {
    name: 'Stripe Webhook',
    method: 'POST',
    path: '/stripe/webhook',
    description: 'Stripe payment event webhook. Handles checkout.session.completed and subscription events.',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': '<stripe-sig>' },
    sampleBody: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123' } } }, null, 2),
  },
  {
    name: 'Iyzico Webhook',
    method: 'POST',
    path: '/iyzico/webhook',
    description: 'Iyzico payment callback webhook for Turkish payment processing.',
    headers: { 'Content-Type': 'application/json', 'X-IYZICO-Signature': '<iyzico-sig>' },
    sampleBody: JSON.stringify({ paymentId: 'pay_123', status: 'SUCCESS' }, null, 2),
  },
];

export default function WebhookDashboard() {
  const { t } = useLocale();
  const API_BASE = resolveApiBase();
  const [selected, setSelected] = useState(0);
  const [customBody, setCustomBody] = useState(endpoints[0].sampleBody);
  const [customHeaders, setCustomHeaders] = useState('');
  const [response, setResponse] = useState<{ status: number; body: string; time: number } | null>(null);
  const [loading, setLoading] = useState(false);

  function selectEndpoint(idx: number) {
    setSelected(idx);
    setCustomBody(endpoints[idx].sampleBody);
    setResponse(null);
    setCustomHeaders('');
  }

  async function sendRequest() {
    const ep = endpoints[selected];
    setLoading(true);
    setResponse(null);
    const start = Date.now();

    try {
      const headers: Record<string, string> = { ...ep.headers };
      if (customHeaders.trim()) {
        customHeaders.split('\n').forEach((line) => {
          const [k, ...v] = line.split(':');
          if (k && v.length) headers[k.trim()] = v.join(':').trim();
        });
      }

      const res = await fetch(`${API_BASE}${ep.path}`, {
        method: ep.method,
        headers,
        body: customBody,
      });

      const time = Date.now() - start;
      let body: string;
      try {
        body = JSON.stringify(await res.json(), null, 2);
      } catch {
        body = await res.text();
      }

      setResponse({ status: res.status, body, time });
    } catch (err) {
      setResponse({ status: 0, body: String(err), time: Date.now() - start });
    } finally {
      setLoading(false);
    }
  }

  const ep = endpoints[selected];

  return (
    <div style={{ padding: '24px 0' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 8 }}>Webhook Tester</h1>
      <p style={{ color: 'var(--ink-45)', fontSize: 14, marginBottom: 24 }}>Test AGENA webhook endpoints with custom payloads.</p>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* Endpoint list */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {endpoints.map((e, i) => (
            <button
              key={e.path}
              onClick={() => selectEndpoint(i)}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: selected === i ? '1px solid rgba(13,148,136,0.5)' : '1px solid var(--panel-border)',
                background: selected === i ? 'rgba(13,148,136,0.1)' : 'var(--panel)',
                color: selected === i ? '#5eead4' : 'var(--ink-65)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: selected === i ? '#22c55e' : 'var(--ink-35)', marginRight: 6 }}>{e.method}</span>
              {e.name}
            </button>
          ))}
        </div>

        {/* Request builder */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Endpoint info */}
          <div style={{ padding: 16, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ padding: '2px 8px', borderRadius: 4, background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: 11, fontWeight: 700 }}>{ep.method}</span>
              <code style={{ fontSize: 13, color: 'var(--ink-78)' }}>{API_BASE}{ep.path}</code>
            </div>
            <p style={{ color: 'var(--ink-45)', fontSize: 13 }}>{ep.description}</p>
          </div>

          {/* Headers */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 6, display: 'block' }}>Custom Headers (one per line, key: value)</label>
            <textarea
              value={customHeaders}
              onChange={(e) => setCustomHeaders(e.target.value)}
              placeholder={Object.entries(ep.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)',
                background: 'var(--terminal-bg)', color: 'var(--ink-65)', fontSize: 12, fontFamily: 'monospace',
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Body */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 6, display: 'block' }}>Request Body</label>
            <textarea
              value={customBody}
              onChange={(e) => setCustomBody(e.target.value)}
              rows={8}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--panel-border-2)',
                background: 'var(--terminal-bg)', color: 'var(--ink-65)', fontSize: 12, fontFamily: 'monospace',
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={sendRequest}
            disabled={loading}
            className='button button-primary'
            style={{ alignSelf: 'flex-start', padding: '10px 24px', fontSize: 14 }}
          >
            {loading ? 'Sending...' : 'Send Request'}
          </button>

          {/* Response */}
          {response && (
            <div style={{ padding: 16, borderRadius: 12, background: 'var(--terminal-bg)', border: '1px solid var(--panel-border)' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'center' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700,
                  background: response.status >= 200 && response.status < 300 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                  color: response.status >= 200 && response.status < 300 ? '#22c55e' : '#ef4444',
                }}>
                  {response.status || 'ERR'}
                </span>
                <span style={{ color: 'var(--ink-35)', fontSize: 12 }}>{response.time}ms</span>
              </div>
              <pre style={{ color: 'var(--ink-65)', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {response.body}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
