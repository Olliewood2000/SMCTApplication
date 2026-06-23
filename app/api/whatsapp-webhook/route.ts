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
  const items: Array<{
    from: string;
    body: string | null;
    media_id: string | null;
    message_type: string;
    wa_message_id: string | null;
  }> = [];

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const message of messages) {
        const messageType = message?.type || 'text';
        const from = String(message?.from || '');
        if (!from) continue;

        const waMessageId = message?.id || null;
        const mediaId =
          message?.image?.id ||
          message?.video?.id ||
          message?.audio?.id ||
          message?.document?.id ||
          message?.sticker?.id ||
          null;

        const body =
          message?.text?.body ||
          message?.image?.caption ||
          message?.button?.text ||
          message?.interactive?.button_reply?.title ||
          message?.interactive?.list_reply?.title ||
          null;

        items.push({
          from,
          body: body ? String(body) : null,
          media_id: mediaId ? String(mediaId) : null,
          message_type: String(messageType),
          wa_message_id: waMessageId ? String(waMessageId) : null,
        });
      }
    }
  }

  return items;
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
  const targetLocal = normaliseToUkLocal(localPhone);
  const targetIntl = normaliseToUkIntl(intlPhone || localPhone);
  const targetLastTen = targetLocal.slice(-10);
  if (!targetLocal && !targetIntl) return null;

  const { data, error } = await supabase
    .from('leads')
    .select('id, phone, unread_count')
    .not('phone', 'is', null)
    .limit(5000);

  if (error || !data?.length) {
    console.warn('[whatsapp-webhook] failed to load leads for phone match', {
      error: error?.message || null,
    });
    return null;
  }

  let fallback: any = null;
  for (const lead of data) {
    const leadLocal = normaliseToUkLocal(lead.phone || '');
    const leadIntl = normaliseToUkIntl(lead.phone || '');
    if (!leadLocal && !leadIntl) continue;

    if (leadLocal === targetLocal || leadIntl === targetIntl) {
      return lead;
    }

    if (!fallback && targetLastTen && leadLocal.slice(-10) === targetLastTen) {
      fallback = lead;
    }
  }

  return fallback;
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
    const inboundMessages = extractInboundMessage(payload);
    if (!inboundMessages.length) {
      console.info('[whatsapp-webhook] no inbound messages in payload');
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    for (const inbound of inboundMessages) {
      const localPhone = normaliseToUkLocal(inbound.from);
      const intlPhone = normaliseToUkIntl(inbound.from);
      const lead = await findLeadByPhone(localPhone, intlPhone);
      if (!lead?.id) {
        console.warn('[whatsapp-webhook] no lead matched inbound phone', {
          from: inbound.from,
          localPhone,
          intlPhone,
          waMessageId: inbound.wa_message_id,
        });
        continue;
      }

      const nowIso = new Date().toISOString();
      const preview = buildPreview(inbound.body, inbound.message_type);
      const unreadCount = Number(lead.unread_count || 0) + 1;

      const { error: leadUpdateError } = await supabase
        .from('leads')
        .update({
          reply_received: true,
          last_message_at: nowIso,
          last_message_preview: preview,
          unread_count: unreadCount,
        })
        .eq('id', lead.id);

      if (leadUpdateError) {
        console.error('[whatsapp-webhook] failed to update lead summary', {
          leadId: lead.id,
          error: leadUpdateError.message,
        });
      }

      const insertPayload: Record<string, unknown> = {
        lead_id: lead.id,
        direction: 'in',
        channel: 'whatsapp',
        body: inbound.body,
        wa_message_id: inbound.wa_message_id,
        message_type: inbound.message_type,
        is_automated: false,
      };
      if (inbound.media_id) {
        insertPayload.media_id = inbound.media_id;
      }

      const { error: insertError } = await supabase.from('messages').insert(insertPayload);
      if (insertError && /media_id/i.test(insertError.message) && /column/i.test(insertError.message)) {
        const { media_id: _ignore, ...withoutMedia } = insertPayload;
        const retry = await supabase.from('messages').insert(withoutMedia);
        if (retry.error) {
          console.error('[whatsapp-webhook] failed to insert inbound message (fallback failed)', {
            leadId: lead.id,
            error: retry.error.message,
            waMessageId: inbound.wa_message_id,
          });
        } else {
          console.info('[whatsapp-webhook] inbound message inserted (without media_id fallback)', {
            leadId: lead.id,
            waMessageId: inbound.wa_message_id,
          });
        }
      } else if (insertError) {
        console.error('[whatsapp-webhook] failed to insert inbound message', {
          leadId: lead.id,
          error: insertError.message,
          waMessageId: inbound.wa_message_id,
        });
      } else {
        console.info('[whatsapp-webhook] inbound message inserted', {
          leadId: lead.id,
          waMessageId: inbound.wa_message_id,
          type: inbound.message_type,
        });
      }
    }
  } catch (err) {
    console.error('[whatsapp-webhook] failed to process inbound payload', err);
  }

  // Meta only needs a fast 200 acknowledgement.
  return NextResponse.json({ ok: true }, { status: 200 });
}
