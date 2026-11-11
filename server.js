// KIN Sandbox Checkout: tiny zero-dependency server.
//
// Responsibilities:
//  - serve the static page and data files,
//  - serve /config.js generated from .env, so the page's sandbox banner and
//    the PayPal SDK both read the SAME config value (sandbox mode can never
//    be silently off, and the client ID is never hard-coded in HTML),
//  - POST /api/orders            -> create a PayPal sandbox order (Orders API v2)
//  - POST /api/orders/:id/capture -> server-side capture; only a verified
//    COMPLETED capture from PayPal is returned as success.
//  - POST /api/explain           -> live AI explainer (OpenAI, server-side
//    only). The ONLY fact source is the listing object in data/listings.json;
//    the system prompt comes from docs/AI-EXPLAINER-PROMPT.md. Responses
//    separate facts used from flagged assumptions. With no AI_API_KEY (or a
//    provider failure) it returns an honest error with NO generated text, and
//    the page falls back to its labeled pre-generated text.
//
// Credentials come from .env only (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET /
// PAYPAL_ENV / AI_API_KEY). Secrets are used server-side only and are never
// sent to the browser. If a secret is missing or still the placeholder, the
// affected endpoints fail loudly with a "not configured" error instead of
// faking a result.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

// --- minimal .env loader (no dependencies) ---
function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
const env = loadEnv(path.join(ROOT, '.env'));
const PAYPAL_ENV = (env.PAYPAL_ENV || 'sandbox').toLowerCase();
const CLIENT_ID = env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = env.PAYPAL_CLIENT_SECRET || '';
const SECRET_PLACEHOLDERS = ['', 'PENDING-SECURE-TRANSFER', 'your-sandbox-client-secret-here'];
const secretConfigured = !SECRET_PLACEHOLDERS.includes(CLIENT_SECRET);
const API_BASE = PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const listingsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'listings.json'), 'utf8'));
const listingsById = Object.fromEntries(listingsData.listings.map((l) => [l.id, l]));

// --- AI explainer config (OpenAI; key server-side only, from .env) ---
const AI_API_KEY = (env.AI_API_KEY || '').trim();
const AI_MODEL = (env.AI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
// Optional override (e.g. a proxy or a test stub). Defaults to OpenAI.
const AI_API_BASE = ((env.AI_API_BASE || 'https://api.openai.com/v1').trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
const aiConfigured = AI_API_KEY.length > 0;
const AI_TIMEOUT_MS = 20000;

// The listing fields are the ONLY facts the explainer may use. factsUsed in
// a model response is filtered against this whitelist before it is served.
const LISTING_FIELDS = ['id', 'category', 'title', 'covers', 'amount_usd', 'household', 'metro', 'urgency', 'funded_pct', 'label'];

// System prompt source of truth: docs/AI-EXPLAINER-PROMPT.md, the section
// under "## System prompt (paste-ready)". If it cannot be extracted, the
// explainer reports itself not configured rather than inventing a prompt.
function loadExplainerSystemPrompt() {
  try {
    const md = fs.readFileSync(path.join(ROOT, 'docs', 'AI-EXPLAINER-PROMPT.md'), 'utf8');
    const start = md.indexOf('## System prompt (paste-ready)');
    if (start === -1) return null;
    const rest = md.slice(start).split(/\r?\n/).slice(1).join('\n');
    const end = rest.indexOf('\n## ');
    const text = (end === -1 ? rest : rest.slice(0, end)).trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    return null;
  }
}
const EXPLAINER_SYSTEM_PROMPT = loadExplainerSystemPrompt();

// Machine contract appended to the human system prompt above. It makes the
// facts-vs-assumptions split structural (returned as data), not cosmetic.
const EXPLAINER_CONTRACT = [
  'You will receive one listing as JSON. Its fields are the only listing facts you may use, in addition to the KIN trust facts in the system prompt above.',
  'Respond with ONLY a JSON object, no markdown, of the form: {"text": string, "factsUsed": [field names], "assumptions": [strings]}.',
  'factsUsed must list only field names from this set, naming the fields your answer actually relied on: ' + LISTING_FIELDS.join(', ') + '.',
  'assumptions must list anything in your answer that is NOT directly stated in the listing fields or the KIN trust facts, phrased as the assumption itself. If there are none, use an empty array. Never present an assumption as a fact.',
  'If the user asks a question: answer only from the listing fields and the KIN trust facts. If the answer is not in them, say plainly in "text" that this is not something the listing states, invent nothing, and leave "assumptions" empty.',
  'If no question is asked: write the 3-to-5 sentence explanation described in the system prompt, ending with the required sentence.',
].join('\n');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function secretNotConfigured(res) {
  return sendJson(res, 503, {
    error: 'sandbox_secret_not_configured',
    message:
      'PayPal sandbox secret is not configured on the server yet (PAYPAL_CLIENT_SECRET is ' +
      'missing or still a placeholder in .env). Orders cannot be created or captured, and no ' +
      'success is shown, until the real sandbox secret is in place. No payment was attempted.',
  });
}

// One immediate retry on a thrown network error. Observed Nov 6, 2026: the
// second of two sequential calls in this process intermittently fails with a
// socket error ("other side closed") when its connection is reused, while a
// fresh attempt succeeds. Retrying once is safe here: order creation carries
// a PayPal-Request-Id (below), and capture success is only ever reported
// after PayPal's own COMPLETED response is verified.
async function fetchWithRetry(url, options) {
  try {
    return await fetch(url, options);
  } catch (e) {
    return await fetch(url, options);
  }
}

async function paypalAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const r = await fetchWithRetry(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal OAuth failed: HTTP ${r.status}`);
  const j = await r.json();
  return j.access_token;
}

async function handleCreateOrder(req, res) {
  if (!secretConfigured) return secretNotConfigured(res);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const { listingId } = JSON.parse(body || '{}');
      const listing = listingsById[listingId];
      if (!listing) return sendJson(res, 400, { error: 'unknown_listing', message: `No listing with id ${listingId}.` });
      const token = await paypalAccessToken();
      const r = await fetchWithRetry(`${API_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `kin-create-${listing.id}-${Date.now()}` },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: listing.id,
              description: `KIN sandbox demonstration: ${listing.title} (fictional example, no real donation)`,
              custom_id: listing.id,
              amount: { currency_code: 'USD', value: Number(listing.amount_usd).toFixed(2) },
            },
          ],
        }),
      });
      const j = await r.json();
      if (!r.ok) return sendJson(res, 502, { error: 'paypal_create_failed', message: `PayPal returned HTTP ${r.status} creating the order.`, details: j });
      return sendJson(res, 200, { id: j.id, status: j.status });
    } catch (e) {
      return sendJson(res, 500, { error: 'create_order_error', message: String(e && e.message || e) });
    }
  });
}

async function handleCaptureOrder(res, orderId) {
  if (!secretConfigured) return secretNotConfigured(res);
  try {
    const token = await paypalAccessToken();
    const r = await fetchWithRetry(`${API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const j = await r.json();
    if (!r.ok) return sendJson(res, 502, { error: 'paypal_capture_failed', message: `PayPal returned HTTP ${r.status} capturing the order.`, details: j });
    const capture = j.purchase_units?.[0]?.payments?.captures?.[0];
    // Payment approval alone is NOT completion: only a verified COMPLETED
    // capture from PayPal counts as a successful transaction.
    if (j.status !== 'COMPLETED' || !capture || capture.status !== 'COMPLETED') {
      return sendJson(res, 502, {
        error: 'capture_not_completed',
        message: `PayPal did not return a completed capture (order status: ${j.status || 'unknown'}). No success is shown.`,
      });
    }
    return sendJson(res, 200, {
      verified: true,
      environment: PAYPAL_ENV,
      orderId: j.id,
      transactionId: capture.id,
      captureStatus: capture.status,
      amount: capture.amount?.value,
      currency: capture.amount?.currency_code,
      listingId: j.purchase_units?.[0]?.custom_id || j.purchase_units?.[0]?.reference_id || null,
    });
  } catch (e) {
    return sendJson(res, 500, { error: 'capture_order_error', message: String(e && e.message || e) });
  }
}

function explainerNotConfigured(res) {
  return sendJson(res, 503, {
    error: 'explainer_not_configured',
    message:
      'The live AI explainer is not configured on the server yet (AI_API_KEY is missing in .env). ' +
      'No explanation was generated. The page shows its pre-generated fallback text, labeled as fallback.',
  });
}

function handleExplain(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch (e) {
      return sendJson(res, 400, { error: 'bad_request', message: 'Request body must be JSON with a listingId.' });
    }
    // The listing object from data/listings.json is the ONLY fact source.
    // Listing facts are never accepted from the request body.
    const listing = listingsById[parsed.listingId];
    if (!listing) return sendJson(res, 400, { error: 'unknown_listing', message: `No listing with id ${parsed.listingId}.` });
    if (!aiConfigured || !EXPLAINER_SYSTEM_PROMPT) return explainerNotConfigured(res);

    const question = typeof parsed.question === 'string' ? parsed.question.trim().slice(0, 500) : '';
    const listingFacts = {};
    for (const f of LISTING_FIELDS) if (listing[f] !== undefined) listingFacts[f] = listing[f];
    const userMessage = question
      ? `Listing (JSON, the only listing facts):\n${JSON.stringify(listingFacts)}\n\nSupporter question: ${question}`
      : `Listing (JSON, the only listing facts):\n${JSON.stringify(listingFacts)}\n\nNo question was asked. Write the standard explanation.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const r = await fetch(`${AI_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: AI_MODEL,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${EXPLAINER_SYSTEM_PROMPT}\n\n${EXPLAINER_CONTRACT}` },
            { role: 'user', content: userMessage },
          ],
        }),
      });
      if (!r.ok) {
        return sendJson(res, 502, {
          error: 'explainer_provider_failed',
          message: `The AI provider returned HTTP ${r.status}. No explanation was generated; the page shows its labeled fallback text.`,
        });
      }
      const j = await r.json();
      const content = j.choices?.[0]?.message?.content;
      let out;
      try {
        out = JSON.parse(content || '');
      } catch (e) {
        out = null;
      }
      if (!out || typeof out.text !== 'string' || !out.text.trim()) {
        return sendJson(res, 502, {
          error: 'explainer_provider_failed',
          message: 'The AI provider returned an unusable response. No explanation was generated; the page shows its labeled fallback text.',
        });
      }
      // Grounding enforcement: factsUsed may only name real listing fields.
      const factsUsed = Array.isArray(out.factsUsed)
        ? [...new Set(out.factsUsed.filter((f) => LISTING_FIELDS.includes(f)))]
        : [];
      const assumptions = Array.isArray(out.assumptions)
        ? out.assumptions.slice(0, 10).map((a) => String(a).slice(0, 200))
        : [];
      return sendJson(res, 200, {
        source: 'live-ai',
        listingId: listing.id,
        text: out.text.trim(),
        factsUsed,
        assumptions,
      });
    } catch (e) {
      const timedOut = e && e.name === 'AbortError';
      return sendJson(res, 502, {
        error: 'explainer_provider_failed',
        message: timedOut
          ? 'The AI provider did not respond in time. No explanation was generated; the page shows its labeled fallback text.'
          : `The AI explainer call failed (${String(e && e.message || e)}). No explanation was generated; the page shows its labeled fallback text.`,
      });
    } finally {
      clearTimeout(timer);
    }
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Dynamic config: single source of truth for sandbox mode + client ID.
  if (p === '/config.js') {
    const cfg = {
      paypalEnv: PAYPAL_ENV,
      sandbox: PAYPAL_ENV !== 'live',
      clientId: CLIENT_ID,
      secretConfigured,
    };
    const body = `window.KIN_CONFIG = ${JSON.stringify(cfg)};\n`;
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(body);
  }

  if (p === '/api/explain' && req.method === 'POST') return handleExplain(req, res);
  if (p === '/api/orders' && req.method === 'POST') return handleCreateOrder(req, res);
  const capMatch = p.match(/^\/api\/orders\/([^/]+)\/capture$/);
  if (capMatch && req.method === 'POST') return handleCaptureOrder(res, decodeURIComponent(capMatch[1]));
  if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found', message: `No API route for ${req.method} ${p}.` });

  // Static files (with traversal protection).
  let rel = p === '/' ? '/index.html' : p;
  const file = path.normalize(path.join(ROOT, rel));
  const blocked =
    !file.startsWith(ROOT + path.sep) ||
    path.basename(file).startsWith('.env') ||
    file.startsWith(path.join(ROOT, 'docs') + path.sep);
  if (blocked) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`KIN Sandbox Checkout server: http://localhost:${PORT}`);
  console.log(`PayPal environment: ${PAYPAL_ENV} (API base ${API_BASE})`);
  console.log(`Client ID loaded from .env: ${CLIENT_ID ? 'yes' : 'NO'}`);
  console.log(`Client secret configured: ${secretConfigured ? 'yes' : 'no (placeholder) — order endpoints will return the not-configured error'}`);
  console.log(`AI explainer: OpenAI model ${AI_MODEL} via ${AI_API_BASE}; key configured: ${aiConfigured ? 'yes' : 'no — /api/explain will return the not-configured error'}; system prompt loaded from docs: ${EXPLAINER_SYSTEM_PROMPT ? 'yes' : 'NO'}`);
});
