# JL Setters — KPI Dashboard

Live KPI dashboard spanning two eras of the team's daily forms: **Google Sheets**
(through 31 Aug 2026) and **Airtable** (from 1 Sept 2026, the current system of
record). Polls every 30 seconds, no page reload. Time frame picker
(Day/7D/30D/Month/3M/6M/All/Custom), and three sections: Setter Activity, Closer
Activity, and SDR (Webinar) Activity — plus an Overview that rolls the funnel up
across both eras and shows Calendly bookings and Meta ad spend.

## How it's built

- `public/index.html` — the whole frontend (vanilla HTML/CSS/JS, no build step, no
  framework). Brand colors/fonts live as CSS variables at the top of the `<style>` block.
- `api/data.js` — a Vercel serverless function that calls the Google Sheets API
  (historical Blue/Pink/Agency data + Calendly) and the Airtable API (current
  setter/SDR/closer/deal data) using server-side credentials. The browser never
  sees any tokens; it only ever talks to `/api/data`.

## The September 2026 cutover

`CUTOVER = '2026-09-01'` in `public/index.html` is the single source of truth for
which system a given date reads from: strictly before it comes from Google Sheets,
on/after it comes from Airtable. Each of Setter/Closer/SDR Activity renders **two
separate, clearly labeled sub-sections** when the selected period spans the
cutover — "Historical — Google Sheets" and "Airtable — from 1 Sept 2026" — rather
than forcing the two schemas into one shared metric set, since the field names and
granularity genuinely differ between the old wide-format sheets and the new
Airtable EOD tables. The Overview page is the exception: it sums the two eras
together for the concepts that really are the same thing regardless of source
(Booked/Taken/Showed/Closed/Cash/Revenue), so leadership gets one continuous
all-time number there.

## Data sources

| Section | Historical (pre-Sept, Google Sheets) | Current (from Sept, Airtable) |
|---|---|---|
| Setter Activity | Blue/Pink "Daily Submissions" sheets, setter-side columns | `DM Setter EOD`: New Inbounds, New Outbounds, Follow-ups, Calls Pitched, Calls Booked, Hours Worked |
| Closer Activity | Blue/Pink sheets, closer-side columns | `Closer EOD` (Cash Collected, Revenue Generated, Calls Taken, Calls Closed) + `SRF` (Showed/Closed/Disqualified formula fields) |
| SDR Activity (Webinar) | Agency "Dialler EoD" sheet (Cold + VSL funnel, org-wide only — the old sheet had no per-rep breakdown) | `SDR EOD`: all 16 fields across Pre-Webinar, Show-Not-Booked, No-Show-Webby, Replay-Watched, and Triage funnels, broken out per SDR |

Airtable field selection was a deliberate, field-by-field decision (not "map
what's convenient") — every EOD table has more fields available (compliance
checkboxes like "Inbox Clear"/"CRM Updated", and free-text reflection notes like
"Went Well Today"/"Biggest Bottleneck") that are intentionally **not** shown.
`api/data.js` still fetches full Airtable records, so surfacing one of those later
is a frontend-only change — add it to the relevant `*_FIELDS` config array in
`public/index.html`.

Calendly bookings (grouped by event type) and Meta Ads spend (ROAS/cost-per-X) are
unrelated to the Sheets→Airtable migration and span all time unchanged, shown on
the Overview only.

## Deploy (no local Node required)

1. **Google service account**: enable the Google Sheets API on a Cloud project,
   create a Service Account with a JSON key, and share the Blue, Pink, Agency, and
   Calendly response sheets with its `client_email` (Viewer access).
2. **Airtable**: create a Personal Access Token scoped **read-only** to the
   `JL Setters` base (`appYB6z0rRZ4QNbH5`) — `data.records:read`, `schema.bases:read`.
   Create one at [airtable.com/create/tokens](https://airtable.com/create/tokens).
3. Push this folder to a GitHub repo (already connected: `dillonmoran/jl-setters-dashboard`).
4. In Vercel's **Settings → Environment Variables**, set `GOOGLE_SERVICE_ACCOUNT_KEY`
   and `AIRTABLE_TOKEN` (and optionally `META_ACCESS_TOKEN`).
5. Deploy — Vercel auto-detects `/public` as static and `/api` as a serverless function.

## Local preview

```
npm i -g vercel
vercel dev
```
