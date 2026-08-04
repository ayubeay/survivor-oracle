# Observation failure is not evidence - 2026-08-03

## The defect
BONK scored 62 or 67 depending on whether getTokenLargestAccounts succeeded. Under parallel
load, 3 of 8 tokens failed. The failure produced HOLDER_QUERY_FAILED, the 15-weight holder
signal left coverage, and the score changed with no change in on-chain state. A signed
receipt recorded whichever value the RPC happened to return.

## Root cause
The inner catch swallowed every error identically. An outer catch already handled 429s as
MEGA_CAP_FALLBACK but was unreachable, since the inner one returned first.

## The error was not what was assumed
Not a 429, not a timeout:
    failed to get token largest accounts: account index service overloaded, please try again

The node was explicitly asking to be retried, and the first fix classified it as terminal.
That only surfaced because the classifier reported the error text instead of hiding it -
the retry was added for rate limits and timeouts, the same failures recurred, and the
detail field named the real cause.

## Fix
Three attempts, 400ms then 900ms with jitter, for causes that are transient:
    HOLDER_QUERY_RATE_LIMITED     429, too many requests, deprioritized
    HOLDER_QUERY_TIMEOUT          timeout, ETIMEDOUT, ECONNRESET
    HOLDER_QUERY_NODE_OVERLOADED  overloaded, please try again, service unavailable
    HOLDER_QUERY_RPC_FAILED       anything else - not retried

Failures carry observation_failure { category, attempts, detail }, so a receipt states why
a signal is missing rather than leaving a silent gap.

Parallel burst: 3 failures in 8 -> 0 in 8. Cost 1.8s on a worst case. RAY verified stable
at 61 across three consecutive production calls, previously 61 or 62 by chance.

## Doctrine
RPC congestion is a failure to observe, not an observation about the token. A signal that
could not be measured is reported as unmeasured with a stated cause - never a neutral
default, never a worse value, never silently.

This generalises to every external source: each must distinguish "the token has this
property" from "we could not look".

## Next, and deliberately not another denominator experiment
Holder concentration is numerically correct but its meaning is incomplete - the same shape
as burned LP. PYUSD reads as adverse concentration, but its large accounts may be issuer
treasury, exchange custody, bridges, or program vaults.

Proposed Layer 1 classifier, reporting only:
    concentration_percent
    account_classes: WALLET | PROGRAM_CONTROLLED | MULTISIG_CONTROLLED | UNKNOWN
    classified_percent, unknown_percent, provenance

Layer 1 can determine account ownership and program control. It cannot name Coinbase,
Binance, or a Paxos treasury without a registry - that stays Layer 2. Test whether the
classification separates concentrated retail ownership from concentrated custody before
any weight changes.
