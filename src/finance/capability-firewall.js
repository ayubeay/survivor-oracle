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
const { permitsClass, RISK_BEARING_CLASS } = require('./credential-grant');

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
  /* Promoted 2026-08-14 for review_equity_order ONLY - see REVIEW_PROMOTION below.
     Not a blanket SIMULATE allowance. review_option_order stays denied: options are not
     permitted on the agentic account, so a review there would be meaningless anyway. */
  SIMULATE: 'DENY',
  MUTATE_METADATA: 'DENY',
  MUTATE_ORDER: 'DENY_BY_DEFAULT_ALLOW_ONLY_WITH_VALID_EXECUTION_AUTHORIZATION',
  EXERCISE_DERIVATIVE: 'DENY',
  ACCOUNT_CONFIGURATION: 'DENY',
  UNKNOWN: 'DENY',
};

/* Classified against the live surface returned by tools/list on 2026-08-08, v1.1.1. */
/* Capability-specific promotion. A generic SIMULATE=ALLOW would have permitted
   review_option_order too, on an account with no options permission. Permission is granted
   to one named capability with its evidence and constraints recorded beside it. */
const REVIEW_PROMOTION = {
  review_equity_order: {
    classification: 'NON_EXECUTING_SIMULATION',
    effect: 'NO_CAPITAL_MOVEMENT',
    permission: 'ALLOW',
    evidence: 'Robinhood tool description: "Simulate a stock order without placing it. ' +
              'Returns the current quote plus pre-trade alerts (buying power, PDT, ' +
              'instrument halt, etc.)." place_equity_order is described as mirroring its ' +
              'parameters plus ref_id, making review the explicit non-placing twin.',
    constraints: [
      'agentic_allowed account only',
      'review endpoint only - no automatic escalation to place',
      'response captured as evidence',
      'order state verified before and after every call',
    ],
    verification_required: 'get_equity_orders before and after; any new order reverts this.',
    promoted_at: '2026-08-14',
  },
};

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

/* The credential dimension, added 2026-08-19.
 *
 * Two keys at the same venue can carry different authority - Crypto.com's Agent Key
 * demonstrated it - so the connector surface no longer describes what an execution may do.
 * The credential does, and it has to be presented here, on the only path to transport,
 * rather than checked once at issuance and trusted afterwards.
 *
 * Risk-bearing classes only. Denying a quote lookup because a permission list is unparsed
 * protects nothing and teaches callers to route around the firewall. */
function credentialCheck(cls, credentialGrant) {
  if (RISK_BEARING_CLASS.indexOf(cls) === -1) return null;
  const c = permitsClass(credentialGrant, cls);
  if (c.permitted) return null;
  return { decision: 'DENY', reason: 'CREDENTIAL_GRANT_REFUSED',
           credential_failure: c.code, detail: c.detail,
           note: 'Absent or insufficient credential authority for a risk-bearing ' +
                 'capability. No credential-grant information is not the same as ' +
                 'unrestricted authority.' };
}

function checkToolCall(toolName, args, authorization, currentSnapshotId, mandate,
                       credentialGrant) {
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
  /* One named capability, promoted on stated evidence, with verification attached. */
  if (REVIEW_PROMOTION[toolName]) {
    const pr = REVIEW_PROMOTION[toolName];
    return { ...base, decision: 'ALLOW', reason: 'CAPABILITY_SPECIFIC_PROMOTION',
             classification: pr.classification, effect: pr.effect,
             constraints: pr.constraints, verification_required: pr.verification_required };
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
    /* Authority (mandate), instrument (credential), and permission for one action
       (authorization) are three separate things, and all three have to hold. */
    const cred = credentialCheck(cls, credentialGrant);
    if (cred) return { ...base, ...cred };
    const v = verifyAuthorization({ auth: authorization, order: args,
                                    capability: toolName, currentSnapshotId, mandate,
                                    credentialGrant });
    if (!v.valid) {
      return { ...base, decision: 'DENY', reason: 'EXECUTION_AUTHORIZATION_INVALID',
               authorization_failure: v.code, detail: v.detail };
    }
    return { ...base, decision: 'ALLOW', reason: 'VALID_EXECUTION_AUTHORIZATION',
             authorization_id: v.authorization_id, single_use: true,
             /* On the receipt, because "who could have done this" is a question about the
                credential and the connector cannot answer it. */
             credential_alias: credentialGrant.credential_alias,
             credential_grant_state: credentialGrant.grant_state,
             credential_venue_enforcement: credentialGrant.venue_enforcement };
  }
  return { ...base, decision: 'DENY', reason: 'PHASE_0_CLASS_DENIED',
           note: cls === CLASS.SIMULATE
             ? 'review_* self-describes as non-placing but its schema has not been captured. Denied until separately promoted.'
             : 'The OAuth token permits this. This runtime does not expose it.' };
}

async function guardedCall(transport, toolName, args, authorization, currentSnapshotId,
                           mandate, credentialGrant) {
  const check = checkToolCall(toolName, args, authorization, currentSnapshotId, mandate,
                              credentialGrant);
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
    /* Re-checked here, not merely at the advisory step above, so a credential swapped or
       revoked between check and consume cannot ride through. Same reason the mandate is
       re-verified rather than trusted from the first pass. */
    const cred = credentialCheck(check.capability_class, credentialGrant);
    if (cred) {
      const err = new Error('Blocked at consumption: ' + cred.credential_failure);
      err.receipt = { ...check, ...cred };
      throw err;
    }
    const v = verifyAndConsume({ auth: authorization, order: args,
                                 capability: toolName, currentSnapshotId, mandate,
                                 credentialGrant });
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
function auditToolList(liveToolNames, serverInfo, credentialGrant) {
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
    /* An audit that names only the connector cannot say what the credential in hand could
       have done. Null means no grant was presented, which is itself the finding. */
    credential_alias: (credentialGrant && credentialGrant.credential_alias) || null,
    credential_grant_state: (credentialGrant && credentialGrant.grant_state) || 'UNKNOWN',
    credential_bounded_by_venue: credentialGrant ? credentialGrant.bounded_by_venue : null,
    credential_venue_enforcement: (credentialGrant && credentialGrant.venue_enforcement) || 'UNKNOWN',
  };
}

module.exports = { checkToolCall, guardedCall, auditToolList, classify, credentialCheck,
                   CLASS, PHASE_0_POSTURE, TOOL_CLASS, REVIEW_PROMOTION, PHASE_0_MODEL };
