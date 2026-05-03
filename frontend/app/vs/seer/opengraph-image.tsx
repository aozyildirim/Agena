import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Agena Vs Sentry Seer';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'AGENA VS SENTRY SEER',
    title: 'Seer suggests.\nAGENA opens PR.',
    subtitle: 'Open-source, BYO LLM, OWASP-aware.',
    accent: '#a855f7',
    accent2: '#6366f1',
    emoji: '⚖️',
  });
}
