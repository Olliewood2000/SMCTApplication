-- ============================================================
-- SMCT Leads — Supabase schema
-- Run this in: Supabase dashboard -> SQL Editor -> New query
-- ============================================================

create table leads (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),

  -- Vehicle
  reg          text,
  make         text,
  model        text,
  year         int,
  fuel         text,
  engine       text,
  colour       text,
  mot_status   text,
  mot_expiry   text,
  mileage      int,
  condition    text,
  transmission text,

  -- Contact
  name         text,
  email        text,
  phone        text,
  postcode     text,

  -- Pipeline
  band         text check (band in ('SMCT','Dealer source')),
  status       text default 'New' check (status in (
                 'New','Contacted','Info received','Decision',
                 'Buying','Passed to dealers','Sold to dealer','Dead')),
  asking_price numeric,
  dealer       text,
  commission   numeric,

  -- Automation tracking
  last_action      text,        -- e.g. 'Opener sent', 'Nudge 1 sent'
  last_action_at   timestamptz, -- when the automation last did something
  reply_received   boolean default false
);

-- Helpful index for sorting newest first
create index leads_created_at_idx on leads (created_at desc);

-- ============================================================
-- Row Level Security
-- For a single-user internal dashboard using the service role
-- key from the server, RLS can stay off. If you later add
-- Supabase Auth on the client, enable RLS and add policies.
-- ============================================================
-- alter table leads enable row level security;
