import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '../../../lib/supabase';

function authed() {
  const c = cookies().get('smct_auth');
  return c && c.value === process.env.DASHBOARD_PASSWORD;
}

// GET /api/leads?band=SMCT|Dealer source|all
export async function GET(request) {
  if (!authed()) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const band = searchParams.get('band');

  let query = supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  if (band && band !== 'all') {
    query = query.eq('band', band);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leads: data });
}
