import { createOgImage, ogSize, ogContentType } from '@/lib/og-template';
export const runtime = 'edge';
export const alt = 'Contact AGENA';
export const size = ogSize;
export const contentType = ogContentType;
export default async function Image() {
  return createOgImage({ title: 'Contact Us', subtitle: 'Get in touch with the AGENA team', tags: ['Support', 'Enterprise', 'Open Source'] });
}
