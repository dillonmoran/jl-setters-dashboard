# JL Setters — KPI Dashboard

Live KPI dashboard backed by the **JL Setters** Airtable base. Polls every 30 seconds,
no page reload. Time frame picker (Day/7D/30D/Month/3M/6M/All/Custom), and three
sections: Setter Activity, Closer Activity, and SDR (Webinar) Activity — plus an
Overview that rolls the funnel up and shows Calendly bookings and Meta ad spend.

## How it's built

- `public/index.html` — the whole frontend (vanilla HTML/CSS/JS, no build step, no
  framework). Brand colors/fonts live as CSS variables at the top of the `<style>` block.
- `api/data.js` — a Vercel serverless function that calls the Airtable API (setter/SDR/
  closer/deal data) and the Google Sheets API (Calendly bookings only) using server-side
  credentials. The browser never sees any tokens; it only ever talks to `/api/data`.

## Data sources

| Section | Airtable table | Fields tracked |
|---|---|---|
| Setter Activity | `DM Setter EOD` | New Inbounds, New Outbounds, Follow-ups, Calls Pitched, Calls Booked, Hours Worked |
| Closer Activity | `Closer EOD` + `SRF` | Cash Collected, Revenue Generated, Calls Taken, Calls Closed, plus Showed/Closed/Disqualified (formula fields on SRF) |
| SDR Activity (Webinar) | `SDR EOD` | All 16 fields across the Pre-Webinar, Show-Not-Booked, No-Show-Webby, Replay-Watched and Triage funnels |

Field selection was a deliberate, field-by-field decision (not "map what's convenient") —
every EOD table has more fields available (compliance checkboxes like "Inbox Clear"/
"CRM Updated", and free-text reflection notes like "Went Well Today"/"Biggest
Bottleneck") that are intentionally **not** shown. `api/data.js` still fetches full
records, so surfacing one of those later is a frontend-only change — add it to the
relevant `*_FIELDS` config array in `public/index.html`.

Calendly bookings (grouped by event type) and Meta Ads spend (ROAS/cost-per-X) are
unrelated to the Airtable migration and are carried over unchanged, shown on the
Overview only.

## Deploy (no local Node required)

1. **Airtable**: create a Personal Access Token scoped **read-only** to the
   `JL Setters` base (`appYB6z0rRZ4QNbH5`) — `data.records:read`, `schema.bases:read`.
   Create one at [airtable.com/create/tokens](https://airtable.com/create/tokens).
2. **Google service account** (Calendly only): if not already set up, enable the
   Google Sheets API on a Cloud project, create a Service Account with a JSON key, and
   share the Calendly response sheet with its `client_email` (Viewer access).
3. Push this folder to a GitHub repo (already connected: `dillonmoran/jl-setters-dashboard`).
4. In Vercel's **Settings → Environment Variables**, set `AIRTABLE_TOKEN` and
   `GOOGLE_SERVICE_ACCOUNT_KEY` (and optionally `META_ACCESS_TOKEN`).
5. Deploy — Vercel auto-detects `/public` as static and `/api` as a serverless function.

## Local preview

```
npm i -g vercel
vercel dev
```
