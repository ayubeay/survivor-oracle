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
    'venue_key_expiry':      'OBSERVED_CONFIGURABLE_MIN_30_DAYS',
    'venue_key_permissions': 'OBSERVED_CONFIGURABLE_DEFAULT_INCLUDES_WITHDRAWALS',
    /* Two different questions, and they got two different answers on the same day.

       Is withdrawal authority absent from the credential a venue issues?  NO -
       All (default) checks "Make cash withdrawals".
       CAN it be excluded from the credential we choose to issue?          YES - the box
       unchecks, along with seven others.

       The second question is the one that matters for issuing a key, and it is the one a
       capability firewall should be asking. Recorded as EXCLUDABLE rather than ABSENT
       because the exclusion was seen in the setup UI and has never been seen to hold
       against an actual withdrawal attempt. */
    'withdrawal_prohibition':'OBSERVED_EXCLUDABLE_NOT_DEFAULT',
    'sandbox':               'UNVERIFIED',
  },

  /* The weekly trading limit slider starts at $1,000 - OBSERVED in the setup UI, not
     verified by attempting a violation. Recorded here because it establishes a conditional
     granularity fact: IF the limit is enforced as represented, it cannot align with a small
     experimental mandate and could only act as an outer wall.

     That conditional does not upgrade the enforcement state. Venue-enforced does not imply
     sufficiently bounded, and observed does not imply enforced. */
  venue_limit_floors: { total_budget_usd: 1000 },

  /* The same granularity argument as the $1,000 budget floor, in the time dimension:
     30 days is the SHORTEST expiry the venue offers, so a key cannot be bounded to the
     length of a short first experiment. Venue expiry can only ever be an outer wall here;
     the operative expiry stays the mandate's own.

     NOT yet consumed by reconcileWithConnector - that function compares a dollar floor and
     has no duration comparison, so a verified expiry would today report VENUE_ALIGNED
     regardless of how short the mandate is. Recorded rather than quietly fixed, because the
     gap is real and fixing it needs its own tests. Inert while venue_key_expiry stays
     OBSERVED_*, which short-circuits to UNVERIFIED before any floor is read. */
  venue_expiry_floor_days: 30,

  /* CONFIGURABLE IS NOT SAFELY CONFIGURED.
   *
   * This sits alongside the two distinctions already recorded - observed is not enforced,
   * and enforced is not sufficiently bounded - and it is the one that bites first. The
   * Agent Key surface is genuinely configurable, and its DEFAULT grant is broader than any
   * admissible agent mandate: nine permissions checked, including cash withdrawals and the
   * bank-account and deposit views that surround them.
   *
   * A key generated by accepting the defaults would carry withdrawal authority to an
   * autonomous agent. That is why no key exists yet and why Generate stays untouched. The
   * venue expressing authority at the venue is worth something only if the expressed
   * authority is narrowed on purpose.
   *
   * Read the permission list as evidence about the DEFAULT, not about the floor. The nine
   * are displayed individually; whether they can be deselected one by one, and what a
   * hand-picked set is actually honoured as, was not observed. */
  agent_key_setup: {
    flow: ['set_up', 'verify', 'connect'],

    expiration_options: ['30 days', '60 days', '90 days'],
    expiration_default: '30 days',
    expiration_shortest_offered: '30 days',

    permissions_default: 'All (default)',
    /* Verbatim, in the order displayed, all CHECKED under All (default). */
    permissions_checked_under_default: [
      'Execute trades',
      'View market data & insights',
      'View balance & transactions',
      'View cash deposit info',
      'Send cash deposit info',
      'View cash withdrawal details',
      'Make cash withdrawals',
      'View bank accounts',
      'View deposit & withdrawal limits',
    ],
    permissions_display: 'INDIVIDUALLY_DISPLAYED',

    /* Upgraded 2026-08-19 by direct UI interaction: the account holder unchecked every box
       the interface allowed. Eight of nine came off. One did not.

       So the capability model is better than All (default) made it look. Withdrawal
       authority is removable, and even trade authority is removable. The dangerous thing
       here is the DEFAULT, not the model. */
    permissions_deselection: 'OBSERVED_INDIVIDUALLY_CONFIGURABLE',
    permissions_mandatory: ['View balance & transactions'],
    /* The narrowest grant the UI was seen to allow. Not a key that exists - a floor that
       was observed in the configuration surface. */
    permissions_minimum_observed_grant: ['View balance & transactions'],
    permissions_removable_confirmed: [
      'Execute trades',
      'View market data & insights',
      'View cash deposit info',
      'Send cash deposit info',
      'View cash withdrawal details',
      'Make cash withdrawals',
      'View bank accounts',
      'View deposit & withdrawal limits',
    ],
    /* Still true and still important: unchecking a box in a setup screen is not the same as
       a venue refusing an action the box would have permitted. Selection was observed.
       Honouring was not. */
    permissions_honoured_at_execution: 'NOT_OBSERVED',

    /* No spot / perpetual / margin / leverage distinction appeared anywhere in the
       permission list, and none appeared under Execute trades when the list was worked
       through box by box. Record that as granularity NOT OBSERVED. It is NOT evidence that
       'Execute trades' covers every product, and it is NOT evidence that it does not -
       the list simply does not speak to instrument type. Do not infer its semantics.

       This is now the load-bearing uncertainty. A key holding the observed minimum plus
       Execute trades is close to least privilege on the MONEY-MOVEMENT axis and completely
       unbounded on the PRODUCT axis, on a venue with 343 perpetual swaps, 341 of them at
       50x. The mandate's instruments.allowed_types and max_leverage carry that dimension
       alone, with no credential-side backstop. */
    permissions_instrument_granularity: 'NOT_OBSERVED',

    weekly_limit_range_usd: [1000, 20000],
    weekly_limit_scope: 'UNVERIFIED',        // per key or per account, not established

    observed_at: '2026-08-19',
    first_seen_at: '2026-08-15',
    observation_method: 'setup screen inspected by the account holder; no key generated, ' +
                        'Generate never pressed, nothing submitted',

    unknown: ['what a hand-picked permission set is honoured as at execution time',
              'whether Execute trades spans spot, perpetuals and margin - the load-bearing ' +
                'uncertainty now that money movement is excludable',
              'whether View balance & transactions is mandatory at the venue or only in ' +
                'this setup UI',
              'whether the weekly limit is per key or per account',
              'whether generating a key is reversible, and revocation behaviour',
              'whether ANY of these controls actually refuses a violation'],
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
