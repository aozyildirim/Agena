import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Ai Code Review';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'AI CODE REVIEW',
    title: 'OWASP-aware\nreviewer agents.',
    subtitle: 'On every pull request. BYO LLM.',
    accent: '#10b981',
    accent2: '#06b6d4',
    emoji: '🔎',
  });
}
