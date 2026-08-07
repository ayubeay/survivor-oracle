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
