import { NextRequest } from 'next/server';
import { x402Handler } from '@/lib/x402';

export const GET = (req: NextRequest) =>
  x402Handler(req, {
    resource: 'https://agena.dev/api',
    description: 'AGENA API root — premium agentic endpoints. Pay via x402 to access.',
  });
export const POST = (req: NextRequest) =>
  x402Handler(req, {
    resource: 'https://agena.dev/api',
    description: 'AGENA API root — premium agentic endpoints. Pay via x402 to access.',
  });
