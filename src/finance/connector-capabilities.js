/* Connector capability declaration.
 *
 * Discovered, not assumed. Today's answers are dated because they are observations about
 * one venue at one moment, and a connector's surface can change.
 *
 * The important field is AUTONOMY. Availability alone is not enough - Robinhood permits
 * equity execution AND states that the agent must obtain explicit human confirmation
 * first. A Sniper that treats "available" as "unattended" would violate the venue's own
 * stated contract.
 */

const ROBINHOOD_AGENTIC = {
  connector: 'robinhood_agentic',
  endpoint: 'https://agent.robinhood.com/mcp/trading',
  observed_at: '2026-08-14',
  server_version: '1.1.1',

  capabilities: {
    'equity.observe':        'AVAILABLE',
    'equity.review':         'AVAILABLE',
    'equity.execute':        'AVAILABLE',
    'equity.autonomy':       'DUAL_CONTRACT',   // see execution_contracts below
    'options.observe':       'AVAILABLE',
    'options.execute':       'NOT_PERMITTED',   // no option_level on the agentic account
    'index.observe':         'AVAILABLE',
    'crypto.observe':        'NOT_EXPOSED',
    'crypto.execute':        'NOT_EXPOSED',
    'scanner':               'AVAILABLE',       // 56 filters incl. options flow
  },

  /* TWO contracts, not one. An earlier version of this file recorded
     HUMAN_CONFIRMATION_REQUIRED as the venue ceiling. That was wrong - it encoded a
     property of the review WORKFLOW as a property of the VENUE. Robinhood's Agentic
     Trading documentation states plainly that a user may instruct an agent to act without
     asking approval, and gives automation examples. Corrected 2026-08-14. */
  execution_contracts: {
    REVIEWED: {
      sequence: ['review', 'present_preview_and_disclosure', 'explicit_human_confirmation', 'place'],
      disclosure_required: 'market_data_disclosure verbatim and unmodified',
      alerts_required: 'any non-empty order_checks surfaced verbatim',
      trigger: 'the agent chose to call review_equity_order',
      source: 'review_equity_order tool guide, observed 2026-08-14',
      note: 'The guide says confirmation is required EVEN WHEN order_checks is empty - ' +
            'because the user asked to review, they get to review.',
    },
    PRE_AUTHORIZED: {
      sequence: ['standing_mandate', 'condition_met', 'admissibility', 'place'],
      trigger: 'a standing user instruction to act without per-trade approval',
      source: 'Robinhood Agentic Trading overview: "if you have asked your agent to take ' +
              'action without asking your approval, it can place trades without your ' +
              'confirmation"; disclosures state trades may be executed without direct ' +
              'input on each transaction',
      status: 'DOCUMENTED_CLIENT_GOVERNED_AUTHORITY',
      /* Searched, 2026-08-15. No mechanism for expressing granular bounds on standing
         autonomous authority was observed in any of:
           - the Trading MCP tool surface (54 tools)
           - the OAuth scope (single value, "internal")
           - the returned account model (no mandate fields)
           - the place_equity_order schema (no authorization parameter)
           - the Agentic account UI (Agent is not clickable; only Disconnect is offered,
             and "Let your agent trade options" is ordinary product onboarding with
             suitability questions, not a mandate editor)

         This is not a claim that no such mechanism exists anywhere in Robinhood. It is a
         statement about five specific surfaces. */
      authority_layers_observed: {
        connection: 'Robinhood governs this - agent connected, Disconnect available',
        account: 'Robinhood governs this - only agentic_allowed accounts accept execution',
        product: 'Robinhood governs this - options require separate eligibility onboarding',
        mandate_bounds: 'NOT OBSERVED on any Robinhood surface - appears client-governed',
      },
    },
  },

  market_data: {
    finest_interval: 'minute',            // 15second returns 0 bars
    depth: 'level_2_with_size',
    indicators: ['rsi','macd','bollinger_bands','sma','ema','vwap','atr'],
    indicators_unavailable: ['stochastic'],
    read_latency_ms: [113, 423],
    session_aware: true,                  // regular vs non-reg trade times differ
  },

  /* What review does NOT provide. Recorded because it was expected and is not there. */
  execution_cost: {
    fees_from_broker: 'NOT_PROVIDED',
    estimated_fill: 'NOT_PROVIDED',
    spread: 'DERIVABLE_FROM_QUOTE',       // bid/ask only
    note: 'Spread is not total realized cost. Slippage, regulatory fees and market ' +
          'movement become measurable only from real executions.',
  },
};

/* Autonomy ceilings differ per connector. A lane inherits its venue's ceiling. */
const AUTONOMY = {
  UNATTENDED_WITHIN_POLICY: 'agent may execute within governed limits',
  HUMAN_CONFIRMATION_REQUIRED: 'agent may propose and review; a human must confirm each order',
  OBSERVE_ONLY: 'no execution capability',
};

function autonomyFor(connector, capability) {
  const c = connector && connector.capabilities;
  return (c && c[capability + '.autonomy']) || 'OBSERVE_ONLY';
}

/* Stronger than counting orders. Equal counts prove nothing once an account has activity -
   an order could be created and another cancelled between snapshots. Identity and status
   are the durable invariant. */
function orderStateFingerprint(orders) {
  return (orders || []).map(o => [
    o.id || o.order_id || o.ref_id || '?',
    o.state || o.status || '?',
    o.created_at || o.updated_at || '?',
  ].join(':')).sort();
}

function verifyNoMutation(before, after) {
  const b = orderStateFingerprint(before);
  const a = orderStateFingerprint(after);
  const added = a.filter(x => b.indexOf(x) === -1);
  const removed = b.filter(x => a.indexOf(x) === -1);
  return {
    unchanged: added.length === 0 && removed.length === 0,
    added, removed,
    before_count: b.length, after_count: a.length,
    method: 'order id + state + timestamp set comparison',
    note: 'Count equality alone is insufficient once an account has activity.',
  };
}

module.exports = { ROBINHOOD_AGENTIC, AUTONOMY, autonomyFor,
                   orderStateFingerprint, verifyNoMutation };
