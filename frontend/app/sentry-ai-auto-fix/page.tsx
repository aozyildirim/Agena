import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Sentry AI Auto-Fix · Production Errors → Pull Request in Minutes | AGENA',
  description: 'Connect Sentry to AGENA and let AI agents auto-fix production errors. Imports issues, runs an OWASP-aware reviewer, opens a PR on GitHub or Azure DevOps, and resolves the Sentry issue when the PR merges. Free tier available.',
  keywords: [
    'Sentry AI auto-fix',
    'Sentry AI bot',
    'auto-fix Sentry errors',
    'Sentry to pull request',
    'Sentry GitHub integration AI',
    'Sentry Azure DevOps integration AI',
    'AI production error fixing',
    'auto-resolve Sentry issues',
    'Sentry AI integration',
    'Sentry agent',
    'Seer alternative open source',
  ],
  alternates: { canonical: 'https://agena.dev/sentry-ai-auto-fix' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/sentry-ai-auto-fix',
    title: 'Sentry AI Auto-Fix — Production Errors → Merged PR | AGENA',
    description: 'Imports a Sentry issue, runs an AI reviewer, opens a PR, resolves the Sentry issue on merge. Setup in 5 minutes.',  }
};

const FAQ = [
  {
    q: 'How does AGENA fix Sentry errors automatically?',
    a: 'AGENA polls your Sentry organization for unresolved issues, parses the stack trace and reproduction context, runs the AI agent pipeline (analyzer → planner → developer → reviewer), opens a pull request on GitHub or Azure DevOps with the patch, and posts a comment back on the Sentry issue with the PR URL. When the PR is merged, the Sentry issue is auto-resolved via webhook.'
  },
  {
    q: 'Do I need to give AGENA my Sentry API token?',
    a: 'Yes — a User Auth Token with org:read, project:read, event:read, event:write and issue:write scopes. The token is stored encrypted server-side and used only for the configured organization slug. AGENA never reads source code through Sentry.'
  },
  {
    q: 'Which Sentry issues get imported?',
    a: 'By default, unresolved issues from the Sentry projects you map to Agena repos. You can scope by environment, release, fixability score (Sentry Seer), substatus (regressed / new), age window (24h / 7d / 14d / 30d) and reporter rules.'
  },
  {
    q: 'Can I send security errors to a specific reviewer agent?',
    a: 'Yes — define an Integration Rule that matches the Sentry issue\'s tags / project and routes the imported task to your security_developer agent. The rule action also lets you override priority and target repo. The security agent runs an OWASP-aware prompt and produces a threat-model + fix plan instead of writing code.'
  },
  {
    q: 'Does AGENA replace Sentry Seer?',
    a: 'No — AGENA complements Seer. We use Seer\'s fixability score (when present) as a signal for which issues to auto-fix vs. flag. AGENA actually opens the PR and routes through your code review process; Seer suggests inline fixes within Sentry.'
  },
  {
    q: 'How long does an auto-fix take?',
    a: 'Typical end-to-end: 8-15 minutes from "Sentry alert fires" to "AI PR opened on GitHub". The reviewer agent then runs a 30-90 second AI code review against the patch before the PR is marked ready.'
  },
];

export default function SentryAIAutoFixPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AGENA — Sentry AI Auto-Fix',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    description: metadata.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'AGENA', url: 'https://agena.dev' }
  };
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px', display: 'grid', gap: 48 }}>
      <Script id='ld-app' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(ldJson) }} />
      <Script id='ld-faq' type='application/ld+json' dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }} />

      <header style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Sentry × AGENA
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          Sentry production errors → <br />
          <span style={{ background: 'linear-gradient(90deg, #a855f7, #f97316)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>merged AI pull request</span> in 12 minutes
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>
          Connect Sentry to AGENA and let AI agents auto-import issues, run an OWASP-aware code review,
          and ship a pull request on GitHub or Azure DevOps. When the PR merges, the Sentry issue is
          auto-resolved.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #a855f7, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free — connect Sentry
          </Link>
          <Link href='/dashboard/integrations/sentry' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            See the dashboard →
          </Link>
        </div>
      </header>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>The flow, end to end</h2>
        <ol style={{ display: 'grid', gap: 12, paddingLeft: 0, listStyle: 'none' }}>
          {[
            { title: 'Sentry → Agena auto-import', desc: 'AGENA polls your Sentry org every 5 minutes (configurable) for unresolved issues in mapped projects. Each issue becomes a task with stack trace, breadcrumbs, request meta, and the Sentry permalink.' },
            { title: 'Integration Rules tag the task', desc: 'Rules you set in /dashboard/integrations/rules auto-tag tasks based on reporter, issue type, environment, or labels — e.g. tasks reported by the security team get a "security" tag and are routed to the security_developer agent.' },
            { title: 'AI pipeline runs', desc: 'analyzer → planner → developer → reviewer. Code is generated against the right repo (resolved from the Sentry → repo mapping), tested, and the reviewer agent runs an OWASP-aware code review with severity + score.' },
            { title: 'PR opened on GitHub or Azure DevOps', desc: 'A pull request is opened with the patch, the Sentry issue link, and the AI review summary. A comment is posted on the Sentry issue with the PR URL.' },
            { title: 'Auto-resolve on merge', desc: 'When the PR is merged, GitHub / Azure DevOps webhooks tell AGENA, which marks the Sentry issue resolved and posts a final comment with the merged commit.' },
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 16, padding: '14px 18px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(168,85,247,0.15)', color: '#c084fc', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-90)' }}>{step.title}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-58)', marginTop: 4, lineHeight: 1.55 }}>{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>What you get out of the box</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {[
            { icon: '🛡️', title: 'OWASP-aware AI reviewer', body: 'A dedicated security_developer agent ships with AGENA. Paranoid by default, treats every input as malicious, outputs threat-model + fix plan + residual-risk note.' },
            { icon: '⚡', title: 'Fixability badge', body: 'Sentry Seer score surfaced as a coloured badge so you can scan which issues AGENA can fix with high confidence.' },
            { icon: '🔎', title: 'Inline stack trace preview', body: 'Click an issue and see file:line + ±5 lines of code context, marked in_app frames, breadcrumbs, request meta — without leaving Agena.' },
            { icon: '✦', title: 'AI Fix Preview', body: 'Run an LLM root-cause analysis BEFORE importing as a task. Produces summary + suggested fix + likely files + confidence score.' },
            { icon: '📐', title: 'Integration Rules', body: 'Auto-tag and auto-route by reporter, issue type, environment, or labels. Same engine works for Jira and Azure DevOps.' },
            { icon: '🔄', title: 'Auto-resolve on PR merge', body: 'Webhook flips the Sentry issue to resolved when the AI-generated PR merges, and posts the merged commit hash as a comment.' },
            { icon: '📊', title: 'Per-agent review history', body: 'See every review the security agent has done across all your tasks — severity distribution, average score, click-through to the report.' },
            { icon: '🌍', title: '7-day error sparkline', body: 'Each Sentry issue card shows a 7-day occurrence trend so you can spot regressions and traffic spikes at a glance.' },
          ].map((f) => (
            <div key={f.title} style={{ padding: 16, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 6, lineHeight: 1.55 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>Setup in 5 minutes</h2>
        <ol style={{ paddingLeft: 24, color: 'var(--ink-78)', fontSize: 14, lineHeight: 1.8 }}>
          <li>Create a Sentry User Auth Token with <code>org:read</code>, <code>project:read</code>, <code>event:read</code>, <code>event:write</code>, <code>issue:write</code> scopes.</li>
          <li>In AGENA → Integrations → Sentry, paste the token + your org slug (visible in your sentry.io URL).</li>
          <li>In the Sentry page, browse projects and map each one to a target repo.</li>
          <li>Toggle <strong>Auto-import</strong> on the mappings you want AGENA to watch.</li>
          <li>Optionally add an Integration Rule: <em>reporter = security@yourcompany.com → tag = security_review, agent = security_developer, priority = critical</em>.</li>
        </ol>
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

      <RelatedLandings current='/sentry-ai-auto-fix' />

      

      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Stop triaging Sentry alerts manually</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-58)', maxWidth: 560, margin: '0 auto 20px' }}>
          The free tier covers 5,000 imported tasks per month. Bring your own LLM key (OpenAI / Gemini) to run agents.
        </p>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #a855f7, #6366f1)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
