/**
 * SURVIVOR Gate Server
 * Standalone HTTP server that wraps your live Oracle with execution authority.
 *
 * Endpoints:
 *   POST /gate          — Primary: submit intent → get gate decision
 *   GET  /gate/health   — Status check
 *   POST /gate/policy   — Debug: get raw policy for a mint without enforcement
 *
 * Environment:
 *   GATE_PORT           — Port to listen on (default: 8787)
 *   SURVIVOR_URL        — Your Oracle base URL (default: https://survivor-oracle-production.up.railway.app)
 *   GATE_TIMEOUT_MS     — Oracle call timeout (default: 8000)
 */

const http = require('http');
const { buildPolicy } = require('./policy');
const { enforce } = require('./enforce');

const PORT = process.env.GATE_PORT ? Number(process.env.GATE_PORT) : 8787;
const SURVIVOR_URL = (process.env.SURVIVOR_URL || 'https://survivor-oracle-production.up.railway.app').replace(/\/$/, '');
const TIMEOUT_MS = process.env.GATE_TIMEOUT_MS ? Number(process.env.GATE_TIMEOUT_MS) : 8000;

// ─── helpers ────────────────────────────────────────────────────────────────

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

/**
 * Calls your live SURVIVOR Oracle at /score/:mint?quick=true
 * Returns { score, risk_tier, confidence, reasons }
 */
async function fetchSurvivorScore(mint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${SURVIVOR_URL}/score/${encodeURIComponent(mint)}?quick=true`;
    const res = await fetch(url, { signal: controller.signal });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Oracle responded ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    return {
      score: Number(data.score ?? 40),
      risk_tier: String(data.risk_tier ?? 'VERY_HIGH'),
      confidence: Number(data.confidence ?? 0.5),
      reasons: Array.isArray(data.reasons) ? data.reasons : [],
      oracle_meta: {
        mint: data.mint,
        name: data.name,
        symbol: data.symbol,
        safe: data.safe,
        cached: data.cached || false,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── request handler ─────────────────────────────────────────────────────────

async function handleGate(req, res) {
  let intent;
  try {
    intent = await readJson(req);
  } catch {
    return jsonResponse(res, 400, { error: 'Invalid JSON body' });
  }

  // Validate required fields
  const required = ['to_asset', 'notional_usd'];
  const missing = required.filter(f => intent[f] == null);
  if (missing.length) {
    return jsonResponse(res, 400, {
      error: 'Missing required fields',
      missing,
      required_shape: {
        chain: 'solana',
        from_asset: 'SOL',
        to_asset: '<mint_address>',
        notional_usd: 500,
        slippage_bps: 100,
        kind: 'swap',
      },
    });
  }

  // Defaults
  intent.chain = intent.chain || 'solana';
  intent.kind = intent.kind || 'swap';
  intent.slippage_bps = intent.slippage_bps || 100;

  // 1. Score the target asset
  let scoreData;
  try {
    scoreData = await fetchSurvivorScore(intent.to_asset);
  } catch (err) {
    // Oracle unavailable → fail safe (DENY)
    return jsonResponse(res, 200, {
      decision: {
        ok: false,
        mode: 'BLOCK',
        error: `Oracle unavailable: ${err.message}`,
        policy: {
          decision: 'DENY',
          constraints: { cooldown_seconds: 60 },
          confidence: 0,
          reasons: [{ code: 'ORACLE_UNAVAILABLE', severity: 'high' }],
          expires_at: Math.floor(Date.now() / 1000) + 60,
        },
      },
      oracle: null,
    });
  }

  // 2. Build policy from score
  const policy = buildPolicy({
    score: scoreData.score,
    risk_tier: scoreData.risk_tier,
    confidence: scoreData.confidence,
    reasons: scoreData.reasons,
    kind: intent.kind,
  });

  // 3. Enforce — get gate decision
  const decision = enforce(intent, policy);

  // 4. Return full gate result
  return jsonResponse(res, 200, {
    decision,
    oracle: scoreData.oracle_meta,
    evaluated_at: new Date().toISOString(),
  });
}

async function handlePolicyDebug(req, res) {
  let body;
  try { body = await readJson(req); }
  catch { return jsonResponse(res, 400, { error: 'Invalid JSON' }); }

  const mint = body.mint;
  const kind = body.kind || 'swap';
  if (!mint) return jsonResponse(res, 400, { error: 'mint required' });

  try {
    const scoreData = await fetchSurvivorScore(mint);
    const policy = buildPolicy({ ...scoreData, kind });
    return jsonResponse(res, 200, { mint, kind, score: scoreData, policy });
  } catch (err) {
    return jsonResponse(res, 500, { error: err.message });
  }
}

// ─── server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS for local dev / agent clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/gate') {
    return handleGate(req, res);
  }

  if (req.method === 'POST' && req.url === '/gate/policy') {
    return handlePolicyDebug(req, res);
  }

  if (req.method === 'GET' && req.url === '/gate/health') {
    return jsonResponse(res, 200, {
      status: 'healthy',
      service: 'survivor-gate',
      version: '1.0.0',
      oracle: SURVIVOR_URL,
      port: PORT,
      uptime_seconds: Math.floor(process.uptime()),
    });
  }

  jsonResponse(res, 404, { error: 'Not found', endpoints: ['POST /gate', 'POST /gate/policy', 'GET /gate/health'] });
});

server.listen(PORT, () => {
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  SURVIVOR Gate v1.0.0                       │');
  console.log('│  Execution Governor for Autonomous Agents   │');
  console.log('└─────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Gate:    http://localhost:${PORT}/gate`);
  console.log(`  Oracle:  ${SURVIVOR_URL}`);
  console.log(`  Timeout: ${TIMEOUT_MS}ms`);
  console.log('');
  console.log('  Decisions: ALLOW → THROTTLE → READ_ONLY → DENY');
  console.log('');
});

module.exports = { server };
