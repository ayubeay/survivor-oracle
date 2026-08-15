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
