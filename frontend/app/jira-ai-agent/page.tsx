import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Jira AI Agent · Auto-Refine Backlog & Open PRs from Jira Issues | AGENA',
  description: 'Connect Jira to AGENA and let AI agents refine your backlog, estimate story points, route security tasks by reporter, and open pull requests on GitHub or Azure DevOps. Reporter-based routing, sprint integration, free tier.',
  keywords: [
    'Jira AI agent',
    'Jira AI bot',
    'AI backlog refinement Jira',
    'Jira story point estimation AI',
    'auto-assign Jira reporter rules',
    'Jira to pull request AI',
    'Jira AI integration',
    'Jira sprint AI automation',
    'Jira security ticket routing',
    'Atlassian AI agent',
    'Jira agent OWASP review',
  ],
  alternates: { canonical: 'https://agena.dev/jira-ai-agent' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/jira-ai-agent',
    title: 'Jira AI Agent — Auto-Refine Backlog & Open PRs | AGENA',
    description: 'AI agents pick up Jira issues, refine them, estimate story points, route by reporter, and open the PR. Setup in 5 minutes.',  }
};

const FAQ = [
  {
    q: 'How does AGENA work with Jira?',
    a: 'AGENA imports Jira issues (via JQL filter or per-project sync), turns each into a Task, runs the AI agent pipeline (analyzer → planner → developer → reviewer), opens a PR on the linked GitHub or Azure DevOps repo, and writes back to the Jira issue with PR URL, status transitions, and refinement output (acceptance criteria, story points, suggested assignee).'
  },
  {
    q: 'Can I route security tickets to a different agent automatically?',
    a: 'Yes — define an Integration Rule that matches Jira reporter, issue type, project, or label. For example: reporter = security@yourcompany.com OR label = security → auto-tag = security_review, agent = security_developer, priority = critical. The same rule engine works for both Jira and Azure DevOps.'
  },
  {
    q: 'Does AGENA write story points back to Jira?',
    a: 'Yes — when you run AI Refinement on a Jira-sourced task, AGENA writes the estimated story points to the Jira custom field you configure (default: customfield_10016). Acceptance criteria and refined description are also written back as a Jira comment.'
  },
  {
    q: 'Which Jira authentication is supported?',
    a: 'API token via email + token (Atlassian Cloud) or PAT (Jira Server / Data Center). Stored encrypted server-side, scoped to the configured site URL. AGENA never reads code through Jira — only issue content.'
  },
  {
    q: 'Do I need Jira Premium or a specific Atlassian plan?',
    a: 'No — AGENA works with Jira Free, Standard, Premium, and Enterprise. Custom field IDs are auto-detected. JQL filters can be edited per project.'
  },
  {
    q: 'How is this different from Atlassian Intelligence?',
    a: 'Atlassian Intelligence summarises and rewrites issue text. AGENA actually writes the code, opens the PR, runs an AI code review, and resolves the Jira issue when the PR merges. They are complementary — many teams use both.'
  },
];

export default function JiraAIAgentPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AGENA — Jira AI Agent',
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
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0052cc', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Jira × AGENA
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          AI agents that refine your Jira backlog and <br />
          <span style={{ background: 'linear-gradient(90deg, #0052cc, #2684ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>open the pull request</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>
          Connect Jira to AGENA and let AI agents pick up issues, refine them with acceptance criteria and story
          points, route security tasks to the right agent based on reporter, and ship a PR on GitHub or Azure DevOps —
          with status transitions written back to Jira.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #0052cc, #2684ff)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free — connect Jira
          </Link>
          <Link href='/dashboard/integrations/jira' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            See the dashboard →
          </Link>
        </div>
      </header>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>The flow, end to end</h2>
        <ol style={{ display: 'grid', gap: 12, paddingLeft: 0, listStyle: 'none' }}>
          {[
            { title: 'Jira issue → Agena task', desc: 'AGENA polls Jira via JQL or webhook. Each matching issue becomes a Task with full description, acceptance criteria, attachments, and a backlink to the Jira ticket.' },
            { title: 'Integration Rules tag and route', desc: 'Rules match on reporter, issue type, project, or label. Example: reporter = security@yourcompany.com → tag = security_review, agent = security_developer, priority = critical. Same rule engine works for Jira AND Azure DevOps.' },
            { title: 'AI Refinement (optional)', desc: 'Click ✨ Refine on the task. The PM agent expands the description, writes acceptance criteria, estimates story points, and suggests an assignee based on prior expertise.' },
            { title: 'AI pipeline runs', desc: 'analyzer → planner → developer → reviewer. The reviewer agent runs an OWASP-aware code review against the diff and produces a severity + score.' },
            { title: 'PR opened, Jira updated', desc: 'A pull request is opened on GitHub or Azure DevOps. The Jira issue gets a comment with the PR URL, transitions to "In Review", and (when the PR merges) auto-transitions to "Done".' },
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 16, padding: '14px 18px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,82,204,0.15)', color: '#2684ff', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
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
            { icon: '🎯', title: 'Reporter-based routing', body: 'Match Jira reporter, label, project, or issue type to auto-tag the task and pick the right reviewer agent. No hardcoded if/else.' },
            { icon: '✨', title: 'AI Refinement', body: 'PM agent expands story descriptions, writes acceptance criteria, estimates story points, and suggests an assignee.' },
            { icon: '🔢', title: 'Story point writeback', body: 'Estimated points are written to the configured Jira custom field. Refinement output added as a Jira comment.' },
            { icon: '🔁', title: 'Two-way status sync', body: 'PR opens → Jira "In Review". PR merges → Jira "Done". PR closes without merge → Jira reopened.' },
            { icon: '🛡️', title: 'OWASP-aware reviewer', body: 'Built-in security_developer agent runs an OWASP-aware AI review on every PR generated from a security-tagged Jira ticket.' },
            { icon: '📋', title: 'Sprint context', body: 'Tasks inherit Jira sprint and version info. AGENA respects sprint boundaries when bulk-assigning to AI.' },
            { icon: '📊', title: 'DORA metrics', body: 'Lead time, change failure rate, and recovery time tracked automatically per Jira issue type and team.' },
            { icon: '🧠', title: 'Repo-aware planning', body: 'The planner agent reads your codebase before writing the plan. No hallucinated file paths.' },
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
          <li>Create an Atlassian API token at <code>id.atlassian.com/manage-profile/security/api-tokens</code>.</li>
          <li>In AGENA → Integrations → Jira, paste your email + token + site URL (e.g. <code>yourco.atlassian.net</code>).</li>
          <li>Pick which Jira projects to sync and define a JQL filter (default: <code>resolution = Unresolved AND assignee = currentUser()</code>).</li>
          <li>Map each Jira project to a target repo (GitHub or Azure DevOps).</li>
          <li>Add an Integration Rule for security routing: <em>reporter in (security-team) → agent = security_developer, tag = security_review, priority = critical</em>.</li>
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

      <RelatedLandings current='/jira-ai-agent' />

      

      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Stop manually grooming the backlog</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-58)', maxWidth: 560, margin: '0 auto 20px' }}>
          The free tier covers 5,000 imported tasks per month. Bring your own LLM key (OpenAI / Gemini) to run agents.
        </p>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #0052cc, #2684ff)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
