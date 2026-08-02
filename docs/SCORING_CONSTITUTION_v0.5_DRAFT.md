# SURVIVOR Scoring Constitution v0.5 - DRAFT FOR ARGUMENT

**Status:** DRAFT. Nothing here is implemented. Written 2026-08-02 to force the
definitional question before another weight is touched.

## 1. The sentence

    A SURVIVOR score of 80 means: of the doctrine signals we successfully measured,
    the observed evidence was 80% favourable.

It is a statement about measured evidence, not about the asset. Two assets can both score
80 while one was measured on six signals and the other on three.

## 2. What the score does not mean
- not a probability of rug, failure, or loss
- not a prediction of price
- not a statement about unmeasured properties
- not comparable across scoring versions
- not comparable across coverage levels without reading coverage

That last point is the one the current single number hides.

## 3. Four separate outputs

    evidence_score   how favourable were the signals we measured?      0-100
    coverage         how much of the doctrine did we measure?          0-100%
    confidence       how much do we trust the measurements we made?    LOW/MED/HIGH
    gate             what should an agent be permitted to do?          ALLOW/CHALLENGE/DENY

Each answers a different question. Collapsing them is what made LP, missing evidence, and
renormalization intractable: every fix to one distorted the others.

Gate is a function of all three, not of evidence_score alone. High evidence on thin
coverage should not reach ALLOW.

## 4. The problem with this design as of today
Coverage currently takes two values across a 20-token sample: 63% and 81%. It is a flag
for whether the holder query succeeded, layered on signals that are globally unmeasured.
It does not yet measure observation completeness in any useful sense.

Confidence is a hand-tuned penalty table keyed on holderNote strings. It has no term for
LP or dev activity being absent.

So three of the four dimensions above are aspirational. Writing them into a constitution
does not make them measurable. The constitution must state which are real today.

## 5. Layer boundaries (settled 2026-08-01)
    Layer 1   derivable from chain data alone. Deterministic. No registry, no inference.
    Layer 2   requires external knowledge: protocol registries, asset class, program
              identity, custody. Clearly marked as enrichment, never as derivation.

Established Layer 1 signals: mint authority classification (five states), holder
concentration over total supply, token age from earliest observed pair, liquidity by pool
with provenance, freeze authority.

Established Layer 2 questions, all currently unanswered: which program controls a PDA,
whether that program is upgradeable, what asset class a token belongs to, whether LP
locking is applicable to that class.

## 6. Open questions this draft does not answer
1. What fills the 20 points released if LP leaves the core weights?
2. Do the tier thresholds (LOW>=75, MEDIUM>=60, HIGH>=50, VERY_HIGH>=40) survive any
   denominator change, or must they be recalibrated against a sample?
3. Can coverage be made to vary meaningfully, or is it structurally binary until more
   signals are measured?
4. What does confidence measure that coverage does not?
5. Should evidence_score be reported at all, or only gate plus its reasons?

## 7. The test any future signal must pass
    - is it derivable at Layer 1, or does it need a registry?
    - does it discriminate across the sample, or does it track a convention?
    - what does its absence mean: unmeasured, not applicable, or genuinely absent?
    - what happens to the denominator when it is missing?
    - does adding it move tier boundaries?

LP failed the second and fourth. Dev activity fails the first. Both were weighted anyway.
