import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '../../../../lib/supabase';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

// POST /api/leads/update  { id, fields: { status?, band?, dealer?, commission?, asking_price? } }
export async function POST(request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { id, fields } = await request.json();

  if (!id || !fields) {
    return NextResponse.json({ error: 'missing id or fields' }, { status: 400 });
  }

  // Whitelist updatable fields so the client can't write anything it likes.
  const allowed = ['status', 'band', 'dealer', 'commission', 'asking_price'];
  const update = {};
  for (const key of allowed) {
    if (key in fields) update[key] = fields[key];
  }

  const { data, error } = await supabase
    .from('leads')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lead: data });
}
