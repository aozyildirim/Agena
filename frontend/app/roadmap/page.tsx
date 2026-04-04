'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const REPO = 'aozyildirim/Agena';

interface GHIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: { name: string; color: string }[];
  html_url: string;
  created_at: string;
}

interface RoadmapItem {
  title: string;
  status: 'done' | 'in-progress' | 'planned';
  labels: { name: string; color: string }[];
  url: string;
  number: number;
}

const statusStyle = {
  done: { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', label: 'Done' },
  'in-progress': { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', label: 'In Progress' },
  planned: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: 'Planned' },
};

// Manual roadmap items (always shown, augmented by GitHub issues if available)
const staticItems: RoadmapItem[] = [
  { title: 'Visual Flow Builder (n8n-style)', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'Multi-model LLM support (GPT-5, Gemini)', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'Pixel Agent Office (Boss Mode)', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'DORA Metrics Dashboard', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'ChatOps (Slack, Teams, Telegram)', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'Qdrant Vector Memory', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'Sprint Performance Analytics', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'Device Code Login (CLI)', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'Multi-language Blog & i18n (7 languages)', status: 'done', labels: [{ name: 'feature', color: '22c55e' }], url: '', number: 0 },
  { title: 'AI-powered code review comments', status: 'in-progress', labels: [{ name: 'enhancement', color: 'f59e0b' }], url: '', number: 0 },
  { title: 'Custom LLM provider plugins', status: 'in-progress', labels: [{ name: 'enhancement', color: 'f59e0b' }], url: '', number: 0 },
  { title: 'GitHub Actions integration', status: 'planned', labels: [{ name: 'feature', color: '3b82f6' }], url: '', number: 0 },
  { title: 'VS Code extension', status: 'planned', labels: [{ name: 'feature', color: '3b82f6' }], url: '', number: 0 },
  { title: 'Self-hosted installer (1-click)', status: 'planned', labels: [{ name: 'feature', color: '3b82f6' }], url: '', number: 0 },
  { title: 'GitLab integration', status: 'planned', labels: [{ name: 'feature', color: '3b82f6' }], url: '', number: 0 },
  { title: 'Bitbucket integration', status: 'planned', labels: [{ name: 'feature', color: '3b82f6' }], url: '', number: 0 },
  { title: 'AI test generation agent', status: 'planned', labels: [{ name: 'feature', color: '3b82f6' }], url: '', number: 0 },
];

export default function RoadmapPage() {
  const [ghItems, setGhItems] = useState<RoadmapItem[]>([]);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/issues?state=all&per_page=30&labels=enhancement,feature`)
      .then((r) => r.json())
      .then((issues: GHIssue[]) => {
        if (!Array.isArray(issues)) return;
        const items: RoadmapItem[] = issues
          .filter((i) => !i.title.includes('[bot]'))
          .map((i) => ({
            title: i.title,
            status: i.state === 'closed' ? 'done' : 'planned',
            labels: i.labels,
            url: i.html_url,
            number: i.number,
          }));
        setGhItems(items);
      })
      .catch(() => {});
  }, []);

  const allItems = [...staticItems, ...ghItems];
  const filtered = filter === 'all' ? allItems : allItems.filter((i) => i.status === filter);

  const counts = {
    all: allItems.length,
    done: allItems.filter((i) => i.status === 'done').length,
    'in-progress': allItems.filter((i) => i.status === 'in-progress').length,
    planned: allItems.filter((i) => i.status === 'planned').length,
  };

  return (
    <div className='container' style={{ maxWidth: 800, padding: '80px 24px 60px' }}>
      <div style={{ marginBottom: 32 }}>
        <div className='section-label'>Roadmap</div>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 12px' }}>
          Public Roadmap
        </h1>
        <p style={{ color: 'var(--ink-45)', fontSize: 15, lineHeight: 1.6 }}>
          What we&apos;re building, what&apos;s in progress, and what&apos;s coming next. Issues synced from{' '}
          <a href={`https://github.com/${REPO}`} target='_blank' rel='noopener noreferrer' style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            GitHub
          </a>.
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {([
          { key: 'all', label: 'All' },
          { key: 'done', label: 'Done' },
          { key: 'in-progress', label: 'In Progress' },
          { key: 'planned', label: 'Planned' },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              border: filter === f.key ? '1px solid rgba(13,148,136,0.5)' : '1px solid var(--panel-border-2)',
              background: filter === f.key ? 'rgba(13,148,136,0.15)' : 'transparent',
              color: filter === f.key ? '#5eead4' : 'var(--ink-50)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((item, i) => {
          const s = statusStyle[item.status];
          return (
            <div
              key={`${item.title}-${i}`}
              style={{
                padding: '14px 18px',
                borderRadius: 12,
                border: '1px solid var(--panel-border)',
                background: 'var(--panel)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {s.label}
              </span>
              <span style={{ color: 'var(--ink-78)', fontSize: 14, flex: 1, minWidth: 0 }}>
                {item.url ? (
                  <a href={item.url} target='_blank' rel='noopener noreferrer' style={{ color: 'var(--ink-78)', textDecoration: 'none' }}>
                    {item.title}
                    {item.number > 0 && <span style={{ color: 'var(--ink-30)', fontSize: 12, marginLeft: 6 }}>#{item.number}</span>}
                  </a>
                ) : (
                  item.title
                )}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {item.labels.slice(0, 2).map((l) => (
                  <span key={l.name} style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: `#${l.color}22`, color: `#${l.color}` }}>
                    {l.name}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div style={{ textAlign: 'center', marginTop: 40, padding: '28px', borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
        <p style={{ color: 'var(--ink-50)', marginBottom: 12, fontSize: 14 }}>
          Have a feature request?
        </p>
        <a href={`https://github.com/${REPO}/issues/new`} target='_blank' rel='noopener noreferrer' className='button button-primary' style={{ padding: '10px 24px', fontSize: 14, textDecoration: 'none' }}>
          Open an Issue →
        </a>
      </div>
    </div>
  );
}
