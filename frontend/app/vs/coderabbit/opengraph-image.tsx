import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Agena Vs Coderabbit';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'AGENA VS CODERABBIT',
    title: 'One reviewer\nis not enough.',
    subtitle: 'Custom personas. BYO LLM. Self-host.',
    accent: '#10b981',
    accent2: '#06b6d4',
    emoji: '⚖️',
  });
}
