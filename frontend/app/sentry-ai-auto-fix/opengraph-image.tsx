import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Sentry × Agena';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'SENTRY × AGENA',
    title: 'Sentry alert →\nmerged AI PR.',
    subtitle: 'In 12 minutes. End to end.',
    accent: '#a855f7',
    accent2: '#f97316',
    emoji: '🚨',
  });
}
