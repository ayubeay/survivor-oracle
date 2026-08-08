# SURVIVOR x Robinhood - Phase 2 evidence

**Date:** 2026-08-08
**Status:** Phase 2 execution architecture FROZEN
**Scope:** personal R&D against the author's own accounts

> SURVIVOR has demonstrated a governed dry execution boundary against live Robinhood
> account state, but it has not executed or simulated a live broker order.

Everything below was observed or tested. Where something is inferred rather than
established, it says so.

---

## 1. Observed Robinhood facts

Established from public metadata endpoints, the OAuth consent screen, and authenticated
read-only sessions against the author's own accounts.

    endpoint            https://agent.robinhood.com/mcp/trading
    server              robinhood-trading v1.1.1, MCP protocol 2025-06-18
    auth                OAuth 2.0, authorization_code + PKCE S256
    authorize           https://robinhood.com/oauth  (requires scope=internal explicitly)
    token               https://api.robinhood.com/oauth2/token/
    registration        https://agent.robinhood.com/oauth/trading/register
    client model        registration returns the SAME client_id to every caller. It is
                        RFC 7591-shaped but creates nothing. No per-client identity exists,
                        so Robinhood cannot distinguish one custom client from another and
                        the consent screen names none of them.
    scopes              ["internal"] - a single blanket scope. There is NO read-only option.
    grant contents      trade authority in the Agentic account, read across ALL accounts
                        (positions, orders, balances, P&L, transaction history), watchlist
                        management - presented as one grant with one Allow button.
    second factor       device approval required in the Robinhood app
    token lifetime      774,924 seconds observed - approximately nine days
    tool surface        54 tools, broader than the public documentation described:
                        scanners, saved screeners, option exercise, tax lots, technical
                        indicators, earnings calendars, index data, margin upgrade paths
    account model       per-account `agentic_allowed` boolean - Robinhood's own boundary,
                        machine-readable. Also per-account `option_level`.
    reads               account-scoped; get_portfolio, get_equity_positions and
                        get_realized_pnl all require account_number from get_accounts
    revocation          all grants revoke together from the Agentic account page; with no
                        per-client identity a user cannot tell which grant belonged to what

### Three distinct failure modes
    missing account_number   structured JSON-RPC error
    missing asset class      PLAIN TEXT, not JSON: "unable to fetch realized P&L: rpc
                             error: code = InvalidArgument desc = un-specified asset class"
    tool not permitted       blocked locally; never reaches the wire

A client assuming JSON in content[0].text throws on the second.

---

## 2. SURVIVOR controls built

**Capability firewall.** Every live tool classified by CAPABILITY CLASS, not by name -
OBSERVE_ACCOUNT, OBSERVE_MARKET, OBSERVE_HISTORY, ANALYZE, DISCOVERY, SIMULATE,
MUTATE_METADATA, MUTATE_ORDER, EXERCISE_DERIVATIVE, ACCOUNT_CONFIGURATION, UNKNOWN. Phase 0
posture is per class. 33 of 54 tools permitted, 21 denied. Unknown tools default DENY, so a
tool Robinhood adds tomorrow is not callable because nobody listed it.

    The first version used a hand-written allowlist of guessed names. 43 of 54 live tools
    fell through unclassified - get_positions does not exist, get_pnl does not exist - and
    two mutating tools nobody anticipated (exercise_option, cancel_option_exercise) sat in
    the unclassified pile. Default-deny is what made the guessing survivable.

**Ephemeral authentication.** PKCE verifier, challenge and OAuth state generated fresh per
session. Single-shot loopback callback on 127.0.0.1, state verified before the code is
exchanged, server closed immediately. Access token in memory only; if a refresh token is
returned it is dropped unread. Token lifetime tracked, and a token within 60s of expiry is
refused rather than failing mid-request. Nothing written to disk, Keychain or environment.

**Finance policy - five deterministic gates, in order:**

    1 STRUCTURAL          account exists, active, agentic_allowed, instrument, schema
    2 STATE SUFFICIENCY   snapshot present, fresh, complete, numerically interpretable
    3 CAPITAL BUDGET      SURVIVOR's configured budget, single-order ceiling, cumulative
    4 EXPOSURE            post-trade symbol exposure against the BUDGET, cross-account
    5 VELOCITY            order rate, notional rate, symbol cooldown

Structural failures never reach risk evaluation - impossible and unwise are different
answers. Insufficient state DEFERS rather than approving. Velocity breaches THROTTLE
because waiting resolves them.

**The capital budget is SURVIVOR's number, not the broker's.** Phase 0 observed
buying_power = -196.6 against a cash balance of -49.15: margin leverage applied to a
negative balance. A policy deriving its budget from that inherits the broker's leverage and
the broker's sign. Robinhood's figure remains telemetry.

**Exposure is measured against the authorised budget, not portfolio value.** An empty
account opening its first position is not "100% concentrated" - it has deployed a fraction
of what it was permitted to deploy. Dividing by a portfolio worth zero, or worth -49.15,
produces a number that means nothing.

**Receipt-bound execution authorization.** MUTATE_ORDER's posture is not DENY but
DENY_BY_DEFAULT_ALLOW_ONLY_WITH_VALID_EXECUTION_AUTHORIZATION. A policy ALLOW does not
grant execution; it permits an authorization to be issued, bound to:

    action fingerprint    account, symbol, side, notional, quantity, order type, limit
    capability            the exact tool it may be spent on
    state snapshot        the state the policy actually evaluated
    expiry                30 seconds by default
    single use            consumed atomically at the transport boundary

Signed Ed25519 by the execution governor. Verify-and-consume is one synchronous operation,
so two concurrent callers cannot both pass. Consumption happens before the transport call,
so a broker failure cannot resurrect permission.

**State machine:** ISSUED, VERIFIED, CONSUMED, EXPIRED, INVALIDATED_BY_DRIFT, REJECTED. A
consumed authorization reports CONSUMED - "this already worked" and "this was never valid"
are different answers.

---

## 3. Evidence and authority are different artifacts

    POLICY RECEIPT          evidence. What was evaluated, what was concluded, which gates
                            ran, which did not. NOT signed - a judgment should not carry
                            authority. It remains useful evidence within the receipt model.

    EXECUTION AUTHORIZATION authority. This capability may be exercised, for this action,
                            against this state, until this expiry, once. Signed, because
                            forging it must require the key rather than the format.

---

## 4. What Phase 2B demonstrated

Live Robinhood account state read through the firewall. Token discarded before any
evaluation. A synthetic proposal - never sent to Robinhood - evaluated locally.

    policy decision                       ALLOW
    authorization issued                  expires in 30s, ed25519 signed
    dry execution                         WOULD_EXECUTE, terminated before tools/call

    notional raised after authorization   DENY  ACTION_MISMATCH
    symbol swapped                        DENY  ACTION_MISMATCH
    side flipped                          DENY  ACTION_MISMATCH
    redirected to another account         DENY  ACTION_MISMATCH
    drifted snapshot                      DENY  SNAPSHOT_DRIFT
    no authorization at all               DENY  NO_EXECUTION_AUTHORIZATION

    dry execution attempts                7
    broker order calls                    0
    broker simulations                    0
    capital movement                      NONE

The dry boundary is a return where a tools/call would go. It demonstrates the chain; the
firewall is the control.

---

## 5. Properties under test

Counts from the tree as of this document: capability-firewall 38, execution-authorization
46, policy 30, robinhood-auth and client 22. The properties matter more than the total:

    unknown tools denied by default
    every mutating tool denied without authorization
    an authorization cannot be issued from DENY, DEFER or THROTTLE
    altered notional, symbol, side, account or order type rejected
    unsigned authorization rejected
    a forged payload with a recomputed fingerprint rejected without the signing key
    replay rejected after consumption
    expired authorization rejected
    extending the expiry breaks the signature
    snapshot drift rejected
    an authorization for place does not permit cancel
    concurrent double-use permits exactly one transport attempt
    a failed transport still consumes the authorization
    missing snapshot DEFERS rather than reporting the account as missing
    the policy receipt is unsigned; the authorization is signed

---

## 6. Limitations, stated plainly

1. **The governor signing identity is ephemeral per process.** A signature proves issuance
   by the currently running governor key, not by a persistent SURVIVOR identity. A restart
   invalidates every outstanding authorization.

2. **Consumption atomicity is Node's, not ours.** The verify-and-consume block is
   synchronous, which is why the concurrency test passes. A distributed or multi-process
   deployment needs shared atomic state or compare-and-set.

3. **Correlation policy is NOT_CALIBRATED** and appears as such in every receipt. It needs
   a return interval, lookback, data source, minimum observations, ETF and factor
   treatment, options nonlinearity and regime handling before it means anything.

4. **Broker feasibility is separate from SURVIVOR admissibility.** An ALLOW does not assert
   Robinhood would accept the order.

5. **No live order, order review, cancellation, option exercise, mutation or funding has
   been performed.** The Agentic account holds $0.

6. **Commercial use remains blocked or unresolved** under customer agreement section 29.7,
   which limits API products to personal use. What was tested is personal R&D. A commercial
   path needs a separate authorization or developer relationship, not an inference from the
   MCP being open.

7. **Cross-account visibility is Robinhood's grant, not SURVIVOR's capability.** The
   contribution is aggregation and deterministic policy over that visibility.

---

## 7. Activation conditions

Not a roadmap. Conditions under which the next piece becomes justified.

    persistent governor identity    only if authorizations must cross a process boundary
    distributed atomicity           only if execution moves beyond one process
    correlation calibration         only after a defensible methodology exists
    live enforcement                only under a separately approved, deliberately funded
                                    experiment
    commercial deployment           only after terms are separately resolved with Robinhood

---

## 8. Corrections made during this work

Recorded because each narrowed a claim, and the narrowing is the finding.

    "dynamic registration works"     -> registration returns a fixed shared client
    "review_* is non-mutating"       -> a truncated description is evidence, not proof
    "cross-account read is our edge" -> it is Robinhood's grant; aggregation is ours
    "empty snapshot means no account"-> absence of observation is not observation of absence
    "the authorization is unforgeable"-> an unkeyed digest is tamper evidence, not
                                        authenticity. Now signed.
    "CONSUMED after use"             -> the state function returned REJECTED; the test
                                        asserted what the code did rather than what it
                                        should do, and passed while encoding a bug
