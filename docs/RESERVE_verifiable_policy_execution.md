# RESERVE - Verifiable Policy Execution

**Status:** Research direction. DO NOT IMPLEMENT.
**Urgency:** MEDIUM as research. The honesty correction below applies immediately.

## The correction that prompted this
A SURVIVOR receipt today proves who issued it and whether it was altered. It does NOT
prove that the declared policy was correctly evaluated against the actual inputs.

Those are different claims. Treating a signature as evidence of correct evaluation would be
the same error the scoring work kept finding all week - a name promising more than the
mechanism delivers.

## The evidence ladder

**Level 0 - log.** Record the decision after evaluation. Proves nothing about how it was
reached.

**Level 1 - signed, tamper-evident receipt.** Bind issuer, decision, reasons, constraints,
timestamp, policy version, signature. WHERE SURVIVOR IS TODAY. Proves provenance and
integrity of the claim; proves nothing about the evaluation.

**Level 2 - committed inputs plus deterministic replay.** Commit to canonicalised policy
inputs by hash. Bind the exact policy version and code identity used. Preserve enough
evidence that an authorised verifier can replay the evaluation and confirm the same inputs
produce the reported decision.

Closer than it looks: buildPolicy is a pure function, the policy version is already
emitted, and the inputs are already assembled. What is missing is committing to the inputs
and being able to re-run.

**Level 3 - independent verification.** An independent verifier validates the evaluation
without trusting the original process merely because it signed. Research reproducible
builds, code commitments and attestation mechanisms rather than selecting a cryptographic
technique prematurely.

**Level 4 - privacy-preserving verification where justified.** Whether selected policies
can be proven against committed private inputs without revealing sensitive data. This
belongs with Zircon's cryptographic-evolution program (c), not with SURVIVOR engineering.
Do not assume ZK is necessary or economically justified - Level 2 or 3 likely solves the
actual enterprise problem far more cheaply.

## Two distinctions that must never blur

    signature integrity  !=  policy-execution correctness
    input commitment     !=  proof that committed inputs were truthful

The second matters more and is easier to lose sight of. Suppose a receipt records:

    inputs_hash = abc123
    policy_hash = def456
    decision    = DENY

and anyone can replay those inputs and reproduce DENY. That proves SURVIVOR evaluated these
committed inputs consistently. It does NOT prove those inputs were complete, fresh or
truthful.

Input provenance stays a VERITY and evidence problem. Without it, we could build
sophisticated cryptographic proof around garbage inputs - mathematically impressive and
operationally useless.

This is the same lesson as the holder-control work. A percentage is uninterpretable until
you know what kind of thing it measures. A proof is uninterpretable until you know whether
its inputs described reality.

## Placement
Not a standalone product. vLOID owns admissibility, LITMUS the policy constraints, SURVIVOR
the receipts, VERITY input provenance and confidence, OROS coordination, the Inference
Evidence Ledger the research audit trail, Zircon the cryptographic frontier.

## External signal
An independent legal-AI company is arguing the same shape from a different direction:
deterministic constraints before execution, then independently verifiable evidence the
constraint was satisfied. Their claim is stronger than ours - zero-knowledge receipts a
third party can check without access to the underlying system.

That is external validation of the thesis and identification of the frontier, not a reason
to adopt their mechanism.

One disagreement with that framing worth recording: human review does not disappear. In
high-consequence environments some uncertainty cannot be reduced to deterministic
predicates. The stronger position is that review stops being the universal bottleneck -
deterministic cases execute, ambiguous and high-risk cases escalate.

    proposed action -> deterministic policy -> ALLOW | DENY | HUMAN_REQUIRED

## Doctrine
Do not market Level 1 as Level 2, Level 2 as Level 3, or deterministic replay as a
zero-knowledge proof. Evidence claims must never exceed what the mechanism establishes.

## Grading
Worthwhile research. Level 2 is the only rung reachable without new cryptography, and it
would meaningfully strengthen what a receipt means. Do not implement now - the current
priority is evidence from real systems, not stronger proofs about evidence we have not
gathered.
