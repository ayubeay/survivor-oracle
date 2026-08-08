# RESERVE - SURVIVOR Autonomous Finance Control Plane

**Status:** Reserved with a validated integration target. Not production.
**Urgency:** HIGHEST of any reserve written this week. The doorway is open now.
**Adapter 001:** Robinhood Agentic Trading, launched 2026-05-27.

## Why this differs from every other reserve
Most reserves describe a capability nobody has asked for. This one describes a gap someone
is publicly complaining about, on a rail that is already open.

From Robinhood's documentation as reported: Agentic Trading exposes a Trading MCP so
third-party agents can connect to a dedicated Agentic account. Claude, ChatGPT, Codex,
Cursor and Grok are named, and any MCP-compatible platform may connect. Agents get read
access to all accounts, positions, balances, transactions and watchlists; order placement
is confined to the Agentic account. Robinhood warns that autonomous orders can execute
without per-trade confirmation.

Their own risk disclosure describes the failure domain precisely: agents can make errors,
misinterpret instructions, act on incomplete or outdated information, and behave
unexpectedly.

That is a description of the problem SURVIVOR exists to govern.

## The observed gap
A public experiment: 13 autonomous agents, each with its own capital slice, and - in the
operator's own words - no coordination layer between them.

Five agents independently turning bullish on correlated semiconductor names each stay
inside their own allocation while the portfolio quietly concentrates. A crypto agent buys
BTC while a prediction-market strategy establishes the opposite macro exposure. Neither
knows.

## Position
    strategy framework  defines what the strategy wants to do
    AI agent            reasons about when and why
    SURVIVOR            determines whether the proposed execution is admissible
    venue               executes
    receipt             establishes what happened, under which policy and configuration

    agent -> SURVIVOR -> Robinhood Trading MCP -> Agentic account

SURVIVOR must not become the stock-picking model. Keep that separation rigid. It answers a
different question: given everything already happening across this account, is this
particular autonomous action admissible right now?

## Checks before an MCP call
Agent identity, authorisation, capital budget, position limits, portfolio exposure,
correlated exposure, order velocity, loss budget, context freshness, strategy constraints,
anomaly detection. Then ALLOW / THROTTLE / DEFER / DENY.

## The read permissions are the leverage
The agent sees ALL accounts while executing only in the Agentic one. That is enough to
distinguish agent-local risk from human-total portfolio risk.

If the ordinary account already holds $20,000 of semiconductors, an autonomous strategy
does not deserve another $5,000 simply because its own account started empty. No individual
agent can see that. The control plane can.

## Example receipt
    Agent strategy_07 | Venue Robinhood Agentic | BUY XYZ $100
    identity VERIFIED | permission VALID | allocation WITHIN_LIMIT
    daily loss budget OK | concentration OK | cross-agent exposure ELEVATED
    context freshness VALID
    DECISION THROTTLE, approved notional $40
    reason: aggregate correlated exposure across autonomous strategies would exceed
            portfolio policy at $100

## Configuration provenance requirement
Every governed execution must be attributable to an immutable, versioned strategy
configuration. Receipts capture or reference:

    agent_id + strategy_id + strategy_config_hash + model and version
    + context snapshot reference + policy_version + proposed_action
    + admissibility_decision + execution_result + eventual outcome

When a strategy loses money: which configuration produced these trades, when did it change,
what changed it, did performance deteriorate after, which policy evaluated it, and can the
decision be replayed under the previous configuration?

Combined with the Context Integrity reserve this gives provenance on both sides - cognition
provenance (what information and model produced the decision) and execution provenance
(what configuration and policy permitted the action).

## Broker-neutral
Robinhood is Adapter 001, not the product. Coinbase, Kalshi and other agent-accessible
venues sit behind the same governance interface. The control plane sees cross-platform
exposure; a single venue sees only itself.

## First experiment - shadow only
Receive proposed decisions, produce ALLOW / THROTTLE / DEFER / DENY receipts, control
nothing. Compare decisions against what actually happened. Execution authority is a
question for after the gate has evidence behind it.

Prove the control plane before entrusting the control plane with capital. Same discipline
the scoring work has followed all week.

## What has NOT been verified
Robinhood's documentation is recorded here as pasted, not independently checked. Before any
build:

1. Confirm the MCP endpoint and current terms directly.
2. **Confirm whether a third-party governance layer sitting between an agent and the MCP is
   permitted.** Their docs say any MCP-compatible platform may connect - that is about the
   AGENT connecting. Something intercepting proposed actions in the middle is a different
   question, and the entire architecture rests on the answer.
3. Confirm what Agentic account onboarding actually requires.

The Virtuals / Robinhood Chain integration is a related but separate surface and should not
be conflated with the brokerage Trading MCP.

## Grading
The strongest commercial thesis reserved this week. Agentic finance is commoditising
execution and strategy construction simultaneously - Robinhood supplies the execution rail,
frameworks supply strategy scaffolding, several models supply cognition. That makes the
layer asking *should this autonomous action be allowed* more valuable, not less.

The cheapest first step is not code. It is checking whether the terms permit what the
architecture assumes.

---

## Investigation 2026-08-07 - what the account actually showed

**Status change: PERSONAL R&D REACHABLE / COMMERCIAL USE BLOCKED.**

Agentic Trading is live and available. Endpoint https://agent.robinhood.com/mcp/trading,
documented for Claude Code, Claude Desktop, ChatGPT, Codex, Cursor.

Authenticating the MCP walks the user into opening a dedicated Agentic brokerage account -
it is not a login, it is an account-opening flow with a regulatory suitability
questionnaire. Discovery therefore has a real cost.

### Permission scope, from the OAuth consent screen
    trade   Agentic account only
    read    all accounts - positions, orders, balances, P&L, transaction history
    manage  watchlists

The read-across-all-accounts scope is what makes cross-account exposure governance
possible. No individual agent connected to its own account can see that; a control plane
holding the session can.

### The blocker: Customer Agreement Section 29.7
API Products may be used "solely for your own personal use and not for any other
purposes", and Robinhood reserves the right to revoke API authorization.

    personal experiment   your agent -> SURVIVOR -> Robinhood MCP -> your Agentic account
                          consistent with what Robinhood expressly enables

    commercial service    many customers -> SURVIVOR -> Robinhood
                          NOT authorised by the current agreement

Technical compatibility is not contractual permission. Offering this to others needs an
explicit developer or commercial relationship with Robinhood, not an inference from the MCP
being open.

### review_equity_order / place_equity_order
Robinhood exposes review and place as separate calls. That is architecturally useful:

    agent proposes -> review_equity_order -> broker warnings and execution info
    -> SURVIVOR policy -> ALLOW / THROTTLE / DEFER / DENY
    -> if ALLOW, place_equity_order -> receipt

SURVIVOR consumes the broker's own review as evidence rather than reimplementing checks the
venue does better. Same pattern as consuming Token-2022 transfer-fee configuration instead
of guessing at execution cost.

### Architecture correction
SURVIVOR is the MCP CLIENT, not a proxy between an agent and the MCP. Robinhood's model is
one connection, client to server. There is no seam for a third party in the middle. The
governed runtime authenticates, holds the session, evaluates policy and calls the tools
itself.

### First experiment, unchanged and unfunded
Read account, portfolio and P&L. Generate shadow policy receipts. Execute nothing. Fund
nothing. Then replace the borrowed MCP client with SURVIVOR's own implementation.

### Operational note
Account numbers, tokens and session credentials never enter this repository or any
architecture document.

## OAuth model, established 2026-08-08 without authenticating

Unauthenticated probe of the MCP endpoint returns 401 with:

    www-authenticate: Bearer resource_metadata=
      "https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading"

Following the discovery chain, from public metadata only:

    authorization_endpoint   https://robinhood.com/oauth
    token_endpoint           https://api.robinhood.com/oauth2/token/
    registration_endpoint    https://agent.robinhood.com/oauth/trading/register
    grant_types              authorization_code, refresh_token
    code_challenge_methods   S256
    token_endpoint_auth      none
    scopes_supported         ["internal"]

### Finding 1 - dynamic client registration is open
A registration_endpoint exists and token endpoint auth is "none". This is a public OAuth
client with PKCE. SURVIVOR can register itself and authenticate a user without a developer
relationship, partnership or pre-provisioned credentials.

That removes the largest architectural unknown: SURVIVOR CAN be the MCP client.

### Finding 2 - there is no read-only scope
scopes_supported is a single value, "internal". The consent screen confirms it: trade
authority, cross-account read and watchlist management are presented as one grant with one
Allow button. No granular selection.

CONSEQUENCE: a Phase 0 observation experiment cannot be made safe by requesting a narrower
scope. Any authenticated session carries Agentic trade authority whether or not it is used.

The execution boundary must therefore be enforced entirely within SURVIVOR - by never
calling place_equity_order - with nothing external preventing it. That is a self-imposed
constraint, not a broker-enforced one.

This is exactly the situation a control plane exists to address, and exactly why the
control plane has to earn trust before it holds capital. The Phase 0 design stands, but its
safety comes from our discipline rather than from scope restriction. Record that honestly
rather than describing observation mode as read-only.

### Not authenticated
The OAuth consent screen was reached and deliberately not approved. Granting persistent
brokerage read access to a temporary discovery client was not justified when Claude Code is
not the intended client. Everything above came from public metadata endpoints.

### Still unknown, and requires authentication to learn
Exact tool schemas for review_equity_order and place_equity_order. Token lifetime and
refresh behaviour. Whether tools/list differs from the public documentation. Response
shapes for account and portfolio reads.

### Correction to Finding 1 - what the metadata does and does not prove
The earlier wording overclaimed. Published metadata establishes that Robinhood exposes a
registration endpoint, uses authorization_code with PKCE S256, and requires no client
secret. That is the standards-based machinery a custom client needs.

It does NOT establish that arbitrary registration succeeds, that registration carries no
conditions, or that commercial operation is authorised. The defensible statement:

    Robinhood exposes the machinery required for a custom MCP client. SURVIVOR appears
    technically capable of becoming that client, subject to successful registration and
    applicable terms.

Successful dynamic registration remains unproven until attempted.

### Three boundaries, and only the first belongs to Robinhood
    ROBINHOOD AUTHORISATION   the token may do whatever the "internal" scope permits
    SURVIVOR CAPABILITY       which of those the runtime exposes upstream at all
    SURVIVOR POLICY           whether this particular proposed action is admissible

    Robinhood:  you MAY place trades
    runtime:    this deployment CANNOT place trades
    policy:     this deployment can, but THIS trade is DENIED

Three different controls. Conflating them is how a system ends up describing itself as
read-only when nothing structurally prevents writing.

### Phase 0 is an allowlist, not a promise
"Read-only" was assumed to be a broker permission. It is not - there is one scope. So
read-only becomes a property SURVIVOR must construct rather than something it can request.

The runtime rejects forbidden tool names before the request leaves the process:

    agent requests place_equity_order
      -> MCP client capability wrapper
      -> PHASE_0_EXECUTION_DISABLED
      -> DENY + receipt

    permitted   account reads, balances, positions, P&L, order history, market data,
                review_* where non-executing
    forbidden   place_equity_order, place_option_order, any mutating cancel or modify,
                watchlist mutation

Even though the OAuth token carries trade authority, no usable path to exercise it exists
through the runtime. That is a materially stronger experiment than instructing a model not
to call something.

### Next progression, still zero capital and zero mutation
    1  attempt dynamic client registration, inspect the response
    2  implement and verify the PKCE authorization flow
    3  authenticate the operator's own account
    4  store credentials outside the repository
    5  tools/list
    6  construct the hard Phase 0 allowlist
    7  read account, position and P&L state
    8  produce the first shadow governance receipt
    9  execute nothing

Failure at step 1 is itself valuable evidence.

### Status
    custom-client architecture strongly supported
    no advertised read-only scope - confirmed
    Claude does not need brokerage access - confirmed
    SURVIVOR can enforce a narrower surface than OAuth grants
    successful arbitrary registration - UNPROVEN
    commercial authorisation - UNRESOLVED under current customer terms
    trading and funding - NOT STARTED

### Step 1 result, 2026-08-08 - dynamic registration succeeds
POST to the registration endpoint with client metadata returned 200 and a client_id.
No approval, no developer relationship, no client secret, token_endpoint_auth_method
"none". A custom redirect_uri of http://localhost:8765/callback was accepted verbatim,
which makes a local PKCE loopback flow possible.

Two observations:
- the submitted client_name was ignored; the response returned "Robinhood Trading". Client
  identity is not stored per registration, so the consent screen will not name our client.
- the client_id is a public value. It is not a secret and does not authorise anything on
  its own; the user consent step is what grants access.

Status change: successful arbitrary registration - CONFIRMED. SURVIVOR can be the MCP
client for personal R&D use.

Commercial authorisation remains unresolved under customer agreement 29.7. Registration
being open is not permission to operate a service on behalf of others.

### Correction 2026-08-08 - registration is not dynamic
Two identical registration requests returned the SAME client_id
(LtLiNmbs9owbYfWgBlC68Z2VujIPuvGoAiSYr8xW). The endpoint is RFC 7591-shaped but returns one
fixed public client to every caller. Nothing is created.

That explains the normalised client_name: there is no per-registration identity to store.

Consequences:
- a custom client still works - PKCE binds the authorization to the caller's session, so a
  shared client_id is not itself a vulnerability
- but Robinhood CANNOT distinguish SURVIVOR from Claude Code from any other custom client.
  Every non-partner client is the same client.
- the consent screen will never name our client, and the Agentic account's connected-agents
  list cannot attribute a connection to a specific custom runtime

The earlier status line "successful arbitrary registration - CONFIRMED" was wrong. The
correct statement: the endpoint accepts any registration request and returns a shared
public client. Custom clients are supported; custom client IDENTITY is not.

### Authorization flow: unresolved
First authorize attempt timed out after 180s. The authorize URL routed to the Agentic
account page rather than a consent screen, so no callback arrived. Added scope=internal as
the next hypothesis; unverified.
