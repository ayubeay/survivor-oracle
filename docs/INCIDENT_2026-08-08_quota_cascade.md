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

## Resolution and correction - 2026-08-09

Replaced the exhausted RPC endpoint with a healthy provider. One environment variable, read
in two files.

Observed immediately afterward:

    SURVIVOR production      BONK 67, coverage 65% - scoring restored
    OROS /events with mint   ~8.40s -> ~5.75s
    OROS /events no mint     ~0.87s
    MomentumSniper           one OROS timeout at 00:02:13 after log rotation

### What is established
The exhausted RPC was a real contributor but NOT the entire source of mint-path latency.
Restoring capacity removed roughly 2.6 seconds. Roughly 4.9 seconds still separates the
no-mint and mint-bearing requests.

Corrected causal model:

    existing expensive mint/scoring path
      + shared RPC quota exhausted by unnecessary background polling
      -> reduced latency headroom
      -> downstream governance requests more likely to exceed the 12s timeout

That is a more useful finding than "the poller broke everything." The expensive path existed
first; the quota exhaustion removed the headroom that was hiding it.

### What is NOT established
MomentumSniper failure-rate recovery. The current log has run for minutes. One failure since
midnight cannot be meaningfully compared with 148 across a full day, and the earlier draft of
this section made exactly that comparison. Corrected.

### Still open
1. Measure the MomentumSniper OROS timeout rate over a meaningful post-fix window.
2. Break down the ~4.9s incremental mint-path latency by stage.
3. Determine which scoring and RPC operations are sequential and which can safely run
   concurrently.
4. Classify hard quota exhaustion separately from transient rate limiting, so retries do
   not add useless delay against a limit that will not clear.
5. Introduce dependency budgets so background discovery cannot consume capacity reserved
   for control-plane and on-demand execution.

Point 5 is the strategic finding. The monitor was not merely too aggressive - it had the
same ability to consume scarce infrastructure as a production governance path. Background
discovery, research workloads, scoring and governance should have separate quotas or
priority classes.

### Do not raise the 12s timeout yet
Increasing it would hide the remaining 5-6 second path rather than explain it. Instrument
where those seconds go first. The next useful step is stage timing inside the mint path, not
another architectural feature.

---

## Standing rule, added 2026-08-14 after a third instance

**Never catch and discard without recording what was caught.**

Three occurrences in one week, each costing real time:

    /health returned 200 while the RPC quota was exhausted
    MomentumSniper logged "OROS governance call failed: " - TimeoutError stringifies to ""
    the equity collector wrote 0 book records for three runs

The third is the clearest. The venue returned a plain-text message saying exactly what was
wrong - "too many symbols: this tool returns the order book for up to 4 symbols per call,
got 10 - split into batches of 4 or fewer" - and a JSON.parse in a try/catch returning null
made it indistinguishable from an empty result. Adding one console.log found it on the next
run.

A failure that reports as an empty success is worse than a crash. The crash tells you
something is wrong; the empty success tells you nothing is.

## Third measurement, 2026-08-15 - the intrinsic cost keeps revising down

A fresh RPC key with no quota pressure:

    OROS /events with mint      4.27s   (was 8.40s exhausted, 5.75s after first swap)
    fetchTokenData full         3.71s   (was 4.91s)
    getTokenMintInfo            0.27s
    classifyMintAuthority       0.00s
    classifyTransferControl     0.10s
    getDexScreenerData          0.24s

### Correction to the correction
Yesterday's entry attributed ~2.6s to the quota and called the remaining ~4.9s intrinsic.
That figure was itself contaminated by residual load. On a clean key the same path measures
3.71s.

So the attribution has moved twice, in the same direction, each time a cleaner measurement
became available. The honest statement is that the mint path costs roughly 3.5-4s under
current conditions and the "intrinsic" component has not stopped revising.

**Lesson: a measurement taken during degradation should not be labelled intrinsic.** Wait
for a clean baseline before attributing cost to architecture.

### Headroom
Against MomentumSniper's 12s client timeout, 4.27s is about a third of the budget rather
than two-thirds. That is real headroom, though the underlying sequencing question stands:
four cheap calls totalling under a second run AFTER holder distribution rather than
alongside it.
