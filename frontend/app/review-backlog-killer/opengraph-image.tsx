import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Review Backlog Killer';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'REVIEW BACKLOG KILLER',
    title: 'PRs disappear.\nVelocity drops.',
    subtitle: 'Auto-nudge stuck PRs before it tanks.',
    accent: '#f59e0b',
    accent2: '#ef4444',
    emoji: '⏱',
  });
}
