# Shadow denominator model - measured, rejected

**Date:** 2026-08-02 · **Version:** measured-evidence-v0.5.1-shadow
**Status:** implemented as observation, NOT promoted. Live scoring unchanged.

## The model
Recompute the evidence score over signals that are both measured and valid, reducing the
denominator accordingly. Excluded: lpLocked (measures burned LP, a launch convention) and
devWalletActivity (never collected).

    shadow = sum(subscore * weight over included) / sum(weight over included)

## Result across 20 tokens: rejected

| token | coverage | live | shadow | weight | delta |
|---|---|---|---|---|---|
| JUP | 50% | 62 | 100 | 50 | +38 |
| RAY | 50% | 62 | 100 | 50 | +38 |
| BONK, WIF, POPCAT, PYTH, JTO | 65% | 67 | 91 | 65 | +24 |
| W | 65% | 65 | 88 | 65 | +23 |
| jitoSOL | 65% | 62 | 83 | 65 | +21 |
| MEW, BOME | 65% | 61 | 82 | 65 | +21 |
| DRIFT, SLERF | 65% | 59 | 79 | 65 | +20 |
| mSOL | 65% | 59 | 78 | 65 | +19 |
| ORCA | 65% | 56 | 74 | 65 | +18 |
| bSOL, INF, TNSR | 65% | 51-53 | 67-69 | 65 | +16 |

## Why it fails
1. IT REWARDS IGNORANCE. JUP and RAY score a perfect 100 because their holder query
   failed, so only signals they happen to pass remain in the denominator. A token we know
   less about outranks every token we know more about. This is the failure predicted
   before implementation, appearing exactly where predicted.

2. IT DOES NOT DISCRIMINATE. Within the fully-measured group the delta ranges 16-24, close
   to a constant offset. The ranking is nearly unchanged from live, so the model adds
   roughly 20 points without improving separation.

3. IT COMPRESSES THE TOP. Five distinct tokens tie at 91. The live model separated them.

## What this establishes
The denominator is not the problem to solve. Removing invalid signals from the
denominator cannot produce a better score while two of seven signals are globally
unmeasured, because the reduced denominator amplifies whatever remains and rewards tokens
with the least data.

The problem is upstream: not enough signals are measured. Any denominator policy is a
different way of dividing by a hole.

## Kept
The shadow_denominator field remains in the scorer output as observation. It costs
nothing, is marked enforced: false, and provides ongoing evidence about what a reduced
denominator would do as signal coverage changes.

## Prior rejected variants
See LP_SIGNAL_APPLICABILITY_RESEARCH.md for three earlier attempts - LP capped at 85,
LP removed with weight redistributed, and LP as a bounded bonus - each rejected on
population-level measurement.
