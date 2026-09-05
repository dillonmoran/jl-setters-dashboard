// Vercel serverless function — proxies Airtable (JL Setters base) + Google Sheets
// (Calendly) + Meta Ads so credentials never reach the browser.
// Required env vars (set in Vercel Project Settings -> Environment Variables):
//   AIRTABLE_TOKEN               Personal Access Token, read-only, scoped to the
//                                 JL Setters base (data.records:read, schema.bases:read)
//   GOOGLE_SERVICE_ACCOUNT_KEY   full JSON key for a service account with Viewer
//                                 access to the Calendly response sheet
// Optional:
//   META_ACCESS_TOKEN            Meta Marketing API token (ads_read) — the ad
//                                 spend section shows "not connected" without it

const { JWT } = require('google-auth-library');

const AIRTABLE_BASE_ID = 'appYB6z0rRZ4QNbH5'; // "JL Setters" base
const AIRTABLE_TABLES = {
  dmSetterEod: 'tblzryPvy2w0JXGZm', // DM Setter EOD
  sdrEod: 'tbl4pRg9CyiyDTk0p',      // SDR EOD (webinar-side)
  closerEod: 'tblxticPqlNq7vx0i',   // Closer EOD
  srf: 'tbl3Maf0bCgzFWeEP',         // Sales Record Form (Showed/Closed/Disqualified)
};

// Calendly bookings sheet — unrelated to the Airtable migration, left as-is.
const CALENDLY_SOURCE = { id: '1Nh7WHYMd2QEJrvVNJ-aTOQxXUufbjkJ-Z2Hoo8ZFKxg', range: 'A1:Z5000' };

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
    const [dmSetterEod, sdrEod, closerEod, srf] = await Promise.all([
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.dmSetterEod),
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.sdrEod),
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.closerEod),
      fetchAirtableTable(airtableToken, AIRTABLE_TABLES.srf),
    ]);

    let calendly = [];
    try {
      const client = getGoogleClient();
      calendly = await fetchSheet(client, CALENDLY_SOURCE.id, CALENDLY_SOURCE.range);
    } catch (calErr) {
      calendly = [];
    }

    let adSpend = { connected: false, rows: [] };
    try {
      adSpend = await fetchMetaSpend();
    } catch (metaErr) {
      adSpend = { connected: false, rows: [], error: metaErr.message };
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ dmSetterEod, sdrEod, closerEod, srf, calendly, adSpend, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
