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

  /* What authority the CREDENTIAL carries, as distinct from what the connector can do.
     Robinhood exposes nothing to narrow: one OAuth scope, "internal", covering cross-account
     reads and trade authority together, with no per-credential permission surface found
     across the five surfaces searched on 2026-08-15.

     NOT_EXPOSED is an observation, not a gap in ours. That is what makes it usable: a
     credential here cannot be narrowed at the venue, so every bound on it is client-side,
     and declareCredentialGrant refuses to record that silently. */
  credential_grant_model: {
    surface: 'NOT_EXPOSED',
    observed_at: '2026-08-15',
    permissions: null,
    mandatory: null,
    default_grant: null,
    minimum_observed_grant: null,
    class_requirements: null,
    product_scope_controls: 'NOT_EXPOSED',
    product_scope_of_execution: 'UNKNOWN',
    evidence: 'OAuth scope is a single value, "internal". No mandate or permission fields ' +
              'in the Trading MCP tool surface (54 tools), the account model, the ' +
              'place_equity_order schema, or the Agentic account UI, which offers only ' +
              'Disconnect. Five surfaces, searched - not a claim about all of Robinhood.',
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
    /* Confirmed visually 2026-08-19: a three-step progress indicator reading
       Set up -> Verify -> Connect, with Set up active. */
    flow: ['set_up', 'verify', 'connect'],
    screen_title: 'Generate API key',
    screen_subtitle: 'Select the preferences of your key',
    /* The feature is presented as Agent Key; the setup screen calls the artifact an API
       key. Recorded because the two names appear in different places for the same thing. */
    artifact_named: 'API key',

    expiration_options: ['30 days', '60 days', '90 days'],
    expiration_default: '30 days',
    expiration_shortest_offered: '30 days',
    /* A bottom sheet of radio buttons, 30 days filled. One value, not a combination. */
    expiration_control: 'SINGLE_SELECT_RADIO',

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
    /* A bottom sheet headed `Permissions`, one row per permission with a check control on
       the right. Seen 2026-08-20 with all nine checked - the All (default) state - which
       confirms the nine labels and their order exactly as recorded above.

       What the picture does NOT distinguish: which of them can be unchecked. All nine
       render identically when checked, so the irreducibility of View balance &
       transactions rests on the interaction that tried to remove it, not on anything
       visible in the list. Do not expect a future screenshot to show which one is
       mandatory. */
    permissions_control: 'CHECKBOX_LIST_IN_BOTTOM_SHEET',
    permissions_list_visually_confirmed: true,
    permissions_mandatory_visually_distinguishable: false,

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
       through box by box - and none appeared under Execute trades when that checkbox was
       itself opened. Record it as an absence in this UI. It is NOT evidence that
       'Execute trades' covers every product, and it is NOT evidence that it does not -
       the UI simply does not say. Do not infer its semantics.

       This is now the load-bearing uncertainty. A key holding the observed minimum plus
       Execute trades is close to least privilege on the MONEY-MOVEMENT axis and completely
       unbounded on the PRODUCT axis, on a venue with 343 perpetual swaps, 341 of them at
       50x. The mandate's instruments.allowed_types and max_leverage carry that dimension
       alone, with no credential-side backstop. */
    permissions_instrument_granularity: 'NOT_EXPOSED_IN_AGENT_KEY_UI',

    weekly_limit_range_usd: [1000, 20000],
    weekly_limit_scope: 'UNVERIFIED',        // per key or per account, not established

    /* What the Set up step shows about its own consequences, which is: nothing. The
       primary button reads "Generate API key" and is enabled. No warning, no
       irreversibility notice, no one-time-display caution appears on this screen.

       That absence is NOT evidence that pressing it is reversible, and NOT evidence that
       the key is created at that moment rather than after Verify. Set up is step one of
       three and what the other two do has not been seen. The button was not pressed. */
    generate_button: 'PRESENT_AND_ENABLED',
    generate_consequences_stated_on_screen: 'NONE_VISIBLE',
    generate_reversibility: 'UNKNOWN',
    key_creation_moment: 'UNKNOWN',

    observed_at: '2026-08-19',
    first_seen_at: '2026-08-15',
    observation_method: 'setup screen inspected by the account holder and reviewed ' +
                        'directly from screenshots; no key generated, Generate never ' +
                        'pressed, nothing submitted',

    unknown: ['what a hand-picked permission set is honoured as at execution time',
              'whether Execute trades spans spot, perpetuals and margin - the load-bearing ' +
                'uncertainty now that money movement is excludable',
              'whether View balance & transactions is mandatory at the venue or only in ' +
                'this setup UI',
              'whether the weekly limit is per key or per account',
              'whether generating a key is reversible, and revocation behaviour',
              'whether ANY of these controls actually refuses a violation'],
  },

  /* What authority a CREDENTIAL can carry here, as distinct from what the venue can do.
     This is the connector that forced the distinction to exist: the venue supports cash
     withdrawals, All (default) grants them, and a configured key can exclude them. Three
     different answers to three different questions.

     Everything below is OBSERVED in the setup surface on 2026-08-19 and VERIFIED nowhere.
     No key has been generated and Generate has never been pressed, which is why any grant
     declared against this connector carries credential_status NOT_YET_ISSUED and therefore
     authorises nothing at runtime. */
  credential_grant_model: {
    surface: 'OBSERVED_CONFIGURABLE',
    observed_at: '2026-08-19',

    permissions: [
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
    /* Will not uncheck. The one irreducible permission. */
    mandatory: ['View balance & transactions'],
    /* All nine. This is the grant you get by not choosing - and it moves money. */
    default_grant: [
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
    minimum_observed_grant: ['View balance & transactions'],

    /* Which permissions an operation class needs before this runtime will attempt it.
       INFERRED FROM THE PERMISSION LABELS, not observed - the venue was never seen to
       refuse anything, and the labels are all we have.

       Safe in both directions BECAUSE IT IS ONLY EVER USED TO RESTRICT. If a label means
       less than it appears, we attempt something the credential cannot do and the venue
       refuses - no capital moves. If some other permission also enables the class, we
       refuse an operation that would have worked - inconvenient, not dangerous. Neither
       error direction spends money, which is the only reason an inference is tolerable
       here at all. */
    class_requirements: {
      MUTATE_ORDER:    ['Execute trades'],
      OBSERVE_ACCOUNT: ['View balance & transactions'],
      OBSERVE_MARKET:  ['View market data & insights'],
    },
    class_requirements_state: 'INFERRED_FROM_PERMISSION_LABELS',

    /* TWO DIFFERENT CLAIMS, and collapsing them is how a UI observation becomes a
       semantic assumption.

       WHAT WAS OBSERVED - `Execute trades` is a single checkbox. Selecting and opening it
       exposes no additional product controls: no sub-permissions, no tooltip, no
       spot / perpetual / margin split, no leverage limit, no instrument selector, no
       order-type scope. That is an absence IN THE AGENT KEY UI, directly observed, and it
       is a fact about the interface.

       WHAT REMAINS UNKNOWN - what `Execute trades` actually authorises. The absence of
       controls is not evidence that it covers everything, nor that it covers spot only,
       nor spot plus perps. It is evidence that the UI does not say. Another surface might;
       none has been examined.

       Why the absence matters more than it looks: the account is not a single-product
       account. It exposes several distinct product families (see account_surface below),
       so one undifferentiated trading checkbox sits above a genuinely wide surface. That
       makes the missing granularity significant rather than merely unsurprising.

       Consequence for this layer: the credential CANNOT independently bound product type.
       instruments.allowed_types and instruments.max_leverage carry it alone, backed by
       connector reconciliation and the firewall, with no credential-side backstop. */
    product_scope_controls: 'NOT_EXPOSED_IN_AGENT_KEY_UI',
    product_scope_of_execution: 'UNKNOWN',
    product_scope_evidence: 'Direct UI observation 2026-08-19: Execute trades is one ' +
      'checkbox; opening it revealed no sub-permissions, tooltip, product split, leverage ' +
      'control, instrument selector or order-type scope. Absence in this UI only.',

    /* Account-surface observation, 2026-08-19, recorded because it changes how significant
       the absence above is - and fenced because it is the most inviting place in this file
       to make an unsupported inference.

       MUST NOT be used to conclude that an Agent Key can operate any of these. It
       establishes what the ACCOUNT exposes and nothing about what the CREDENTIAL carries.
       Agent Key sits under More, separately, labelled Beta. */
    account_surface: {
      observed_at: '2026-08-19',
      inference_permitted: false,
      establishes: 'ACCOUNT_SURFACE_ONLY',
      account_tier: 'BASIC',

      /* Read off the account menus, by section heading, as displayed. Fuller than the
         first pass, which summarised and dropped entries. */
      menu_sections: {
        Trade:  ['Recurring Buy', 'Limit Order', 'Crypto Baskets', 'Price alerts', 'TWAP'],
        Stocks: ['Trend watch', 'Discovery', 'Whale Baskets'],
        Predict: ['Strike Options', 'UpDown Options'],
        Assets: ['Tokens Wallet', 'Cash', 'Stocks'],
        Spend:  ['Card', 'Pay'],
        Earn:   ['DeFi Yield', 'Airdrop Arena', 'Crypto Earn'],
        Rewards: ['Rewards Hub', 'Campaigns'],
        Retirement: ['IRAs'],
        /* The section Agent Key actually lives in, seen 2026-08-20. */
        More:   ['Agent Key', 'University', 'Settings'],
      },
      benefits_page: ['Banking: 3% APY on cash', 'Banking: Instant Global Transfer (Coming Soon)',
                      'Card: Spend with Crypto.com Card', 'Stocks: 1% Transfer Bonus',
                      'IRAs: 1% Match contributions', 'IRAs: 1% Transfer',
                      'IRAs: 1% Roll over', 'Services: Up to 5% back on Crypto.com Travel'],
      product_families: ['crypto trading (Recurring Buy, Limit Order, Crypto Baskets, ' +
                           'Price alerts, TWAP)',
                         'Stocks (Trend watch, Discovery, Whale Baskets)',
                         'prediction products (Strike Options, UpDown Options)',
                         'Tokens Wallet', 'Cash', 'Card/Pay', 'Earn', 'Rewards', 'IRAs'],

      /* PROVENANCE, revised 2026-08-20 - and revised UPWARDS, which is worth as much as
         the downgrade was.

         On 2026-08-19 these two were recorded as reported-not-seen, because the images
         reviewed that day stopped short of the section containing them. A later capture
         reached it: a `More` group holding Agent Key with a `Beta` chip, above University
         and Settings, below a Retirement group holding IRAs. Both claims are now
         confirmed by looking.

         The correction sequence is left visible rather than tidied into a single confident
         line. A claim that was downgraded for lack of evidence and later re-established
         BY evidence is a different thing from one that was simply always asserted, and the
         difference is the part worth keeping. */
      agent_key_placement: 'under More, labelled Beta, above University and Settings',
      agent_key_maturity: 'BETA',
      agent_key_provenance: 'VISUALLY_CONFIRMED',
      agent_key_provenance_history: [
        '2026-08-19 REPORTED_BY_ACCOUNT_HOLDER_NOT_VISUALLY_CONFIRMED',
        '2026-08-20 VISUALLY_CONFIRMED - More section reached in a later capture',
      ],

      note: 'Recorded as text on purpose. The evidence is photographs of a live personal ' +
            'account showing an account holder name, email address and reward balances; ' +
            'no image, no personal identifier and no account balance is committed to ' +
            'this repository.',
    },

    /* DOCUMENTED - a provenance level distinct from everything above it.
     *
     * First-party crypto.com surfaces only, read 2026-08-21. Forums, third-party blogs and
     * search-result snippets were excluded by construction, not filtered afterwards.
     *
     * NONE OF THIS IS ENFORCEMENT EVIDENCE. Documentation describing a control and the
     * venue refusing an action are different claims, and only the second earns
     * VERIFIED_ENFORCED. The repository has made this mistake once already: Robinhood's
     * PRE_AUTHORIZED contract was recorded from documentation and a five-surface search
     * later found no mechanism behind it. */
    official_documentation: {
      researched_at: '2026-08-21',
      provenance: 'DOCUMENTED',
      enforcement_claim: 'NONE',
      /* Every documented statement below is framed around the OpenClaw integration
         specifically, not the Agent Key as a general venue credential. */
      documented_for: 'OPENCLAW_INTEGRATION',
      sources: [
        'help.crypto.com/en/articles/13843786-api-key-management',
        'help.crypto.com/en/articles/13843782-getting-started',
        'help.crypto.com/en/articles/13843765-openclaw-trading-overview',
        'help.crypto.com/en/articles/13886868-support',
        'crypto.com/en/product-news/openclaw-integration',
        'crypto.com/us/crypto/learn/how-to-set-up-openclaw-on-cryptocom',
        'crypto.com/en/product-news/cryptocom-exchange-openclaw-ai-agents',
      ],

      /* A SECOND, DIFFERENT KIND OF FIRST-PARTY SOURCE, kept separate from the web pages
         above on purpose. These are crypto.com-owned TECHNICAL material, admissible because
         ownership is pinned to one named repository that the crypto.com help centre itself
         links and calls open source - not because GitHub is trusted generally. Widening the
         source test to "anything on github" would admit community forks and reverse
         engineering, which this project excludes by construction. */
      technical_repository_sources: {
        owner: 'crypto-com',
        repository: 'crypto-com/crypto-agent-trading',
        linked_from: 'help.crypto.com/en/articles/13913493-agent-skill-github-repository',
        described_by_venue_as: 'The Agent Skill is open source',
        files_read: ['README.md', 'repository file listing', 'crypto-com-app/SKILL.md'],
        /* READ-PATH CAVEAT, carried rather than flattened. These files were retrieved
           through a fetch layer that summarises with a small model, not by direct raw-byte
           inspection. First-party material, mediated read. The Exchange endpoint below came
           from documentation quoted directly and does not carry this caveat. */
        read_path: 'FIRST_PARTY_RAW_FILE_VIA_SUMMARISING_FETCH_LAYER',
      },

      states: {
        /* "Execute trading: Allows the agent to place trades (market orders only)." and
           "supports Market orders (One-Time Buy or Sell)". A real narrowing, on the ORDER
           TYPE axis - which is not the product axis and does not answer it. */
        order_types: 'MARKET_ONLY',
        /* "Currently, the OpenClaw integration supports cryptocurrency trading, with more
           asset types to come." So stocks and prediction products are documented as NOT
           currently in scope. Spot versus perpetuals versus margin is never distinguished
           anywhere - see product_scope_of_execution, which stays UNKNOWN. */
        asset_scope: 'CRYPTOCURRENCY_ONLY_MORE_ASSET_TYPES_TO_COME',
        secret_visibility: 'SHOWN_ONCE_AT_SETUP',
        rotation_effect: 'OLD_KEY_INVALIDATED_IMMEDIATELY_CONNECTED_AGENTS_DISCONNECTED',
        permission_editing_after_issuance: 'SUPPORTED_PENDING_ORDERS_PRESERVED',
        /* Two triggers, and the second was not visible in the UI at all. */
        expiry_triggers: ['selected duration, default 30 days',
                          '30 days of inactivity (no API calls)'],
        expiry_effect: 'all trading via the integration stops',
        /* Independent documentary support for the interaction-observed mandatory
           permission, in different words: "Access portfolio balance is always enabled to
           allow the agent to function." */
        always_enabled_permission: 'portfolio balance access',
        documented_permissions: ['Execute trading', 'Portfolio balance', 'Market data'],
        /* CORRECTED 2026-08-21, second pass. See corrections below for the prior wording.
           It sat among venue-side facts and read like a venue control; the venue's own
           agent skill implements it as a CLIENT-SIDE setting the user can switch off. */
        confirmation_mode: 'AGENT_SIDE_CLIENT_SETTING_NOT_VENUE_CONTROL',
        confirmation_mode_detail: 'the skill defaults to requiring user confirmation and ' +
          'exposes opt-out to auto-execution via a memory.confirmation_required setting',
        /* Strengthened, and only to documentary strength. The App skill exposes API key
           revocation as an API operation, which is more than "documented as existing" and
           still says nothing about in-flight orders, immediacy, or whether the server
           actually refuses a revoked key. */
        kill_switch: 'API_KEY_REVOCATION_EXPOSED_AS_API_OPERATION',
        kill_switch_enforcement: 'NOT_STATED',
        kill_switch_in_flight_semantics: 'NOT_STATED',
        weekly_limit_default_usd: 10000,
        weekly_limit_scope: 'NOT_STATED',
        /* Documented in the App skill. Connector behaviour, not an authority bound. */
        rate_limits: { trades_per_minute: 10, api_calls_per_minute: 100, on_exceed: 'HTTP_429' },
      },

      /* PRESERVED, NOT RESOLVED. Choosing a winner would discard evidence, and in every
         case here the sources disagree about something that cannot be settled without
         evidence this project has deliberately not gathered. */
      contradictions: [
        {
          subject: 'withdrawal authority',
          documented_strong: 'High-risk actions, like withdrawing funds, are strictly ' +
                             'off-limits - product announcement',
          documented_weak: 'designed with trade-only permissions, which means it should ' +
                           'not be able to withdraw or transfer funds - US how-to',
          observed: 'Make cash withdrawals is one of nine permissions and is CHECKED under ' +
                    'All (default) - VISUALLY_CONFIRMED',
          status: 'UNRESOLVED',
          technical_first_party: 'the crypto.com-owned App agent skill exposes withdrawal ' +
                    'order creation and execution, and bank account management and linking, ' +
                    'as capability families reachable with an Agent Key, and states the key ' +
                    'requires permissions for trading, balances, deposits and withdrawals - ' +
                    'DOCUMENTED, mediated read path',
          /* Four legs now, not three, and they do not converge. The technical material is
             the strongest of the four and it agrees with the SCREEN, not with the
             announcement. Reading INFERRED: the announcement describes the intended
             integration configuration, not the credential capability. Make cash withdrawals
             is not decorative. Still not enforcement evidence either way. */
          posture: 'UNCHANGED. withdrawal_prohibition stays OBSERVED_EXCLUDABLE_NOT_DEFAULT. ' +
                   'Two official pages disagree with each other on strength, and both ' +
                   'disagree with the screen. Either the documentation is stale against the ' +
                   'app, or the permission is present and inert. Nothing here relaxes the ' +
                   'rule against accepting the default grant.',
        },
        {
          subject: 'permission count',
          documented: 'exactly three, consistently across three independent pages',
          observed: 'nine, INTERACTION_OBSERVED and VISUALLY_CONFIRMED, including six cash ' +
                    'and banking permissions absent from every documented list',
          status: 'UNRESOLVED',
          note: 'Consistent across three pages, so not a single omission. The documented ' +
                'always-enabled portfolio permission does corroborate the observed ' +
                'mandatory one, in different wording.',
        },
        {
          subject: 'weekly limit default',
          documented: '$10,000',
          observed: '$1,000, slider at the floor, VISUALLY_CONFIRMED',
          status: 'UNRESOLVED',
          note: 'The declaration records only the range, which both sources agree on. ' +
                'No default is declared, and none should be until they agree.',
        },
      ],

      research_unknowns: {
        OFFICIAL_DOCUMENTATION_SUBSTANTIVE_BUT_SILENT_ON_THIS: [
          'spot versus perpetuals versus margin within cryptocurrency trading',
          'weekly limit scope - per credential, per agent or per account',
          'weekly limit enforcement mechanism',
          'whether deselected permissions are refused server-side',
          'what revocation does to an in-flight agent',
          'whether a revoked key is actually refused by the server, and what happens to ' +
            'orders already in flight - revocation is exposed as an API operation, which ' +
            'is not the same as observing it refuse anything',
          'the exact moment the credential becomes live in the setup sequence',
          'whether generation is reversible',
          'whether an App Agent Key authenticates against Exchange API endpoints - the two ' +
            'surfaces are documented separately and never related to each other',
          'whether the two surfaces share internal backend infrastructure beneath their ' +
            'distinct hosts',
        ],
        OFFICIAL_DOCUMENTATION_SPARSE_OR_INSUFFICIENT: [
          'revocation mechanics generally',
          'the Weekly Trading Budget article referenced by the trading overview, which ' +
            'could not be located as a reachable URL',
        ],
        OFFICIAL_SOURCE_UNREACHABLE_FROM_ENVIRONMENT: [],
      },
    },

    /* UNRESOLVED ARCHITECTURAL QUESTION, opened 2026-08-21. Recorded rather than fixed.
     *
     * Crypto.com documents two DIFFERENT credential systems:
     *
     *   App      Agent Key, under More, Beta, the nine-permission screen observed here,
     *            documented only for the OpenClaw integration
     *   Exchange classic API keys via Account Management -> API Management, with
     *            Can Read / Enable Trading, and no Agent Key feature referenced at all
     *
     * This declaration is CRYPTO_COM_EXCHANGE, endpointed at api.crypto.com/exchange/v1,
     * and carries an App-derived credential model - while its own product_boundary already
     * says the App and the Exchange are different universes.
     *
     * The tension predates this research; the documentation makes it concrete. Whether it
     * needs two connectors (crypto_com_app_agent_key and crypto_com_exchange_api) or merely
     * credential profiles within one turns on a question nobody has answered: do App Agent
     * Keys call the Exchange API surface, or a different backend?
     *
     * DO NOT refactor on the strength of the question alone. Answer it first. */
    /* ANSWERED 2026-08-21, second pass, and the question above is left standing because
       the sequence is the useful part.

       Crypto.com-owned technical material settles it at the level a connector models. The
       venue ships ONE repository containing TWO separate skills:

         crypto-com-app        host wapi.crypto.com, credentials CDC_API_KEY/CDC_API_SECRET
                               taken from the Agent Key management guide, two-step
                               quote-then-confirm trade flow, plus fiat, bank account and
                               withdrawal capability families
         crypto-com-exchange   host api.crypto.com/exchange/v1, Exchange API credentials,
                               private/create-order with amend and cancel, LIMIT and MARKET

       And the Exchange REST/WS documentation mentions Agent Key, agent, OpenClaw and the
       Crypto.com App exactly nowhere.

       DISTINCT_EXECUTION_SURFACES is a claim about hosts, credentials, method vocabularies
       and capability families - the things a connector declaration models. It is NOT proof
       that crypto.com runs separate internal backends. Shared infrastructure behind two
       gateways is excluded by nothing found, and no source addresses it. Whether an App
       Agent Key would authenticate against an Exchange endpoint is likewise unestablished.

       The DESIGN decision this unblocks is still open: two connector declarations, or one
       crypto_com venue carrying app_agent_key and exchange_api_key execution profiles.
       That needs an audit of what currently assumes CRYPTO_COM_EXCHANGE. Not this commit. */
    credential_model_attribution: 'DISTINCT_EXECUTION_SURFACES',
    credential_model_attribution_history: [
      '2026-08-21 UNRESOLVED_APP_VS_EXCHANGE - documentation described both, related neither',
      '2026-08-21 DISTINCT_EXECUTION_SURFACES - venue-owned agent repository ships two ' +
        'skills with different hosts, credentials, methods and capability families',
    ],
    credential_model_caveat: 'EXECUTION_SURFACE_CLAIM_NOT_BACKEND_ARCHITECTURE_CLAIM',
    execution_surfaces: {
      app_agent_key: {
        host: 'https://wapi.crypto.com',
        host_provenance: 'DOCUMENTED_VIA_SUMMARISING_FETCH_LAYER',
        credential_env: ['CDC_API_KEY', 'CDC_API_SECRET'],
        order_model: 'two-step quote then confirm',
        capability_families: ['trading', 'balances', 'transaction history', 'fiat and cash',
                              'bank account management', 'deposits', 'withdrawals',
                              'weekly trading limit retrieval', 'API key revocation'],
      },
      exchange_api: {
        host: 'https://api.crypto.com/exchange/v1/',
        host_provenance: 'DOCUMENTED_QUOTED_DIRECTLY',
        sandbox_host: 'https://uat-api.3ona.co/exchange/v1/',
        auth: 'api_key plus HMAC-SHA256 sig plus nonce',
        order_methods: ['private/create-order', 'private/create-order-list'],
        order_types: 'LIMIT and MARKET, with amend and cancel',
        mentions_agent_key: false,
      },
      app_key_accepted_by_exchange_endpoints: 'UNKNOWN',
      shared_backend_beneath_hosts: 'UNKNOWN',
    },

    evidence: 'Setup screen read 2026-08-15 and worked through box by box 2026-08-19 by ' +
              'the account holder. Eight of nine permissions uncheck, including Make cash ' +
              'withdrawals and Execute trades; View balance & transactions will not. ' +
              'Selection observed; honouring at execution time never observed. Official ' +
              'documentation read 2026-08-21 - see official_documentation.',
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
