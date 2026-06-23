import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

export async function GET(request: Request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mediaId = searchParams.get('media_id');
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!mediaId) {
    return NextResponse.json({ error: 'missing media_id' }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: 'missing WHATSAPP_ACCESS_TOKEN' }, { status: 500 });
  }

  // Step 1: Resolve temporary download URL from WhatsApp Graph API.
  const metaRes = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!metaRes.ok) {
    const err = await metaRes.text();
    return NextResponse.json({ error: 'failed to resolve media url', details: err }, { status: metaRes.status });
  }

  const meta = await metaRes.json();
  const mediaUrl = meta?.url;
  if (!mediaUrl) {
    return NextResponse.json({ error: 'media url missing from metadata' }, { status: 502 });
  }

  // Step 2: Fetch binary media bytes from temporary URL.
  const fileRes = await fetch(mediaUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!fileRes.ok || !fileRes.body) {
    const err = await fileRes.text();
    return NextResponse.json({ error: 'failed to download media', details: err }, { status: fileRes.status || 502 });
  }

  const contentType =
    fileRes.headers.get('content-type') ||
    meta?.mime_type ||
    'application/octet-stream';

  return new Response(fileRes.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
