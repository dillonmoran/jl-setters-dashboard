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
the Overview only — **except** the webinar-booking event type, which is folded
into Overview's "Calls Booked" (see below).

## Webinar-sourced bookings (Calendly, no DM Setter)

Some calls are booked directly by webinar attendees on Calendly, with no DM
Setter involved — so they never show up in DM Setter EOD's "Calls Booked"
field, which undercounts Calls Booked relative to Calls Taken (closers do take
these calls; nobody logs them as booked anywhere else). `WEBINAR_CALENDLY_EVENT_TYPES`
in `public/index.html` (currently just `"JL Setters Strategy Call"`, confirmed
with Dillon) is folded into Overview's Calls Booked total and funnel, with a
hint on both the funnel and the Calendly Bookings table explaining the overlap
so it doesn't read as a duplicate. If another webinar-booking event type shows
up later, add it to that array — no other code change needed. Note this is
Overview-only: it isn't attributed to any DM Setter, so it deliberately doesn't
appear in DM Setter Activity's per-rep Calls Booked numbers.

These bookings land in the same Calendly response sheet
(`1Nh7WHYMd2QEJrvVNJ-aTOQxXUufbjkJ-Z2Hoo8ZFKxg`, `SHEET_SOURCES.calendly` in
`api/data.js`) as every other event type already pulled into the dashboard, via
whatever sync already populates that sheet — so no new automation is needed to
count them; the Discord notification is just a heads-up to the team, not the
system of record.

### Deduplicating repeat/rescheduled bookings

The raw Calendly export logs every booking event, including reschedules — the
same person can appear several times for the same event type (confirmed in
the live data: "Aj Aj"/"AJ AJ" booked "JL Setters Strategy Call" 3 times in
one day, and "Alex Lu"/"Alex Lou" turned out to be the same person on
different days). Counting raw rows overcounted "new" bookings — e.g. 27 raw
rows landed on Aug 30th, but only 21 were actually distinct people.

`dedupeCalendlyByPerson` (`public/index.html`) collapses this, applied once in
`fetchData` right after parsing, so every downstream use of `state.calendly`
(the Calls Booked figure, the Calendly Bookings table, the footer count) is
already deduplicated — nothing else needed to change. Two rows are the same
person if they share an exact email (cheap, reliable — Calendly requires one)
or a fuzzy-matched name (same `nameSimilarity`/threshold as AOV client
matching). Matching is scoped **per event type**: the same person booking a
Discovery Call and, separately, a Strategy Call is two real distinct bookings,
not a duplicate. Whichever row has the earliest date becomes that person's
counted booking date — a reschedule moves an appointment, it isn't a new lead.

## Roster — who shows up where

The nav is flat (no "Webinar"/"Non-Webinar" grouping): DM Setter Activity, Closer
Activity, SDR Activity. Who gets a card on each of those is driven by the **Role**
field on the Airtable `Sales Team` table (`ROLE_BY_VIEW` in `public/index.html`
maps the view to the exact Role value — `"DM Setter"`, `"Closer"`, `"SDR"`), not by
who happens to have submitted a form. `api/data.js` fetches the whole Sales Team
table fresh on every load, so adding a new rep there with a Role is enough for
them to appear immediately — with zero stats until their first EOD submission —
no code change needed. Setter Activity also shows a derived **Pitch → Booking %**
(Calls Booked ÷ Calls Pitched) per rep and org-wide, since that isn't a raw
Airtable field.

## AOV (Average Order Value) per rep

A closed deal often spans more than one SRF row: a "Deposit" or "Closed/Won" row
at close, then a separate "Remainder Collection (no call)" row later when the
rest of the payment comes in. Remainder rows carry no Setter/SDR (and are
submitted well after the original call), so AOV is computed with a two-pass
match in `public/index.html` (`buildAovClientTotals`):

1. Group **every** SRF row (all-time, not clamped to the Sept cutover — a
   deposit and its remainder can straddle any date boundary) by **Client Full
   Name**, using fuzzy matching (`clusterClientNames`/`nameSimilarity` —
   Levenshtein edit distance normalized by name length, threshold 0.82, names
   under 4 characters excluded from fuzzy matching). Client names are
   hand-typed by different reps on different rows, so exact matching missed
   real matches: "Eros llanes" vs "Eros llans" scores ~0.91 and now merges.
   The threshold is picked to still keep genuinely different names apart —
   "John" vs "John Ellis" scores ~0.4 and stays separate. This is a
   similarity heuristic, not a guarantee: if two different clients happen to
   have very similar names, double-check the AOV numbers against Airtable
   directly rather than trusting the merge blindly.
2. Cash Collected sums across all of a client's rows. Closer and Setter/SDR
   attribution comes only from whichever row has Call Outcome "Deposit" or
   "Closed/Won" — a client with no such row (never actually closed) is
   excluded, so a stray £0 disqualified lead can't dilute the average.

AOV is then `mean(client total cash)` per rep, shown as "AOV (All-Time)" on
every rep's card in Setter/Closer/SDR Activity, plus an org-wide "AOV (All
Clients, All-Time)" hero card on each of those three views. It's deliberately
**not** period-scoped like the rest of the dashboard (a deposit this month and
its remainder next month are still one order), so it won't move when you
switch the Day/Week/Month picker.

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
