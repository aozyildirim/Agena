import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Ai Sprint Refinement';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'AI SPRINT REFINEMENT',
    title: 'Auto-estimate\nstory points.',
    subtitle: 'Writes AC, suggests assignees.',
    accent: '#f59e0b',
    accent2: '#ef4444',
    emoji: '✨',
  });
}
