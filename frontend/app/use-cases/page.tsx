import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Cases – AGENA Agentic AI Platform',
  description:
    'Discover how teams use AGENA\'s agentic AI and pixel agent technology for autonomous code generation, PR automation, sprint acceleration, and AI-powered development workflows.',
  alternates: { canonical: '/use-cases' },
  openGraph: {
    title: 'Use Cases – AGENA Agentic AI Platform',
    description: 'How teams use agentic AI for autonomous code generation and PR automation.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'AGENA Use Cases' }],
  },
};

const useCases = [
  {
    icon: '⚡',
    title: 'Autonomous Code Generation',
    subtitle: 'From task description to production code',
    description:
      'AGENA\'s agentic AI pipeline takes a task from your backlog and autonomously generates production-grade code. The developer agent analyzes your codebase, follows existing patterns, and produces clean, reviewable code — no manual coding required for routine tasks.',
    benefits: [
      'Reduce time from task to PR by 10x',
      'Consistent code quality across all generated PRs',
      'Automatic adherence to codebase conventions',
      'Full context awareness via vector memory',
    ],
    keyword: 'ai-code-generation',
  },
  {
    icon: '🔄',
    title: 'AI-Powered Pull Request Automation',
    subtitle: 'Branch, commit, and PR creation on autopilot',
    description:
      'Stop manually creating branches and writing PR descriptions. AGENA\'s finalizer agent automatically creates feature branches, makes clean commits with descriptive messages, and opens pull requests with full task context on GitHub or Azure DevOps.',
    benefits: [
      'Zero manual Git operations for AI-generated code',
      'PR descriptions include full task context and changes',
      'Automatic branch naming following your conventions',
      'GitHub and Azure DevOps integration',
    ],
    keyword: 'pr-automation',
  },
  {
    icon: '🏃',
    title: 'Sprint Acceleration',
    subtitle: 'Complete more tasks per sprint with AI agents',
    description:
      'Augment your development team with agentic AI. AGENA handles routine development tasks autonomously while your engineers focus on complex architecture and business logic. Monitor sprint velocity and AI contribution through the pixel agent dashboard.',
    benefits: [
      'AI handles routine tasks, humans handle complexity',
      'Real-time sprint velocity tracking',
      'Pixel agent dashboard shows AI workforce status',
      'Task-level cost and token tracking',
    ],
    keyword: 'sprint-acceleration',
  },
  {
    icon: '🔍',
    title: 'Automated Code Review',
    subtitle: 'AI reviewer agent catches issues before humans',
    description:
      'AGENA\'s reviewer agent independently reviews all generated code for bugs, security vulnerabilities, and best practices before creating the PR. This pre-review layer ensures your team only sees high-quality code that\'s ready for final human review.',
    benefits: [
      'Catch bugs before human review',
      'Security vulnerability scanning',
      'Best practice compliance checking',
      'Reduced review burden on senior engineers',
    ],
    keyword: 'automated-code-review',
  },
  {
    icon: '🧠',
    title: 'Context-Aware Development with Vector Memory',
    subtitle: 'AI agents learn from your past tasks',
    description:
      'AGENA\'s Qdrant-powered vector memory stores context from previously completed tasks. When a new task arrives, the AI agents automatically retrieve similar past solutions, enabling smarter code generation that builds on proven patterns.',
    benefits: [
      'AI improves with every completed task',
      'Similar past solutions inform new code generation',
      'Organization-scoped memory isolation',
      'Reduced hallucination through grounded context',
    ],
    keyword: 'vector-memory-ai',
  },
  {
    icon: '💬',
    title: 'ChatOps Integration',
    subtitle: 'Manage AI agents from Slack and Teams',
    description:
      'Trigger AI agent tasks, receive real-time progress updates, and review generated PRs directly from Slack or Microsoft Teams. AGENA\'s ChatOps integration brings agentic AI into your team\'s existing communication workflow.',
    benefits: [
      'Trigger tasks from Slack or Teams',
      'Real-time notifications on task progress',
      'Review AI-generated PRs without leaving chat',
      'Team-wide visibility into AI agent activity',
    ],
    keyword: 'chatops-ai',
  },
];

export default function UseCasesPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'AGENA Use Cases',
    description: 'How teams use AGENA\'s agentic AI for autonomous software development.',
    url: 'https://agena.dev/use-cases',
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://agena.dev' },
        { '@type': 'ListItem', position: 2, name: 'Use Cases', item: 'https://agena.dev/use-cases' },
      ],
    },
  };

  return (
    <>
      <script type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className='container page-container-narrow' style={{ maxWidth: 960, padding: '80px 24px' }}>
        <div style={{ marginBottom: 56, textAlign: 'center' }}>
          <div className='section-label' style={{ justifyContent: 'center' }}>Use Cases</div>
          <h1 style={{ fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 800, color: 'var(--ink-90)', margin: '8px 0 16px' }}>
            What Can You Build with Agentic AI?
          </h1>
          <p style={{ color: 'var(--ink-45)', fontSize: 16, lineHeight: 1.7, maxWidth: 640, margin: '0 auto' }}>
            AGENA&apos;s pixel agent technology powers autonomous development workflows for teams of all sizes.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {useCases.map((uc, i) => (
            <section
              key={uc.keyword}
              id={uc.keyword}
              style={{
                padding: '36px 40px',
                borderRadius: 20,
                border: '1px solid var(--panel-border-2)',
                background: 'var(--panel)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
                <span style={{ fontSize: 28 }}>{uc.icon}</span>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-90)', margin: 0 }}>{uc.title}</h2>
                  <p style={{ color: 'var(--ink-35)', fontSize: 13, margin: '2px 0 0' }}>{uc.subtitle}</p>
                </div>
              </div>
              <p style={{ color: 'var(--ink-58)', fontSize: 15, lineHeight: 1.75, margin: '16px 0 20px' }}>
                {uc.description}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                {uc.benefits.map((b) => (
                  <div
                    key={b}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid var(--panel-border)',
                      background: 'rgba(13,148,136,0.04)',
                      color: 'var(--ink-65)',
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <span style={{ color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                    {b}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* CTA */}
        <div style={{ marginTop: 64, textAlign: 'center', padding: '48px 32px', borderRadius: 20, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
          <h2 style={{ color: 'var(--ink-90)', fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
            Ready to automate your development workflow?
          </h2>
          <p style={{ color: 'var(--ink-45)', marginBottom: 24, fontSize: 16 }}>
            Start free and let AGENA&apos;s agentic AI pipeline handle the rest.
          </p>
          <Link href='/signup' className='button button-primary' style={{ fontSize: 16, padding: '14px 36px' }}>
            Start Free →
          </Link>
        </div>
      </div>
    </>
  );
}
