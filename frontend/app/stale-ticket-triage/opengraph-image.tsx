import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Stale Ticket Triage';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'STALE TICKET TRIAGE',
    title: 'Kill the Friday\ntriage meeting.',
    subtitle: 'AI close / snooze / keep, bulk-approved.',
    accent: '#10b981',
    accent2: '#06b6d4',
    emoji: '🧹',
  });
}
