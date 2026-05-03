import type { Metadata } from 'next';
import Link from 'next/link';
import RelatedLandings from '@/components/RelatedLandings';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'New Relic AI Agent · Auto-Fix APM Errors with AI Pull Requests | AGENA',
  description: 'Connect New Relic to AGENA. AI agents auto-import errors from your APM entities, generate the fix, run an OWASP-aware code review, and open a pull request on GitHub or Azure DevOps. Free tier, BYO LLM.',
  keywords: [
    'New Relic AI agent',
    'New Relic AI bot',
    'New Relic to pull request AI',
    'New Relic AI integration',
    'APM AI auto-fix',
    'NerdGraph AI agent',
    'New Relic error AI fix',
    'auto-fix New Relic errors',
  ],
  alternates: { canonical: 'https://agena.dev/newrelic-ai-agent' },
  openGraph: {
    type: 'article',
    url: 'https://agena.dev/newrelic-ai-agent',
    title: 'New Relic AI Agent — APM Errors → Merged PR | AGENA',
    description: 'Imports New Relic errors, runs AI pipeline, opens the PR. NerdGraph-powered, OWASP-aware reviewer, multi-repo.',  }
};

const FAQ = [
  { q: 'How does AGENA pull errors from New Relic?', a: 'AGENA uses the New Relic NerdGraph API (GraphQL). You configure an entity mapping that ties an APM entity GUID to one of your AGENA repo mappings. Every 5 minutes the worker queries NRQL for new errors on that entity, deduplicates by SHA-256 fingerprint of (entity, error_class, message), and creates an AGENA task with the file:line, transaction context, and the New Relic errors-inbox link.' },
  { q: 'What scopes does the API key need?', a: 'A New Relic User API key with read access to the accounts containing the entities you want to monitor. AGENA only reads — it does not write back to New Relic. Stored encrypted server-side.' },
  { q: 'Does it work with EU and US data centers?', a: 'Yes — set base URL to https://api.newrelic.com/graphql for US or https://api.eu.newrelic.com/graphql for EU. Account ID lives in the integration’s extra config.' },
  { q: 'How is file/line extracted from a New Relic error?', a: 'For PHP errors, AGENA parses the standard error message format /path/to/File.php:123. For other languages, the stack frame is read from the AttributeMap on the error event. If we can’t resolve a precise file:line, the task still imports — the developer agent does its own analysis from the error class + message.' },
  { q: 'Can I route by entity?', a: 'Yes — define an Integration Rule that matches entity GUID or entity name and routes to a specific reviewer agent. Example: entity name contains "billing" → security_developer reviewer + priority critical.' },
  { q: 'How does this differ from the Sentry integration?', a: 'Functionally identical end-to-end (import → AI pipeline → PR → auto-resolve). The mapping shape differs: Sentry maps a project to a repo; New Relic maps an APM entity (GUID) to a repo. You can run both — many teams send web errors to Sentry and backend APM errors to New Relic.' },
];

export default function NewRelicAIAgentPage() {
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AGENA — New Relic AI Agent',
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
        <div style={{ fontSize: 13, fontWeight: 700, color: '#00ac69', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          New Relic × AGENA
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 800, lineHeight: 1.1, color: 'var(--ink-90)', margin: 0 }}>
          New Relic APM errors → <br />
          <span style={{ background: 'linear-gradient(90deg, #00ac69, #1ce783)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>merged AI pull request</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--ink-58)', marginTop: 18, maxWidth: 720, marginInline: 'auto', lineHeight: 1.55 }}>
          AGENA queries New Relic via NerdGraph, auto-imports new errors per APM entity, runs an AI agent
          pipeline against the right repo, opens a pull request, and (optionally) writes a deploy marker back
          when the PR merges. Built-in OWASP-aware reviewer for security-tagged entities.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link href='/signup' style={{ padding: '12px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #00ac69, #1ce783)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            Start free — connect New Relic
          </Link>
          <Link href='/dashboard/integrations/newrelic' style={{ padding: '12px 24px', borderRadius: 10, border: '1px solid var(--panel-border)', background: 'var(--panel)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
            See the dashboard →
          </Link>
        </div>
      </header>

      <section>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>The flow, end to end</h2>
        <ol style={{ display: 'grid', gap: 12, paddingLeft: 0, listStyle: 'none' }}>
          {[
            { title: 'Map New Relic entities to repos', desc: 'Browse your APM entities in AGENA. For each entity GUID you care about, map it to a repo (GitHub or Azure DevOps).' },
            { title: 'Auto-import every 5 minutes', desc: 'The AGENA worker queries NerdGraph for new errors per entity. Each error is fingerprinted by (entity, error_class, message) and deduplicated. New ones become tasks with the errors-inbox link.' },
            { title: 'Integration Rules tag and route', desc: 'Match by entity GUID, entity name, or error class. Route security-tagged entities to the security_developer reviewer.' },
            { title: 'AI pipeline runs', desc: 'analyzer → planner → developer → reviewer. The reviewer runs OWASP-aware AI review and produces severity + score.' },
            { title: 'PR opened on GitHub or Azure DevOps', desc: 'Pull request with the patch, AI review, and the New Relic errors-inbox link. Optional: write a New Relic deploy marker when the PR merges.' },
          ].map((step, i) => (
            <li key={i} style={{ display: 'flex', gap: 16, padding: '14px 18px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--panel-border)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,172,105,0.15)', color: '#1ce783', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
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
            { icon: '🌐', title: 'NerdGraph-powered', body: 'Native NerdGraph (GraphQL) integration — entity browser, NRQL error queries, transaction enrichment.' },
            { icon: '🎯', title: 'Per-entity routing', body: 'Each APM entity maps to a repo. Multi-entity teams keep their AI fix flow scoped to the right service.' },
            { icon: '🛡️', title: 'OWASP-aware reviewer', body: 'security_developer agent runs paranoid review on security-tagged entities.' },
            { icon: '🇪🇺', title: 'EU + US support', body: 'Both data center endpoints supported out of the box.' },
            { icon: '📈', title: 'Sample transactions', body: 'AGENA enriches each error group with sample transactions (endpoint, method, URI) for context.' },
            { icon: '🔁', title: 'Auto-import per entity', body: 'Toggle auto-import on each entity mapping you want monitored. Worker runs every 5 minutes.' },
            { icon: '📊', title: 'Errors inbox link', body: 'Each AGENA task links back to the entity errors inbox in one.eu.newrelic.com / one.newrelic.com.' },
            { icon: '🌍', title: 'Multi-repo per entity', body: 'A single entity can fan out to multiple repos when one APM entity spans services.' },
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
          <li>Create a User API key in New Relic (one.newrelic.com → API keys).</li>
          <li>In AGENA → Integrations → New Relic, paste the key, select US or EU base URL, set your account ID.</li>
          <li>Browse your APM entities in AGENA and click Map for each one.</li>
          <li>Pick the target repo for each mapping.</li>
          <li>Toggle <strong>Auto-import</strong> on the mappings you want AGENA to watch.</li>
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

      <RelatedLandings current='/newrelic-ai-agent' />

      

      <footer style={{ textAlign: 'center', padding: '40px 0', borderTop: '1px solid var(--panel-border)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>Stop triaging APM alerts manually</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-58)', maxWidth: 560, margin: '0 auto 20px' }}>
          The free tier covers 5,000 imported tasks per month. Bring your own LLM key (OpenAI / Gemini) to run agents.
        </p>
        <Link href='/signup' style={{ padding: '12px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #00ac69, #1ce783)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
          Start free
        </Link>
      </footer>
    </main>
  );
}
