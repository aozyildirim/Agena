import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'AGENA vs Sentry Seer · Open-Source AI Auto-Fix Alternative for Sentry',
  description: 'Sentry Seer suggests inline fixes inside Sentry. AGENA actually opens the pull request on GitHub or Azure DevOps, runs an OWASP-aware reviewer, and auto-resolves the Sentry issue on merge. Open-source, self-hostable, and you bring your own LLM key.',
  keywords: [
    'Sentry Seer alternative',
    'open source Seer alternative',
    'Sentry AI fix alternative',
    'Sentry Autofix alternative',
    'Sentry Seer vs',
    'AI Sentry fix',
    'self hosted Sentry AI',
  ],
  alternates: { canonical: 'https://agena.dev/vs/seer' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/vs/seer',
    title: 'AGENA vs Sentry Seer — Auto-Fix That Opens the PR | AGENA',
    description: 'Seer suggests fixes inline. AGENA opens the PR. Open-source, BYOLLM, OWASP-aware reviewer.',  }
};

const ROWS: { feature: string; agena: string; competitor: string }[] = [
  { feature: 'What it does', agena: 'Imports Sentry issues, runs an AI agent pipeline, opens a PR on GitHub / Azure DevOps, and auto-resolves the Sentry issue on merge.', competitor: 'Suggests inline code fixes within the Sentry UI. The user copies the patch into their editor or commits via Sentry’s GitHub app.' },
  { feature: 'Pull request creation', agena: 'Yes — PR opened with the patch, AI review, and a backlink to the Sentry issue.', competitor: 'Limited — GitHub PR via Sentry app, no Azure DevOps PR creation, no AI review attached.' },
  { feature: 'OWASP-aware reviewer', agena: 'Built-in security_developer agent runs paranoid review with threat model + fix plan + residual risk note.', competitor: 'No dedicated security review persona.' },
  { feature: 'Custom reviewer agents', agena: 'Define your own personas (Performance Reviewer, A11y Reviewer, SQL Style Cop) with their own prompts and models.', competitor: 'Single fixed reviewer model.' },
  { feature: 'Multi-repo orchestration', agena: 'One Sentry issue can fan out to multiple repos with per-repo PRs.', competitor: 'Single-repo only.' },
  { feature: 'Integration Rules', agena: 'Auto-route Sentry issues by tag, environment, project, or reporter to specific reviewer agents.', competitor: 'Static config per project.' },
  { feature: 'Bring your own LLM', agena: 'OpenAI, Anthropic, Google, or self-hosted endpoint. Cost is yours.', competitor: 'Sentry-hosted model. Cost included in plan.' },
  { feature: 'Self-hostable', agena: 'Yes — Docker Compose, fully air-gapped operation supported.', competitor: 'No — Sentry SaaS only.' },
  { feature: 'Open source', agena: 'Yes.', competitor: 'No — proprietary feature inside Sentry.' },
  { feature: 'Pricing', agena: 'Free tier (5,000 imports/mo). BYO LLM key. Pro at $49/mo.', competitor: 'Bundled with Sentry Business / Team plans, billed per usage event.' },
];

const FAQ = [
  { q: 'Is AGENA a Sentry replacement?', a: 'No — AGENA does not capture or store errors. You keep using Sentry as your error monitor; AGENA reads Sentry issues via API and turns them into pull requests. Think of AGENA as the layer that takes a Sentry issue and ships a fix.' },
  { q: 'Why not just use Seer?', a: 'Seer is great for inline fix suggestions, but the loop ends inside Sentry. AGENA closes the loop end-to-end: imports the issue, runs an OWASP-aware reviewer, opens the PR, posts a comment back on Sentry, and resolves the Sentry issue when the PR merges. The cycle from alert to merged PR runs in 8–15 minutes with zero human keystrokes.' },
  { q: 'Can I use both?', a: 'Yes — they are complementary. We surface Seer’s fixability score on each Sentry issue card so you can scan which issues to auto-fix vs. flag for human review. Seer’s in-Sentry suggestions still work for cases where AGENA isn’t involved.' },
  { q: 'Does AGENA need access to my source code?', a: 'Only the diff and ±5 lines of context for the file:line in the stack trace. You can self-host AGENA fully air-gapped — the only network egress is to Sentry, your VCS, and your chosen LLM provider.' },
];

export default function VsSeerPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: metadata.title,
    description: metadata.description,
    url: 'https://agena.dev/vs/seer'
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
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          AGENA vs Sentry Seer
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 800, lineHeight: 1.15, color: 'var(--ink-90)', margin: 0 }}>
          Seer suggests fixes inside Sentry.<br />
          <span style={{ background: 'linear-gradient(90deg, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>AGENA actually opens the pull request.</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--ink-58)', marginTop: 16, maxWidth: 720, marginInline: 'auto', lineHeight: 1.6 }}>
          Open-source, self-hostable, BYO LLM key. Same Sentry-to-fix loop, but it ends with a merged PR on GitHub or Azure DevOps and an auto-resolved Sentry issue — not an inline suggestion.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #a855f7, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free
          </Link>
          <Link href='/sentry-ai-auto-fix' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            See the Sentry flow →
          </Link>
        </div>
      </header>

      <section style={{ borderRadius: 16, border: '1px solid var(--panel-border)', background: 'var(--panel)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.4fr', padding: '14px 18px', background: 'rgba(168,85,247,0.08)', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--panel-border)' }}>
          <span style={{ color: 'var(--ink-58)' }}>Feature</span>
          <span style={{ color: '#c084fc' }}>AGENA</span>
          <span style={{ color: 'var(--ink-78)' }}>Sentry Seer</span>
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

      <RelatedLandings current='/vs/seer' />

      

      <footer style={{ textAlign: 'center', padding: '32px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Close the Sentry loop end to end</h2>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #a855f7, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
