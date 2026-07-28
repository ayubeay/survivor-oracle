# Receipt schema divergence: Gate vs x402

**Status:** OPEN DESIGN QUESTION · **Found:** 2026-07-28

Two SURVIVOR services issue receipts in incompatible formats under one product name.

| | SURVIVOR Gate (v1.1.0) | SURVIVOR x402 |
|---|---|---|
| host | survivor-oracle-production-1501 | survivor-x402-production |
| schema | execution_receipt/1.0 | survivor.receipt.v2 |
| signer | 53a3c348c8195cff5bdeafee446cccbc55808d8abfee55a9dc1355f0981232ea (hex) | 47Y21b1CpfNTggEkty1CwXqh55ZmvkTJHdbx9UHCVWtm (base58) |
| storage | server-side, GET /receipts, /receipts/stats | stateless; the receipt IS the artifact |
| verify | GET /receipts/:id/verify (by id) | POST /verify (by payload) |
| finalize | POST /receipts/:id/finalize | n/a |
| access | open | x402 payment required |
| canonicalization | unknown | sorted-key JSON, RFC8785 style |

## Why this matters
A third party asked to "verify a SURVIVOR receipt" must first determine which service
issued it, then implement a different verifier for each. That is the fragmentation the
provider-abstraction doctrine exists to prevent, applied inward.

## Not a bug
The two models serve different needs. Gate is stateful and tracks execution lifecycle
(finalize, stats); x402 is stateless and hands the caller a self-contained artifact.
Both are defensible. What is not defensible is two formats under one name.

## Decision needed before either has external users
A. Converge on survivor.receipt.v2 - Gate emits the same payload shape, adds its
   execution-specific fields under a namespaced key, keeps its storage layer.
B. Converge on execution_receipt - x402 adopts Gate's schema plus a payment evidence block.
C. Define a common envelope both wrap: shared { schema, issuer, signature,
   canonicalization } with service-specific payloads inside.

C is likely correct: it preserves both models while giving verifiers one outer contract.

## Also unresolved
- Two signing keys with no published relationship. A verifier cannot tell whether both
  belong to SURVIVOR without out-of-band knowledge.
- Gate publishes no /signer equivalent; its key appears only in /gate/health.
- Host naming: both services sit on survivor-oracle-* hostnames. Gate is not an oracle.

## Context
Found while adding a signals block to the oracle for the planned /report tier. Gate
consumes the same oracle (survivor-oracle-production) and was verified unaffected by
that change: BONK returns THROTTLE with $500 cap, 50bps, 900s cooldown, confidence 0.85.
