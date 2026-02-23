#!/usr/bin/env node
/**
 * SURVIVOR Gate Demo
 * Runs 3 scenarios against your live Oracle to prove governance works.
 *
 * Run gate server first:
 *   node src/gate/server.js
 *
 * Then in another terminal:
 *   node src/gate/demo.js
 */

const { executeSwap, getTokenRisk } = require('./mcp-tools');

const GATE_URL = process.env.GATE_URL || 'http://localhost:8787';

// ─── Test intents ─────────────────────────────────────────────────────────────

// A fresh pump.fun token — expect DENY or READ_ONLY
const HIGH_RISK_MINT = '2DcyRtLBfVQDcxaXhz8L931RVD5k4B5XwRqZBnwJpump';

// SOL — megacap, should ALLOW
const LOW_RISK_MINT = 'So11111111111111111111111111111111111111112';

// ─── Display helpers ─────────────────────────────────────────────────────────

function banner(title) {
  console.log('');
  console.log('─'.repeat(60));
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

function printResult(label, result) {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(result, null, 2));
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

async function runDemo() {
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  SURVIVOR Gate Demo — Execution Governance  │');
  console.log(`│  Gate: ${GATE_URL.padEnd(37)}│`);
  console.log('└─────────────────────────────────────────────┘');

  // ── Scenario 1: Risk assessment without executing ─────────────────────────
  banner('SCENARIO 1 — Read-only risk assessment (safe to call anytime)');
  try {
    const risk = await getTokenRisk({ mint: HIGH_RISK_MINT, kind: 'swap' });
    printResult('get_token_risk', risk);
  } catch (err) {
    console.error('  Error:', err.message);
    console.error('  → Is the Gate server running? Run: node src/gate/server.js');
  }

  // ── Scenario 2: High-risk swap — expect DENY or READ_ONLY ─────────────────
  banner('SCENARIO 2 — High-risk swap attempt (expect DENIED or SIMULATION_ONLY)');
  try {
    const result = await executeSwap({
      chain: 'solana',
      from_asset: 'SOL',
      to_asset: HIGH_RISK_MINT,
      notional_usd: 2500,
      slippage_bps: 100,
    });
    printResult('execute_swap (high-risk)', result);
  } catch (err) {
    console.error('  Error:', err.message);
  }

  // ── Scenario 3: Low-risk asset — expect ALLOW ─────────────────────────────
  banner('SCENARIO 3 — Low-risk asset (expect ALLOW or THROTTLE)');
  try {
    const result = await executeSwap({
      chain: 'solana',
      from_asset: 'USDC',
      to_asset: LOW_RISK_MINT,
      notional_usd: 500,
      slippage_bps: 30,
    });
    printResult('execute_swap (low-risk)', result);
  } catch (err) {
    console.error('  Error:', err.message);
  }

  // ── Scenario 4: Irreversible action hardening ──────────────────────────────
  banner('SCENARIO 4 — Bridge attempt on risky token (always tightens)');
  try {
    const result = await executeSwap({
      chain: 'solana',
      from_asset: 'SOL',
      to_asset: HIGH_RISK_MINT,
      notional_usd: 1000,
      slippage_bps: 50,
      kind: 'bridge',
    });
    printResult('execute_swap (bridge / irreversible)', result);
  } catch (err) {
    console.error('  Error:', err.message);
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log('  Demo complete.');
  console.log('  Agents see DENIED / SIMULATION_ONLY / EXECUTED.');
  console.log('  They cannot override. They cannot negotiate.');
  console.log('  Survivor decides. Always.');
  console.log('─'.repeat(60));
  console.log('');
}

runDemo().catch(err => {
  console.error('Demo failed:', err.message);
  process.exit(1);
});