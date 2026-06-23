import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client using the service role key.
// This file must only ever be imported in server code (API routes),
// never in client components, because the service role key is secret.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// The pipeline statuses, in order. Single source of truth.
export const STATUSES = [
  'New',
  'Contacted',
  'Info received',
  'Decision',
  'Buying',
  'Passed to dealers',
  'Sold to dealer',
  'Dead',
];
