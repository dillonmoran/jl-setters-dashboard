// Vercel serverless function — proxies Google Sheets (historical, pre-Sept 2026
// data + Calendly) + Airtable (live, Sept 2026 onwards) + Meta Ads so credentials
// never reach the browser.
// Required env vars (set in Vercel Project Settings -> Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_KEY   full JSON key for a service account with Viewer
//                                 access to the Blue/Pink/Agency/Calendly sheets
//   AIRTABLE_TOKEN               Personal Access Token, read-only, scoped to the
//                                 JL Setters base (data.records:read, schema.bases:read)
// Optional:
//   META_ACCESS_TOKEN            Meta Marketing API token (ads_read) — the ad
//                                 spend section shows "not connected" without it

const { JWT } = require('google-auth-library');

// Historical sheets — the team's setter/SDR/closer forms lived here through
// August 2026, before the move to Airtable. Kept so past months stay visible.
const SHEET_SOURCES = {
  blue: { id: '1U0RvCd2ckuwBQDiPzCBTQ6VJW7ulwYKOjLlhHiCx6dM', range: 'Daily Submissions!A1:AL2000' },
  pink: { id: '1zGKnIGA5BARnxx2bqtkzo_9tpNF3JpJkaq6JSfuNNvE', range: 'A1:Z2000' },
  agency: { id: '177Mc00EUvTzrx52ZbndyrWaYbnHl6EF3G04cOn5vc8E', range: 'A1:Z2000' },
  calendly: { id: '1Nh7WHYMd2QEJrvVNJ-aTOQxXUufbjkJ-Z2Hoo8ZFKxg', range: 'A1:Z5000' },
};

const AIRTABLE_BASE_ID = 'appYB6z0rRZ4QNbH5'; // "JL Setters" base
const AIRTABLE_TABLES = {
  dmSetterEod: 'tblzryPvy2w0JXGZm', // DM Setter EOD
  sdrEod: 'tbl4pRg9CyiyDTk0p',      // SDR EOD (webinar-side)
  closerEod: 'tblxticPqlNq7vx0i',   // Closer EOD
  srf: 'tbl3Maf0bCgzFWeEP',         // Sales Record Form (Showed/Closed/Disqualified)
};

// Ad accounts confirmed live under the JLSetters3 business: JG (Jack), LS (Lewis), JL Agency.
const META_AD_ACCOUNTS = ['1487613569508490', '1676143043837220', '1446377807296882'];

let cachedGoogleClient = null;
function getGoogleClient() {
  if (cachedGoogleClient) return cachedGoogleClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable on the server.');
  const creds = JSON.parse(raw);
  cachedGoogleClient = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return cachedGoogleClient;
}
async function fetchSheet(client, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await client.request({ url });
  return res.data.values || [];
}

async function fetchAirtableTable(token, tableId) {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const airtableRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!airtableRes.ok) {
      const text = await airtableRes.text();
      throw new Error(`Airtable responded ${airtableRes.status} for table ${tableId}: ${text}`);
    }
    const data = await airtableRes.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function fetchMetaAccountSpend(accountId, token, since, until) {
  const rows = [];
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_name,spend',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    limit: '500',
    access_token: token,
  });
  let url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?${params.toString()}`;
  while (url) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) throw new Error(`Meta API (${accountId}): ${json.error.message}`);
    (json.data || []).forEach(row => {
      rows.push({ campaign: row.campaign_name, date: row.date_start, spend: parseFloat(row.spend || '0') || 0 });
    });
    url = json.paging && json.paging.next ? json.paging.next : null;
  }
  return rows;
}
async function fetchMetaSpend() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { connected: false, rows: [] };
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10); // trailing 12 months
  const perAccount = await Promise.all(
    META_AD_ACCOUNTS.map(id => fetchMetaAccountSpend(id, token, since, until))
  );
  return { connected: true, rows: perAccount.flat() };
}

module.exports = async (req, res) => {
  const airtableToken = process.env.AIRTABLE_TOKEN;
  if (!airtableToken) {
    res.status(500).json({ error: 'Missing AIRTABLE_TOKEN environment variable on the server.' });
    return;
  }

  try {
    const airtablePromise = Promise.all([
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.dmSetterEod),
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.sdrEod),
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.closerEod),
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.srf),
    ]);

    let blue = [], pink = [], agency = [], calendly = [];
    try {
      const client = getGoogleClient();
      [blue, pink, agency, calendly] = await Promise.all([
        fetchSheet(client, SHEET_SOURCES.blue.id, SHEET_SOURCES.blue.range),
        fetchSheet(client, SHEET_SOURCES.pink.id, SHEET_SOURCES.pink.range),
        fetchSheet(client, SHEET_SOURCES.agency.id, SHEET_SOURCES.agency.range),
        fetchSheet(client, SHEET_SOURCES.calendly.id, SHEET_SOURCES.calendly.range),
      ]);
    } catch (sheetsErr) {
      blue = []; pink = []; agency = []; calendly = [];
    }

    const [dmSetterEod, sdrEod, closerEod, srf] = await airtablePromise;

    let adSpend = { connected: false, rows: [] };
    try {
      adSpend = await fetchMetaSpend();
    } catch (metaErr) {
      adSpend = { connected: false, rows: [], error: metaErr.message };
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      blue, pink, agency, calendly,
      dmSetterEod, sdrEod, closerEod, srf,
      adSpend, fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
