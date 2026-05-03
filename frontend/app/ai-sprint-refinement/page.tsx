import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'AI Sprint Refinement · Auto-Estimate Story Points & Write Acceptance Criteria | AGENA',
  description: 'Stop spending hours on backlog grooming. AGENA refines Jira and Azure DevOps tickets with AI — expands descriptions, writes acceptance criteria, estimates story points, suggests assignees. Writes back to the source ticket. Free tier.',
  keywords: [
    'AI sprint refinement',
    'AI backlog grooming',
    'AI story point estimation',
    'AI Jira refinement',
    'AI Azure DevOps refinement',
    'AI acceptance criteria',
    'AI suggested assignee',
    'sprint planning AI tool',
    'AI scrum master',
    'backlog automation AI',
  ],
  alternates: { canonical: 'https://agena.dev/ai-sprint-refinement' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/ai-sprint-refinement',
    title: 'AI Sprint Refinement — Auto-Estimate Story Points | AGENA',
    description: 'AI expands descriptions, writes AC, estimates points, suggests assignees. Writes back to Jira / Azure DevOps.',  }
};

const FAQ = [
  { q: 'What does AI Sprint Refinement do exactly?', a: 'For each task you click ✨ Refine on, the PM agent: (1) expands the description with concrete edge cases, (2) writes a Given/When/Then acceptance criteria block, (3) estimates story points using a configurable Fibonacci/T-shirt scale, (4) suggests an assignee based on prior expertise on similar tasks, and (5) flags risk indicators (security, perf, third-party blocker). The output is written back to the source ticket as a comment.' },
  { q: 'Does it write story points back to Jira / Azure DevOps?', a: 'Yes. For Jira-sourced tasks, AGENA writes to the configured Story Points custom field (default customfield_10016). For Azure DevOps, it writes to Microsoft.VSTS.Scheduling.StoryPoints. Both also get a discussion / comment with the AI refinement output for human review.' },
  { q: 'How accurate are the story point estimates?', a: 'The PM agent looks at the task description, your team’s velocity history, prior similar tasks, and the codebase context. In our internal testing, AI estimates land within ±1 Fibonacci point of the team’s actual estimate 78% of the time, and within ±2 points 96% of the time. The AI is a starting point — you can override before sprint planning.' },
  { q: 'Can I use this without committing to AI code generation?', a: 'Yes — refinement is decoupled from code generation. Many teams start with refinement-only to demo the AI’s value at sprint planning, then expand to code generation once trust builds.' },
  { q: 'What about "big" or "novel" tasks where the AI shouldn’t guess?', a: 'For tasks that are genuinely novel (no analogue in the codebase) or large (would be 13+ points), the prompt explicitly asks the agent to flag the task as needing human breakdown rather than emitting a confident point estimate. You see a "Needs human breakdown" badge instead of a number.' },
  { q: 'How does the suggested assignee work?', a: 'The agent looks at the file paths the task is likely to touch, then queries the Refinement Service for engineers who have committed to those paths recently (last 90 days). The top match is suggested, with the alternative shown if there’s a tie. You can disable this if your team uses pure pull-based assignment.' },
];

export default function AISprintRefinementPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AGENA — AI Sprint Refinement',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    description: metadata.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' }
  };
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  };

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px', display: 'grid', gap: 48 }}>
      <Script id='ld-app' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }} />
      <Script id='ld-faq' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }} />

      <header style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          AI Sprint Refinement
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          Stop spending Friday afternoons on backlog grooming.<br />
          <span style={{ background: 'linear-gradient(90deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Let AI refine the backlog.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>
          AGENA expands ticket descriptions, writes Given/When/Then acceptance criteria, estimates story points, and
          suggests an assignee based on prior code expertise. Output is written back to Jira or Azure DevOps so your
          single source of truth stays in your tracker.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free
          </Link>
          <Link href='/dashboard/refinement' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            See the dashboard →
          </Link>
        </div>
      </header>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>What gets generated</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {[
            { icon: '📝', title: 'Expanded description', body: 'Edge cases, error states, and prerequisite work spelled out. No more two-line tickets that explode into a sprint.' },
            { icon: '✅', title: 'Acceptance criteria', body: 'Given/When/Then format. Each criterion has its own row so QA can write tests directly off it.' },
            { icon: '🔢', title: 'Story point estimate', body: 'Fibonacci, T-shirt, or hours. Configurable per workspace. Falls back to "Needs human breakdown" for novel or 13+ point tickets.' },
            { icon: '🧑‍💻', title: 'Suggested assignee', body: 'Based on who has committed to the likely files in the last 90 days. Tie-break shown.' },
            { icon: '⚠️', title: 'Risk indicators', body: 'Flags for security, performance, third-party blocker, breaking change. Colour-coded badges in the UI.' },
            { icon: '↩️', title: 'Writes back to source', body: 'Jira: comment + Story Points field. Azure DevOps: discussion + Story Points field. GitHub Issues: comment.' },
            { icon: '📊', title: 'Refinement runs page', body: 'Every refinement run is logged with input/output, model used, cost. Click into any past run for audit.' },
            { icon: '🎯', title: 'Per-team config', body: 'Each team can set its own scale, prompt overrides, and assignee preference.' },
          ].map((f) => (
            <div key={f.title} style={{ padding: 16, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 6, lineHeight: 1.55 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: 'clamp(14px, 4vw, 24px)', borderRadius: 16, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Sample refinement output</h2>
        <pre style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'clamp(10px, 2.6vw, 12px)', color: 'var(--ink-78)', background: 'rgba(0,0,0,0.2)', padding: 'clamp(12px, 3vw, 16px)', borderRadius: 10, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{`Original ticket: "User can't pay with saved card"

## Refined Description
The /api/orders/checkout endpoint fails with HTTP 500 when the user selects
a previously saved card from their wallet. Stripe webhook returns 402 because
the saved-card token is being passed to confirm-payment without re-attaching
to the current PaymentIntent. Affects all returning customers with at least
one saved card. Likely introduced in #4318 (wallet refactor).

## Acceptance Criteria
- GIVEN a logged-in user with one or more saved cards
  WHEN they pick a saved card on /checkout
  THEN the order completes with a 200 and a charge appears in Stripe
- GIVEN the saved card is expired
  WHEN the user picks it
  THEN the user sees a clear "card expired" message and can pick another
- GIVEN the user has no saved cards
  WHEN they reach /checkout
  THEN the saved-card section is hidden, no JS error in console

## Story Points
3

## Risk
- security: medium (touches payment flow)
- third-party-blocker: low (Stripe is reachable)

## Suggested Assignee
@erin (last 5 commits to packages/services/.../payment_service.py)
Alternate: @daniel`}</pre>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Frequently asked</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {FAQ.map((f) => (
            <details key={f.q} style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.q}</summary>
              <p style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 8, lineHeight: 1.6 }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <RelatedLandings current='/ai-sprint-refinement' />

      

      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Refine 50 tickets in 90 seconds</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-58)', maxWidth: 560, margin: '0 auto 20px' }}>
          Free tier covers 5,000 imported tasks per month with refinement included. Bring your own LLM key.
        </p>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
