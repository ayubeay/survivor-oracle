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

---

## Official documentation read, 2026-08-21

First-party crypto.com surfaces only. Forums, third-party blogs and search-result snippets
were excluded by construction rather than filtered afterwards. Seven pages fetched and read
in full:

    help.crypto.com/en/articles/13843786-api-key-management
    help.crypto.com/en/articles/13843782-getting-started
    help.crypto.com/en/articles/13843765-openclaw-trading-overview
    help.crypto.com/en/articles/13886868-support
    crypto.com/en/product-news/openclaw-integration
    crypto.com/us/crypto/learn/how-to-set-up-openclaw-on-cryptocom
    crypto.com/en/product-news/cryptocom-exchange-openclaw-ai-agents

Research outcome: **reachable, substantive, partially answering.** Access was never the
constraint, which is itself worth recording - the unknowns below are silences in real
documentation, not gaps where we could not look.

**DOCUMENTED is a provenance level, and it is not enforcement.** Everything in this section
is what crypto.com says. None of it is the venue refusing an action. The repository has made
this mistake once: Robinhood's PRE_AUTHORIZED contract was recorded from documentation, and
a five-surface search later found no mechanism behind it.

Note the framing throughout: every statement is about the **OpenClaw integration**, not
about the Agent Key as a general venue credential.

### What the documentation establishes
    order types      market orders only - "place trades (market orders only)",
                     "Market orders (One-Time Buy or Sell)"
    asset scope      "supports cryptocurrency trading, with more asset types to come",
                     so stocks and prediction products are NOT currently in scope
    secret key       shown once at setup, never again on the management screen
    rotation         "The old key is invalidated immediately, and all connected bots will
                     be disconnected"
    permission edit  supported after issuance; "pending orders are preserved"
    expiry           TWO triggers - the selected duration (default 30 days) AND
                     "after 30 days of inactivity (no API calls)"
    expiry effect    "all trading via OpenClaw stops"
    always enabled   "Access portfolio balance is always enabled to allow the agent to
                     function"
    confirmation     an option to require a manual confirmation before trades
    kill switch      documented as existing; server-side enforcement NOT stated

The inactivity expiry was not visible anywhere in the UI. It is new evidence, not a
restatement.

The always-enabled portfolio permission is independent documentary corroboration of the
interaction-observed mandatory permission, in different words - the UI calls it
`View balance & transactions`, the docs call it portfolio balance access.

### Order type is not product type
`market orders only` is a real narrowing and it answers a different question than the one
that has been blocking a decision. `Execute trades` remains unbounded on the product axis
within cryptocurrency: spot versus perpetuals versus margin is not distinguished on any page.
`product_scope_of_execution` stays UNKNOWN.

### Three contradictions, preserved rather than resolved

**Withdrawal authority.** Three sources, three strengths:

    "High-risk actions, like withdrawing funds, are strictly off-limits"    announcement
    "designed with trade-only permissions, which means it shouldn't be
     able to withdraw or transfer funds"                                    US how-to
    Make cash withdrawals is one of nine permissions, CHECKED under
     All (default)                                                          VISUALLY_CONFIRMED

The two official pages disagree with each other on strength, and both disagree with the
screen. Either the documentation is stale against the app, or the permission is present and
inert. **The posture does not move.** `withdrawal_prohibition` stays
`OBSERVED_EXCLUDABLE_NOT_DEFAULT`, and nothing here relaxes the rule against accepting the
default grant. A documented promise is the weakest of the three claims about what happens
when a request actually arrives.

**Permission count.** Documentation names exactly three permissions - Execute trading,
Portfolio balance, Market data - consistently across three independent pages. The app showed
nine, including six cash and banking permissions that appear in no documented list.
Consistent across three pages, so not a single omission.

**Weekly limit default.** Documentation says $10,000. The screen showed $1,000, slider at the
floor. Both agree on the $1,000-$20,000 range, which is what the declaration records. No
default is declared, and none should be until they agree.

### Still unknown, with the reason attached
    OFFICIAL_DOCUMENTATION_SUBSTANTIVE_BUT_SILENT_ON_THIS
      spot versus perpetuals versus margin within cryptocurrency trading
      weekly limit scope - per credential, per agent or per account
      weekly limit enforcement mechanism
      whether deselected permissions are refused server-side
      what revocation does to an in-flight agent
      whether the kill switch is venue-side or client-side
      the exact moment the credential becomes live in the setup sequence
      whether generation is reversible

    OFFICIAL_DOCUMENTATION_SPARSE_OR_INSUFFICIENT
      revocation mechanics generally
      the "Weekly Trading Budget" article the trading overview references, which could not
        be located as a reachable URL

    OFFICIAL_SOURCE_UNREACHABLE_FROM_ENVIRONMENT
      nothing

The suffix describes where our knowledge stopped, not what Crypto.com's system does. In all
three cases the venue semantic itself remains UNKNOWN.

### UNRESOLVED: App Agent Key versus Exchange API credential

The largest finding, and it is a question rather than an answer.

Crypto.com documents two different credential systems:

    App        Agent Key, under More, labelled Beta, the nine-permission screen observed
               here, documented only for the OpenClaw integration
    Exchange   classic API keys created through Account Management -> API Management, with
               Can Read and Enable Trading, and no Agent Key feature referenced at all

This repository declares the App-derived credential model inside `CRYPTO_COM_EXCHANGE`,
endpointed at `api.crypto.com/exchange/v1` - while that same declaration already records
`app_and_exchange_differ: true`. The tension predates this research. The documentation makes
it concrete.

Whether the clean model needs two connectors - `crypto_com_app_agent_key` and
`crypto_com_exchange_api` - or merely credential profiles within one, turns on a question
nobody has answered: **do App Agent Keys call the Exchange API surface, or a different
backend?** Recorded as `credential_model_attribution: UNRESOLVED_APP_VS_EXCHANGE`.

Do not refactor on the strength of the question. Answer it first.

**Answered the same day. See the section below. The question is left standing because the
sequence is the useful part.**

### ANSWERED: distinct execution surfaces, 2026-08-21 second pass

Crypto.com's help centre links a venue-owned repository, `crypto-com/crypto-agent-trading`,
which it calls open source. That repository ships **two separate skills**:

    crypto-com-app        host wapi.crypto.com
                          credentials CDC_API_KEY / CDC_API_SECRET, taken from the Agent Key
                          management guide
                          two-step quote then confirm trade flow
                          plus fiat, cash, bank account linking, deposits and WITHDRAWALS,
                          weekly limit retrieval, API key revocation

    crypto-com-exchange   host api.crypto.com/exchange/v1/  (UAT uat-api.3ona.co)
                          Exchange API credentials, HMAC-SHA256 with api_key, sig, nonce
                          private/create-order, create-order-list, amend, cancel
                          LIMIT and MARKET

The Exchange REST and WebSocket documentation mentions Agent Key, agent, OpenClaw and the
Crypto.com App **nowhere at all**.

Recorded as `credential_model_attribution: DISTINCT_EXECUTION_SURFACES`, with the previous
`UNRESOLVED_APP_VS_EXCHANGE` kept in `credential_model_attribution_history`.

**What this claim is, and is not.** It is a claim about hosts, credentials, method
vocabularies and capability families - the things a connector declaration models. It is NOT
proof that crypto.com runs separate internal backends. Shared infrastructure behind two
gateways is excluded by nothing found, and no source addresses it. Carried as
`credential_model_caveat: EXECUTION_SURFACE_CLAIM_NOT_BACKEND_ARCHITECTURE_CLAIM`.

Two things stay UNKNOWN and are recorded as such: whether an App Agent Key authenticates
against Exchange endpoints, and whether the two share a backend.

### The withdrawal contradiction gains a fourth leg

    strictly off-limits                     product announcement    DOCUMENTED
    should not be able to withdraw          US how-to               DOCUMENTED
    Make cash withdrawals, checked          Agent Key screen        VISUALLY_CONFIRMED
    withdrawal order creation and
      execution, bank account management    venue-owned app skill   DOCUMENTED

Four legs, and they do not converge. The technical material is the strongest of the four and
it agrees with the **screen**, not with the announcement. Reading, INFERRED: the announcement
describes the intended integration configuration, not the credential capability.
`Make cash withdrawals` is not decorative.

Still UNRESOLVED. Still not enforcement evidence in either direction. The posture does not
move, and this makes the refusal to accept the default grant better founded than it was.

### Corrected against our own record

`confirmation_mode` previously read "documented option to require manual confirmation before
trades", sitting among venue-side facts where it could be read as a venue control. The
venue's own skill implements it as a client-side setting the user can switch off by
requesting auto-execution. Now `AGENT_SIDE_CLIENT_SETTING_NOT_VENUE_CONTROL`, prior wording
preserved in the declaration.

`kill_switch` strengthened, and only to documentary strength: key revocation is exposed as an
API operation. Whether the server actually refuses a revoked key, and what happens to orders
already in flight, are both `NOT_STATED`.

New documentary evidence: rate limits of 10 trades and 100 API calls per minute, HTTP 429 on
exceed. Connector behaviour, not an authority bound.

### Read-path provenance
The `wapi.crypto.com` hostname came from a first-party raw repository file **read through a
summarising fetch layer**, not by direct raw-byte inspection. The Exchange endpoints were
quoted directly from documentation. Those are different evidence paths and the declaration
keeps them apart -
`DOCUMENTED_VIA_SUMMARISING_FETCH_LAYER` versus `DOCUMENTED_QUOTED_DIRECTLY`.

The repository source is admissible because ownership is pinned to one named repo the venue
links and calls its own. GitHub is not a trusted domain here, which is why it is recorded in
`technical_repository_sources` rather than appended to the crypto.com web `sources` list.

### THE SPLIT, 2026-08-21 - and what it was actually fixing

The two surfaces are now two declarations. Until this point everything above lived in one
object named `CRYPTO_COM_EXCHANGE`, and the cost was not cosmetic.

    crypto_com_exchange_api      930 instruments, 343 perps, 100x, margin pairs
                                 level-2 book, 0.16bp spread
                                 spot/perp/future observe, orderbook depth, sandbox
                                 execution_contracts: still NOT_INVESTIGATED
                                 credential model: NOT_CHARACTERISED - grants REFUSE

    crypto_com_app_agent_key     agent key setup, the nine permissions
                                 weekly limit floor, expiry floor
                                 documented market-only quote/confirm contract
                                 instruments: NOT_ENUMERATED - mandates REFUSE

    crypto_com (venue)           product_boundary, execution_surfaces,
                                 credential_model_attribution + history + caveat
                                 data only - nothing at runtime reads it

**Two live bugs, not one.** The known one: an App Agent Key mandate passed instrument
reconciliation by borrowing the Exchange's 930-instrument universe. The one found during the
audit: `reconcileWithConnector` reads `venue_limit_floors` and the `venue_trading_budget` /
`venue_key_expiry` capability keys - all App facts - so an EXCHANGE mandate was inheriting
enforcement provenance from App credential controls. It reported UNVERIFIED where the honest
answer is CLIENT_ONLY, because the Exchange has no such control of its own.

Both directions of contamination, in one function, from one merged object.

**How it happened, which matters more than the mistake.** `git log -S` shows `agent_key`,
`venue_trading_budget`, `venue_key_expiry`, `venue_key_permissions` and
`withdrawal_prohibition` all entered in `bf2f328` - "capability declaration from public
discovery, with seven items marked unverified pending account access." They were never App
observations. They were correctly-marked placeholders on the Exchange connector, awaiting
account access. Months later real evidence arrived and filled them - but by then we had
learned the evidence belonged to a different execution surface.

Nothing was carelessly merged. **A placeholder outlived the assumption that gave it its
location.** Recorded as history rather than doctrine; if the same shape appears on another
connector, it will have earned one.

**Consequences, both default-closed.** An App mandate now refuses - `NOT_ENUMERATED` is
declared explicitly with its reason, because "never enumerated" and "observed none" are
different claims. An Exchange credential grant now refuses - `NOT_CHARACTERISED` is not a
surface `declareCredentialGrant` recognises, so it cannot inherit the App's nine-permission
model. Neither refusal is a regression; both are the layer doing its job on evidence we do
not have.

Two test branches lost their route through `issueMandate` and are now covered by synthetic
connector fixtures rather than being allowed to lapse: the `UNVERIFIED` enforcement state,
and the reservation that `venue_expiry_floor_days` is declared but not consumed.

### Still unknown after 2026-08-19
    what a hand-picked permission set is honoured as at execution time
    whether Execute trades spans spot, perpetuals and margin - LOAD-BEARING, and the
      reason no key is generated now that money movement is known to be excludable
    whether View balance & transactions is mandatory at the venue or only in this setup UI
    whether the weekly limit is per key or per account
    revocation behaviour and whether it is immediate
    whether generating a key requires anything irreversible
    whether ANY of these controls actually refuses a violation
