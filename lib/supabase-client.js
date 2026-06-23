'use client';

import { createClient } from '@supabase/supabase-js';

let browserSupabase = null;

export function getBrowserSupabase() {
  if (browserSupabase) return browserSupabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  browserSupabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return browserSupabase;
}
