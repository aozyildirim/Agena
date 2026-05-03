import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Azure DevOps AI Bot · Auto-Fix Work Items & Open PRs | AGENA',
  description: 'Connect Azure DevOps to AGENA. AI agents pick up work items, write code, open pull requests, and complete them on merge. Reporter-based routing, multi-repo orchestration, story point writeback. Free tier available.',
  keywords: [
    'Azure DevOps AI bot',
    'Azure DevOps AI agent',
    'Azure DevOps work item AI',
    'Azure DevOps to pull request AI',
    'AI auto-PR Azure DevOps',
    'Azure DevOps AI integration',
    'Azure DevOps reporter routing AI',
    'AI code review Azure DevOps',
    'Azure DevOps story point AI',
    'Azure Boards AI agent',
    'Azure Repos AI automation',
  ],
  alternates: { canonical: 'https://agena.dev/azure-devops-ai-bot' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/azure-devops-ai-bot',
    title: 'Azure DevOps AI Bot — Work Items → Merged PR | AGENA',
    description: 'AI agents pick up Azure DevOps work items, write code, open the PR, and complete it on merge. Reporter-based routing for security tickets.',  }
};

const FAQ = [
  {
    q: 'How does AGENA work with Azure DevOps?',
    a: 'AGENA connects to your Azure DevOps organization via PAT, syncs work items from selected projects, runs the AI agent pipeline, and creates pull requests on Azure Repos. The work item state transitions (To Do → Active → Resolved → Closed) are written back automatically as the AI runs and the PR merges.'
  },
  {
    q: 'Does AGENA support both Azure Repos and Azure Boards?',
    a: 'Yes. Boards (work items) is the source of truth for tasks; Repos is the target for PRs. You can also mix — pull work items from Azure Boards and open PRs on GitHub if your code lives there.'
  },
  {
    q: 'Can I auto-route security work items to a security reviewer agent?',
    a: 'Yes — define an Integration Rule that matches Created By, Work Item Type, Area Path, or Tags, and route to your security_developer agent. Same rule engine works for Jira, Azure DevOps, Sentry, and New Relic imports.'
  },
  {
    q: 'How is the PAT stored?',
    a: 'Personal Access Token is encrypted at rest with envelope encryption (org-level KMS-style key). Required scopes: Code (read & write), Work Items (read & write), Build (read), and Identity (read). AGENA never reads your code through Boards APIs.'
  },
  {
    q: 'Does AGENA write story points back to Azure DevOps?',
    a: 'Yes — when AI Refinement runs on an Azure-sourced task, AGENA updates the Story Points field on the work item, transitions state to "Refined", and posts the AI-generated acceptance criteria as a discussion comment.'
  },
  {
    q: 'How does it handle Azure DevOps Pipelines?',
    a: 'AGENA does not run your pipelines. When the AI opens a PR, your existing build/release pipelines run as normal. The reviewer agent runs an LLM code review independently before the PR is marked ready, so AI review and CI run in parallel.'
  },
];

export default function AzureDevOpsAIBotPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AGENA — Azure DevOps AI Bot',
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
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0078d4', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Azure DevOps × AGENA
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          Azure DevOps work items → <br />
          <span style={{ background: 'linear-gradient(90deg, #0078d4, #00b7c3)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>merged AI pull request</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>
          AGENA imports Azure Boards work items, runs an AI pipeline, opens a PR on Azure Repos, completes the PR on
          merge, and writes state and story points back to the work item. Reporter / area path / tag based routing for
          security tickets.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #0078d4, #00b7c3)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free — connect Azure DevOps
          </Link>
          <Link href='/dashboard/integrations/azure' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            See the dashboard →
          </Link>
        </div>
      </header>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>The flow, end to end</h2>
        <ol style={{ display: 'grid', gap: 12, paddingLeft: 0, listStyle: 'none' }}>
          {[
            { title: 'Work item → Agena task', desc: 'AGENA syncs work items from Azure Boards via WIQL or area-path filter. Each work item becomes a Task with description, acceptance criteria, attachments, and a backlink to the work item.' },
            { title: 'Integration Rules tag and route', desc: 'Rules match on Created By, Work Item Type, Area Path, or Tags. Example: Tag contains "security" → route to security_developer agent, priority = critical, repo = backend-api.' },
            { title: 'AI Refinement (optional)', desc: 'Click ✨ Refine. The PM agent expands the description, adds acceptance criteria, estimates story points, suggests assignee. Story points written back to the Story Points field.' },
            { title: 'AI pipeline runs', desc: 'analyzer → planner → developer → reviewer. Code is generated against the right Azure repo, pushed to a feature branch, and the reviewer runs OWASP-aware AI review on the diff.' },
            { title: 'PR opened, work item completed on merge', desc: 'Pull request created on Azure Repos with the AI review attached. Work item state → Active. When the PR auto-completes, work item → Closed and the merged commit URL is added as a discussion comment.' },
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 16, padding: '14px 18px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,120,212,0.15)', color: '#3aa0ec', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
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
            { icon: '🧩', title: 'Boards + Repos in one flow', body: 'Sync work items from Boards, open PRs on Repos, complete PRs on merge — all without leaving Agena.' },
            { icon: '🎯', title: 'Area-path routing', body: 'Match by Area Path, Iteration Path, Created By, Tag, or Work Item Type. Same Integration Rule engine across all integrations.' },
            { icon: '🔢', title: 'Story point writeback', body: 'Refinement updates the Story Points field on the work item and posts AC as a discussion comment.' },
            { icon: '🔁', title: 'Two-way state sync', body: 'PR opened → Active. PR merged → Closed. PR abandoned → reactivated. Backlog stays accurate.' },
            { icon: '🛡️', title: 'OWASP-aware reviewer', body: 'Tag a work item with "security" and the security_developer agent runs paranoid review with threat model + fix plan.' },
            { icon: '🌐', title: 'Multi-org, multi-project', body: 'One Agena workspace can connect to multiple Azure DevOps organizations and projects. Repo-level mappings.' },
            { icon: '⚡', title: 'PR auto-completion', body: 'Optional auto-complete on the AI-generated PR — with squash, branch deletion, and required-reviewer policies respected.' },
            { icon: '📊', title: 'DORA dashboard', body: 'Lead time, change failure rate, and MTTR per project, area path, and team — measured against AI-generated and human PRs.' },
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
          <li>Create a PAT at <code>dev.azure.com/yourorg/_usersSettings/tokens</code> with Code (R&W), Work Items (R&W), Build (R), Identity (R).</li>
          <li>In AGENA → Integrations → Azure DevOps, paste the PAT and your org URL (<code>https://dev.azure.com/yourorg</code>).</li>
          <li>Pick the projects to sync. AGENA auto-discovers your repos and proposes mappings.</li>
          <li>Configure the work item filter (default: <code>State &lt;&gt; Closed AND AssignedTo = @Me</code>).</li>
          <li>Add an Integration Rule for security: <em>Tag contains &quot;security&quot; → agent = security_developer, priority = critical</em>.</li>
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

      <RelatedLandings current='/azure-devops-ai-bot' />

      

      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Stop hand-grooming Azure Boards</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-58)', maxWidth: 560, margin: '0 auto 20px' }}>
          The free tier covers 5,000 imported tasks per month. Bring your own LLM key (OpenAI / Gemini) to run agents.
        </p>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #0078d4, #00b7c3)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
