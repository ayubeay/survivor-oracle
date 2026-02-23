/**
 * SURVIVOR Gate — Enforcement Layer
 * Takes an intent + policy → GateResult
 *
 * GateResult modes:
 *   FORWARD  — execute (with constraints applied if THROTTLE)
 *   SIMULATE — read-only quote/simulate only
 *   BLOCK    — hard stop, do not execute
 */

/**
 * Apply constraints to intent (clamps notional + slippage).
 * Returns a new intent object — never mutates original.
 */
function clampIntent(intent, constraints) {
  const next = { ...intent };
  if (typeof constraints.max_notional_usd === 'number') {
    next.notional_usd = Math.min(next.notional_usd, constraints.max_notional_usd);
  }
  if (typeof constraints.max_slippage_bps === 'number') {
    next.slippage_bps = Math.min(next.slippage_bps, constraints.max_slippage_bps);
  }
  return next;
}

/**
 * @param {object} intent      Original trade intent from agent
 * @param {object} policy      SurvivorPolicy from buildPolicy()
 * @returns {GateResult}
 */
function enforce(intent, policy) {
  const now = Math.floor(Date.now() / 1000);

  if (policy.expires_at <= now) {
    return {
      ok: false,
      mode: 'BLOCK',
      error: 'Policy expired — re-request Survivor evaluation',
      policy,
    };
  }

  switch (policy.decision) {
    case 'DENY':
      return {
        ok: false,
        mode: 'BLOCK',
        error: 'Execution denied by Survivor policy',
        policy,
      };

    case 'READ_ONLY':
      return {
        ok: true,
        mode: 'SIMULATE',
        intent,
        policy,
      };

    case 'THROTTLE': {
      const throttledIntent = clampIntent(intent, policy.constraints);
      return {
        ok: true,
        mode: 'FORWARD',
        intent: throttledIntent,
        constrained: true,
        original_notional_usd: intent.notional_usd,
        policy,
      };
    }

    case 'ALLOW':
      return {
        ok: true,
        mode: 'FORWARD',
        intent,
        constrained: false,
        policy,
      };

    default:
      return {
        ok: false,
        mode: 'BLOCK',
        error: `Unknown policy decision: ${policy.decision}`,
        policy,
      };
  }
}

module.exports = { enforce, clampIntent };