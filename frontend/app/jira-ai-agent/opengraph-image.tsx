import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Jira × Agena';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'JIRA × AGENA',
    title: 'AI agents that\nopen the PR.',
    subtitle: 'Refines backlog. Routes by reporter.',
    accent: '#0052cc',
    accent2: '#2684ff',
    emoji: '🪐',
  });
}
