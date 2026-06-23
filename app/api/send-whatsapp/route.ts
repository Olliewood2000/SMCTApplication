import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const WEBHOOK_URL = 'https://primary-production-dac83.up.railway.app/webhook/whatsapp-reply';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

function normaliseUkPhone(input: string) {
  let phone = String(input || '').replace(/\s+/g, '');
  if (phone.startsWith('0')) {
    phone = `44${phone.slice(1)}`;
  }
  return phone.replace(/[^0-9]/g, '');
}

export async function POST(request: Request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { lead_id, phone, message } = await request.json();

  if (!lead_id || !phone || !message) {
    return NextResponse.json({ error: 'missing lead_id, phone, or message' }, { status: 400 });
  }

  const payload = {
    lead_id,
    phone: normaliseUkPhone(phone),
    message,
  };

  const upstream = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  }

  const text = await upstream.text();
  return NextResponse.json({ ok: upstream.ok, status: upstream.status, body: text }, { status: upstream.status });
}
