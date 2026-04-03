import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8010';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, message, newsletter } = body;

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const res = await fetch(`${API_BASE}/public/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: String(name).slice(0, 200),
        email: String(email).slice(0, 200),
        message: String(message).slice(0, 2000),
        newsletter: !!newsletter,
      }),
    });

    if (res.ok) {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
