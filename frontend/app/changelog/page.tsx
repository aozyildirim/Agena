import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Changelog – AGENA Agentic AI Platform',
  description:
    'Latest updates, new features, and improvements to AGENA — the agentic AI platform for autonomous code generation and pixel agent orchestration.',
  alternates: { canonical: '/changelog' },
  openGraph: {
    title: 'Changelog – AGENA',
    description: 'Latest updates and new features from the AGENA agentic AI platform.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'AGENA Changelog' }],
  },
};

const releases = [
  {
    version: 'v0.9.0',
    date: '2026-03-28',
    title: 'Pixel Agent Visual Dashboard',
    type: 'feature' as const,
    items: [
      'Real-time pixel agent office view with animated AI characters',
      'Boss Mode — monitor all agents working simultaneously',
      'Agent state synchronization with LangGraph pipeline',
      'Pixel character palettes for each agent role (PM, Developer, Reviewer, Finalizer)',
    ],
  },
  {
    version: 'v0.8.0',
    date: '2026-03-15',
    title: 'Multi-Model LLM Support',
    type: 'feature' as const,
    items: [
      'Google Gemini as fallback LLM provider alongside OpenAI',
      'Model routing — automatic model selection based on task complexity',
      'Prompt caching for reduced token costs',
      'Per-task token and cost tracking dashboard',
    ],
  },
  {
    version: 'v0.7.2',
    date: '2026-03-05',
    title: 'Sprint Performance Analytics',
    type: 'improvement' as const,
    items: [
      'DORA metrics dashboard (deployment frequency, lead time, MTTR, change failure rate)',
      'Sprint velocity charts with AI vs human contribution breakdown',
      'Task completion trends and prediction insights',
    ],
  },
  {
    version: 'v0.7.0',
    date: '2026-02-20',
    title: 'ChatOps Integration',
    type: 'feature' as const,
    items: [
      'Slack integration — trigger tasks and receive PR notifications',
      'Microsoft Teams bot for real-time agent updates',
      'ChatOps commands for task management from chat',
    ],
  },
  {
    version: 'v0.6.0',
    date: '2026-02-05',
    title: 'Vector Memory & Context Intelligence',
    type: 'feature' as const,
    items: [
      'Qdrant vector database integration for task similarity search',
      'Context-aware code generation using past task memory',
      'Organization-scoped memory isolation',
      'Memory status and schema API endpoints',
    ],
  },
  {
    version: 'v0.5.0',
    date: '2026-01-15',
    title: 'Azure DevOps & Jira Integration',
    type: 'feature' as const,
    items: [
      'Azure DevOps PR automation (branch, commit, pull request)',
      'Jira task import with bidirectional status sync',
      'Multi-platform project mapping',
    ],
  },
];

const typeBadge = {
  feature: { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', label: 'Feature' },
  improvement: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: 'Improvement' },
  fix: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', label: 'Fix' },
};

export default function ChangelogPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'AGENA Changelog',
    description: 'Latest updates and releases from the AGENA agentic AI platform.',
    url: 'https://agena.dev/changelog',
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
        { '@type': 'ListItem', position: 2, name: 'Changelog', item: 'https://agena.dev/changelog' },
      ],
    },
  };

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className='container changelog-container' style={{ maxWidth: 760, padding: '80px 24px' }}>
        <div style={{ marginBottom: 48 }}>
          <div className='section-label'>Changelog</div>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
            What&apos;s New in AGENA
          </h1>
          <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7 }}>
            Latest features, improvements, and updates to the agentic AI platform.
          </p>
        </div>

        <div style={{ position: 'relative', paddingLeft: 32 }}>
          {/* Timeline line */}
          <div style={{ position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: 'var(--panel-border-2)' }} />

          {releases.map((release) => {
            const badge = typeBadge[release.type];
            return (
              <div key={release.version} style={{ marginBottom: 40, position: 'relative' }}>
                {/* Timeline dot */}
                <div style={{ position: 'absolute', left: -28, top: 6, width: 12, height: 12, borderRadius: '50%', background: badge.color, border: '2px solid var(--bg)' }} />

                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--ink-65)', fontWeight: 700 }}>{release.version}</span>
                  <time style={{ fontSize: 13, color: 'var(--ink-35)' }}>{release.date}</time>
                  <span style={{ padding: '2px 8px', borderRadius: 4, background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 600 }}>
                    {badge.label}
                  </span>
                </div>

                <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 10 }}>
                  {release.title}
                </h2>

                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {release.items.map((item) => (
                    <li key={item} style={{ color: 'var(--ink-50)', fontSize: 14, lineHeight: 1.6, display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--accent)', flexShrink: 0 }}>+</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: 40, padding: '32px', borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
          <p style={{ color: 'var(--ink-50)', marginBottom: 16 }}>
            Want to see AGENA in action?
          </p>
          <Link href='/signup' className='button button-primary' style={{ padding: '12px 28px', fontSize: 15 }}>
            Start Free →
          </Link>
        </div>
      </div>
    </>
  );
}
