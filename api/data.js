// Vercel serverless function — proxies Google Sheets + Meta Ads so the
// credentials never reach the browser.
// Required env var:
//   GOOGLE_SERVICE_ACCOUNT_KEY   full JSON key for a service account with
//                                Viewer access to the 4 sheets below.
// Optional env var (ad spend section shows "not connected" without it):
//   META_ACCESS_TOKEN            long-lived (or System User) Meta Marketing
//                                API token with ads_read on the 3 accounts below.

const { JWT } = require('google-auth-library');

const SOURCES = {
  pink: { id: '1zGKnIGA5BARnxx2bqtkzo_9tpNF3JpJkaq6JSfuNNvE', range: 'A1:Z2000' },
  affiliates: { id: '1cTZnqu1TyQvQ5LvGwls0slKCQ4JLoFWuYD21vXGp2ug', range: 'A1:Z2000' },
  agency: { id: '177Mc00EUvTzrx52ZbndyrWaYbnHl6EF3G04cOn5vc8E', range: 'A1:Z2000' },
  // Blue side (Jack + Lewis): setter-side + closer-side data for all 6 brand/offer
  // blocks lives in the "Daily Submissions" tab of this sheet.
  blue: { id: '1U0RvCd2ckuwBQDiPzCBTQ6VJW7ulwYKOjLlhHiCx6dM', range: 'Daily Submissions!A1:AL2000' },
  calendly: { id: '1Nh7WHYMd2QEJrvVNJ-aTOQxXUufbjkJ-Z2Hoo8ZFKxg', range: 'A1:Z5000' },
};

// Ad accounts confirmed live under the JLSetters3 business: JG (Jack), LS (Lewis),
// JL Agency. Add more here as new accounts (Poppy, affiliates) get onboarded —
// this is just a flat list, no per-account config needed.
const META_AD_ACCOUNTS = ['1487613569508490', '1676143043837220', '1446377807296882'];
const RANGE_FLOOR = '2026-04-30';

let cachedClient = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY environment variable on the server.');
  const creds = JSON.parse(raw);
  cachedClient = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return cachedClient;
}

async function fetchSheet(client, spreadsheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await client.request({ url });
  return res.data.values || [];
}

async function fetchMetaAccountSpend(accountId, token, since, until) {
  const rows = [];
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_name',
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
  const perAccount = await Promise.all(
    META_AD_ACCOUNTS.map(id => fetchMetaAccountSpend(id, token, RANGE_FLOOR, until))
  );
  return { connected: true, rows: perAccount.flat() };
}

module.exports = async (req, res) => {
  try {
    const client = getClient();
    const [pink, affiliates, agency, blue, calendly] = await Promise.all([
      fetchSheet(client, SOURCES.pink.id, SOURCES.pink.range),
      fetchSheet(client, SOURCES.affiliates.id, SOURCES.affiliates.range),
      fetchSheet(client, SOURCES.agency.id, SOURCES.agency.range),
      fetchSheet(client, SOURCES.blue.id, SOURCES.blue.range),
      fetchSheet(client, SOURCES.calendly.id, SOURCES.calendly.range),
    ]);

    let adSpend = { connected: false, rows: [] };
    try {
      adSpend = await fetchMetaSpend();
    } catch (metaErr) {
      adSpend = { connected: false, rows: [], error: metaErr.message };
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ pink, affiliates, agency, blue, calendly, adSpend, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
