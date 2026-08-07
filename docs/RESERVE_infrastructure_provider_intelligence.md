# RESERVE - Infrastructure Provider Intelligence (API Connect / SURVIVOR)

**Status:** RESERVED
**Urgency:** LOW for the full registry and routing engine. MEDIUM for one narrow piece -
see below.

## Purpose
Never depend on a single infrastructure provider. Evaluate, benchmark, route between and
learn from them. Providers are interchangeable execution engines; the intelligence layer
stays provider-independent.

## Capability registry
Abstract each capability behind an internal interface, with providers registered against
it: historical token balances, historical account state, archive RPC, low-latency RPC,
webhooks, gasless transactions, cross-chain coverage, compression.

## Benchmark receipts
Periodically measure latency, availability, timeout rate, consistency, archive
completeness, websocket stability, rate limits, regional performance, historical query
performance and cost. Produce a receipt naming the recommendation and its reason.

## Capability discovery
When a provider ships something new, evaluate whether it reduces engineering cost,
improves correctness or improves reliability. Not every feature should be adopted. Every
adoption produces an evaluation receipt.

## Routing
Select dynamically per capability, on health, latency, completeness, historical accuracy,
price and region.

## Doctrine
Providers compete on speed, uptime, coverage and cost. SURVIVOR competes on
interpretation, execution governance, receipts, structural intelligence, reproducibility
and admissibility.

    infrastructure: what happened?
    SURVIVOR:       what does it mean?

## The one piece worth doing sooner
The 2026-08-03 holder-query work found RPC congestion silently changing scores - a token
measured differently depending on how busy the node was. The retry and failure
classification fixed the symptom on one provider.

A **provider health signal consumed by coverage** is the narrow, useful subset: when the
RPC is degraded, coverage should say so, and Gate should be able to see it. That is small,
reuses the observation_failure work already shipped, and closes a real gap.

The full registry, benchmark suite and routing engine are premature - there is one provider
in use and no demand pressure requiring failover.

## Long-term
API Connect becomes the orchestration layer, answering not "which RPC?" but "which provider
is optimal for this capability, at this cost, in this region, with this confidence?" The
provider becomes an implementation detail.
