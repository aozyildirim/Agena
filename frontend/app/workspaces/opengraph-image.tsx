import { renderLandingOg, ogSize, ogContentType } from '@/lib/landingOg';

export const size = ogSize;
export const contentType = ogContentType;
export const alt = 'AGENA — Workspaces for Big Teams';

export default async function Image() {
  return renderLandingOg({
    eyebrow: 'WORKSPACES',
    title: 'One platform.\nA workspace per squad.',
    subtitle: 'Multi-team AI agents — invite-code joins, role-based titles.',
    accent: '#7c3aed',
    accent2: '#06b6d4',
    emoji: '🗄',
  });
}
