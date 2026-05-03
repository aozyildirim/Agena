import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Azure Devops × Agena';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'AZURE DEVOPS × AGENA',
    title: 'Work items →\nmerged AI PR.',
    subtitle: 'Auto-completes on green CI.',
    accent: '#0078d4',
    accent2: '#00b7c3',
    emoji: '🟦',
  });
}
