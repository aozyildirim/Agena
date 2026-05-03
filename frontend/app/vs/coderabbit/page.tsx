import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'AGENA vs CodeRabbit · Customizable AI Code Review with Multiple Reviewer Personas',
  description: 'CodeRabbit reviews PRs with a single fixed model. AGENA gives you multiple reviewer personas (security, performance, accessibility, lead developer) — each with its own prompt and model. Open-source, self-hostable, BYO LLM key.',
  keywords: [
    'CodeRabbit alternative',
    'open source CodeRabbit alternative',
    'CodeRabbit vs',
    'AI code review tool comparison',
    'Bito alternative',
    'PullRequest alternative',
    'self hosted AI code review',
  ],
  alternates: { canonical: 'https://agena.dev/vs/coderabbit' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/vs/coderabbit',
    title: 'AGENA vs CodeRabbit — Custom Reviewer Personas | AGENA',
    description: 'Multiple reviewer personas, BYO LLM, OWASP-aware, open-source. The configurable AI code review platform.',  }
};

const ROWS: { feature: string; agena: string; competitor: string }[] = [
  { feature: 'Reviewer model', agena: 'You pick — GPT-5, Claude, Gemini, or self-hosted endpoint per agent.', competitor: 'Fixed CodeRabbit model. No choice.' },
  { feature: 'Custom reviewer personas', agena: 'Define any number — Performance, A11y, SQL Style Cop, Security. Each with its own prompt + model.', competitor: 'Single reviewer with limited config.' },
  { feature: 'OWASP-aware reviewer', agena: 'Built-in security_developer agent ships with paranoid OWASP Top 10 prompt.', competitor: 'Generic review only.' },
  { feature: 'Reporter / tag based routing', agena: 'Integration Rules auto-route security tickets to the security reviewer, frontend tickets to the A11y reviewer, etc.', competitor: 'No source-aware routing.' },
  { feature: 'Source — auto-import', agena: 'Sentry, Jira, Azure DevOps, New Relic, Datadog, AppDynamics — all reviewed automatically when imported as tasks.', competitor: 'Triggered by PR open only.' },
  { feature: 'Severity scoring', agena: '0-100 confidence + critical/high/medium/low/clean severity per review.', competitor: 'Comments only.' },
  { feature: 'Per-agent audit history', agena: 'Each reviewer agent has full review history with severity distribution and avg score.', competitor: 'Org-level analytics, not per-persona.' },
  { feature: 'Bring your own LLM', agena: 'Yes — your OpenAI / Anthropic / Google key. Cost is yours, you control limits.', competitor: 'CodeRabbit-hosted model, billed per review.' },
  { feature: 'Self-hostable', agena: 'Yes — Docker Compose, fully air-gapped operation supported.', competitor: 'No — SaaS only.' },
  { feature: 'Open source', agena: 'Yes.', competitor: 'No — proprietary.' },
  { feature: 'Pricing', agena: 'Free tier + BYO LLM. Pro at $49/mo per workspace.', competitor: '$15-30/dev/mo.' },
];

const FAQ = [
  { q: 'Does AGENA do PR comment threading like CodeRabbit?', a: 'AGENA writes the structured review (Summary, Findings, Severity, Score) into the PR description and posts a comment with the per-finding breakdown. We do not yet thread per-line comments inline on the diff (on the roadmap). For now, each finding cites file:line so reviewers can click through.' },
  { q: 'Can I run different reviewers on different repos?', a: 'Yes — the reviewer agent is picked per task / per Integration Rule. You can have a Performance Reviewer fire on backend repos and an A11y Reviewer fire on frontend repos, with a single security_developer agent gating all security-tagged tasks.' },
  { q: 'How does cost compare?', a: 'AGENA is BYO LLM, so the variable cost is whatever your provider charges per review. A typical review on GPT-5-mini is $0.01-0.05; on GPT-5 it’s $0.15-0.40. CodeRabbit at $24/dev/mo for unlimited reviews is competitive at high review volume; AGENA wins at lower volume or when you want to control which model runs.' },
  { q: 'Is the security reviewer really OWASP-aware?', a: 'The system prompt explicitly enumerates the OWASP Top 10 (A01-A10) and asks the model to map each finding to the relevant category. It’s tuned to be paranoid — treats every input as malicious, traces data flow, and outputs threat model + fix plan + residual risk. You can edit the prompt in [Prompt Studio](/dashboard/prompts) and roll back to previous versions if a tweak degrades quality.' },
];

export default function VsCodeRabbitPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: metadata.title,
    description: metadata.description,
    url: 'https://agena.dev/vs/coderabbit'
  };
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  };

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px', display: 'grid', gap: 40 }}>
      <Script id='ld-page' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }} />
      <Script id='ld-faq' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }} />

      <header style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          AGENA vs CodeRabbit
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 800, lineHeight: 1.15, color: 'var(--ink-90)', margin: 0 }}>
          One reviewer model is not enough.<br />
          <span style={{ background: 'linear-gradient(90deg, #10b981, #06b6d4)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Build your own reviewer personas.</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--ink-58)', marginTop: 16, maxWidth: 720, marginInline: 'auto', lineHeight: 1.6 }}>
          Performance Reviewer with GPT-5-mini for speed. Security Reviewer with GPT-5-pro for paranoia. A11y Reviewer with a tight WCAG 2.2 prompt. Each persona, each model, each cost — your call.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #10b981, #06b6d4)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free
          </Link>
          <Link href='/ai-code-review' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            How AI review works →
          </Link>
        </div>
      </header>

      <section style={{ borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.4fr', padding: '14px 18px', background: 'rgba(16,185,129,0.08)', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--panel-border)' }}>
          <span style={{ color: 'var(--ink-58)' }}>Feature</span>
          <span style={{ color: '#34d399' }}>AGENA</span>
          <span style={{ color: 'var(--ink-78)' }}>CodeRabbit</span>
        </div>
        {ROWS.map((row, i) => (
          <div key={row.feature} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.4fr', padding: '14px 18px', fontSize: 13, lineHeight: 1.55, borderBottom: i < ROWS.length - 1 ? '1px solid var(--panel-border)' : 'none' }}>
            <span style={{ color: 'var(--ink-78)', fontWeight: 600 }}>{row.feature}</span>
            <span style={{ color: 'var(--ink-90)' }}>{row.agena}</span>
            <span style={{ color: 'var(--ink-58)' }}>{row.competitor}</span>
          </div>
        ))}
      </section>

      <section>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Frequently asked</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {FAQ.map((f) => (
            <details key={f.q} style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.q}</summary>
              <p style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 8, lineHeight: 1.6 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <RelatedLandings current='/vs/coderabbit' />

      

      <footer style={{ textAlign: 'center', padding: '32px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Configurable AI code review</h2>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #10b981, #06b6d4)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
