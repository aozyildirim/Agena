import { createOgImage, ogSize, ogContentType } from '@/lib/og-template';
export const runtime = 'edge';
export const alt = 'AGENA Status';
export const size = ogSize;
export const contentType = ogContentType;
export default async function Image() {
  return createOgImage({ title: 'System Status', subtitle: 'Real-time service health monitoring', tags: ['Uptime', 'API', 'Infrastructure'] });
}
