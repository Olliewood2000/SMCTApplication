import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '../../../../lib/supabase';

const WHATSAPP_REPLY_WEBHOOK_URL = 'https://primary-production-dac83.up.railway.app/webhook/whatsapp-reply';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

// POST /api/messages/send  { lead_id, text }
// Sends via Railway webhook and logs outbound message.
export async function POST(request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { lead_id, text } = await request.json();

  if (!lead_id || !text) {
    return NextResponse.json({ error: 'missing lead_id or text' }, { status: 400 });
  }

  // Get the lead's phone number
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  // Normalise UK numbers for webhook payload.
  // 07xxx... -> 447xxx...
  let phone = (lead.phone || '').replace(/\s+/g, '');
  if (phone.startsWith('0')) phone = `44${phone.slice(1)}`;
  phone = phone.replace(/[^0-9]/g, '');

  if (!phone) {
    return NextResponse.json({ error: 'lead phone missing' }, { status: 400 });
  }

  let sendStatus = 'sent';
  try {
    const res = await fetch(WHATSAPP_REPLY_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id,
        phone,
        message: text,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('Webhook send failed:', data);
      sendStatus = 'failed';
    }
  } catch (err) {
    console.error('Webhook send error:', err);
    sendStatus = 'failed';
  }

  if (sendStatus === 'failed') {
    return NextResponse.json({ error: 'send failed', sendStatus }, { status: 502 });
  }

  // Log outbound WhatsApp message in Supabase
  const { data: msg, error: msgErr } = await supabase
    .from('messages')
    .insert({
      lead_id,
      direction: 'out',
      channel: 'whatsapp',
      body: text,
      status: sendStatus,
      is_automated: false,
    })
    .select()
    .single();

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  // Update the lead's last-message summary for the inbox list
  await supabase
    .from('leads')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 80),
    })
    .eq('id', lead_id);

  return NextResponse.json({ message: msg, sendStatus });
}
