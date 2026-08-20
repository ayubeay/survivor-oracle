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

### The checkbox was opened, and the account behind it looked at
Two further direct observations on 2026-08-19, both recorded as text. The evidence arrived
as screenshots of a live personal account; **no image is committed to this repository.**

**`Execute trades` is a single checkbox.** Selecting and opening it exposes no additional
product controls - no sub-permissions, no tooltip, no spot / perpetual / margin split, no
leverage limit, no instrument selector, no order-type scope.

That is an absence IN THE AGENT KEY UI. It is not a semantic finding. Recorded as two
fields, deliberately separate:

    product_scope_controls      NOT_EXPOSED_IN_AGENT_KEY_UI   observed
    product_scope_of_execution  UNKNOWN                       not established

Collapsing those two into one is how a UI observation becomes an assumption. The absence of
controls is not evidence that `Execute trades` covers everything, nor that it covers spot
only, nor spot plus perps. It is evidence that the UI does not say.

**The account is not a single-product account.** Its surface exposes several distinct
product families: crypto trading tools (Recurring Buy, Limit Order, Crypto Baskets, TWAP),
Stocks, prediction products (Strike Options, UpDown Options), Tokens Wallet, Cash, Card/Pay,
Earn, Rewards and IRAs. The account is on BASIC. `Agent Key` sits separately under **More**
and is labelled **Beta**.

This MUST NOT be read as evidence that an Agent Key can operate any of them. It establishes
account surface and nothing else. What it does establish is that one undifferentiated
trading checkbox sits above a genuinely wide surface - which makes the missing granularity
significant rather than merely unsurprising. A single-product account with one trading
checkbox would say little; this does not.

### ACCOUNT CAPABILITY IS NOT AGENT-KEY CAPABILITY
The ladder gains a rung at the top, one level further out than the credential distinction:

    account capability     what the account exposes        9 product families
    agent-key capability   what a key can be asked to do   one trading checkbox
    credential grant       what our key actually carries   configurable, none issued
    mandate authority      what a human authorised         SPOT, 1x, capped, expiring

Reading a product list as a capability list is the same error as reading a connector
surface as authority, one level out. Recorded in the connector declaration with
`inference_permitted: false`, and tested so a later edit cannot promote it.

### Screenshot review, 2026-08-19 - what the images confirmed and what they did not
The observations above were reported in text first and the screenshots reviewed afterwards.
Both are recorded, and where they disagree the weaker claim wins.

**Confirmed by looking:**

    Set up -> Verify -> Connect        three-step indicator, Set up active
    screen title                       "Generate API key" / "Select the preferences of your key"
    Expiration                         30 / 60 / 90 days, radio buttons, 30 filled
    Permissions                        one dropdown reading "All (default)"
    Weekly trading limit               $1,000 USD, slider ticks $1K $5K $10K $15K $20K
    account tier                       BASIC
    account menus                      Trade, Stocks, Predict, Assets, Spend, Earn, Rewards

The account menu detail was fuller than the first pass recorded - Trade also carries
`Price alerts`, Stocks resolves to `Trend watch`, `Discovery`, `Whale Baskets`, Earn to
`DeFi Yield`, `Airdrop Arena`, `Crypto Earn`. Corrected rather than left summarised.

**NOT confirmed by looking - and then confirmed, 2026-08-20.** The first review found no
Agent Key entry and no `Beta` label anywhere in the images, so the claim was downgraded to
`REPORTED_BY_ACCOUNT_HOLDER_NOT_VISUALLY_CONFIRMED` rather than being allowed to inherit the
confidence of the confirmed facts around it. A later capture reached the section that had
been cut off: a `More` group holding **Agent Key** with a **Beta** chip, above University and
Settings, below a Retirement group holding IRAs. Now `VISUALLY_CONFIRMED`.

Both steps are kept, in `agent_key_provenance_history`. A claim downgraded for lack of
evidence and later re-established BY evidence is a different object from one that was simply
asserted throughout, and the difference is the part worth keeping. The downgrade also did
its job: it was wrong about the world and right about what was known, which is the only
thing a provenance field can be asked to be.

**The permission sheet, seen.** A bottom sheet headed `Permissions`, one row per permission
with a check control on the right, all nine checked - the `All (default)` state. It confirms
the nine labels and their order exactly as recorded.

What it does not show is which of them can be unchecked. All nine render identically when
checked, so the irreducibility of `View balance & transactions` rests on the interaction
that tried to remove it and on nothing visible in the list. No future screenshot will settle
that; only the interaction can. Recorded as
`permissions_mandatory_visually_distinguishable: false`.

Further menu detail from the same capture: Rewards resolves to `Rewards Hub` and
`Campaigns`, Retirement to `IRAs`, More to `Agent Key`, `University`, `Settings`. The
benefits page also carries `IRAs: 1% Roll over` and a Services entry for Crypto.com Travel.

**The Set up screen says nothing about its own consequences.** The primary button reads
`Generate API key` and is enabled. There is no warning, no irreversibility notice, no
one-time-display caution. That silence is recorded as silence:

    generate_button                          PRESENT_AND_ENABLED
    generate_consequences_stated_on_screen   NONE_VISIBLE
    generate_reversibility                   UNKNOWN
    key_creation_moment                      UNKNOWN

An absent warning is not a safety claim - the same rule as an absent control not being a
statement of scope. Set up is step one of three, and whether the key is created on that
button or after Verify has not been seen. The button was not pressed.

**Privacy.** The images show an account holder name, an email address and reward balances.
Descriptions are committed; identifiers and balances are not. Tests assert the connector
declaration contains no email pattern, no account holder name and no balance figure. Venue
configuration numbers - the $1,000 floor, the $1K-$20K slider - are venue facts and stay.

### Where the residual risk sits, precisely
    credential-level money movement   CAN be excluded - withdrawals, banking, cash
    credential-level product scope    NO narrower control observed under Execute trades
    mandate-level product scope       CAN restrict to SPOT and 1x
    venue enforcement of either       UNVERIFIED

So the credential layer bounds money movement and cannot bound product. The mandate bounds
product with no credential-side backstop, checked by connector reconciliation and the
firewall. That is the whole residual risk, stated.

The remaining pre-key questions are now narrow: what happens at Generate / Verify /
Connect, and whether a key carrying only the minimum permissions plus `Execute trades` is
worth creating while its product scope is unknown. If it cannot be learned without risking
capital or an overprivileged credential, it stays unknown rather than forced.

### The minimum credential was modelled, and one hole turned up, 2026-08-20
Before building anything further, the governance model was asked a direct question: can it
already represent the credential we would actually want - `View balance & transactions` plus
`Execute trades`, everything else excluded, product scope UNKNOWN, status NOT_YET_ISSUED?

It can, in every respect that was checked:

    granted           the two permissions, nothing else
    excluded          seven, including Make cash withdrawals
    permitted_classes OBSERVE_ACCOUNT, MUTATE_ORDER
    runtime           CREDENTIAL_NOT_ISSUED - it authorises nothing
    product scope     UNKNOWN, credential bounds nothing, mandate carries it alone

No new abstraction was needed. But asking the inverse question found a real hole.

**A grant carrying all nine permissions reported the same three permitted classes as a
grant carrying two.** Six of the nine map to no operation class at all - the cash deposit,
withdrawal, bank account and limits permissions - so the firewall, which only ever asks
about classes, had nothing to ask. `Make cash withdrawals` sat inside `granted[]` and
appeared in no other field of the object. Authority the credential carries, that no control
in the path would ever check, and that no receipt would mention.

A control that is never reached is not a control. This was worse: there was no control to
miss, and the grant looked complete.

Closed by refusing to declare such a grant silently. Permissions no class requires are
computed as `unmapped_granted`, and a grant containing any of them needs
`acknowledge_unaccounted_authority: true` - the same shape as the unbounded-credential
acknowledgement, for the same reason. Granting them is not forbidden; doing it quietly is.
The flag rides through to the firewall receipt as
`credential_carries_unaccounted_authority`, because a receipt that omits it describes a
narrower key than the one that was used.

Robinhood's grant reports `carries_unaccounted_authority: true` with
`unmapped_granted: null` - unknowable rather than empty, since a single OAuth scope offers
no per-permission list to compare against.

### Still unknown after 2026-08-19
    what a hand-picked permission set is honoured as at execution time
    whether Execute trades spans spot, perpetuals and margin - LOAD-BEARING, and the
      reason no key is generated now that money movement is known to be excludable
    whether View balance & transactions is mandatory at the venue or only in this setup UI
    whether the weekly limit is per key or per account
    revocation behaviour and whether it is immediate
    whether generating a key requires anything irreversible
    whether ANY of these controls actually refuses a violation
