# Incident: one poller degraded three services - 2026-08-08

## Chain
    SURVIVOR pump.fun poller, 15s interval, ~1,400 RPC calls/hour before scoring
      -> Helius quota exhausted, 1,000,000 / 1,000,000, 26 days to reset
      -> SURVIVOR scoring returns 429 "max usage reached", with retry backoff
      -> OROS scores the mint carried in every swap event
      -> +7.5s latency per governed event
      -> MomentumSniper's 12s aiohttp timeout crossed
      -> governance ERROR, fail closed to paper mode

## Measured
    POST /events without a mint    0.87s
    POST /events with a mint       8.40s
    difference                     7.5s, attributable to mint scoring

    OROS governance failures/day   8, 3, 6, 4, 58, 103, 148 (Aug 3-8, escalating)

## What this cost
Nothing in capital - MomentumSniper runs OROS_PAPER_MODE=1 and fails closed. What it cost
was availability: SURVIVOR cannot score, OROS is slow for any event carrying a mint, and
MomentumSniper has made no governed decisions for days.

## Root cause
A background discovery feed with no readers consumed a quota that synchronous,
execution-critical scoring depended on. Nothing surfaced it: /health returned 200,
the service reported itself initialized, and totalScored: 0 was the only signal.

## Doctrine
**Background enrichment must not share a budget with synchronous execution-critical
dependencies.** Separate allowances - a critical scoring reserve, a background monitor
allowance, a research allowance - so a discovery feed cannot starve a control plane.

## Two secondary findings
**Retrying a hard limit adds latency for nothing.** The holder-query retry added on
2026-08-03 correctly handles transient RPC failure with 400ms and 900ms backoff. A 429
reading "max usage reached" is not transient, and four attempts against an exhausted quota
is pure delay. The classifier should distinguish a rate limit that will clear from a quota
that will not.

**An empty error string cost most of this investigation.** MomentumSniper logged
"OROS governance call failed: " because asyncio.TimeoutError stringifies to nothing. It
should carry type, elapsed_ms, endpoint and stage. This is the same failure as
HOLDER_QUERY_FAILED hiding a 429 behind a generic label - the third instance today of a
system reporting less than it knew.

## Fixed
Monitor disabled by default (MONITOR_ENABLED, and 60s rather than 15s if enabled). The gate
now runs before the startup banner, so the log does not announce a monitor that is not
running.

## Not fixed
Quota exhausted until reset. No code recovers it.
