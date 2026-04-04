import { createOgImage, ogSize, ogContentType } from '@/lib/og-template';
export const runtime = 'edge';
export const alt = 'AGENA Blog';
export const size = ogSize;
export const contentType = ogContentType;
export default async function Image() {
  return createOgImage({ title: 'Blog', subtitle: 'Insights on agentic AI, pixel agents, and autonomous development', tags: ['Agentic AI', 'Tutorials', 'Engineering'] });
}
