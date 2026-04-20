import { NextRequest, NextResponse } from 'next/server';

const MARKDOWN_PATHS: Record<string, string> = {
  '/': '/api/md/home',
  '/docs': '/api/md/docs',
  '/sdk': '/api/md/sdk',
  '/api-docs': '/api/md/api-docs',
};

function wantsMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  const a = accept.toLowerCase();
  return a.includes('text/markdown') || a.includes('text/x-markdown') || a.includes('application/markdown');
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const target = MARKDOWN_PATHS[pathname];
  if (!target) return NextResponse.next();
  if (!wantsMarkdown(req.headers.get('accept'))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/', '/docs', '/sdk', '/api-docs'],
};
