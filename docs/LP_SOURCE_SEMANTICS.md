# LP lock source investigation - RugCheck semantics

**Date:** 2026-08-02 · **Status:** RESEARCH. LP remains unmeasured in production.

## Aggregation is sound
An earlier claim that lpLockedPct used a per-pool denominator was wrong. Computed across
five tokens, sum(lpLockedUSD) / totalMarketLiquidity reconciles with the summary value:

| token | markets | locked USD | total liquidity | ratio | summary |
|---|---|---|---|---|---|
| BONK | 212 | $139,532 | $690,185 | 20.2% | 20.16% |
| WIF | 139 | $3,937,539 | $4,158,675 | 94.7% | 94.68% |
| SLERF | 71 | $12,413,097 | $12,416,466 | 100.0% | 99.97% |
| mSOL | 80 | $833 | $2,743,062 | 0.03% | 0.03% |
| JUP | 268 | $2,678 | $2,353,047 | 0.11% | - |

The denominator is total observed market liquidity. That part is trustworthy.

## What "locked" appears to mean is the problem
Every locker entry across all five tokens shares one shape:
- programID 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 (Raydium AMM), on 100% of entries
- owner === programID on every entry
- tokenAccount === 11111111111111111111111111111111 (system address) on every entry
- uri roots raydium.io/clmm/create-position and raydium.io/liquidity/increase
- lockerScanStatus: "none" on every token

A system-address tokenAccount means there is no escrow account being pointed at. The URIs
are pool-entry links, not lock records. And lockerScanStatus reports that no locker scan
ran at all.

The locker count also does not match markets with positive lock: BONK has 10 lockers
against 28 markets reporting lpLockedPct > 0. Different things are being counted.

## Working interpretation
lpLockedUSD most likely measures liquidity held in Raydium CLMM positions, where LP is
NFT-represented rather than fungible and so does not appear as withdrawable supply. That
is a venue property, not a commitment.

This explains the population pattern found earlier: memecoins score 95-100% because their
liquidity concentrates in Raydium CLMM; established tokens and LSTs score near zero because
they spread across Meteora DLMM and Orca. The signal tracks which venue a token trades on.

## What cannot be said
Not defensible: "94.7% of WIF liquidity is time-locked."
Defensible: "RugCheck classifies liquidity representing 94.7% of observed market liquidity
as locked under its detection model, which appears to key on Raydium CLMM position
ownership rather than on escrow or time-lock contracts."

## Still unavailable
- unlock timestamps
- whether LP is burned vs held vs escrowed
- whether the position can be modified or withdrawn, and by whom
- comparable semantics across Raydium, Meteora, Orca, Pump.fun
- any locker scan at all (lockerScanStatus: none)

## Decision
LP remains unmeasured in production scoring. The source passed the aggregation test and
failed the meaning test. Restoring a 20-weight signal on a venue proxy would encode
"trades on Raydium CLMM" as a safety property.

Possible future states, only the first two justifying strong credit:
    BURNED_OR_IRRECOVERABLE
    TIME_LOCK_VERIFIED
    PROTOCOL_POSITION            descriptive only
    SOURCE_CLASSIFIED_LOCKED     descriptive only
    UNLOCKED_OR_WITHDRAWABLE
    UNKNOWN_MECHANISM
    SOURCE_UNAVAILABLE

## Next
Verifying the CLMM hypothesis directly would mean reading a Raydium CLMM pool's position
accounts on-chain and comparing against what RugCheck reports as locked for that pool.
That is a Layer 1 check and would settle the interpretation.
