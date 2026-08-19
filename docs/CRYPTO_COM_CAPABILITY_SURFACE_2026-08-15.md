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

---

## Permissions and Expiration read, 2026-08-19

The 2026-08-15 entry above is left standing. Three of its six open questions are answered
here and the answers are not the ones the architecture was hoping for. The earlier list is
not edited, because the sequence of what was unknown and when is the useful part.

Inspected by the account holder on the US Agent Key setup screen. **No key generated,
Generate never pressed, nothing submitted.** OBSERVED, not VERIFIED - a permission shown in
a settings screen and a permission that refuses an action are different claims.

### Expiration - the full option list
    30 days   default, selected
    60 days
    90 days

Nothing shorter than 30 days is offered. Active-next item 2 asked for a shorter expiry for
a first experiment; the venue does not have one.

This is the $1,000 budget floor again in the time dimension. A venue control that cannot be
set as tight as the mandate is an outer wall, never the operative limit. Recorded as
`venue_expiry_floor_days: 30`.

### Permissions - All (default), and what it actually grants
The permissions are displayed individually. Under `All (default)` these nine are CHECKED:

    Execute trades
    View market data & insights
    View balance & transactions
    View cash deposit info
    Send cash deposit info
    View cash withdrawal details
    Make cash withdrawals
    View bank accounts
    View deposit & withdrawal limits

**`All (default)` is not a trading permission. It includes `Make cash withdrawals`.**

The 2026-08-15 entry asked whether withdrawals are excluded by construction. They are not.
On the default they are granted, alongside bank-account visibility and the deposit and
withdrawal limits. A key generated by accepting the defaults would hand an autonomous agent
the authority to move money out of the account.

That is why no key exists. **Do not create an API key, and do not assume withdrawal
exclusion.**

### Correction, same day - the boxes uncheck
The paragraph that stood here said deselection was not observed and that a narrower key was
not yet something this repository knew how to obtain. Direct UI interaction on 2026-08-19
replaced it. The account holder manually unchecked the permissions. Every displayed
permission can be unchecked EXCEPT `View balance & transactions`, which remains selected
and cannot be unchecked.

Recorded as OBSERVED:

    Agent Key permissions are individually configurable
    View balance & transactions is mandatory in this setup UI - it will not uncheck
    Make cash withdrawals CAN be explicitly removed
    Execute trades can also be independently removed
    an Agent Key therefore does not inherently require withdrawal authority,
      despite All (default) granting it
    no separate spot / perpetual / margin / leverage execution permissions were observed

This is a materially better security design than `All (default)` made it look. The capability
model supports something close to least privilege:

    mandatory   balance and transaction visibility
    optional    execute trades
    removable   withdrawals, deposits, banking information, limits

**The dangerous part is the default configuration, not the capability model.** That is a
narrower and fairer criticism than the one recorded a few hours earlier, and the earlier
one is left in place above because the correction is the useful part.

Still not observed: what a hand-picked set is actually honoured as at execution time.
Unchecking a box in a setup screen is not a venue refusing the action the box would have
permitted. Selection was observed; honouring was not.

### What was NOT observed, and must not be inferred
No spot / perpetual / margin / leverage distinction appeared anywhere in the permission
list. Record that as **granularity not observed**. It is not proof that `Execute trades`
necessarily covers every product, and not proof that it does not - the list simply does not
speak to instrument type. Until it does, the mandate's own `instruments.allowed_types` and
`max_leverage` bounds carry that dimension by themselves, on a venue with 343 perpetual
swaps and 341 of them at 50x.

This is now the load-bearing uncertainty, and it is the reason the key still does not get
generated. The narrowest useful credential is:

    View balance & transactions  +  Execute trades

which is close to least privilege on the MONEY-MOVEMENT axis and entirely unbounded on the
PRODUCT axis. Excluding withdrawals is real progress; it does not bound what a trade is.
Do not infer the semantics of `Execute trades`.

The weekly trading limit is unchanged at $1,000 to $20,000, scope still unestablished.

### CREDENTIAL CAPABILITY, DEFAULT GRANT, MINIMUM GRANT
Three things, not one, and Crypto.com supplied direct evidence that they differ:

    credential capability   what the venue's key CAN carry        includes withdrawals
    default grant           what it carries if you accept it      includes withdrawals
    minimum grant           what it can be reduced to             balance and transactions

The wrong question to ask a connector is "does this venue's agent key support withdrawals?"
Crypto.com's answer is yes, and the answer is not decision-relevant. The right question is
**"can withdrawal authority be excluded from the credential we actually issue?"** Here the
answer is also yes, and that one is decision-relevant.

For the capability firewall this is a distinct dimension from anything previously declared.
A connector's capability surface describes the venue; it does not describe the credential we
chose. Two keys at the same venue can carry different authority, so authority has to be a
property of the credential, not of the connector.

Implemented 2026-08-19 as `src/finance/credential-grant.js`, and threaded through issuance,
the mandate check, the firewall and the consumption step - a credential swapped or revoked
between authorization and transport fails, because a check that runs only at issuance leaves
the transport reachable by anyone holding the authorization. A grant declared against this
connector carries `credential_status: NOT_YET_ISSUED` and therefore authorises nothing, so
the "no key exists" fact is enforced by the code rather than by remembering it.

### CONFIGURABLE IS NOT SAFELY CONFIGURED
The repository already separates observed from enforced, and enforced from sufficiently
bounded. This is the third distinction and it precedes both:

    CONFIGURABLE          the venue exposes controls over agent authority
    SAFELY CONFIGURED     the controls are set narrower than the harm they bound

A venue can do the first and still ship a default grant that is broader than any admissible
agent mandate. Crypto.com does exactly that. The earlier finding stands - Crypto.com
expresses at the venue what Robinhood leaves to the client - but it now carries a
qualifier: what the venue expresses BY DEFAULT is not a bound, it is a maximal grant, and
the burden of narrowing it sits with whoever presses Generate.

The three distinctions in sequence, each earned rather than argued:

    capability        is not   default grant         (the key CAN be narrower)
    default grant     is not   minimum grant         (eight of nine boxes uncheck)
    configurable      is not   safely configured     (default grants withdrawals)
    observed          is not   enforced              (no control seen refusing anything)
    enforced          is not   sufficiently bounded  ($1,000 floor, 30-day floor)

### Still unknown after 2026-08-19
    what a hand-picked permission set is honoured as at execution time
    whether Execute trades spans spot, perpetuals and margin - LOAD-BEARING, and the
      reason no key is generated now that money movement is known to be excludable
    whether View balance & transactions is mandatory at the venue or only in this setup UI
    whether the weekly limit is per key or per account
    revocation behaviour and whether it is immediate
    whether generating a key requires anything irreversible
    whether ANY of these controls actually refuses a violation
