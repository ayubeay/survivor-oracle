# Crypto.com Exchange - public capability discovery, 2026-08-15

Read-only. Public endpoints, no credential, no trading. The account holds ~$6.75 and stays
untouched - it is a capability laboratory, the same role the unfunded Robinhood Agentic
account plays.

## Instrument universe
    total          930
    CCY_PAIR       577   spot
    PERPETUAL_SWAP 343
    FUTURE          10
    tradable now   930   (zero flagged untradable)

    quote currencies: USD 774, USDT 124, BTC 14, EUR 7, PYUSD 5, CRO 4, ETH 2

## Leverage - the finding that changed the mandate
    341 perps at 50x
      2 perps at 100x
    144 spot pairs with margin_buy_enabled

Per-instrument fields include max_leverage, margin_buy_enabled, margin_sell_enabled,
contract_size, underlying_symbol, expiry_timestamp_ms, price_tick_size, qty_tick_size.

**A mandate permitting "crypto.trade" with only a symbol allowlist would have authorised
50x leveraged and short exposure by omission.** Robinhood's equity lane has no equivalent,
so the gap was invisible until a second venue was examined.

Mandate now carries instruments.allowed_types (default ['SPOT']) and instruments.max_leverage
(default 1). Leverage must be granted deliberately, the same principle as unknown tools
defaulting to DENY.

## Market data
    get-book depth 10, both sides, each level [price, size, order_count]
    BTC_USD spread observed at 1 cent on $63,097 - about 0.16 basis points

For comparison, AAPL measured 2-3bp. Crypto microstructure here is materially tighter.

## App and Exchange are different universes
Holdings checked against the exchange instrument list:

    CRO   4 spot pairs
    BTC   4 spot pairs
    CAW   1 spot pair      long-tail token, tradable
    VVS   1 spot pair
    BNB   NOT LISTED       held in the App, absent from the Exchange

Same lesson as Robinhood's consumer crypto not reaching the agent surface: a product
offering an asset does not mean the programmable surface exposes it.

## Not yet established - needs the account, not public endpoints
    whether Agent Key exists for a US App account
    what permissions an agent key offers
    whether venue-enforced trading budgets are real
    key expiry semantics
    confirmation-mode controls
    whether withdrawals and transfers are technically impossible under agent credentials
    revocation and kill-switch behaviour
    order lifecycle and post-execution receipts
    sandbox or paper support

## Why this venue matters architecturally
Robinhood governs connection, account eligibility and product capability; the bounds of
autonomous action appear client-governed. If Crypto.com enforces budgets, expiry or
trading-only permissions at the venue, then:

    client mandate <= venue capability and limits

and a receipt can record which controls WE enforced and which the venue independently
enforced. That is stronger evidence than our own decision alone, and it is defense in depth
rather than duplication.

---

## Agent Key found in the US App account, 2026-08-15

The Agent Key surface exists. Currently "No keys yet" - nothing generated, nothing enabled.

### What it configures, per key
    Expiration            configurable
    Permissions           configurable
    Weekly trading limit  configurable, with a Remaining counter

The Remaining counter is the significant detail. The venue TRACKS CONSUMPTION against the
limit rather than merely storing a ceiling.

### The venue's own framing
From the onboarding screen: generate a key choosing what the agent can do and its trading
limit; link the agent; then instruct it, and it executes up to the specified limit.

Security note, verbatim in substance: anyone with access to the Agent Key can trade up to
the weekly limit; AI agents may malfunction, misinterpret data, or be manipulated, leading to
unintended orders. Third-party integrations use open-source components and external
messaging platforms at the user's own risk.

So the venue treats the weekly limit as the backstop against exactly the failure modes the
mandate layer exists to bound. That is the right role for it.

### The comparison, now observed rather than assumed
    ROBINHOOD AGENTIC
      connection            venue-enforced (Disconnect)
      account eligibility   venue-enforced (agentic_allowed)
      product capability    venue-enforced (options onboarding)
      autonomous bounds     NOT FOUND on any surface examined - client-governed

    CRYPTO.COM AGENT KEY
      connection            venue-enforced (key generation and revocation)
      permissions           venue-configured
      expiry                venue-configured
      weekly trading budget venue-configured, consumption tracked

**Crypto.com expresses at the venue what Robinhood leaves to the client.**

That makes defense in depth real here: our mandate sits at or below the venue limit, and a
failure in our runtime still meets a wall. The receipt can record that the venue
independently constrained the action rather than only that we permitted it.

### Marked OBSERVED, not VERIFIED
The configuration screen was seen. Enforcement was not tested - no key generated, no order
attempted. A limit in a settings screen and a limit that rejects an order are different
claims, and only the second earns VENUE_ENFORCED in a mandate's enforcement map.

### Still unknown
    whether permissions include a trading-only option that excludes withdrawals
    the granularity of permissions - instrument types, spot versus perps, order types
    what expiry options exist
    whether the weekly limit is per key or per account
    revocation behaviour and whether it is immediate
    whether generating a key requires anything irreversible
