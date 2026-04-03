/**
 * SURVIVOR Execution Receipt Module
 * Canonical receipt schema v1 for the Gate service.
 *
 * Receipt lifecycle:
 *   1. PREPARED  — created at intent time (pre-execution)
 *   2. FINALIZED — updated after execution completes
 *
 * Sections:
 *   header      — schema version, receipt ID, timestamps, status
 *   intent      — what the agent declared it would do
 *   actor       — who is acting (ties to IAM)
 *   attestation — SURVIVOR's judgment (decision, drift, policies)
 *   execution   — what actually happened (filled at finalize)
 *   signature   — Ed25519 over canonical JSON
 */

'use strict';

const crypto = require('crypto');
const nacl   = require('tweetnacl');
const bs58   = require('bs58');

// ── Config ──────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 'execution_receipt/1.0';

// Ed25519 signing key — reuse the Gate's existing signer if available,
// otherwise derive from SURVIVOR_RECEIPT_SEED_HEX or fall back to dev key.
let SIGNING_KEYPAIR;
let PUBLIC_KEY_HEX;

function initSigner() {
  const seedHex = process.env.SURVIVOR_RECEIPT_SEED_HEX
    || process.env.SURVIVOR_SIGNING_SEED_HEX;

  if (seedHex) {
    const seed = Buffer.from(seedHex, 'hex');
    SIGNING_KEYPAIR = nacl.sign.keyPair.fromSeed(seed);
  } else {
    // Dev fallback — deterministic but NOT secure
    const devSeed = crypto.createHash('sha256')
      .update('survivor-gate-dev-receipt-signer')
      .digest();
    SIGNING_KEYPAIR = nacl.sign.keyPair.fromSeed(devSeed);
    console.warn('[receipt] WARNING: using dev signing key — set SURVIVOR_RECEIPT_SEED_HEX in production');
  }

  PUBLIC_KEY_HEX = Buffer.from(SIGNING_KEYPAIR.publicKey).toString('hex');
  console.log(`[receipt] signer pubkey: ${PUBLIC_KEY_HEX.slice(0, 16)}...`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function nowISO() {
  return new Date().toISOString();
}

function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort(), 0);
}

function deepCanonicalJson(obj) {
  // Recursively sort all keys for deterministic hashing
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepCanonicalJson);
  const sorted = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = deepCanonicalJson(obj[k]);
  }
  return sorted;
}

function stableStringify(obj) {
  return JSON.stringify(deepCanonicalJson(obj));
}

function sha256hex(data) {
  return crypto.createHash('sha256')
    .update(typeof data === 'string' ? data : JSON.stringify(data))
    .digest('hex');
}

function stableHash(obj) {
  return `sha256:${sha256hex(stableStringify(obj))}`;
}

function makeReceiptId() {
  const ts  = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const rnd = crypto.randomBytes(4).toString('hex');
  return `exec_${ts}${rnd}`;
}

// ── Signing ─────────────────────────────────────────────────────────────────

function signPayload(obj) {
  const payload = Buffer.from(stableStringify(obj), 'utf8');
  const sig     = nacl.sign.detached(payload, SIGNING_KEYPAIR.secretKey);

  return {
    scheme:       'ed25519',
    public_key:   PUBLIC_KEY_HEX,
    signature:    Buffer.from(sig).toString('base64'),
    payload_hash: stableHash(obj),
  };
}

function verifySignature(obj, publicKeyHex, signatureB64) {
  try {
    const payload = Buffer.from(stableStringify(obj), 'utf8');
    const sig     = Buffer.from(signatureB64, 'base64');
    const pubkey  = Buffer.from(publicKeyHex, 'hex');
    return nacl.sign.detached.verify(payload, sig, pubkey);
  } catch {
    return false;
  }
}

// ── Drift Computation ───────────────────────────────────────────────────────

/**
 * Compute drift between declared intent and environment conditions.
 * Returns 0.00 (no drift) to 1.00 (maximum drift).
 *
 * This is the hook where OROS dimensional telemetry plugs in later.
 * For now: basic heuristics based on chain mismatch, amount, volatility.
 */
function computeDriftScore(intent, environment) {
  let drift = 0.0;

  // Chain mismatch
  if (intent.chain && environment.chain && intent.chain !== environment.chain) {
    drift += 0.35;
  }

  // Amount-weighted volatility risk
  if (intent.action_type === 'swap' || intent.kind === 'swap') {
    const amount = parseFloat(intent.amount_usd || intent.notional_usd || 0);
    const vol    = parseFloat(environment.market_volatility || 0.2);
    drift += Math.min(0.50, (amount / 10000.0) * vol);
  }

  // Slippage tolerance risk
  if (intent.slippage_bps) {
    const bps = parseInt(intent.slippage_bps, 10);
    if (bps > 200) drift += 0.10;
    if (bps > 500) drift += 0.15;
  }

  // Liquidity risk
  if (environment.liquidity_band === 'thin') drift += 0.08;
  if (environment.liquidity_band === 'dry')  drift += 0.20;

  return Math.round(Math.min(drift, 1.0) * 10000) / 10000;
}

function computeConfidenceBand(score) {
  if (score >= 0.80) return 'HIGH';
  if (score >= 0.50) return 'MEDIUM';
  return 'LOW';
}

// ── Receipt Builders ────────────────────────────────────────────────────────

/**
 * Build a PREPARED receipt from a gate decision.
 *
 * @param {Object} opts
 * @param {Object} opts.intent       — the caller's declared intent
 * @param {Object} opts.actor        — agent identity (optional IAM fields)
 * @param {Object} opts.decision     — the gate enforce() result
 * @param {Object} opts.environment  — market/chain conditions
 * @param {Object} opts.oracleMeta   — oracle scoring snapshot
 * @param {string} opts.policyScope  — policy identifier
 * @param {string} opts.callerRef    — caller's correlation ID (optional)
 */
function buildPreparedReceipt(opts) {
  const {
    intent,
    actor       = {},
    decision,
    environment = {},
    oracleMeta  = {},
    policyScope = 'survivor.gate/default',
    callerRef   = null,
  } = opts;

  // Normalize intent body for hashing
  const intentBody = {
    action_type:  intent.action_type || intent.kind || 'swap',
    chain:        intent.chain       || 'solana',
    network:      intent.network     || 'mainnet',
    amount_usd:   parseFloat(intent.amount_usd || intent.notional_usd || 0),
    target:       intent.target      || intent.to_asset || null,
    from_asset:   intent.from_asset  || null,
    slippage_bps: parseInt(intent.slippage_bps || 0, 10),
    parameters:   intent.parameters  || {},
    policy_scope: policyScope,
  };

  const intentHash = stableHash(intentBody);
  const driftScore = computeDriftScore(intentBody, environment);
  const decisionScore = Math.round(Math.max(0, 1.0 - driftScore) * 10000) / 10000;
  const confidenceBand = computeConfidenceBand(decisionScore);

  // Map gate decision to receipt decision
  const gateMode = decision?.mode || decision?.decision || 'ALLOW';
  let receiptDecision;
  if (gateMode === 'FORWARD' || gateMode === 'ALLOW')        receiptDecision = 'ALLOW';
  else if (gateMode === 'THROTTLE' || gateMode === 'CHALLENGE') receiptDecision = 'CHALLENGE';
  else                                                         receiptDecision = 'DENY';

  const now = nowUnix();

  const receipt = {
    header: {
      schema_version: SCHEMA_VERSION,
      receipt_id:     makeReceiptId(),
      status:         'PREPARED',
      created_at:     now,
      updated_at:     now,
      caller_ref:     callerRef,
    },
    intent: {
      ...intentBody,
      intent_hash: intentHash,
    },
    actor: {
      agent_id:       actor.agent_id       || actor.agentId   || 'anonymous',
      integrity_rate: actor.integrity_rate  || actor.integrityRate || null,
      archetype:      actor.archetype      || null,
      proof_ref:      actor.proof_ref      || actor.proofRef  || null,
    },
    attestation: {
      decision:          receiptDecision,
      decision_score:    decisionScore,
      confidence_band:   confidenceBand,
      drift_score:       driftScore,
      gate_mode:         gateMode,
      gate_constrained:  decision?.constrained || false,
      policy_version:    'survivor.policy/1.0',
      evaluated_policies: [
        policyScope,
        'survivor.risk/default',
      ],
      reason_codes:      (decision?.policy?.reasons || []).map(r => r.code || r),
      environment_hash:  stableHash(environment),
      oracle_snapshot: {
        score:     oracleMeta.score     || null,
        risk_tier: oracleMeta.risk_tier || null,
        safe:      oracleMeta.safe      || null,
        symbol:    oracleMeta.symbol    || null,
      },
    },
    execution: {
      tx_signature:       null,
      outcome:            null,
      expected_result:    {},
      observed_result:    {},
      outcome_delta:      null,
      finalized_at:       null,
      execution_metadata: {},
    },
    signature: {},
  };

  // Sign the full receipt (with signature field empty)
  receipt.signature = signPayload(receipt);

  return receipt;
}

/**
 * Finalize a PREPARED receipt with execution results.
 *
 * @param {Object} receipt   — the PREPARED receipt
 * @param {Object} opts
 * @param {string} opts.txSignature       — on-chain tx signature
 * @param {string} opts.outcome           — EXECUTED | BLOCKED | FAILED | EXPIRED
 * @param {Object} opts.expectedResult    — what was expected
 * @param {Object} opts.observedResult    — what actually happened
 * @param {Object} opts.executionMetadata — route, latency, etc.
 */
function finalizeReceipt(receipt, opts) {
  if (receipt.header.status === 'FINALIZED') {
    throw new Error('Receipt already finalized');
  }

  const {
    txSignature       = null,
    outcome           = 'EXECUTED',
    expectedResult    = {},
    observedResult    = {},
    executionMetadata = {},
  } = opts;

  // Compute outcome delta
  const delta = computeOutcomeDelta(expectedResult, observedResult);

  receipt.header.status     = 'FINALIZED';
  receipt.header.updated_at = nowUnix();

  receipt.execution = {
    tx_signature:       txSignature,
    outcome:            outcome,
    expected_result:    expectedResult,
    observed_result:    observedResult,
    outcome_delta:      delta,
    finalized_at:       nowUnix(),
    execution_metadata: executionMetadata,
  };

  // Re-sign the finalized receipt
  receipt.signature = {};
  receipt.signature = signPayload(receipt);

  return receipt;
}

function computeOutcomeDelta(expected, observed) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(observed)])].sort();
  const delta = {};

  for (const k of keys) {
    const ev = expected[k];
    const ov = observed[k];
    if (typeof ev === 'number' && typeof ov === 'number') {
      delta[k] = Math.round((ov - ev) * 100000000) / 100000000;
    } else if (ev !== ov) {
      delta[k] = { expected: ev, observed: ov };
    }
  }

  return Object.keys(delta).length > 0 ? delta : null;
}

// ── Verification ────────────────────────────────────────────────────────────

function verifyReceipt(receipt) {
  const sig = receipt.signature;
  if (!sig || !sig.signature || !sig.public_key) {
    return { verified: false, reason: 'missing_signature' };
  }

  // Build the signable version (signature field empty)
  const signable = JSON.parse(JSON.stringify(receipt));
  signable.signature = {};

  const verified = verifySignature(signable, sig.public_key, sig.signature);

  return {
    receipt_id:   receipt.header.receipt_id,
    verified,
    status:       receipt.header.status,
    payload_hash: sig.payload_hash,
    public_key:   sig.public_key,
  };
}

// ── Extract receipt summary for gate response ───────────────────────────────

/**
 * Returns a minimal object to append to the existing /gate response
 * so MomentumSniper gets receipt metadata without breaking existing parsing.
 */
function receiptSummary(receipt) {
  return {
    receipt_id:     receipt.header.receipt_id,
    receipt_status: receipt.header.status,
    receipt_decision: receipt.attestation.decision,
    drift_score:    receipt.attestation.drift_score,
    confidence_band: receipt.attestation.confidence_band,
    intent_hash:    receipt.intent.intent_hash,
    verify_url:     `/receipts/${receipt.header.receipt_id}/verify`,
    signature:      receipt.signature,
  };
}

// ── Module Init ─────────────────────────────────────────────────────────────

initSigner();

module.exports = {
  SCHEMA_VERSION,
  PUBLIC_KEY_HEX,
  buildPreparedReceipt,
  finalizeReceipt,
  verifyReceipt,
  receiptSummary,
  computeDriftScore,
  stableHash,
  makeReceiptId,
  initSigner,
};
