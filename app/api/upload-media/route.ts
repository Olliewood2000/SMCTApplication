import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const WHATSAPP_PHONE_NUMBER_ID = '1265560829965454';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

export async function POST(request: Request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'missing WHATSAPP_ACCESS_TOKEN' }, { status: 500 });
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing image file' }, { status: 400 });
  }
  if (!file.type?.startsWith('image/')) {
    return NextResponse.json({ error: 'file must be an image' }, { status: 400 });
  }

  const waFormData = new FormData();
  waFormData.set('messaging_product', 'whatsapp');
  waFormData.set('file', file, file.name || 'image.jpg');

  const upstream = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: waFormData,
  });

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json({ error: 'upload failed', details: data }, { status: upstream.status || 502 });
  }

  return NextResponse.json({ media_id: data?.id || null, raw: data }, { status: 200 });
}
