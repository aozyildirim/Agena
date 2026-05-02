import { NextRequest, NextResponse } from 'next/server';

// Server-side: prefer INTERNAL_API_BASE_URL (e.g. http://backend:8010 in
// Docker) so the route can reach the API container directly. Fall back to
// the public URL for non-Docker dev where backend lives on localhost.
const API_BASE =
  process.env.INTERNAL_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8010';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/public/newsletter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });

    if (res.ok) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
