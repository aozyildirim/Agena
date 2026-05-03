import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Cross-Source Insights';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'CROSS-SOURCE INSIGHTS',
    title: '"Which deploy\ncaused this bug?"',
    subtitle: 'Answered in 5 seconds.',
    accent: '#6366f1',
    accent2: '#06b6d4',
    emoji: '🧠',
  });
}
