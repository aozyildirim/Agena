import { NextRequest } from 'next/server';
import { x402Handler } from '@/lib/x402';

export const GET = (req: NextRequest) => x402Handler(req);
export const POST = (req: NextRequest) => x402Handler(req);
