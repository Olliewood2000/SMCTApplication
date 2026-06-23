import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

const VERIFY_TOKEN = 'smct2024';

function normaliseToUkLocal(phone: string) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('44')) return `0${digits.slice(2)}`;
  if (digits.startsWith('7')) return `0${digits}`;
  return digits;
}

function normaliseToUkIntl(phone: string) {
  const local = normaliseToUkLocal(phone);
  if (!local) return '';
  if (local.startsWith('0')) return `44${local.slice(1)}`;
  return local;
}

function extractInboundMessage(payload: any) {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  if (!message) return null;

  const messageType = message.type || 'text';
  const from = String(message.from || '');
  const waMessageId = message.id || null;
  const mediaId =
    message?.image?.id ||
    message?.video?.id ||
    message?.audio?.id ||
    message?.document?.id ||
    message?.sticker?.id ||
    null;

  let body = message?.text?.body || null;
  if (!body && messageType === 'image') {
    body = message?.image?.caption || null;
  }

  return {
    from,
    body,
    media_id: mediaId,
    message_type: messageType,
    wa_message_id: waMessageId,
  };
}

function buildPreview(body: string | null, messageType: string) {
  if (body && body.trim()) return body.trim().slice(0, 80);
  if (messageType === 'image') return 'Photo received';
  if (messageType === 'video') return 'Video received';
  if (messageType === 'audio') return 'Audio received';
  if (messageType === 'document') return 'Document received';
  return 'New WhatsApp message';
}

async function findLeadByPhone(localPhone: string, intlPhone: string) {
  const lastTen = localPhone.replace(/[^0-9]/g, '').slice(-10);
  const orFilters: string[] = [];
  if (localPhone) orFilters.push(`phone.eq.${localPhone}`);
  if (intlPhone) {
    orFilters.push(`phone.eq.${intlPhone}`);
    orFilters.push(`phone.eq.+${intlPhone}`);
  }
  if (lastTen) orFilters.push(`phone.ilike.%${lastTen}`);

  if (!orFilters.length) return null;

  const { data, error } = await supabase
    .from('leads')
    .select('id, phone, unread_count')
    .or(orFilters.join(','))
    .limit(25);

  if (error || !data?.length) {
    return null;
  }

  const exact = data.find((lead) => normaliseToUkLocal(lead.phone || '') === localPhone);
  return exact || data[0];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'verification failed' }, { status: 403 });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const inbound = extractInboundMessage(payload);
    if (!inbound?.from) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const localPhone = normaliseToUkLocal(inbound.from);
    const intlPhone = normaliseToUkIntl(inbound.from);
    const lead = await findLeadByPhone(localPhone, intlPhone);
    if (!lead?.id) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const nowIso = new Date().toISOString();
    const preview = buildPreview(inbound.body, inbound.message_type);
    const unreadCount = Number(lead.unread_count || 0) + 1;

    await supabase
      .from('leads')
      .update({
        reply_received: true,
        last_message_at: nowIso,
        last_message_preview: preview,
        unread_count: unreadCount,
      })
      .eq('id', lead.id);

    await supabase.from('messages').insert({
      lead_id: lead.id,
      direction: 'in',
      channel: 'whatsapp',
      body: inbound.body,
      wa_message_id: inbound.wa_message_id,
      media_id: inbound.media_id,
      message_type: inbound.message_type,
      is_automated: false,
    });
  } catch (err) {
    console.error('[whatsapp-webhook] failed to process inbound payload', err);
  }

  // Meta only needs a fast 200 acknowledgement.
  return NextResponse.json({ ok: true }, { status: 200 });
}
