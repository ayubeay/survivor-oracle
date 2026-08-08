/* Phase 0 capability firewall.
 *
 * Robinhood's OAuth grant carries one scope, "internal", covering cross-account reads AND
 * trade authority in the Agentic account. There is no read-only scope to request. So
 * observation-only is not a permission we can obtain - it is a property this runtime must
 * construct.
 *
 * Enforcement lives here, below the model. A prompt instructing an agent not to trade is
 * not a control. This rejects forbidden tool names before any request leaves the process.
 *
 *     OAuth grants:            READ + TRADE + MUTATE
 *     this runtime exposes:    READ
 *     agent-visible surface:   READ
 */

const PHASE_0_MODEL = 'phase0-capability-firewall-v1';

/* Observation-only. A tool must be named here to be callable at all. */
const PHASE_0_ALLOW = new Set([
  'get_account_details',
  'get_portfolio',
  'get_positions',
  'get_buying_power',
  'get_pnl',
  'get_orders',
  'get_order_history',
  'get_watchlists',
  'get_quote',
  'get_quotes',
  'get_historical_data',
  'get_market_data',
  'search_instruments',
]);

/* Named explicitly so a denial can state WHY rather than only that the tool was unlisted. */
const KNOWN_MUTATING = {
  place_equity_order:  'ORDER_PLACEMENT',
  place_option_order:  'ORDER_PLACEMENT',
  cancel_equity_order: 'ORDER_MUTATION',
  cancel_option_order: 'ORDER_MUTATION',
  replace_equity_order:'ORDER_MUTATION',
  modify_equity_order: 'ORDER_MUTATION',
  create_watchlist:    'WATCHLIST_MUTATION',
  update_watchlist:    'WATCHLIST_MUTATION',
  delete_watchlist:    'WATCHLIST_MUTATION',
  add_to_watchlist:    'WATCHLIST_MUTATION',
};

/* review_* is DENIED in phase 0 despite appearing non-executing.
 * Robinhood documents review and place as separate calls, which suggests review does not
 * transmit an order - but "suggests" is not "established". It stays denied until live
 * inspection confirms its semantics. Assuming a tool is safe because its name sounds safe
 * is the error this whole layer exists to prevent. */
const PENDING_CLASSIFICATION = {
  review_equity_order: 'SEMANTICS_UNVERIFIED',
  review_option_order: 'SEMANTICS_UNVERIFIED',
};

function checkToolCall(toolName, args) {
  const at = new Date().toISOString();
  const base = { model_version: PHASE_0_MODEL, tool: toolName, checked_at: at };

  if (typeof toolName !== 'string' || !toolName) {
    return { ...base, decision: 'DENY', reason: 'INVALID_TOOL_NAME' };
  }
  if (PHASE_0_ALLOW.has(toolName)) {
    return { ...base, decision: 'ALLOW', reason: 'OBSERVATION_ONLY_TOOL' };
  }
  if (KNOWN_MUTATING[toolName]) {
    return { ...base, decision: 'DENY', reason: 'PHASE_0_MUTATION_DISABLED',
             category: KNOWN_MUTATING[toolName],
             note: 'The OAuth token permits this. This runtime does not expose it.' };
  }
  if (PENDING_CLASSIFICATION[toolName]) {
    return { ...base, decision: 'DENY', reason: 'PHASE_0_PENDING_CLASSIFICATION',
             category: PENDING_CLASSIFICATION[toolName],
             note: 'Denied until live inspection establishes whether this mutates state.' };
  }
  /* Unknown tools default DENY. A tool Robinhood adds tomorrow must not become callable
     because nobody listed it. */
  return { ...base, decision: 'DENY', reason: 'PHASE_0_UNKNOWN_TOOL_DEFAULT_DENY',
           note: 'Not on the observation allowlist. Unlisted tools are denied by default.' };
}

/* The only path to the transport. Anything reaching the wire passes through here. */
async function guardedCall(transport, toolName, args) {
  const check = checkToolCall(toolName, args);
  if (check.decision !== 'ALLOW') {
    const err = new Error('Blocked by phase 0 capability firewall: ' + check.reason);
    err.receipt = check;
    throw err;
  }
  const result = await transport(toolName, args);
  return { result, receipt: { ...check, executed: true } };
}

/* Tools the live server offers that we have never classified - surfaced rather than
   silently denied, so the gap is visible instead of invisible. */
function auditToolList(liveToolNames) {
  const unclassified = liveToolNames.filter(n =>
    !PHASE_0_ALLOW.has(n) && !KNOWN_MUTATING[n] && !PENDING_CLASSIFICATION[n]);
  return {
    model_version: PHASE_0_MODEL,
    live_tool_count: liveToolNames.length,
    allowed: liveToolNames.filter(n => PHASE_0_ALLOW.has(n)),
    known_mutating: liveToolNames.filter(n => KNOWN_MUTATING[n]),
    pending: liveToolNames.filter(n => PENDING_CLASSIFICATION[n]),
    unclassified,
    all_unclassified_default_deny: true,
  };
}

module.exports = { checkToolCall, guardedCall, auditToolList,
                   PHASE_0_ALLOW, KNOWN_MUTATING, PENDING_CLASSIFICATION, PHASE_0_MODEL };
