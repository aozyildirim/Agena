import { createOgImage, ogSize, ogContentType } from '@/lib/og-template';
export const runtime = 'edge';
export const alt = 'AGENA Changelog';
export const size = ogSize;
export const contentType = ogContentType;
export default async function Image() {
  return createOgImage({ title: 'Changelog', subtitle: 'Latest features, improvements, and updates', tags: ['Releases', 'Updates', 'What\'s New'] });
}
