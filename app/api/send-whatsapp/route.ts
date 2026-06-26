import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '../../../lib/supabase';

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1265560829965454';

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

function extractMissingColumnName(message: string | undefined) {
  if (!message) return null;
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
}

function withEmbeddedMediaId(body: string | null, mediaId: string | null) {
  if (!mediaId) return body;
  const marker = `[[media_id:${mediaId}]]`;
  const base = String(body || '').trim();
  if (base.includes(marker)) return base;
  if (!base) return marker;
  return `${base} ${marker}`;
}

async function insertMessageWithFallback(payload: Record<string, unknown>) {
  const insertPayload = { ...payload };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await supabase.from('messages').insert(insertPayload).select().single();
    if (!result.error) {
      return { data: result.data, error: null, droppedColumns: Object.keys(payload).filter((k) => !(k in insertPayload)) };
    }

    const missingColumn = extractMissingColumnName(result.error.message);
    if (!missingColumn || !(missingColumn in insertPayload)) {
      return { data: result.data, error: result.error, droppedColumns: [] };
    }

    console.warn('[send-whatsapp] retrying insert without missing schema column', {
      missingColumn,
    });
    delete insertPayload[missingColumn];
  }

  return {
    data: null,
    error: { message: 'failed to insert message after schema-fallback retries' },
    droppedColumns: [],
  };
}

export async function POST(request: Request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { lead_id, phone, message, media_id, message_type } = await request.json();
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;

  if (!lead_id || !phone) {
    return NextResponse.json({ error: 'missing lead_id or phone' }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: 'missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_TOKEN' }, { status: 500 });
  }

  const outgoingType = message_type === 'image' ? 'image' : 'text';
  if (outgoingType === 'text' && !message) {
    return NextResponse.json({ error: 'missing message for text send' }, { status: 400 });
  }
  if (outgoingType === 'image' && !media_id) {
    return NextResponse.json({ error: 'missing media_id for image send' }, { status: 400 });
  }

  const to = normaliseUkPhone(phone);
  const waPayload =
    outgoingType === 'image'
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'image',
          image: {
            id: media_id,
            ...(message ? { caption: message } : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        };

  let upstream: Response;
  try {
    upstream = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(waPayload),
    });
  } catch (err) {
    console.error('[send-whatsapp] failed to call WhatsApp API', {
      lead_id,
      phone: to,
      outgoingType,
      error: err,
    });
    return NextResponse.json({ error: 'network error calling WhatsApp API' }, { status: 502 });
  }

  const upstreamData = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    console.error('[send-whatsapp] WhatsApp API rejected outbound message', {
      lead_id,
      phone: to,
      outgoingType,
      status: upstream.status,
      details: upstreamData,
    });
    return NextResponse.json(
      { error: 'whatsapp send failed', details: upstreamData },
      { status: upstream.status || 502 }
    );
  }

  const sendStatus = 'sent';
  const waMessageId = upstreamData?.messages?.[0]?.id || null;
  const messageBody = outgoingType === 'image' ? (message || null) : message;

  const baseInsertPayload: Record<string, unknown> = {
    lead_id,
    direction: 'out',
    channel: 'whatsapp',
    body: withEmbeddedMediaId(messageBody, outgoingType === 'image' ? (media_id || null) : null),
    message_type: outgoingType,
    wa_message_id: waMessageId,
    status: sendStatus,
    is_automated: false,
  };
  if (outgoingType === 'image') {
    baseInsertPayload.media_id = media_id;
  }

  const insertResult = await insertMessageWithFallback(baseInsertPayload);
  const loggedMessage = insertResult.data;
  const logError = insertResult.error;

  if (logError) {
    console.error('[send-whatsapp] failed to log outbound message', {
      lead_id,
      phone: to,
      outgoingType,
      error: logError.message,
    });
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  const preview = outgoingType === 'image' ? 'Photo sent' : String(messageBody || '').slice(0, 80);
  await supabase.from('leads').update({
    last_message_at: new Date().toISOString(),
    last_message_preview: preview,
  }).eq('id', lead_id);

  return NextResponse.json({
    ok: true,
    message: loggedMessage,
    sendStatus,
    droppedColumns: insertResult.droppedColumns,
    upstream: upstreamData,
  });
}
