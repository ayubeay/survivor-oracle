# Transfer control: evidence vs execution - 2026-08-03

## The result that mattered
A 2.69% transfer fee moves the evidence score by 3 points. The same fee costs a $50,000
trade $1,345. Both numbers describe the same on-chain fact; only one is useful to whoever
is about to sign.

That is not a weighting failure. It is a category distinction:
    SURVIVOR evidence   what powers exist over this asset, and how concentrated are they
    Gate execution      what those powers cost or prevent for THIS transaction

A transfer fee is a price, not a probability. It belongs beside slippage and route fees,
computed against the actual notional, not folded into an aggregate risk band.

## Shipped, both observational
transfer-control-v0.5.3-shadow (oracle)
  candidate replacement for the freezeAuthority boolean at its existing 10 weight
  UNCONTROLLED 100 | multisig 45+25*(m/n) | program-derived 60 | wallet 35
  permanent delegate -15 | active fee scales by bps | hook or frozen default 20
  non-transferable 0 | unresolved null, never zero
  curated scores return NOT_APPLICABLE rather than undefined

execution-constraints-v0.5.3-shadow (gate)
  computes cost and suggests a decision from active constraints
  fee < 100bps disclose | 100-300 THROTTLE | >300 READ_ONLY
  active hook THROTTLE until the hook program is classified
  default-frozen READ_ONLY | non-transferable DENY
  permanent delegate and freeze authority disclosed, never auto-denied

## Population effect of the transfer-control shadow (23 tokens)
18 UNCONTROLLED, delta 0 - correct, they have no freeze authority either way
PYUSD, USDG: live 0 -> shadow 20, delta +2. Single wallet holds freeze AND permanent
  delegate. The old boolean was harsher; neither is generous.
BERN: live 100 -> shadow 65, delta -3. The only token whose transfer is actively taxed.
USDC, USDT: NOT_APPLICABLE, curated scores are assigned rather than computed.

Only 5 of 23 tokens move, by at most 3 points. The signal is more truthful than the
boolean it would replace and remains low-impact at 10 weight. Its weight should not rise
until the 35 points of nominal doctrine tied to LP and dev activity are resolved -
raising it would reopen the redistribution problem already rejected four times.

## Doctrine
- disclosure does not earn credit. A documented freeze authority is still a freeze
  authority; the subscore reflects concentration of control, not how well it is explained.
- fees are mutable. The reported value is the active configuration observed at receipt
  time, not a guarantee. mutable: true is carried in every disclosure.
- an unreadable capability is UNKNOWN, never unrestricted.

## Open
Absolute cost matters as well as rate. 2.69% is the same rate at every notional but a
different operational consequence: a strategy expecting 2% is already negative, one
expecting 20% may still be admissible. A future gate may need fee_as_percent_of_expected
_return alongside basis points and absolute cost.
