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

export async function POST(request: Request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { lead_id, phone, message, media_id, message_type } = await request.json();
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!lead_id || !phone) {
    return NextResponse.json({ error: 'missing lead_id or phone' }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: 'missing WHATSAPP_ACCESS_TOKEN' }, { status: 500 });
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

  const upstream = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(waPayload),
  });

  const upstreamData = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'whatsapp send failed', details: upstreamData },
      { status: upstream.status || 502 }
    );
  }

  const sendStatus = 'sent';
  const waMessageId = upstreamData?.messages?.[0]?.id || null;
  const messageBody = outgoingType === 'image' ? (message || null) : message;

  const { data: loggedMessage, error: logError } = await supabase
    .from('messages')
    .insert({
      lead_id,
      direction: 'out',
      channel: 'whatsapp',
      body: messageBody,
      message_type: outgoingType,
      media_id: outgoingType === 'image' ? media_id : null,
      wa_message_id: waMessageId,
      status: sendStatus,
      is_automated: false,
    })
    .select()
    .single();

  if (logError) {
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
    upstream: upstreamData,
  });
}
