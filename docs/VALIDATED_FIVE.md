# validated-five-v0.6.0-shadow: honesty without discrimination

**Date:** 2026-08-04 · **Status:** SHADOW. Production remains 0.5.3 unchanged.

## What the current model actually is
    lpLocked: null           excluded from the numerator, its 20 weight still in the
                             denominator - a silent penalty on every computed score
    devWalletActivity: 50    a constant contributing 7.5 points to every token, while
                             coverage simultaneously reports DEV_ACTIVITY_NOT_COLLECTED
    remaining five           65 points of real measurement

The scorer and its own coverage receipt disagree. That is a defect, not an unfinished
feature.

## The candidate
A FIXED five-signal model. Not per-token renormalization - the rejected shadow denominator
divided by whatever resolved for each token and pushed JUP and RAY to 100 after a holder
query failed. Here the signals and weights are fixed in advance:

    mintAuthority 31 | freezeAuthority (transfer control) 15 | holderConcentration 23
    tokenAge 15 | liquidityDepth 16

If any required signal fails to resolve, score_status is INCOMPLETE. The denominator is
never reduced.

## Result across 16 tokens
Mean delta +20.6, all 16 crossed bands, 10 gates loosened. But the ORDERING is nearly
unchanged - the five tokens tied at 67 are still tied at 91, and every delta falls between
+11 and +24.

    BONK WIF POPCAT PYTH JTO  67 -> 91
    JUP 64 -> 86 | jitoSOL 62 -> 83 | MEW BOME RAY 61 -> 82 | DRIFT 61 -> 81
    SLERF 59 -> 79 | mSOL 59 -> 78 | ORCA 56 -> 74 | TNSR 51 -> 67 | PYUSD 42 -> 53

## Finding
Removing LP and dev activity improves honesty, not discrimination. Both defects affected
almost every token similarly, so removing them shifts the scale without changing what the
model knows. Recalibrating bands to fit would reproduce the current tier assignments with
different numbers on them.

## The real question this exposed
The score currently carries two incompatible claims:

    STRUCTURAL EVIDENCE   how favourable are the on-chain properties we evaluated?
    TOKEN SAFETY          how likely is this token to be safe or durable?

SLERF at 79 is defensible under the first and misleading under the second. The five signals
do not measure abandonment, project continuity, treasury behaviour, development, governance
or market survival. A token can pass every structural check and still collapse.

Five tokens tying at 91 - BONK, WIF, POPCAT, PYTH, JTO - shows the same limit from the
other direction. The signals lack resolution for fine-grained cross-asset ranking.

## Decision
Do not recalibrate LOW/MEDIUM/HIGH. Those labels imply a broader verdict than five
structural signals support. Change the semantic contract first:

    score_name: structural_evidence_score
    claims: five currently measurable on-chain structural properties
    does not claim: project viability, returns, developer continuity, market durability,
                    absence of fraud, overall investment safety

    bands: STRONGLY_FAVORABLE_STRUCTURE / FAVORABLE_STRUCTURE / MIXED_STRUCTURE /
           ADVERSE_STRUCTURE / SEVERELY_ADVERSE_STRUCTURE

"79 FAVORABLE_STRUCTURE" is defensible for SLERF. "79 LOW RISK" is not.

## Next validation - claim usefulness, not another denominator
1. Can the five signals reliably identify severe structural defects?
2. Do the receipts explain differences the scalar score hides?
3. Is the score useful as one evidence component rather than a final verdict?
4. Should cross-asset ranking be segmented by asset class rather than pooled?
5. Which additional measured signal would actually break the five-way ties?

## Durable conclusion
SURVIVOR has five defensible structural measurements. They support an honest structural
evidence score. They do not support a comprehensive token-safety verdict. The narrower
claim is stronger because every word of it can be defended by the receipts.
