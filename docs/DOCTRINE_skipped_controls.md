# Doctrine: a skipped control looks like a passed control

Three instances in one week, each nearly shipping.

## The instances

**The quota cascade.** /health returned 200 while the RPC quota was exhausted. The check
proved the process was alive, not that its dependency worked. Nothing surfaced the failure
until on-demand scoring broke downstream.

**The mandate at the firewall.** verifyAuthorization checked mandates correctly and rejected
revoked ones - verified by calling it directly. But checkToolCall and guardedCall took four
parameters, so the mandate passed as a fifth was silently discarded. Revocation worked in
tests and would have done nothing in production.

**The instrument-type reconciliation.** A mandate granting 50x perpetual swaps was accepted
against an equities-only broker, because that connector declared no instrument block and the
check skipped rather than refused.

## The shape

    a control that did not run
    is indistinguishable from
    a control that ran and passed

Both produce silence. Both look like success. The difference only appears when something
downstream fails, or when someone tests the path rather than the component.

## What follows

**Test the path, not only the component.** A function that behaves correctly when handed the
right arguments proves nothing about whether the path hands them over. The assertion that
matters is usually a side effect - transport invocation count, records written, an order
that does or does not exist - not a return value.

**Absence of input is a reason to refuse, not to skip.** A connector declaring no instrument
types cannot be reconciled against; that is a refusal. A missing mandate is a denial, not a
default. An unmeasured signal is UNRESOLVED, not favourable.

**Health checks should exercise the dependency.** A 200 that only proves the process is
running is a claim about the wrong thing.

**Never catch and discard without recording what was caught.** The equity collector wrote
zero book records for three runs while the venue was returning a plain-text message saying
exactly what was wrong.

## Why this keeps happening here

This stack is mostly controls. A governance layer is a large collection of things that
refuse, and a refusal that never fires produces the same observable output as one that fires
and permits. That makes the failure mode structurally likely rather than accidental, and
worth defending against by habit rather than vigilance.
