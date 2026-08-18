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

  /* Declared so a mandate can be reconciled against it. Absent this, the instrument-type
     check silently skipped and a mandate granting perpetual swaps on an equities-only
     broker was accepted - a control that does not run looks exactly like one that passed. */
  instruments: {
    by_type: { CCY_PAIR: 0, EQUITY: 1, OPTION: 0 },
    max_leverage_observed: 1,
    note: 'Equities only on the agentic account. Options are exposed but the account has ' +
          'no option_level, so option execution is NOT_PERMITTED. No leverage, no perps.',
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

/* Crypto.com Exchange - public surface, observed 2026-08-15.
 *
 * Only the PUBLIC endpoints have been examined. Nothing here is authenticated, so every
 * account-side question - agent keys, venue-enforced budgets, expiry, confirmation modes,
 * withdrawal prohibition - is marked UNVERIFIED rather than assumed from documentation.
 *
 * The distinction matters: OpenClaw's documentation describes weekly trading budgets and
 * trading-only credentials, but that is a different product from a US App account, and the
 * Robinhood investigation already showed what happens when documentation is read as
 * capability. */
const CRYPTO_COM_EXCHANGE = {
  connector: 'crypto_com_exchange',
  endpoint: 'https://api.crypto.com/exchange/v1',
  observed_at: '2026-08-15',
  observation_scope: 'PUBLIC_ENDPOINTS_ONLY',

  capabilities: {
    'spot.observe':          'AVAILABLE',
    'spot.execute':          'UNVERIFIED',      // needs an authenticated credential
    'perpetual.observe':     'AVAILABLE',
    'perpetual.execute':     'UNVERIFIED',
    'future.observe':        'AVAILABLE',
    'orderbook.depth':       'AVAILABLE',
    /* Observed in the US App account on 2026-08-15. The Agent Key screen offers
       Expiration, Permissions and a Weekly trading limit with a Remaining counter - so the
       venue tracks consumption, not merely a configured ceiling.

       OBSERVED, not VERIFIED: the configuration surface was seen, enforcement behaviour was
       not tested. A limit that exists in a settings screen and a limit that actually
       rejects an order are different claims. */
    'agent_key':             'AVAILABLE',
    'venue_trading_budget':  'OBSERVED_WEEKLY_WITH_REMAINING',
    'venue_key_expiry':      'OBSERVED_CONFIGURABLE',
    'venue_key_permissions': 'OBSERVED_CONFIGURABLE',
    'withdrawal_prohibition':'UNVERIFIED',
    'sandbox':               'UNVERIFIED',
  },

  instruments: {
    total: 930,
    by_type: { CCY_PAIR: 577, PERPETUAL_SWAP: 343, FUTURE: 10 },
    untradable: 0,
    quote_currencies: ['USD', 'USDT', 'BTC', 'EUR', 'PYUSD', 'CRO', 'ETH'],
    /* The reason the mandate grew leverage bounds. A venue offering 50x on 341 instruments
       makes "permitted to trade crypto" an unsafe grant without an instrument-type bound. */
    max_leverage_observed: 100,
    perps_at_50x: 341,
    perps_at_100x: 2,
    spot_pairs_with_margin: 144,
    per_instrument_fields: ['max_leverage', 'margin_buy_enabled', 'margin_sell_enabled',
                            'contract_size', 'underlying_symbol', 'expiry_timestamp_ms',
                            'price_tick_size', 'qty_tick_size', 'tradable'],
  },

  market_data: {
    depth: 'level_2_with_order_count',   // [price, size, order_count] per level
    depth_levels_observed: 10,
    spread_observed_bps: 0.16,           // BTC_USD, one cent on $63,097
    note: 'AAPL measured 2-3bp on Robinhood. Materially tighter microstructure here.',
  },

  /* The App and the Exchange are different products with different universes. BNB is held
     in the App and absent from the Exchange instrument list. Same lesson as Robinhood's
     consumer crypto not reaching the agent surface. */
  product_boundary: {
    app_and_exchange_differ: true,
    evidence: 'BNB held in the App, NOT LISTED on the Exchange. CAW and VVS are listed.',
  },

  execution_contracts: {
    UNKNOWN: {
      status: 'NOT_INVESTIGATED',
      note: 'No authenticated surface examined. Whether Crypto.com requires confirmation, ' +
            'permits standing mandates, or enforces budgets at the credential is unknown.',
    },
  },
};

module.exports = { ROBINHOOD_AGENTIC, CRYPTO_COM_EXCHANGE, AUTONOMY, autonomyFor,
                   orderStateFingerprint, verifyNoMutation };
