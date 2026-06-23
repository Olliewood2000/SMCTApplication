# SMCT Leads Dashboard

A simple lead dashboard for Sell My Cars Today. Replaces Airtable.
Built with Next.js + Supabase. Works on phone and laptop.

## What it does (v1)

- Lists all leads, newest first
- Filter by band: All / SMCT / Dealer source
- Tap a lead to expand full details
- Change status from a dropdown
- One-tap "Push to dealer" (sets band = Dealer source, status = Passed to dealers)
- Call / Email buttons
- Password-protected

---

## Setup — do this once

### 1. Create the Supabase table
- Go to your Supabase project -> SQL Editor -> New query
- Paste the contents of `supabase-schema.sql` and run it
- This creates the `leads` table

### 2. Get your Supabase keys
- Supabase -> Project Settings -> API
- Copy the **Project URL** and the **service_role** secret key

### 3. Configure environment
- Copy `.env.local.example` to `.env.local`
- Fill in:
  - `NEXT_PUBLIC_SUPABASE_URL` = your project URL
  - `SUPABASE_SERVICE_ROLE_KEY` = the service_role key
  - `DASHBOARD_PASSWORD` = any password you choose

### 4. Install and run
```bash
npm install
npm run dev
```
Open http://localhost:3000 and log in with your password.

### 5. Deploy (so you can use it on your phone)
- Push this folder to a GitHub repo
- Import it into Vercel (vercel.com)
- In Vercel project settings -> Environment Variables, add the same
  three variables from `.env.local`
- Deploy. You get a URL you can open on any device.

---

## Connect n8n (switch from Airtable to Supabase)

In your existing n8n workflow, replace the Airtable node:

1. Delete the Airtable "Create a Record" node
2. Add a **Supabase** node -> operation **Create a row**
3. Credentials: use your Supabase URL + the **service_role** key
4. Table: `leads`
5. Map the fields (note: column names are lowercase with underscores):

| Supabase column | Value from parser            |
|-----------------|------------------------------|
| reg             | `{{ $json.reg }}`            |
| make            | `{{ $json.make }}`           |
| model           | `{{ $json.model }}`          |
| year            | `{{ $json.year }}`           |
| fuel            | `{{ $json.fuel }}`           |
| engine          | `{{ $json.engine }}`         |
| colour          | `{{ $json.colour }}`         |
| mot_status      | `{{ $json.motStatus }}`      |
| mot_expiry      | `{{ $json.motExpiry }}`      |
| mileage         | `{{ $json.mileage }}`        |
| condition       | `{{ $json.condition }}`      |
| transmission    | `{{ $json.transmission }}`   |
| name            | `{{ $json.name }}`           |
| email           | `{{ $json.email }}`          |
| phone           | `{{ $json.phone }}`          |
| postcode        | `{{ $json.postcode }}`       |
| band            | `{{ $json.band }}`           |
| status          | `New`                        |

6. Connect BOTH Switch outputs into this one Supabase node (same as before)
7. Test — a row should appear in Supabase and show up in the dashboard

---

## Notes for later (not in v1)

- Photo handling: use a Supabase Storage bucket, store the file URL on the lead
- Automation timeline: the `last_action`, `last_action_at`, `reply_received`
  columns are already in the schema — n8n can update these as the follow-up
  sequence runs, then the dashboard can show a proper history
- Proper auth: swap the password gate for Supabase Auth when you want
  multiple users (e.g. your business partner)
- Commission reporting: add a totals view filtered by Sold to dealer
