import { createOgImage, ogSize, ogContentType } from '@/lib/og-template';
export const runtime = 'edge';
export const alt = 'AGENA Documentation';
export const size = ogSize;
export const contentType = ogContentType;
export default async function Image() {
  return createOgImage({ title: 'Documentation', subtitle: 'Complete guide to the AGENA agentic AI platform', tags: ['Docs', 'API Reference', 'Self-Hosting'] });
}
