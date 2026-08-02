# Scoring Constitution v0.5 - RATIFIED FRAMING, staged implementation

**Status:** framing settled 2026-08-02. Implementation staged - see section 8.

## 1. What a score means
A SURVIVOR evidence score of 80 means that, under the current doctrine version, the
successfully measured and applicable evidence was strongly favourable relative to the
defined signal weights.

It does NOT mean an 80% probability of safety, survival, or profit. SURVIVOR has no
labelled outcome dataset and makes no calibrated prediction.

## 2. Four outputs, four questions
    evidence_score      how favourable was the evidence we measured?
    coverage            how much of the doctrine did we measure?
    confidence          how much do we trust those measurements?
    gate                what should the caller be permitted to do?

Gate is an admissibility decision informed by all three plus the requested action and
its value - not a threshold on evidence_score. A $5 lookup and a $50,000 swap may receive
different gates from identical token evidence.

## 3. Renaming
risk_score becomes evidence_score. The old name invites reading a 0-100 number as a
probability regardless of documentation. legacy_risk_score retained during migration.

Tier labels become evidence bands:
    75-100  EVIDENCE_FAVORABLE
    60-74   EVIDENCE_MIXED_FAVORABLE
    50-59   EVIDENCE_MIXED
    40-49   EVIDENCE_ADVERSE
    0-39    EVIDENCE_STRONGLY_ADVERSE

## 4. Gate doctrine (draft)
    DENY       critical deterministic failure, prohibited control condition, strongly
               adverse evidence, or policy violation
    CHALLENGE  mixed evidence, insufficient coverage, low confidence, high-value
               execution, or unresolved Layer 2 questions
    ALLOW      favourable evidence AND minimum coverage AND adequate confidence AND no
               critical failure AND requested execution within policy

## 5. What is real today, and what is not
HONEST NOW:
  evidence_score        computed from measured signals, weights explicit
  coverage.weighted_percent  computed, but see below
  coverage.measured / unavailable   real arrays with reasons

NOT REAL YET - must not be emitted as though it were:
  confidence            currently a hand-tuned penalty table on holderNote strings
                        returning 0.85 for nearly every token. Does not consider source
                        quality, freshness, agreement, or provenance. Emitting a
                        structured confidence object from this would be a well-shaped
                        field carrying a near-constant.
  coverage.not_applicable    requires asset class. Layer 2. Always empty today.
  coverage.layer2_required   nothing currently populates it.
  coverage variance     takes two values across a 20-token sample (63% and 81%). It is
                        a flag for holder-query success, not a measure of completeness.

## 6. Staging rule
A field is emitted only when something real computes it. Reserved fields are named in
this document, not shipped as empty keys. Shipping a structured field that always returns
the same value is the failure mode this constitution exists to prevent - it is what
dev activity, LP lock, and hardcoded metadata each did.

## 7. The test any future signal must pass
    - derivable at Layer 1, or does it need a registry?
    - does it discriminate across the sample, or track a convention?
    - what does absence mean: unmeasured, not applicable, or genuinely absent?
    - what happens to the denominator when it is missing?
    - does adding it move band boundaries?

## 8. Implementation stages
    0.5.0  SHIPPED 2026-08-02. evidence_score and evidence_band emitted ALONGSIDE
           risk_score, risk_tier and riskLevel - additive, not a rename, because Gate
           (survivor-oracle-production-1501) and the x402 wrapper both read the legacy
           fields. Boundaries deliberately NOT recalibrated: the current distribution is
           compressed by the unresolved LP hole, so fitting bands to it would encode a
           temporary defect into permanent labels. Schema tagged
           evidence-band-v0.5-provisional. No score moved. Coverage arrays already emit
           measured counts and unmeasured with reasons.
           Legacy fields stay populated until consumers migrate; deprecation is a doc
           statement, not a response-shape change.
    0.5.1  gate becomes a function of evidence + coverage rather than a score threshold,
           validated against the harness for gate migrations.
    0.5.2  confidence, once something real computes it.
    0.6.0  Layer 2 enrichment: asset class, program identity, LP applicability.

## 9. Still open
    - what fills the 20 points if LP leaves the core weights
    - whether band boundaries survive a denominator change
    - whether coverage can be made to vary meaningfully
    - what confidence measures that coverage does not
