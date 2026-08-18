# Robinhood Trading MCP - live capability surface, observed 2026-08-08

Raw observation. Classification is a separate artifact; this file records what the server
actually returned, not what we decided about it.

## Session
    server            robinhood-trading v1.1.1
    protocol          2025-06-18
    client            shared public client via PKCE, no per-client identity
    scope             internal (single scope; scope=internal required on authorize)
    token lifetime    774,924 seconds - approximately nine days
    token persisted   no
    account reads     none performed
    mutations         none performed

The nine-day token lifetime was far longer than assumed. It reinforces rather than weakens
the decision not to persist: a leaked token is a nine-day brokerage credential.

## 54 tools returned by tools/list

    add_option_to_watchlist          add_to_watchlist
    cancel_equity_order              cancel_option_exercise
    cancel_option_order              create_scan
    create_watchlist                 exercise_option
    follow_watchlist                 get_accounts
    get_earnings_calendar            get_earnings_results
    get_equity_fundamentals          get_equity_historicals
    get_equity_orders                get_equity_positions
    get_equity_price_book            get_equity_quotes
    get_equity_tax_lots              get_equity_technical_indicators
    get_equity_tradability           get_financials
    get_index_historicals            get_index_quotes
    get_indexes                      get_limited_margin_upgrade_info
    get_option_chains                get_option_historicals
    get_option_instruments           get_option_level_upgrade_info
    get_option_orders                get_option_positions
    get_option_quotes                get_option_watchlist
    get_pnl_trade_history            get_popular_watchlists
    get_portfolio                    get_realized_pnl
    get_scanner_filter_specs         get_scans
    get_watchlist_items              get_watchlists
    place_equity_order               place_option_order
    remove_from_watchlist            remove_option_from_watchlist
    review_equity_order              review_option_order
    run_scan                         search
    unfollow_watchlist               update_scan_config
    update_scan_filters              update_watchlist

## First audit result
    allowed (observation)      2   get_portfolio, get_watchlists
    known mutating             7   add_to_watchlist, cancel_equity_order, cancel_option_order,
                                   create_watchlist, place_equity_order, place_option_order,
                                   update_watchlist
    pending classification     2   review_equity_order, review_option_order
    UNCLASSIFIED              43

## What the unclassified count proves
The allowlist was written from guessed names and mostly guessed wrong. get_positions does
not exist - it is get_equity_positions. get_pnl does not exist - it is get_realized_pnl and
get_pnl_trade_history. Nothing became callable as a result, because unlisted tools default
to DENY.

Two mutating capabilities were never anticipated and sat in the unclassified pile:
exercise_option and cancel_option_exercise. An allowlist built on imagination would have
missed both. Default-deny is what made the guessing survivable.

## Self-described semantics worth noting
    review_equity_order   "Simulate a stock order without placing it. Returns the current
                          quote p..." (truncated in the run)
    place_equity_order    "Place a real equity order with real money. Parameters mirror
                          review_eq..."
    exercise_option       "Exercise a long options position - a call exercises the right to
                          buy t..."

review_* describes itself as non-placing. That is evidence toward promotion but the full
schema has not been captured, so it stays denied.

## Surface is broader than the public documentation suggested
Scanners, saved screeners, option exercise, tax lots, technical indicators, earnings
calendars, index data and margin upgrade paths. A governance layer over this has
considerably more to classify than buy and sell.

## Observation pass results

Reads are ACCOUNT-SCOPED. get_portfolio, get_equity_positions and get_realized_pnl all
require account_number, discovered from get_accounts. Observation is a chain rooted in
account discovery, not a flat list of calls.

### Account model
Three accounts visible: margin, cash, limited_margin. Exactly ONE carries
agentic_allowed: true. Notably the account with option_level_2 is NOT the agentic one - so
an agent may be authorised against an account that cannot trade options at all.

agentic_allowed is Robinhood's own boundary, machine-readable. An order proposed against an
account where it is false is malformed before any risk question arises.

### Policy inputs actually available
get_portfolio returns, in one call:
    total_value, equity_value, options_value, futures_value, event_contracts_value,
    crypto_value, mutual_funds_value, fixed_income_value, cash, pending_deposits, currency
    buying_power { buying_power, unleveraged_buying_power, display_currency }

That is enough for a capital-budget and cross-asset concentration policy. The asset-class
split is more granular than assumed.

get_equity_positions returns a positions array. get_accounts carries type, option_level,
state, unsettled_funds and the agentic flag per account.

### Three distinct failure modes observed
    missing account_number    JSON-RPC error, structured
    missing asset class       PLAIN TEXT, not JSON: "unable to fetch realized P&L: rpc
                              error: code = InvalidArgument desc = un-specified asset class"
    tool not permitted        blocked locally by the firewall, never reaches the wire

A client assuming JSON in content[0].text will throw on the second. Tolerating non-JSON is
required, and the text carries the actual reason.

### Revocation is blind
Every authorization run creates a separate nine-day grant. Because all custom clients share
one client_id, the settings page cannot distinguish them - a user revoking one grant cannot
tell which agent it belonged to.

For a single experiment that is untidy. For a person running several agents it is a real gap
in the model, and an argument for a control plane holding ONE session rather than each agent
holding its own.

### Still not done
No cross-account aggregation yet, which is the reserve's central claim - reading all three
accounts to see total exposure is possible and untested. No policy evaluation. No order,
mutation, simulation or funding.

---

## Lane discovery, 2026-08-14

Read-only. No orders, no review calls, nothing executed.

### No crypto lane exists on the agent surface
    crypto tools in the 54-tool surface     0
    POST /mcp/crypto                        HTTP 404
    search "SOL"                            returns SOLS, Solstice Advanced Materials
    search "bitcoin"                        returns IBIT, iShares Bitcoin Trust ETF
    account model                           no crypto field of any kind

Robinhood the platform trades crypto - SOL, VIRTUAL, BTC, HYPE and others are on the
consumer site. The AGENT surface does not reach it. Those are different statements and must
not be collapsed. This is a capability-discovery result about one connector at one date, not
an architectural limit on a multi-market Sniper.

### The agentic account is equities-only
    margin          option_level_2   agentic_allowed FALSE
    cash / Roth     no option level  agentic_allowed FALSE
    limited_margin  no option level  agentic_allowed TRUE   <- the only agent-tradable one

So the 15 option tools are visible but unusable: the one account an agent may trade in has
no options permission, and the account with option_level_2 is not agent-eligible.

**The only executable agent lane today is equities.** That is a statement about the current
connector capability surface, not a permanent property of the account, of Robinhood, or of
the Sniper. Option permission on the agentic account and a future crypto surface are both
things that could change; the architecture should discover them rather than encode today's
answer.

### Market data surface per equity
    get_equity_quotes               symbols[]                       -> results
    get_equity_price_book           symbols[]                       -> books (level 2)
    get_equity_fundamentals         symbols[], bounds               -> results
    get_equity_historicals          symbols[], start_time, interval -> results
    get_equity_technical_indicators symbol, type, interval, period,
                                    num_std, fast, output           -> indicators
    get_scanner_filter_specs        -                               -> filter_specs

Richer than expected - a real signal surface including order-book depth and configurable
indicators. Nothing equivalent to on-chain liquidity, holder distribution or curve state,
which is the concrete reason MomentumSniper's Solana signals do not transfer.

### Order schemas, captured
    review_equity_order   required account_number, symbol, side, type
                          optional quantity, dollar_amount, limit_price, stop_price,
                                   time_in_force, market_hours, tax_lots
                          "Simulate a stock order without placing it. Returns the current
                           quote plus pre-trade alerts (buying power, PDT, instrument halt)."

    place_equity_order    same plus ref_id
                          "Requires an agentic_allowed=true account; non-agentic accounts
                           are rejected - do not call."

Two things follow. review_* self-describes as non-placing, which is the evidence its PENDING
classification was waiting for - promotable in a later phase. And Robinhood enforces the
agentic_allowed rule server-side, independently confirming the structural gate was checking
the right thing.

### Operational finding: device approval is unreliable
Two sessions where the push approval never arrived. The selfie fallback worked both times.
Re-authentication cannot be assumed available on demand, which makes the nine-day token
window load-bearing for anything running unattended rather than merely convenient.

### Capability declaration - the shape this should eventually take
Rather than hard-coding "Robinhood supports equities and options", a connector should
declare what it exposes:

    connector: robinhood_agentic
      equity.market_data    AVAILABLE
      equity.review         AVAILABLE
      equity.execute        AVAILABLE (agentic_allowed accounts only)
      options.market_data   AVAILABLE
      options.execute       NOT_PERMITTED (no option_level on the agentic account)
      index.market_data     AVAILABLE
      crypto.*              NOT_EXPOSED

Today's discovery is the manual version of what API Connect should eventually produce
automatically. The Sniper should ask infrastructure what exists rather than assume it.

## Where this leaves the work

The question has moved from "what does Robinhood expose?" to "can a robust equity Sniper
lane be built on the surface we just proved exists?"

Characterising the equity lane deeply enough to answer that:

    exact scanner filter specs
    quote freshness and latency
    price-book depth and update behaviour
    available historical intervals
    technical indicator types and parameters
    review-order response contents - alerts, fees, spread, estimated fill
    whether fractional dollar orders are accepted on the agentic account
    market-hours behaviour
    order-state lifecycle after placement
    whether the nine-day token window is stable enough for unattended operation

That last item is not a login inconvenience. **Authentication continuity is part of the
execution architecture.** An agent that loses access unpredictably is not operationally
autonomous, and device approval has now failed twice with only the selfie fallback working.

---

## Equity lane characterisation, 2026-08-14

Read-only. No review calls, no orders.

### Granularity
    15second     0 bars      not supported
    minute    1950 bars      finest usable - 5 days of history
    5minute    390 bars
    10minute   195 bars
    hour        30 bars
    day          4 bars
    week         1 bar

Minute is the floor. That supports intraday, not high-frequency - which is the appropriate
band for a broker-mediated rail anyway.

### Latency
    quotes        113-159ms across three samples
    price book    267ms
    historicals   117-273ms
    indicators    127-423ms

Comfortably fast enough for a minute timeframe.

### Order book has real depth
Not top-of-book. Level 2 with size at each level:

    asks  305.69 x15, 305.70 x50, 305.75 x66, 305.78 x9, 305.80 x329, 305.81 x327 ...

Genuine microstructure, and the closest analogue to the liquidity depth the Solana strategy
reads - though it measures something different.

### Indicators
Working: rsi, macd, bollinger_bands, sma, ema, vwap, atr. stochastic returns 0 points.
Configurable period, num_std, fast.

### Scanner - 56 filters in three families
    fundamentals   PE, forward PE, PEG, EPS, market cap, shares float, shares outstanding,
                   gross/net/operating margin, ROA, ROE, sector, earnings date, ex-dividend
    options flow   implied volatility, historical volatility, open interest, total call and
                   put volume, relative option volume, average call/put volume
    price action   gap, percent change, dollar change, open, high, low, close, last,
                   bid, ask, average volume

**The options-flow filters are usable even though options cannot be traded on the agentic
account.** Screening on unusual call volume, IV expansion or relative option volume as a
signal for an EQUITY position is a legitimate strategy shape and it is available today.

### Market hours matter
The AAPL quote carried venue_last_trade_time 19:59:59Z alongside
venue_last_non_reg_trade_time 22:30Z - regular-session data stale after hours by design.
Any strategy must distinguish session state rather than treating a quote as current.

### Assessment
The surface supports a real intraday equity strategy: minute bars, level 2 depth, seven
indicators, 56 screening filters including options flow, sub-300ms reads. Considerably more
than a toy.

What it does NOT provide, and what therefore does not transfer from the Solana work: token
mints, on-chain liquidity, holder distribution, curve state, DEX routing. Different market
structure, different signals.

---

## review_equity_order promotion and probe, 2026-08-14

Promoted as a capability-specific allowance, not a blanket SIMULATE permission.
review_option_order remains denied - options are not permitted on the agentic account, so a
review there would be meaningless.

### Verified non-executing
    orders before   0
    review call     buy $1 AAPL, market
    orders after    0

Empirical, not inferred from the description.

### What review actually returns
    order_checks              broker alerts
    quote_data                last trade, bid, ask, previous close, venue times, state
    market_data_disclosure    a compliance string
    guide                     instructions to the agent

**It does NOT return fees, commission, estimated fill price or a spread calculation.** The
earlier expectation that it would was wrong. The guide says to estimate execution from the
quote - ask for buys, bid for sells. So execution cost must be modelled from bid/ask rather
than read from the broker, and the policy has no fee input from this source.

### Robinhood expects human confirmation per order
From the guide, verbatim in substance: the agent MUST present the preview and get explicit
confirmation before calling place_equity_order, and this holds even when order_checks is
empty - empty means no alerts, not that confirmation can be skipped.

That is the venue's stated interaction model. It sits against a fully unattended agent, and
any design here must either honour it or be explicit that it does not. Recorded as a
constraint rather than ignored.

### Compliance obligation
market_data_disclosure must be displayed verbatim and unmodified wherever quotes are shown.
Any interface built on this inherits that requirement.

### An alert is live on the account
    order_checks: { alertType: "EQUITY_USER_LEVEL_MARGIN_CALL" }

A margin call flag at user level, surfaced on a $1 review. Possibly related to the negative
balance on the margin account. **Understand this before funding anything.**

---

## State as of 2026-08-14

**COMPLETE:** discovery, characterisation, observation infrastructure.

    connector surface        54 tools, classified, autonomy ceiling encoded
    execution contract       review -> disclosure -> human confirmation -> place
    review boundary          verified non-executing by before/after order state
    market data              minute bars, level 2 depth, 7 indicators, 56 scanner filters
    collector                quotes, books, bars, fundamentals - all four sources writing

**OPEN, in order:**

1. **Account readiness.** EQUITY_USER_LEVEL_MARGIN_CALL surfaced on a $1 review. Resolve
   what it means and what clears it. Blocks funding, not analysis.

2. **Auth continuity.** Every collector run needs interactive authorization, and device
   push has failed on every attempt - only the selfie fallback works. The data becomes
   valuable through VARIATION across sessions, opens, closes, earnings and volatile days,
   which means running for weeks. That is incompatible with a manual login per run.

   Deciding whether to persist the nine-day token is a real change in posture and deserves
   the same deliberate treatment the review promotion got. Phase 0 holds nothing by design;
   this would change that.

3. **Signal calibration.** Only once history has accumulated enough variation to measure
   against. Not before.

4. **Shadow Sniper.** Proposals from calibrated evidence, no execution.

5. **Governed execution.** Only after 1 and 2 are settled.

Next session should start at 1 and 2, not at another market-data probe.

---

## Correction and a finding, 2026-08-14

### The autonomy ceiling was recorded wrong
An earlier entry declared equity.autonomy = HUMAN_CONFIRMATION_REQUIRED. That encoded a
property of the REVIEW WORKFLOW as a property of the VENUE.

Robinhood's Agentic Trading documentation states that a user may instruct an agent to act
without asking approval, and gives automation examples such as buying on a specified price
decline. The disclosures say trades may be executed without direct input on each
transaction.

Two contracts coexist:

    REVIEWED         agent calls review -> presents preview and disclosure
                     -> explicit human confirmation -> place
    PRE_AUTHORIZED   standing user mandate -> condition met -> place

The confirmation requirement attaches to the first because the agent chose to review.

Corrected to DUAL_CONTRACT. PRE_AUTHORIZED is marked
DOCUMENTED_BUT_NOT_TECHNICALLY_CHARACTERISED - the product capability is documented; how the
MCP represents it is not.

### place_equity_order carries no authorization field
    account_number, symbol, side, type, quantity, dollar_amount, limit_price,
    stop_price, time_in_force, market_hours, tax_lots, ref_id

No authorization, confirmation, mandate or approval token. Nothing indicating under what
authority the order is placed.

**So an order placed under a standing user mandate and an order placed by a malfunctioning
agent are indistinguishable at the venue.** Robinhood cannot tell them apart, and neither
can anyone reading the order history afterward. The account holder remains responsible
either way - the documentation says so explicitly.

The implication: pre-authorization appears to be an agent-and-user SEMANTIC contract rather
than a per-call broker parameter. If that holds, the broker enforces nothing about mandate
scope, and every constraint lives client-side.

That is the accountability vacuum the Computable Accountability reserve describes, found in
a live production system rather than argued hypothetically.

It also settles what the execution authorization is for. Signed, action-bound,
snapshot-bound, single-use authorization is not governance decoration layered on a venue
that already tracks this. **It is the only place the distinction between an authorized and
an unauthorized order can exist.**

### Placement remains DENY
The documentation establishes that unattended execution is a supported product capability.
It does not establish how authorization is represented or enforced. Loosening placement
before that is characterised would be the exact error this architecture exists to prevent.

### Order of work
    1  account readiness - what EQUITY_USER_LEVEL_MARGIN_CALL means and what clears it
    2  auth continuity - whether to persist the nine-day token for unattended collection
    3  technical characterisation of PRE_AUTHORIZED - the mechanism, with the same
       discipline used for review_equity_order
    4  only then, a funded experiment

Do not spend capital to discover semantics.

---

## Authority surface search, 2026-08-15

### Where Robinhood does govern
    connection   agent connected, Disconnect available - real revocation
    account      only agentic_allowed accounts accept agent execution
    product      options require separate eligibility onboarding with suitability questions

The Agentic UI's "Let your agent trade options" is ordinary brokerage product onboarding,
not an autonomy configuration. The Agent entry itself is not clickable; the only exposed
action is Disconnect.

### Where no mechanism was observed
No means of expressing granular bounds on standing autonomous authority was found in:

    the Trading MCP tool surface        54 tools, none mandate-related
    the OAuth scope                     one value, "internal"
    the account model                   no mandate fields in the full object
    the place_equity_order schema       no authorization parameter
    the Agentic account UI              connect and disconnect only

Absent from all five: require-approval toggle, per-trade or daily dollar limits, instrument
allowlists, position size caps, loss limits, trading-hours restrictions, mandate expiry,
trade-count limits.

**This is not a claim that no such mechanism exists anywhere in Robinhood.** It is a
statement about five specific surfaces, searched.

### The defensible finding
On the Robinhood Agentic surfaces observed as of August 2026, Robinhood technically governs
agent connection, account eligibility and product capability. Robinhood documents that users
may authorize agents to execute without per-trade confirmation. No mechanism was observed
for expressing granular bounds on that standing authority. Those bounds therefore appear to
be client-governed on the observed surface.

Status moved from DOCUMENTED_BUT_NOT_TECHNICALLY_CHARACTERISED to
DOCUMENTED_CLIENT_GOVERNED_AUTHORITY.

### What a mandate would need to carry
If the bounds are ours to express, they need expressing:

    WHO          agent identity, strategy identity
    WHAT         permitted instruments, asset classes, action types
    CAPITAL      maximum committed, per-position size, aggregate exposure
    WHEN         effective from, expiry, session constraints
    CONDITIONS   the strategy conditions under which authority becomes exercisable
    RISK         drawdown ceiling, loss budget, concentration, liquidity requirements
    EVIDENCE     what signals must exist before authority may be invoked
    REVOCATION   human kill switch plus automatic invalidation conditions
    EXECUTION    the specific venue capability being invoked
    RECEIPT      which mandate authorized which action, against which evidence

Robinhood's position that the account holder is responsible does not have to become an
accountability vacuum. The receipt can preserve the chain: observation -> signal ->
proposed trade -> evidence confidence -> standing human mandate -> admissibility ->
authorization -> execution -> result.

Neither "the AI decided" nor "Robinhood allowed it" is then the final explanation for why
capital moved.

### Still separate and unresolved
EQUITY_USER_LEVEL_MARGIN_CALL. The UI simultaneously prompts "Add funds to gear up for your
first trade", which is evidence against treating the Agentic account as blocked - but does
not explain the alert. Kept as its own account-readiness item rather than folded into this
finding.

---

## Margin call flag investigated, 2026-08-15

The app shows **no margin call**. Notifications run back to January with nothing about a
call, deficit, restriction or deadline. No banner, no account notice.

So EQUITY_USER_LEVEL_MARGIN_CALL appeared in a review response with no corresponding
customer-facing event. Two readings, neither established:

    it is a routine pre-trade check label rather than an active alert - an unfunded
    account reviewing a $1 buy trips a buying-power classification

    or it reflects the -$49.15 on the individual margin account, surfacing at user level
    below the threshold that generates a notification

**It does not block anything.** Robinhood actively prompts funding of the Agentic account
and no restriction is applied.

### What this means for policy design
A broker alert is evidence, not a verdict. This one has no observable account consequence,
so a policy that treated any non-empty order_checks as a hard DENY would refuse every order
on this account for no reason.

Alerts should map to graded consequences - some DENY, some DEFER, some THROTTLE, some are
informational - and that mapping needs evidence per alert type rather than a blanket rule.

Account readiness: **NOT BLOCKED**. The remaining gate before a funded experiment is the
auth continuity decision, not this.
