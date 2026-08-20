# Doctrine: representational completeness of authority

A governance system must account for authority it does not understand, not only for
authority it does. Authority present in a credential does not leave the security model
because no internal operation class happens to describe it.

    known + mapped     govern normally
    known + unmapped   surface explicitly as unaccounted authority
    unknown            remain unknown, fail closed

    never:
    unmapped           implicitly irrelevant

## The instance this came from

Crypto.com's Agent Key exposes nine permissions. The capability firewall reasons in
operation classes, and the connector declares what three of those classes require:
MUTATE_ORDER needs `Execute trades`, OBSERVE_ACCOUNT needs `View balance & transactions`,
OBSERVE_MARKET needs `View market data & insights`. Six permissions - the cash deposit,
cash withdrawal, bank account and limits ones, including `Make cash withdrawals` - map to
no class at all.

So a credential granted all nine produced this:

    granted            9 permissions, including Make cash withdrawals
    permitted_classes  MUTATE_ORDER, OBSERVE_ACCOUNT, OBSERVE_MARKET

and a credential granted two produced this:

    granted            2 permissions, withdrawals excluded
    permitted_classes  MUTATE_ORDER, OBSERVE_ACCOUNT

The class lists were the same three, plus market data. Every downstream control asks about
classes. `Make cash withdrawals` sat inside `granted[]` and appeared in no other field of
the object, on no receipt, and in no check. The authority was in the credential and absent
from the representation of it.

## Why this is not the skipped-control doctrine

`DOCTRINE_skipped_controls.md` records a control that exists and does not run, and observes
that its silence is indistinguishable from a control that ran and passed. This is one step
further out and worse in a specific way:

    skipped control        the control exists; it did not fire
    unaccounted authority  there is no control, and nothing indicates one is missing

A skipped control leaves a gap someone can find by testing the path. Unaccounted authority
leaves a representation that looks COMPLETE. The grant object had a granted list, an
excluded list, a permitted-class list and a hash. Nothing about it suggested a question had
gone unasked. That is the failure mode this doctrine defends against, and it cannot be found
by testing the path, because the path is behaving exactly as designed.

## The three states must stay distinct

    MAPPED GOVERNED AUTHORITY
      a class exists, the connector declares what it requires, the check runs.

    KNOWN UNMAPPED AUTHORITY
      the permission is observed and named, and no class describes it. It is not governed
      and must not be silently dropped. It is surfaced, and granting it requires an explicit
      acknowledgement.

    GENUINELY UNKNOWN AUTHORITY
      what a permission actually authorises is not established - Crypto.com's
      `Execute trades` covers products nobody has enumerated. This stays UNKNOWN and fails
      closed. It is NOT unmapped authority: unmapped means we know what it is called and
      have no class for it, unknown means we do not know what it does.

Collapsing any pair loses something. Treating unmapped as unknown overstates our ignorance
and would refuse workable credentials. Treating unknown as unmapped understates it and would
let a label stand in for a semantic. Treating either as governed is the original bug.

## Implemented, not aspirational

Commit `0c88339` implements the mechanism. Do not rebuild it.

    src/finance/credential-grant.js
      unmappedPermissions()                 permissions no class requires
      declareCredentialGrant()              refuses them without
                                            acknowledge_unaccounted_authority: true
      grant.unmapped_granted                the list, carried on the grant
      grant.carries_unaccounted_authority   the flag

    src/finance/capability-firewall.js
      credential_carries_unaccounted_authority   propagated to the allow receipt
      credential_unaccounted_permissions         named there too

    src/finance/credential-grant.test.js
      the load-bearing assertion: the acknowledged nine-permission grant and the narrow
      two-permission key agree on every permitted class and differ only on the flag. The
      class list alone could never have told them apart.

Granting unaccounted authority is not forbidden - a venue may force it, or an operator may
want it. Doing it quietly is what is forbidden.

## Where it generalises

Any place this stack maps an external vocabulary onto an internal one. Tool names onto
capability classes, venue permissions onto operation classes, connector fields onto mandate
dimensions. Every such mapping is partial, and the residue is the dangerous part, because a
mapping reports what it matched and says nothing about what it did not.

The habit that follows: when writing a mapping, compute the residue and put it on the
object. An empty residue is the answer you want, and it should be visible rather than
assumed.
