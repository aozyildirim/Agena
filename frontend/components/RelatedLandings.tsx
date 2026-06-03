import Link from 'next/link';

/**
 * Cross-linked "You might also like" block for landing pages.
 *
 * Why: Google rewards pages that other pages on the same site link to.
 * Sitemaps alone aren't enough to convince the crawler a page is worth
 * indexing — internal links are the primary signal. Each landing
 * exposes 3 related landings via the RELATED map; passing the current
 * page's slug filters self-links so the chip block never points back
 * at the same URL.
 */

type LandingMeta = {
  slug: string;
  icon: string;
  title: string;
  blurb: string;
};

const META: Record<string, LandingMeta> = {
  '/cross-source-insights': { slug: '/cross-source-insights', icon: '🧠', title: 'Cross-Source Insights', blurb: '"Which deploy caused this bug?" answered in 5 seconds' },
  '/stale-ticket-triage': { slug: '/stale-ticket-triage', icon: '🧹', title: 'Stale Ticket Triage', blurb: 'Auto-triage Jira / Azure tickets that have gone idle' },
  '/review-backlog-killer': { slug: '/review-backlog-killer', icon: '⏱', title: 'Review Backlog Killer', blurb: 'Auto-nudge stuck PRs before they tank velocity' },
  '/sentry-ai-auto-fix': { slug: '/sentry-ai-auto-fix', icon: '🚨', title: 'Sentry AI Auto-Fix', blurb: 'Sentry production errors → merged AI pull request in 12 minutes' },
  '/jira-ai-agent': { slug: '/jira-ai-agent', icon: '🪐', title: 'Jira AI Agent', blurb: 'Auto-refine backlog and open PRs from Jira issues' },
  '/azure-devops-ai-bot': { slug: '/azure-devops-ai-bot', icon: '🟦', title: 'Azure DevOps AI Bot', blurb: 'Work items → merged AI pull request' },
  '/newrelic-ai-agent': { slug: '/newrelic-ai-agent', icon: '📡', title: 'New Relic AI Agent', blurb: 'Auto-fix New Relic APM errors with AI pull requests' },
  '/ai-code-review': { slug: '/ai-code-review', icon: '🔎', title: 'AI Code Review', blurb: 'OWASP-aware reviewer agents on every pull request' },
  '/ai-sprint-refinement': { slug: '/ai-sprint-refinement', icon: '✨', title: 'AI Sprint Refinement', blurb: 'Auto-estimate story points and write acceptance criteria' },
  '/vs/seer': { slug: '/vs/seer', icon: '⚖️', title: 'AGENA vs Sentry Seer', blurb: 'Inline suggestions vs end-to-end auto-fix loop' },
  '/vs/coderabbit': { slug: '/vs/coderabbit', icon: '⚖️', title: 'AGENA vs CodeRabbit', blurb: 'Custom reviewer personas, BYO LLM, self-hostable' },
  '/workspaces': { slug: '/workspaces', icon: '🗄', title: 'Workspaces for Big Teams', blurb: 'One platform, a workspace per squad — invite-code joins, role-based titles' },
};

// Each key maps to 3 related slugs. The list is deliberately short so
// every page hands the crawler a small, focused recommendation graph.
const RELATED: Record<string, string[]> = {
  '/cross-source-insights': ['/sentry-ai-auto-fix', '/newrelic-ai-agent', '/review-backlog-killer'],
  '/stale-ticket-triage': ['/jira-ai-agent', '/azure-devops-ai-bot', '/ai-sprint-refinement'],
  '/review-backlog-killer': ['/ai-code-review', '/cross-source-insights', '/azure-devops-ai-bot'],
  '/sentry-ai-auto-fix': ['/cross-source-insights', '/ai-code-review', '/vs/seer'],
  '/jira-ai-agent': ['/azure-devops-ai-bot', '/stale-ticket-triage', '/ai-sprint-refinement'],
  '/azure-devops-ai-bot': ['/jira-ai-agent', '/sentry-ai-auto-fix', '/review-backlog-killer'],
  '/newrelic-ai-agent': ['/sentry-ai-auto-fix', '/cross-source-insights', '/azure-devops-ai-bot'],
  '/ai-code-review': ['/vs/coderabbit', '/sentry-ai-auto-fix', '/review-backlog-killer'],
  '/ai-sprint-refinement': ['/jira-ai-agent', '/stale-ticket-triage', '/azure-devops-ai-bot'],
  '/vs/seer': ['/sentry-ai-auto-fix', '/cross-source-insights', '/ai-code-review'],
  '/vs/coderabbit': ['/ai-code-review', '/cross-source-insights', '/sentry-ai-auto-fix'],
  '/workspaces': ['/ai-code-review', '/cross-source-insights', '/ai-sprint-refinement'],
};

export default function RelatedLandings({ current, heading = 'Related' }: { current: string; heading?: string }) {
  const slugs = RELATED[current] || [];
  if (slugs.length === 0) return null;
  return (
    <section style={{ paddingTop: 24, borderTop: '1px solid var(--panel-border)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--ink-42)', textTransform: 'uppercase', marginBottom: 14 }}>{heading}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {slugs.map((s) => {
          const m = META[s];
          if (!m) return null;
          return (
            <Link key={s} href={s} style={{
              display: 'grid', gap: 6, padding: 14, borderRadius: 10,
              background: 'var(--panel)', border: '1px solid var(--panel-border)',
              textDecoration: 'none', color: 'inherit',
              transition: 'border-color 0.15s, transform 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{m.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>{m.title}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-58)', lineHeight: 1.5 }}>{m.blurb}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
