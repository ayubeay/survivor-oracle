# Execution handoff

Read this first. Then read the repository state relevant to the task. **Repository evidence
is authoritative over anything remembered or assumed.**

Last updated 2026-08-19 (second entry: Crypto.com Agent Key permissions and expiry).

---

## What this is

A governed execution layer for autonomous financial agents. The thesis: an agent being
technically able to place an order does not mean it has authority to. The layer makes that
distinction exist, because at the venues examined it does not.

## The chain

    connector declaration   what a venue can do            discovered, never assumed
    credential grant        what the key we issued carries narrows only; absence refuses
    mandate                 what a human authorised        signed, expiring, revocable
    policy                  is this action admissible now  judgment, not authority
    authorization           one exact execution, once      dies when the mandate does
    firewall                last-mile verification         the only path to transport
    receipt                 what actually happened

Files: `src/finance/connector-capabilities.js`, `credential-grant.js`, `mandate.js`,
`policy.js`, `execution-authorization.js`, `capability-firewall.js`. Tests:
`./src/finance/run-tests.sh`, currently 293 passing. **Do not commit unless ALL GREEN.**

`credential-grant.js` landed 2026-08-19. Authority is a property of the credential, not of
the connector: two keys at one venue can carry different authority, so a receipt naming only
the connector cannot say what was possible. A grant may only narrow a connector surface,
never extend it, and never understate a permission the venue forces to be present. Absence
of grant information refuses risk-bearing execution rather than reading as unrestricted.
Robinhood declares `NOT_EXPOSED` - observed unboundedness, which must be acknowledged
explicitly and is not the same as missing information.

---

## Invariants

    CAPABILITY IS NOT AUTHORITY
    POLICY ALLOW IS A JUDGMENT, NOT AUTHORIZATION
    AUTHORITY MUST SURVIVE THE ENTIRE EXECUTION PATH
    DEFAULT CLOSED AT UNDECLARED RISK-BEARING DIMENSIONS
    TEST THE PATH, NOT ONLY THE COMPONENT
    A CONTROL THAT IS NEVER REACHED IS NOT A CONTROL
    OBSERVED IS NOT ENFORCED; ENFORCED IS NOT SUFFICIENTLY BOUNDED
    CONFIGURABLE IS NOT SAFELY CONFIGURED
    CREDENTIAL CAPABILITY IS NOT DEFAULT GRANT IS NOT MINIMUM GRANT
    AUTHORITY IS A PROPERTY OF THE CREDENTIAL, NOT OF THE CONNECTOR
    ACCOUNT CAPABILITY IS NOT AGENT-KEY CAPABILITY IS NOT CREDENTIAL GRANT
      IS NOT MANDATE AUTHORITY
    AN ABSENCE OF CONTROLS IS NOT A STATEMENT OF SCOPE
    ABSENCE OF INPUT IS A REASON TO REFUSE, NOT TO SKIP

Each came from a failure, not an opinion. See `docs/DOCTRINE_skipped_controls.md` and
`docs/INCIDENT_2026-08-08_quota_cascade.md`.

---

## Evidence versus assumption

**Established by observation:**

Robinhood Agentic exposes 54 tools, equities and options only, no crypto. The agentic
account is limited_margin with no option_level, so options are visible and unusable. Minute
bars are the finest interval; level 2 depth; seven indicators; 56 scanner filters including
options flow. `review_equity_order` is non-executing - verified by order state before and
after. `place_equity_order` carries NO authorization field, so an authorized order and a
runaway order are identical at the venue. No margin call exists in the app despite
EQUITY_USER_LEVEL_MARGIN_CALL appearing in a review response.

Crypto.com Exchange lists 930 instruments - 577 spot, 343 perpetual swaps at 50x, two at
100x, 144 margin-enabled spot pairs. Ten-level book with order counts. BTC spread 0.16bp.
Agent Key exists on the US account: Set up / Verify / Connect, weekly limit slider $1,000
to $20,000.

Agent Key expiration offers exactly 30, 60 and 90 days, defaulting to 30. Nothing shorter
exists, so venue expiry cannot be set as tight as a short first experiment.

Agent Key permissions are displayed individually, and `All (default)` checks nine of them:
execute trades; view market data; view balance and transactions; view cash deposit info;
send cash deposit info; view cash withdrawal details; MAKE CASH WITHDRAWALS; view bank
accounts; view deposit and withdrawal limits. **The default grant is not trading-only - it
includes cash withdrawals.** A key generated on the defaults would give an autonomous agent
authority to move money out.

The permissions are individually configurable. Working the list box by box, eight of the
nine uncheck, including `Make cash withdrawals` and `Execute trades`. `View balance &
transactions` will not uncheck and is the observed minimum grant. So an Agent Key does not
inherently require withdrawal authority - the default grant does, the capability model does
not. No key generated; Generate never pressed.

**Not established:**

What a hand-picked Crypto.com permission set is honoured as at execution time - the boxes
were seen to uncheck, and nothing has been seen to hold against an actual attempt. Whether
`View balance & transactions` is mandatory at the venue or only in this setup UI. Whether
spot and perps are separately permissioned: no instrument-type distinction appeared in the
permission list at all, which is granularity NOT OBSERVED, not evidence either way about
what `Execute trades` covers. Whether the weekly limit is per key or per account. Whether any venue control actually rejects a violation -
all Crypto.com controls remain UNVERIFIED, meaning seen in a settings screen and never seen
refuse anything. How Robinhood represents a standing mandate; no mechanism was found across
the MCP surface, OAuth scope, account model, order schema or Agentic UI.

---

## Active next

1. **Crypto.com `Execute trades` scope.** Permission deselection is CLOSED as of
   2026-08-19. `All (default)` includes `Make cash withdrawals`, but eight of the nine
   boxes uncheck; `View balance & transactions` is the observed minimum grant. Money
   movement is excludable from the credential, which is the good news and it is real.

   The gate moved. The narrowest useful key is `View balance & transactions` +
   `Execute trades`, and `Execute trades` is ONE permission with no observed subordinate
   control over spot versus perpetuals versus margin or leverage. On a venue with 341 perps
   at 50x, that key is near least privilege on money movement and unbounded on product.
   Characterise what `Execute trades` actually spans before generating anything. Do not
   infer it from the label.

The checkbox was opened on 2026-08-19: `Execute trades` has no sub-permissions, tooltip,
   product split, leverage control, instrument selector or order-type scope. Recorded as
   `product_scope_controls: NOT_EXPOSED_IN_AGENT_KEY_UI` - an observed absence in that UI -
   with `product_scope_of_execution: UNKNOWN` kept separate, because the UI not saying is
   not the permission meaning everything.

   The credential dimension refuses by construction rather than by discipline: a grant
   declared against `crypto_com_exchange` carries `credential_status: NOT_YET_ISSUED` and
   authorises nothing at runtime, and no credential can claim to bound instrument type.
   `instruments.allowed_types` and `max_leverage` carry that dimension with no
   credential-side backstop.

   The account surface is recorded and fenced: nine product families including Stocks and
   prediction products, with Agent Key separate under More and labelled Beta. That is
   account capability, and it establishes nothing about what a key can reach.

   What is left before a key could exist: what happens at Generate / Verify / Connect, and
   whether a minimum-plus-`Execute trades` key is worth creating while its product scope is
   unknown. If that cannot be learned without risking capital or an overprivileged
   credential, leave it unknown rather than force an answer.

   **Still do not create a key. Do not tap Generate.**

2. **Crypto.com Expiration options.** CLOSED 2026-08-19. Exactly 30, 60 and 90 days, default
   30. Nothing shorter is offered, so venue expiry is an outer wall and the operative expiry
   stays the mandate's own. Recorded as `venue_expiry_floor_days: 30`; note that
   `reconcileWithConnector` has no duration comparison yet, so a verified expiry would
   report VENUE_ALIGNED however short the mandate is. Inert today - `venue_key_expiry` is
   OBSERVED_*, which short-circuits to UNVERIFIED - but it needs its own tests before
   expiry enforcement is ever verified.

3. **Robinhood auth continuity.** Every session needs interactive authorization and device
   push has failed every time - only the selfie fallback works. The equity collector cannot
   accumulate the variation that makes its data worth anything without solving this.
   Persisting the nine-day token is a real change in posture and deserves deliberate
   treatment.

4. **Robinhood pre-authorized contract.** The handoff previously called this
   "documented, not technically characterised". That is stale against the code: the
   2026-08-15 five-surface search already moved PRE_AUTHORIZED to
   `DOCUMENTED_CLIENT_GOVERNED_AUTHORITY` in `connector-capabilities.js`, with
   `mandate_bounds` recorded as NOT OBSERVED on any Robinhood surface. What is documented is
   that unattended execution is a supported product capability; what is established is that
   the bounds on it appear client-governed. How authorization is represented at the venue is
   still uncharacterised, and `place_equity_order` stays DENY until it is. Posture unchanged.

## Not active

SoundKeep - crate-per-folder shipped 2026-08-12, two DJs asked to test, no feedback yet. No
further building until it arrives. SURVIVOR oracle - healthy; mint-path optimisation
reserved with a written activation condition in `src/fetcher.js`. MomentumSniper - paper
mode, 17,634 closed trades audited, positive mean and negative median, no fee or slippage
modelling.

---

## Working rules

Read the file before patching it. Four failed patches in one session came from replacing
strings that were never read.

Probe before building. Nearly every useful finding came from one command against a real
endpoint, not from reasoning.

Record corrections rather than quietly fixing them. The measurement history in the incident
doc revised twice in the same direction and that is the useful part.

Do not spend capital to discover semantics.

Never echo a variable that might hold a credential. A key was exposed this way on 2026-08-15
and had to be regenerated.
