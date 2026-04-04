import { createOgImage, ogSize, ogContentType } from '@/lib/og-template';
export const runtime = 'edge';
export const alt = 'AGENA Use Cases';
export const size = ogSize;
export const contentType = ogContentType;
export default async function Image() {
  return createOgImage({ title: 'Use Cases', subtitle: 'How teams use AGENA for autonomous development', tags: ['PR Automation', 'Code Review', 'DevOps'] });
}
