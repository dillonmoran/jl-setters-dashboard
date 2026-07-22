# JL Setters — KPI Dashboard

Live KPI dashboard pulling from 3 Google Sheets (Pink, Affiliates, and Agency/Dialler
response sheets). Polls every 30 seconds, no page reload. Time frame picker (All Time
default, floored at 30 Apr 2026, through custom range), per-setter filtering, and three
sections: Setter Activity, Pink Closing Performance, and Agency Dialler Activity.

## How it's built

- `public/index.html` — the whole frontend (vanilla HTML/CSS/JS, no build step, no
  framework). Brand colors/fonts live as CSS variables at the top of the `<style>` block.
- `api/data.js` — a Vercel serverless function that calls the Google Sheets API using a
  service account. The browser never sees the credentials; it only ever talks to `/api/data`.

## Data sources

| Section | Sheet | Notes |
|---|---|---|
| Setter Activity | Pink + Affiliate response sheets | Combined, grouped by individual setter (Poppy, Quique, Luca, Jun) |
| Pink Closing Performance | Pink response sheet | Only Pink currently reports cash/revenue/calls-taken data |
| Agency — Dialler Activity | Dialler EoD Report response sheet | Cold-calling + VSL applicant funnel, separate metric set |

The original "Blue" tracker (`2026 B2C KPI Tracker`) is intentionally excluded — it
stopped receiving submissions in May 2026 and would show permanently stale numbers on
a "live" dashboard. Re-add it later (as its own section, same pattern as the other two)
if that team starts submitting again.

Column parsing in `public/index.html` uses fixed column **positions**, not header text —
Google Form response sheets keep a stable column order, and the header text itself
includes messy characters ("£", "\*", stray "?" marks) that are more fragile to match on.

## Deploy (no local Node required)

1. **Set up the Google service account** (one-time):
   - Go to [console.cloud.google.com](https://console.cloud.google.com/), create/select a project.
   - Enable the **Google Sheets API** for that project.
   - Create a **Service Account** (IAM & Admin → Service Accounts), then add a JSON key
     and download it.
   - Share each of the 3 response sheets (Pink, Affiliates, Dialler EoD Report) with the
     service account's email address (found in the JSON key as `client_email`) — Viewer
     access is enough.
2. Push this folder to a GitHub repo.
3. Go to [vercel.com/new](https://vercel.com/new) and import that repo.
4. In the project's **Settings → Environment Variables**, add:
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — paste the entire downloaded JSON key file's contents
     as one line.
5. Deploy — Vercel auto-detects `/public` as static and `/api` as a serverless function,
   and installs `google-auth-library` from `package.json` automatically.

## Reskinning with the real logo

Swap the `.brand-mark` placeholder block in `index.html` for an `<img>` tag pointing at
`public/logo.png` once the logo file is available. CSS variables under
`/* BRAND TOKENS */` control the black/white palette — everything else reads from those.

## Local preview

No local dev server config is committed. To preview locally with Node installed:

```
npm i -g vercel
vercel dev
```
