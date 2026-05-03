import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — New Relic × Agena';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'NEW RELIC × AGENA',
    title: 'APM errors →\nmerged AI PR.',
    subtitle: 'NerdGraph-powered, multi-repo.',
    accent: '#00ac69',
    accent2: '#1ce783',
    emoji: '📡',
  });
}
