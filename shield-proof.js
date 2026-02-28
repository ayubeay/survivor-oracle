#!/usr/bin/env node
/**
 * shield-proof.js — Shield Router attestation proof client
 *
 * Demonstrates the full flow:
 *   1. Request attestation for a mint
 *   2. Verify the attestation signature
 *   3. Apply policy checks (tier/score/TTL thresholds)
 *   4. Print PASS/FAIL with details
 *
 * Usage:
 *   node shield-proof.js [mint] [oracle_url]
 *
 * Examples:
 *   node shield-proof.js DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
 *   node shield-proof.js DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 https://survivor.up.railway.app
 */

const DEFAULTS = {
  mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  oracleUrl: process.env.ORACLE_URL || 'http://localhost:3000',
  routerProgramId: process.env.SHIELD_ROUTER_PROGRAM_ID || null,
};

// ── Policy thresholds (customize for your router) ─────────────────────────────
const POLICY = {
  min_score: 40,          // reject tokens below this score
  max_tier: 3,            // reject tier above this (0=LOW, 1=MED, 2=HIGH, 3=VERY_HIGH)
  min_ttl_seconds: 60,    // reject if TTL remaining < this
  require_oracle_match: true,  // signer must match oracle's declared pubkey
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function dim(s) { return '\x1b[2m' + s + '\x1b[0m'; }
function green(s) { return '\x1b[32m' + s + '\x1b[0m'; }
function red(s) { return '\x1b[31m' + s + '\x1b[0m'; }
function yellow(s) { return '\x1b[33m' + s + '\x1b[0m'; }
function bold(s) { return '\x1b[1m' + s + '\x1b[0m'; }
function cyan(s) { return '\x1b[36m' + s + '\x1b[0m'; }

function riskColor(level) {
  if (level === 'LOW') return green(level);
  if (level === 'MEDIUM') return yellow(level);
  return red(level);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mint = process.argv[2] || DEFAULTS.mint;
  const oracleUrl = process.argv[3] || DEFAULTS.oracleUrl;

  console.log('');
  console.log(bold('  SHIELD ROUTER — Attestation Proof'));
  console.log(dim('  ─────────────────────────────────────────'));
  console.log('');

  // Step 0: Get oracle identity
  console.log(dim('  [0] Fetching oracle identity...'));
  let signerInfo;
  try {
    const res = await fetch(oracleUrl + '/attest/signer');
    signerInfo = await res.json();
    console.log('      Signer:  ' + cyan(signerInfo.signer));
    console.log('      Program: ' + dim(signerInfo.program));
    console.log('      Domain:  ' + dim(signerInfo.domain));
    console.log('');
  } catch (e) {
    console.log(red('      FAIL: Could not reach oracle at ' + oracleUrl));
    console.log(dim('      ' + e.message));
    process.exit(1);
  }

  const routerProgramId = DEFAULTS.routerProgramId || signerInfo.program;

  // Step 1: Request attestation
  console.log(dim('  [1] Requesting attestation...'));
  console.log('      Mint: ' + cyan(mint));
  const t0 = Date.now();
  let attestRes;
  try {
    const res = await fetch(oracleUrl + '/attest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mint, router_program_id: routerProgramId }),
    });
    attestRes = await res.json();
    if (attestRes.error) {
      console.log(red('      FAIL: ' + attestRes.error + ' — ' + attestRes.message));
      process.exit(1);
    }
  } catch (e) {
    console.log(red('      FAIL: ' + e.message));
    process.exit(1);
  }
  const latency = Date.now() - t0;

  const { attestation, signature, signer, meta } = attestRes;
  const cached = meta && meta.cached;

  console.log('      Score: ' + bold(String(attestation.score)) + '/100  Risk: ' + riskColor(meta.risk_level) + '  Tier: ' + attestation.tier);
  console.log('      TTL:   ' + (attestation.expires_at - attestation.issued_at) + 's  Nonce: ' + dim(attestation.nonce.slice(0, 16) + '...'));
  console.log('      ' + dim(latency + 'ms') + (cached ? '  ' + green('[CACHE HIT]') : '  ' + yellow('[CACHE MISS]')));
  console.log('');

  // Step 2: Verify signature
  console.log(dim('  [2] Verifying signature...'));
  let verifyRes;
  try {
    const res = await fetch(oracleUrl + '/attest/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attestation, signature, signer }),
    });
    verifyRes = await res.json();
  } catch (e) {
    console.log(red('      FAIL: Verify endpoint error — ' + e.message));
    process.exit(1);
  }

  const checks = verifyRes.checks || {};
  for (const [k, v] of Object.entries(checks)) {
    const icon = v ? green('✓') : red('✗');
    console.log('      ' + icon + ' ' + k);
  }
  console.log('      TTL remaining: ' + (verifyRes.meta ? verifyRes.meta.ttl_remaining + 's' : 'unknown'));
  console.log('');

  // Step 3: Apply policy
  console.log(dim('  [3] Applying router policy...'));
  const policyResults = [];

  // Score threshold
  const scoreOk = attestation.score >= POLICY.min_score;
  policyResults.push({ name: 'score >= ' + POLICY.min_score, pass: scoreOk, detail: 'got ' + attestation.score });

  // Tier threshold
  const tierOk = attestation.tier <= POLICY.max_tier;
  policyResults.push({ name: 'tier <= ' + POLICY.max_tier, pass: tierOk, detail: 'got ' + attestation.tier });

  // TTL threshold
  const ttlRemaining = verifyRes.meta ? verifyRes.meta.ttl_remaining : 0;
  const ttlOk = ttlRemaining >= POLICY.min_ttl_seconds;
  policyResults.push({ name: 'ttl >= ' + POLICY.min_ttl_seconds + 's', pass: ttlOk, detail: ttlRemaining + 's remaining' });

  // Oracle signer match
  const oracleOk = !POLICY.require_oracle_match || checks.signer_matches_oracle;
  policyResults.push({ name: 'oracle signer match', pass: oracleOk, detail: signer.slice(0, 12) + '...' });

  // Signature valid
  const sigOk = checks.signature_valid === true;
  policyResults.push({ name: 'signature valid', pass: sigOk });

  for (const p of policyResults) {
    const icon = p.pass ? green('✓') : red('✗');
    console.log('      ' + icon + ' ' + p.name + (p.detail ? '  ' + dim(p.detail) : ''));
  }
  console.log('');

  // Final verdict
  const allPass = policyResults.every(function(p) { return p.pass; }) && verifyRes.valid;
  const failedPolicies = policyResults.filter(function(p) { return !p.pass; }).map(function(p) { return p.name; });

  console.log(dim('  ─────────────────────────────────────────'));
  if (allPass) {
    console.log(bold(green('  ✓ PASS')) + ' — Swap allowed by Shield Router policy');
  } else {
    var reasons = [];
    if (!verifyRes.valid) reasons.push('signature verification failed');
    reasons = reasons.concat(failedPolicies);
    console.log(bold(red('  ✗ FAIL')) + ' — ' + reasons.join(', '));
  }
  console.log(dim('  ─────────────────────────────────────────'));
  console.log('');

  // Step 4: Cache stats
  try {
    const res = await fetch(oracleUrl + '/attest/cache/stats');
    const stats = await res.json();
    if (stats.enabled) {
      console.log(dim('  Cache: ' + stats.hits + ' hits / ' + stats.misses + ' misses (' + stats.hit_rate + ')  Active: ' + stats.active));
    }
  } catch (e) { /* ignore */ }

  console.log('');
  process.exit(allPass ? 0 : 1);
}

main().catch(function(e) {
  console.error(red('Fatal: ' + e.message));
  process.exit(1);
});
