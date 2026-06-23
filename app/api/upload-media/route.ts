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
    console.error('[upload-media] missing WHATSAPP_ACCESS_TOKEN');
    return NextResponse.json({ error: 'missing WHATSAPP_ACCESS_TOKEN' }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error('[upload-media] failed to parse multipart form data', err);
    return NextResponse.json({ error: 'invalid multipart form data' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    console.error('[upload-media] missing or invalid file field', {
      receivedType: file ? typeof file : 'null',
    });
    return NextResponse.json({ error: 'missing image file' }, { status: 400 });
  }
  if (!file.type?.startsWith('image/')) {
    console.error('[upload-media] rejected non-image mime type', {
      mimeType: file.type,
      fileName: file.name,
    });
    return NextResponse.json({ error: 'file must be an image' }, { status: 400 });
  }

  const waFormData = new FormData();
  waFormData.set('messaging_product', 'whatsapp');
  waFormData.set('file', file, file.name || 'image.jpg');
  waFormData.set('type', file.type || 'image/jpeg');

  let upstream: Response;
  try {
    upstream = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: waFormData,
    });
  } catch (err) {
    console.error('[upload-media] network error calling Meta media API', err);
    return NextResponse.json({ error: 'network error calling media API' }, { status: 502 });
  }

  const rawText = await upstream.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    console.error('[upload-media] Meta media upload failed', {
      status: upstream.status,
      statusText: upstream.statusText,
      responseBody: rawText,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
    });
    return NextResponse.json(
      {
        error: 'upload failed',
        details: data || rawText,
        upstream_status: upstream.status,
      },
      { status: upstream.status || 502 }
    );
  }

  console.info('[upload-media] Meta media upload success', {
    mediaId: data?.id || null,
    mimeType: file.type,
    fileName: file.name,
    fileSize: file.size,
  });

  return NextResponse.json({ media_id: data?.id || null, raw: data }, { status: 200 });
}
