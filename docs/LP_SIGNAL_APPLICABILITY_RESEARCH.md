# LP signal applicability - research finding (not shipped)

**Date:** 2026-08-02 · **Sample:** 20 Solana tokens · **Status:** RESEARCH ONLY, no production change

## What was tested
Whether LP-lock percentage is a valid universal safety signal at its current 20-point weight.
RugCheck's summary endpoint returns lpLockedPct and was wired into fetchTokenData
experimentally to obtain real measurements.

## Finding: LP lock measures launch convention, not safety
| pattern | tokens |
|---|---|
| 90-100% locked | WIF 95, POPCAT 96, MEW 100, SLERF 100 - all memecoins |
| 0% locked | PYTH, JTO, RAY, ORCA, mSOL, jitoSOL, bSOL, INF, TNSR, BOME |
| partial | BONK 20, W 10, DRIFT 1 |

Twelve of eighteen established tokens report 0%. Memecoins lock LP because it is the trust
convention in that market; protocol tokens and LSTs do not, because their liquidity sits in
DEX pools nobody locks. At 20 weight the signal systematically penalises mature assets and
rewards memecoins.

SLERF - a token whose 2024 collapse is well documented - scored 76/LOW/ALLOW on the strength
of 99.97% locked LP. That is the clearest illustration: locked liquidity prevents one exit
path and says nothing about abandonment, exploit, migration, or dilution.

## Why no change shipped
Three variants were built and measured:

1. LP scored from percentage, capped 85, weight 20 retained.
   SLERF 76/LOW/ALLOW. Signal inverted for the population.
2. LP removed, 20 points redistributed across the remaining six weights.
   Sample mean 65 -> 76, 16 of 18 gating ALLOW. Credits every token for signals that do not
   discriminate. Worse than the original distortion because it produces false permits.
3. LP removed, remaining weights left summing to 80, LP as a max +5 bonus.
   Mean 62, memecoins no longer top the table - but scores now run out of 80 while tier
   thresholds (LOW >= 75, HIGH >= 50) remain calibrated for 100. Semantically invalid.

Every variant requires deciding what fills the 20-point hole, and every answer changes every
score. That is the 0.5.0 missing-evidence model, not an LP patch.

## Separate concern: where LP measurement belongs
RugCheck is currently opt-in behind ?ext=true on a paid tier. Moving it into the base fetch
path would add third-party latency, a new failure mode, rate-limit exposure, and would erase
the free/paid boundary. That is a product decision, not a data fix, and was reverted.

## Deferred to 0.5.0
- measured-evidence renormalization vs fixed denominator vs evidence-plus-coverage
- tier threshold recalibration if the denominator changes
- asset-class applicability (not derivable from chain - Layer 2)
- whether LP belongs as a core weight, a bounded bonus, or reporting only
- where the RugCheck call sits relative to the paid tier

## Artifacts
research-0.5.0.mjs - harness comparing the three denominator policies across 20 tokens,
prints coverage, tiers, gate migrations. Reads only; makes no production change.
