/**
 * SURVIVOR × MCP Tool Layer
 * These are the tools agents call. Every execution-bearing tool
 * passes through Survivor Gate before touching any DEX or chain.
 *
 * Gate URL configurable via GATE_URL env var.
 * Default: http://localhost:8787
 *
 * Each tool returns a structured response the agent can reason about:
 *   { status: 'DENIED' | 'SIMULATION_ONLY' | 'EXECUTED', ... }
 */

const GATE_URL = (process.env.GATE_URL || 'http://localhost:8787').replace(/\/$/, '');

// ─── Gate call ───────────────────────────────────────────────────────────────

async function callGate(intent) {
  const res = await fetch(`${GATE_URL}/gate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(intent),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gate error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// ─── DEX execution stubs (replace with real Jupiter / 0x calls) ──────────────

async function simulateSwap(intent) {
  // TODO: replace with Jupiter quote API or 0x price endpoint
  return {
    expected_output_usd: intent.notional_usd * 0.98,
    estimated_slippage_bps: intent.slippage_bps,
    simulated: true,
    venue: intent.venue || 'jupiter',
  };
}

async function executeSwapOnDex(intent) {
  // TODO: replace with actual Jupiter swap or 0x swap execution
  // This stub returns a fake tx for demo purposes
  return {
    tx_hash: `SIM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    executed_notional_usd: intent.notional_usd,
    executed_slippage_bps: intent.slippage_bps,
    venue: intent.venue || 'jupiter',
    chain: intent.chain || 'solana',
    simulated: true, // remove when real execution is wired
  };
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * execute_swap
 * Governed token swap. Survivor must approve before any execution occurs.
 *
 * @param {object} input
 * @param {string} input.chain          e.g. "solana"
 * @param {string} input.from_asset     e.g. "SOL" or a mint address
 * @param {string} input.to_asset       Target token mint address
 * @param {number} input.notional_usd   Trade size in USD
 * @param {number} input.slippage_bps   Max acceptable slippage in basis points
 * @param {string} [input.venue]        Optional DEX preference
 */
async function executeSwap(input) {
  const intent = {
    chain: input.chain || 'solana',
    from_asset: input.from_asset,
    to_asset: input.to_asset,
    notional_usd: input.notional_usd,
    slippage_bps: input.slippage_bps || 100,
    kind: 'swap',
    venue: input.venue,
  };

  // STEP 1: Survivor Gate — the only path to execution
  let gateResult;
  try {
    gateResult = await callGate(intent);
  } catch (err) {
    return {
      status: 'ERROR',
      error: `Gate unavailable: ${err.message}`,
      action: 'Execution halted — cannot trade without risk assessment',
    };
  }

  const { decision, oracle } = gateResult;

  // STEP 2: Enforce the decision
  if (decision.mode === 'BLOCK') {
    return {
      status: 'DENIED',
      reason: decision.error,
      policy: {
        decision: decision.policy.decision,
        reasons: decision.policy.reasons,
        confidence: decision.policy.confidence,
      },
      token: oracle,
      action: 'No execution occurred.',
    };
  }

  if (decision.mode === 'SIMULATE') {
    const quote = await simulateSwap(decision.intent);
    return {
      status: 'SIMULATION_ONLY',
      quote,
      policy: {
        decision: decision.policy.decision,
        reasons: decision.policy.reasons,
        confidence: decision.policy.confidence,
      },
      token: oracle,
      action: 'Quote only — token risk too high for live execution.',
    };
  }

  // FORWARD (ALLOW or THROTTLE)
  const wasConstrained = decision.constrained;
  const finalIntent = decision.intent;

  const tx = await executeSwapOnDex(finalIntent);

  return {
    status: 'EXECUTED',
    tx,
    policy: {
      decision: decision.policy.decision,
      reasons: decision.policy.reasons,
      confidence: decision.policy.confidence,
      ...(wasConstrained && {
        constrained: true,
        original_notional_usd: decision.original_notional_usd,
        executed_notional_usd: finalIntent.notional_usd,
        note: 'Position size reduced by Survivor policy',
      }),
    },
    token: oracle,
  };
}

/**
 * get_token_risk
 * Read-only risk assessment. No execution. Safe to call freely.
 *
 * @param {object} input
 * @param {string} input.mint   Token mint address
 * @param {string} [input.kind] Intent kind to evaluate policy for (default: swap)
 */
async function getTokenRisk(input) {
  const res = await fetch(`${GATE_URL}/gate/policy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mint: input.mint, kind: input.kind || 'swap' }),
  });

  if (!res.ok) {
    throw new Error(`Gate policy error: ${res.status}`);
  }

  const data = await res.json();
  return {
    mint: data.mint,
    score: data.score.score,
    risk_tier: data.score.risk_tier,
    confidence: data.score.confidence,
    reasons: data.score.reasons,
    policy: data.policy,
    token: data.score.oracle_meta,
  };
}

// ─── Tool manifest (MCP-compatible) ─────────────────────────────────────────

const TOOLS = {
  execute_swap: {
    name: 'execute_swap',
    description: [
      'Execute a token swap governed by Survivor risk policy.',
      'Survivor evaluates the target token before any execution.',
      'May return DENIED, SIMULATION_ONLY, or EXECUTED depending on risk.',
      'Position size may be automatically reduced (THROTTLE) to safe limits.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['from_asset', 'to_asset', 'notional_usd'],
      properties: {
        chain: { type: 'string', description: 'Chain identifier', default: 'solana' },
        from_asset: { type: 'string', description: 'Source asset (symbol or mint)' },
        to_asset: { type: 'string', description: 'Target token mint address' },
        notional_usd: { type: 'number', description: 'Trade size in USD' },
        slippage_bps: { type: 'number', description: 'Max slippage in basis points', default: 100 },
        venue: { type: 'string', description: 'DEX preference (jupiter, 0x, etc.)' },
      },
    },
    handler: executeSwap,
  },

  get_token_risk: {
    name: 'get_token_risk',
    description: [
      'Get Survivor risk assessment for a token without executing any trade.',
      'Returns score, risk tier, structured reasons, and the execution policy',
      'that would apply if a swap were attempted.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['mint'],
      properties: {
        mint: { type: 'string', description: 'Token mint address to evaluate' },
        kind: { type: 'string', description: 'Intent kind for policy calculation', default: 'swap' },
      },
    },
    handler: getTokenRisk,
  },
};

module.exports = { TOOLS, executeSwap, getTokenRisk };