import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Integrations — GitHub, Azure DevOps, Jira, Slack | AGENA',
  description:
    'Connect AGENA with GitHub, Azure DevOps, Jira, Slack, Teams, Telegram, OpenAI, and Gemini. Full integration guide.',
  alternates: { canonical: '/integrations' },
};

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
