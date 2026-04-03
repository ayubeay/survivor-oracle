/**
 * SURVIVOR Gate Server v1.1.0
 * Execution Governor + Receipt API for Autonomous Agents
 *
 * Endpoints:
 *   POST /gate              — Submit intent → gate decision + receipt
 *   GET  /gate/health       — Status check
 *   POST /gate/policy       — Debug: raw policy for a mint
 *   POST /receipts/:id/finalize — Finalize receipt after execution
 *   GET  /receipts/:id      — Get full receipt
 *   GET  /receipts/:id/verify — Verify receipt signature
 *   GET  /receipts          — List receipts (?limit=&status=&agent_id=)
 *   GET  /receipts/stats    — Receipt statistics
 *
 * Environment:
 *   PORT / GATE_PORT        — Port (default: 8787)
 *   SURVIVOR_URL            — Oracle base URL
 *   GATE_TIMEOUT_MS         — Oracle call timeout (default: 8000)
 *   RECEIPTS_ENABLED        — Enable receipt API (default: 1)
 *   RECEIPT_DB_DIR          — Receipt DB directory (default: /data)
 *   VYRE_EMIT               — Emit VYRE artifacts (default: 0)
 */

'use strict';

const http = require('http');
const { buildPolicy } = require('./policy');
const { enforce } = require('./enforce');
const { buildPreparedReceipt, finalizeReceipt, verifyReceipt, receiptSummary, SCHEMA_VERSION, PUBLIC_KEY_HEX } = require('./receipt');
const { initReceiptDb, saveReceipt, updateReceipt, getReceipt, listReceipts, listByAgent, listByStatus, getStats: getReceiptStats } = require('./receipt-db');

let emitVyre;
try { emitVyre = require('./vyre').emitVyre; } catch { emitVyre = null; }

const PORT        = process.env.PORT || process.env.GATE_PORT || 8787;
const SURVIVOR_URL = (process.env.SURVIVOR_URL || 'https://survivor-oracle-production.up.railway.app').replace(/\/$/, '');
const TIMEOUT_MS  = process.env.GATE_TIMEOUT_MS ? Number(process.env.GATE_TIMEOUT_MS) : 8000;
const RECEIPTS_ENABLED = process.env.RECEIPTS_ENABLED !== '0';

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
      score:     Number(data.score ?? 40),
      risk_tier: String(data.risk_tier ?? 'VERY_HIGH'),
      confidence: Number(data.confidence ?? 0.5),
      reasons:   Array.isArray(data.reasons) ? data.reasons : [],
      oracle_meta: {
        mint:   data.mint,
        name:   data.name,
        symbol: data.symbol,
        safe:   data.safe,
        cached: data.cached || false,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleGate(req, res) {
  let intent;
  try { intent = await readJson(req); }
  catch { return jsonResponse(res, 400, { error: 'Invalid JSON body' }); }

  const required = ['to_asset', 'notional_usd'];
  const missing = required.filter(f => intent[f] == null);
  if (missing.length) {
    return jsonResponse(res, 400, {
      error: 'Missing required fields', missing,
      required_shape: {
        chain: 'solana', from_asset: 'SOL', to_asset: '<mint_address>',
        notional_usd: 500, slippage_bps: 100, kind: 'swap',
      },
    });
  }

  intent.chain        = intent.chain || 'solana';
  intent.kind         = intent.kind || 'swap';
  intent.slippage_bps = intent.slippage_bps || 100;

  let scoreData;
  try {
    scoreData = await fetchSurvivorScore(intent.to_asset);
  } catch (err) {
    return jsonResponse(res, 200, {
      decision: { ok: false, mode: 'DENY', intent, constrained: true, error: `Oracle unreachable: ${err.message}` },
      oracle: null, evaluated_at: new Date().toISOString(),
    });
  }

  const policy = buildPolicy({
    score: scoreData.score, risk_tier: scoreData.risk_tier,
    confidence: scoreData.confidence, reasons: scoreData.reasons, kind: intent.kind,
  });

  const decision = enforce(intent, policy);

  let receiptMeta = null;
  if (RECEIPTS_ENABLED) {
    try {
      const receipt = buildPreparedReceipt({
        intent,
        actor: {
          agent_id:       req.headers['x-agent-id']        || 'anonymous',
          integrity_rate: parseFloat(req.headers['x-agent-integrity'] || '0') || null,
          archetype:      req.headers['x-agent-archetype'] || null,
          proof_ref:      req.headers['x-agent-proof-ref'] || null,
        },
        decision,
        environment: {
          chain:             intent.chain,
          market_volatility: parseFloat(req.headers['x-market-volatility'] || '0.2'),
          liquidity_band:    req.headers['x-liquidity-band'] || null,
        },
        oracleMeta: {
          score:     scoreData.score,
          risk_tier: scoreData.risk_tier,
          safe:      scoreData.oracle_meta?.safe,
          symbol:    scoreData.oracle_meta?.symbol,
        },
        policyScope: `gate.${intent.kind}.${intent.chain}`,
        callerRef:   req.headers['x-caller-ref'] || null,
      });
      saveReceipt(receipt);
      receiptMeta = receiptSummary(receipt);
    } catch (e) {
      console.error('[receipt] build/save error:', e.message);
    }
  }

  if (process.env.VYRE_EMIT === '1' && emitVyre) {
    emitVyre({
      gate:    { ...decision, evaluated_at: new Date().toISOString() },
      oracle:  scoreData.oracle_meta,
      runtime: {
        gate_url:   process.env.GATE_URL || '',
        oracle_url: SURVIVOR_URL,
        git_sha:    process.env.GIT_SHA  || 'unknown',
        env:        process.env.NODE_ENV || 'production',
      },
    }).catch(e => console.error('[vyre] emit error:', e?.message));
  }

  const response = {
    decision,
    oracle: scoreData.oracle_meta,
    evaluated_at: new Date().toISOString(),
  };
  if (receiptMeta) response.receipt = receiptMeta;

  return jsonResponse(res, 200, response);
}

async function handleFinalize(req, res, receiptId) {
  let body;
  try { body = await readJson(req); }
  catch { return jsonResponse(res, 400, { error: 'Invalid JSON' }); }

  const receipt = getReceipt(receiptId);
  if (!receipt) return jsonResponse(res, 404, { error: 'Receipt not found', receipt_id: receiptId });

  try {
    const finalized = finalizeReceipt(receipt, {
      txSignature:       body.tx_signature       || null,
      outcome:           body.outcome             || 'EXECUTED',
      expectedResult:    body.expected_result     || {},
      observedResult:    body.observed_result     || {},
      executionMetadata: body.execution_metadata  || {},
    });
    updateReceipt(finalized);
    return jsonResponse(res, 200, finalized);
  } catch (e) {
    return jsonResponse(res, 400, { error: e.message });
  }
}

function handleGetReceipt(res, receiptId) {
  const receipt = getReceipt(receiptId);
  if (!receipt) return jsonResponse(res, 404, { error: 'Receipt not found', receipt_id: receiptId });
  return jsonResponse(res, 200, receipt);
}

function handleVerifyReceipt(res, receiptId) {
  const receipt = getReceipt(receiptId);
  if (!receipt) return jsonResponse(res, 404, { error: 'Receipt not found', receipt_id: receiptId });
  return jsonResponse(res, 200, verifyReceipt(receipt));
}

function handleListReceipts(res, url) {
  const params  = new URL(url, 'http://localhost').searchParams;
  const limit   = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const status  = params.get('status');
  const agentId = params.get('agent_id');

  let receipts;
  if (agentId)      receipts = listByAgent(agentId, limit);
  else if (status)  receipts = listByStatus(status, limit);
  else              receipts = listReceipts(limit);

  return jsonResponse(res, 200, {
    count: receipts.length,
    receipts: receipts.map(r => ({
      receipt_id:  r.header.receipt_id,
      status:      r.header.status,
      decision:    r.attestation.decision,
      drift_score: r.attestation.drift_score,
      agent_id:    r.actor.agent_id,
      created_at:  r.header.created_at,
      outcome:     r.execution?.outcome || null,
    })),
  });
}

function handleReceiptStats(res) {
  const stats = getReceiptStats();
  return jsonResponse(res, 200, {
    service: 'survivor-gate-receipts',
    schema_version: SCHEMA_VERSION,
    signer: PUBLIC_KEY_HEX,
    ...stats,
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

function parseRoute(method, url) {
  const path = url.split('?')[0];
  const finalizeMatch = path.match(/^\/receipts\/([^/]+)\/finalize$/);
  if (method === 'POST' && finalizeMatch) return { handler: 'finalize', id: finalizeMatch[1] };
  const verifyMatch = path.match(/^\/receipts\/([^/]+)\/verify$/);
  if (method === 'GET' && verifyMatch) return { handler: 'verify', id: verifyMatch[1] };
  if (method === 'GET' && path === '/receipts/stats') return { handler: 'receipt_stats' };
  if (method === 'GET' && path === '/receipts') return { handler: 'list_receipts' };
  const getMatch = path.match(/^\/receipts\/([^/]+)$/);
  if (method === 'GET' && getMatch) return { handler: 'get_receipt', id: getMatch[1] };
  if (method === 'POST' && path === '/gate') return { handler: 'gate' };
  if (method === 'POST' && path === '/gate/policy') return { handler: 'policy_debug' };
  if (method === 'GET'  && path === '/gate/health') return { handler: 'health' };
  return { handler: 'not_found' };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-agent-id, x-agent-integrity, x-agent-archetype, x-agent-proof-ref, x-market-volatility, x-liquidity-band, x-caller-ref');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const route = parseRoute(req.method, req.url);
  try {
    switch (route.handler) {
      case 'gate':          return await handleGate(req, res);
      case 'policy_debug':  return await handlePolicyDebug(req, res);
      case 'health':
        return jsonResponse(res, 200, {
          status: 'healthy', service: 'survivor-gate', version: '1.1.0',
          oracle: SURVIVOR_URL, port: PORT, uptime_seconds: Math.floor(process.uptime()),
          receipts_enabled: RECEIPTS_ENABLED, receipt_schema: SCHEMA_VERSION, receipt_signer: PUBLIC_KEY_HEX,
        });
      case 'finalize':
        if (!RECEIPTS_ENABLED) return jsonResponse(res, 503, { error: 'Receipts disabled' });
        return await handleFinalize(req, res, route.id);
      case 'get_receipt':
        if (!RECEIPTS_ENABLED) return jsonResponse(res, 503, { error: 'Receipts disabled' });
        return handleGetReceipt(res, route.id);
      case 'verify':
        if (!RECEIPTS_ENABLED) return jsonResponse(res, 503, { error: 'Receipts disabled' });
        return handleVerifyReceipt(res, route.id);
      case 'list_receipts':
        if (!RECEIPTS_ENABLED) return jsonResponse(res, 503, { error: 'Receipts disabled' });
        return handleListReceipts(res, req.url);
      case 'receipt_stats':
        if (!RECEIPTS_ENABLED) return jsonResponse(res, 503, { error: 'Receipts disabled' });
        return handleReceiptStats(res);
      default:
        return jsonResponse(res, 404, {
          error: 'Not found',
          endpoints: [
            'POST /gate', 'POST /gate/policy', 'GET /gate/health',
            'POST /receipts/:id/finalize', 'GET /receipts/:id',
            'GET /receipts/:id/verify', 'GET /receipts', 'GET /receipts/stats',
          ],
        });
    }
  } catch (e) {
    console.error('[gate] unhandled error:', e);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
});

if (RECEIPTS_ENABLED) {
  try { initReceiptDb(); } catch (e) {
    console.error('[receipt] DB init failed:', e.message);
  }
}

server.listen(PORT, () => {
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  SURVIVOR Gate v1.1.0                       │');
  console.log('│  Execution Governor + Receipt API           │');
  console.log('└─────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Gate:     http://localhost:${PORT}/gate`);
  console.log(`  Oracle:   ${SURVIVOR_URL}`);
  console.log(`  Timeout:  ${TIMEOUT_MS}ms`);
  console.log(`  Receipts: ${RECEIPTS_ENABLED ? 'ON' : 'OFF'}`);
  console.log('');
  console.log('  Decisions: ALLOW → THROTTLE → READ_ONLY → DENY');
  console.log('');
  if (RECEIPTS_ENABLED) {
    console.log('  Receipt endpoints:');
    console.log('    POST /receipts/:id/finalize');
    console.log('    GET  /receipts/:id');
    console.log('    GET  /receipts/:id/verify');
    console.log('    GET  /receipts');
    console.log('    GET  /receipts/stats');
    console.log('');
  }
});

module.exports = { server };
