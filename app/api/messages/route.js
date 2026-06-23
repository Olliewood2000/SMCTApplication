import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '../../../lib/supabase';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

// GET /api/messages?lead_id=123
// Returns the full conversation for one lead, oldest first.
export async function GET(request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get('lead_id');

  if (!leadId) {
    return NextResponse.json({ error: 'missing lead_id' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mark this lead's inbound messages as read (reset unread counter)
  await supabase.from('leads').update({ unread_count: 0 }).eq('id', leadId);

  return NextResponse.json({ messages: data });
}
