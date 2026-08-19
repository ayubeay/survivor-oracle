# Execution handoff

Read this first. Then read the repository state relevant to the task. **Repository evidence
is authoritative over anything remembered or assumed.**

Last updated 2026-08-19.

---

## What this is

A governed execution layer for autonomous financial agents. The thesis: an agent being
technically able to place an order does not mean it has authority to. The layer makes that
distinction exist, because at the venues examined it does not.

## The chain

    connector declaration   what a venue can do            discovered, never assumed
    mandate                 what a human authorised        signed, expiring, revocable
    policy                  is this action admissible now  judgment, not authority
    authorization           one exact execution, once      dies when the mandate does
    firewall                last-mile verification         the only path to transport
    receipt                 what actually happened

Files: `src/finance/connector-capabilities.js`, `mandate.js`, `policy.js`,
`execution-authorization.js`, `capability-firewall.js`. Tests: `./src/finance/run-tests.sh`,
currently 193 passing. **Do not commit unless ALL GREEN.**

---

## Invariants

    CAPABILITY IS NOT AUTHORITY
    POLICY ALLOW IS A JUDGMENT, NOT AUTHORIZATION
    AUTHORITY MUST SURVIVE THE ENTIRE EXECUTION PATH
    DEFAULT CLOSED AT UNDECLARED RISK-BEARING DIMENSIONS
    TEST THE PATH, NOT ONLY THE COMPONENT
    A CONTROL THAT IS NEVER REACHED IS NOT A CONTROL
    OBSERVED IS NOT ENFORCED; ENFORCED IS NOT SUFFICIENTLY BOUNDED
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
Agent Key exists on the US account: Set up / Verify / Connect, expiration defaulting to 30
days, permissions defaulting to "All", weekly limit slider $1,000 to $20,000.

**Not established:**

What Crypto.com's "All" permissions includes. Whether withdrawals are excluded by
construction. Whether spot and perps are separately permissioned. Whether any venue control
actually rejects a violation - all Crypto.com controls are UNVERIFIED, meaning seen in a
settings screen and never seen refuse anything. How Robinhood represents a standing mandate;
no mechanism was found across the MCP surface, OAuth scope, account model, order schema or
Agentic UI.

---

## Active next

1. **Crypto.com Permissions dropdown.** Can the venue constrain a key to read plus spot
   trade, excluding perps, leverage, transfers and withdrawals? Determines whether a key is
   safe to create. No key generated yet. Do not tap Generate.

2. **Crypto.com Expiration options.** 30 days is the default; shorter is preferable for a
   first experiment.

3. **Robinhood auth continuity.** Every session needs interactive authorization and device
   push has failed every time - only the selfie fallback works. The equity collector cannot
   accumulate the variation that makes its data worth anything without solving this.
   Persisting the nine-day token is a real change in posture and deserves deliberate
   treatment.

4. **Robinhood pre-authorized contract.** Documented by Robinhood, not technically
   characterised. `place_equity_order` stays DENY until it is.

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
