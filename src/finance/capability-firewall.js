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
 *
 * Classification is by CAPABILITY CLASS, not by name. The first version used a hand-written
 * allowlist and 43 of 54 live tools fell through unclassified - get_positions did not
 * exist, get_pnl did not exist, and two mutating tools nobody anticipated (exercise_option,
 * cancel_option_exercise) sat in the unclassified pile. Names invented in advance do not
 * survive contact with a real server. Classes are stable where names are not.
 */

const { verifyAuthorization, verifyAndConsume } = require('./execution-authorization');

const PHASE_0_MODEL = 'phase0-capability-firewall-v2';

/* Capability classes. A tool belongs to exactly one. */
const CLASS = {
  OBSERVE_ACCOUNT: 'OBSERVE_ACCOUNT',             // this account's holdings, orders, P&L
  OBSERVE_MARKET: 'OBSERVE_MARKET',               // public prices and instrument data
  OBSERVE_HISTORY: 'OBSERVE_HISTORY',             // historical bars and past events
  ANALYZE: 'ANALYZE',                             // derived computation over market data
  DISCOVERY: 'DISCOVERY',                         // search and instrument resolution
  SIMULATE: 'SIMULATE',                           // order preview without placement
  MUTATE_METADATA: 'MUTATE_METADATA',             // watchlists, scanners - no capital effect
  MUTATE_ORDER: 'MUTATE_ORDER',                   // places, cancels or replaces orders
  EXERCISE_DERIVATIVE: 'EXERCISE_DERIVATIVE',     // option exercise and its cancellation
  ACCOUNT_CONFIGURATION: 'ACCOUNT_CONFIGURATION', // margin and options-level upgrades
  UNKNOWN: 'UNKNOWN',
};

/* Phase 0 posture per class. Adding a tool never changes this; classifying one does. */
const PHASE_0_POSTURE = {
  OBSERVE_ACCOUNT: 'ALLOW',
  OBSERVE_MARKET: 'ALLOW',
  OBSERVE_HISTORY: 'ALLOW',
  DISCOVERY: 'ALLOW',
  ANALYZE: 'ALLOW',
  SIMULATE: 'DENY',                 // review_* self-describes as non-placing; schema not
                                    // yet captured, so it stays denied until promoted
  MUTATE_METADATA: 'DENY',
  MUTATE_ORDER: 'DENY_BY_DEFAULT_ALLOW_ONLY_WITH_VALID_EXECUTION_AUTHORIZATION',
  EXERCISE_DERIVATIVE: 'DENY',
  ACCOUNT_CONFIGURATION: 'DENY',
  UNKNOWN: 'DENY',
};

/* Classified against the live surface returned by tools/list on 2026-08-08, v1.1.1. */
const TOOL_CLASS = {
  // account observation
  get_accounts: CLASS.OBSERVE_ACCOUNT,
  get_portfolio: CLASS.OBSERVE_ACCOUNT,
  get_equity_positions: CLASS.OBSERVE_ACCOUNT,
  get_option_positions: CLASS.OBSERVE_ACCOUNT,
  get_equity_orders: CLASS.OBSERVE_ACCOUNT,
  get_option_orders: CLASS.OBSERVE_ACCOUNT,
  get_equity_tax_lots: CLASS.OBSERVE_ACCOUNT,
  get_realized_pnl: CLASS.OBSERVE_ACCOUNT,
  get_pnl_trade_history: CLASS.OBSERVE_ACCOUNT,
  get_watchlists: CLASS.OBSERVE_ACCOUNT,
  get_watchlist_items: CLASS.OBSERVE_ACCOUNT,
  get_option_watchlist: CLASS.OBSERVE_ACCOUNT,
  get_scans: CLASS.OBSERVE_ACCOUNT,

  // market observation
  get_equity_quotes: CLASS.OBSERVE_MARKET,
  get_equity_price_book: CLASS.OBSERVE_MARKET,
  get_equity_fundamentals: CLASS.OBSERVE_MARKET,
  get_equity_tradability: CLASS.OBSERVE_MARKET,
  get_option_quotes: CLASS.OBSERVE_MARKET,
  get_option_chains: CLASS.OBSERVE_MARKET,
  get_option_instruments: CLASS.OBSERVE_MARKET,
  get_index_quotes: CLASS.OBSERVE_MARKET,
  get_indexes: CLASS.OBSERVE_MARKET,
  get_financials: CLASS.OBSERVE_MARKET,
  get_popular_watchlists: CLASS.OBSERVE_MARKET,
  get_scanner_filter_specs: CLASS.OBSERVE_MARKET,

  // historical
  get_equity_historicals: CLASS.OBSERVE_HISTORY,
  get_option_historicals: CLASS.OBSERVE_HISTORY,
  get_index_historicals: CLASS.OBSERVE_HISTORY,
  get_earnings_calendar: CLASS.OBSERVE_HISTORY,
  get_earnings_results: CLASS.OBSERVE_HISTORY,

  // derived computation
  get_equity_technical_indicators: CLASS.ANALYZE,
  run_scan: CLASS.ANALYZE,

  // discovery
  search: CLASS.DISCOVERY,

  // simulation
  review_equity_order: CLASS.SIMULATE,
  review_option_order: CLASS.SIMULATE,

  // metadata mutation - no capital effect, still denied in phase 0
  create_watchlist: CLASS.MUTATE_METADATA,
  update_watchlist: CLASS.MUTATE_METADATA,
  add_to_watchlist: CLASS.MUTATE_METADATA,
  remove_from_watchlist: CLASS.MUTATE_METADATA,
  add_option_to_watchlist: CLASS.MUTATE_METADATA,
  remove_option_from_watchlist: CLASS.MUTATE_METADATA,
  follow_watchlist: CLASS.MUTATE_METADATA,
  unfollow_watchlist: CLASS.MUTATE_METADATA,
  create_scan: CLASS.MUTATE_METADATA,
  update_scan_config: CLASS.MUTATE_METADATA,
  update_scan_filters: CLASS.MUTATE_METADATA,

  // capital effect
  place_equity_order: CLASS.MUTATE_ORDER,
  place_option_order: CLASS.MUTATE_ORDER,
  cancel_equity_order: CLASS.MUTATE_ORDER,
  cancel_option_order: CLASS.MUTATE_ORDER,

  // derivative exercise - neither of these was anticipated before the live listing
  exercise_option: CLASS.EXERCISE_DERIVATIVE,
  cancel_option_exercise: CLASS.EXERCISE_DERIVATIVE,

  // account configuration
  get_limited_margin_upgrade_info: CLASS.ACCOUNT_CONFIGURATION,
  get_option_level_upgrade_info: CLASS.ACCOUNT_CONFIGURATION,
};

function classify(toolName) {
  if (typeof toolName !== 'string' || !toolName) return CLASS.UNKNOWN;
  return TOOL_CLASS[toolName] || CLASS.UNKNOWN;
}

function checkToolCall(toolName, args, authorization, currentSnapshotId) {
  const at = new Date().toISOString();
  const cls = classify(toolName);
  const posture = PHASE_0_POSTURE[cls] || 'DENY';
  const base = { model_version: PHASE_0_MODEL, tool: toolName, capability_class: cls,
                 phase_0_posture: posture, checked_at: at };

  if (cls === CLASS.UNKNOWN) {
    return { ...base, decision: 'DENY', reason: 'PHASE_0_UNCLASSIFIED_DEFAULT_DENY',
             note: 'Not classified against the observed capability surface. Classify before use.' };
  }
  if (posture === 'ALLOW') {
    return { ...base, decision: 'ALLOW', reason: 'CLASS_PERMITTED_IN_PHASE_0' };
  }
  /* MUTATE_ORDER is never generally permitted. It becomes reachable only for one exact
     action carrying a valid, unexpired, unused execution authorization - and closes again
     immediately. The absence of an authorization is the normal case. */
  if (posture === 'DENY_BY_DEFAULT_ALLOW_ONLY_WITH_VALID_EXECUTION_AUTHORIZATION') {
    if (!authorization) {
      return { ...base, decision: 'DENY', reason: 'NO_EXECUTION_AUTHORIZATION',
               note: 'Capital-moving capability. Denied unless an execution authorization ' +
                     'binds this exact action.' };
    }
    const v = verifyAuthorization({ auth: authorization, order: args,
                                    capability: toolName, currentSnapshotId });
    if (!v.valid) {
      return { ...base, decision: 'DENY', reason: 'EXECUTION_AUTHORIZATION_INVALID',
               authorization_failure: v.code, detail: v.detail };
    }
    return { ...base, decision: 'ALLOW', reason: 'VALID_EXECUTION_AUTHORIZATION',
             authorization_id: v.authorization_id, single_use: true };
  }
  return { ...base, decision: 'DENY', reason: 'PHASE_0_CLASS_DENIED',
           note: cls === CLASS.SIMULATE
             ? 'review_* self-describes as non-placing but its schema has not been captured. Denied until separately promoted.'
             : 'The OAuth token permits this. This runtime does not expose it.' };
}

async function guardedCall(transport, toolName, args, authorization, currentSnapshotId) {
  const check = checkToolCall(toolName, args, authorization, currentSnapshotId);
  if (check.decision !== 'ALLOW') {
    const err = new Error('Blocked by phase 0 capability firewall: ' + check.reason);
    err.receipt = check;
    throw err;
  }
  /* Re-verify AND consume atomically. checkToolCall above is advisory; this is the
     transition that actually spends the grant. Two concurrent callers cannot both pass
     here, and a transport failure still leaves the authorization spent - a failed
     execution must not resurrect permission. */
  if (check.authorization_id) {
    const v = verifyAndConsume({ auth: authorization, order: args,
                                 capability: toolName, currentSnapshotId });
    if (!v.valid) {
      const err = new Error('Blocked at consumption: ' + v.code);
      err.receipt = { ...check, decision: 'DENY', reason: 'EXECUTION_AUTHORIZATION_INVALID',
                      authorization_failure: v.code };
      throw err;
    }
  }
  const result = await transport(toolName, args);
  return { result, receipt: { ...check, executed: true } };
}

/* A capability surface receipt. If the server grows from 54 tools to 58, the four new ones
   are UNKNOWN and therefore denied - drift is visible rather than silently absorbed. */
function auditToolList(liveToolNames, serverInfo) {
  const byClass = {};
  liveToolNames.forEach(n => {
    const c = classify(n);
    (byClass[c] = byClass[c] || []).push(n);
  });
  const unknown = byClass[CLASS.UNKNOWN] || [];
  return {
    model_version: PHASE_0_MODEL,
    server: (serverInfo && serverInfo.name) || null,
    server_version: (serverInfo && serverInfo.version) || null,
    tools_observed: liveToolNames.length,
    classified: liveToolNames.length - unknown.length,
    unclassified: unknown.length,
    unclassified_tools: unknown,
    by_class: byClass,
    allowed_now: liveToolNames.filter(n => PHASE_0_POSTURE[classify(n)] === 'ALLOW'),
    denied_now: liveToolNames.filter(n => PHASE_0_POSTURE[classify(n)] !== 'ALLOW'),
    unknown_default_policy: 'DENY',
    mutation_enabled: false,
    credential_persisted: false,
  };
}

module.exports = { checkToolCall, guardedCall, auditToolList, classify,
                   CLASS, PHASE_0_POSTURE, TOOL_CLASS, PHASE_0_MODEL };
