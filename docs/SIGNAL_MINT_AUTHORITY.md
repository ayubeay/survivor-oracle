# Signal definition: mint authority

**Status:** DESIGN - implementation deferred until semantics are agreed
**Drafted:** 2026-07-29
**Trigger:** mSOL scored 47/VERY_HIGH. MINT_AUTHORITY_PRESENT (weight 20) scored 0 because
the mint authority is not revoked - but mSOL's authority is a Marinade stake pool PDA that
mints against deposited SOL. The signal was designed for pump.fun-style tokens and is being
applied outside that domain.

## What this signal is intended to measure
Proposed: the risk that token supply can be expanded at the discretion of a single actor
without constraint or accountability.

Not: whether minting is possible at all. Many legitimate asset classes mint continuously
by design.

## Observed control models (verified 2026-07-29)
| token | authority | on-curve | account owner | control model |
|---|---|---|---|---|
| BONK, JUP, WIF | null | - | - | REVOKED |
| mSOL | 3JLPCS1qM2.. | false | account does not exist | PDA |
| jitoSOL | 6iQKfEyhr3.. | false | System Program | PDA |
| bSOL | 6WecYymEAR.. | false | System Program | PDA |
| USDC | BJE5MMbqXj.. | true | Token Program | multisig |

The discriminator is PublicKey.isOnCurve, not account ownership: mSOL's authority account
does not exist at all, while jitoSOL's and bSOL's are System-owned. Off-curve addresses are
program-derived by construction.

## Proposed classification
1. REVOKED - supply is fixed. No mint risk.
2. PROGRAM_CONTROLLED - authority is a PDA. Minting is constrained by program logic, not
   discretion. Residual risk lives in program upgrade authority, which is a separate signal
   this oracle does not currently measure.
3. INSTITUTIONAL_CONTROLLED - on-curve authority owned by the Token Program, i.e. a
   multisig. Discretionary minting is possible but requires multiple signers.
4. WALLET_CONTROLLED - on-curve authority owned by the System Program. A single signer can
   mint arbitrarily. This is the case the original heuristic was written for.

## Open questions before implementing
1. Should PROGRAM_CONTROLLED score as REVOKED, partially, or be excluded from scoring?
   Excluding is most honest but requires the renormalization deferred from 0.5.0.
2. Program upgrade authority is the real residual risk for PDAs. An upgradeable program can
   change its minting rules. Should that become its own signal before PROGRAM_CONTROLLED is
   credited at all?
3. INSTITUTIONAL_CONTROLLED carries counterparty and regulatory risk rather than rug risk.
   Is that in scope for this oracle, or a different signal entirely?
4. Does a multisig's threshold matter (2-of-3 vs 7-of-11)? Retrievable from the Token
   Program multisig account if so.

## What the receipt should say regardless of scoring
    "mint_authority": {
      "state": "PROGRAM_CONTROLLED",
      "authority": "3JLPCS1qM2...",
      "control_model": "pda",
      "measurement": "mint_authority_curve_and_owner",
      "limitations": ["program upgrade authority not evaluated"]
    }

That explains the observation without asserting a risk judgment, consistent with how
holder_concentration and liquidity now report.

## Scope note
This is a taxonomy problem, not a calculation error. The arithmetic was correct; one
heuristic is being applied across asset classes with different trust models. Any fix is a
scoring-methodology change requiring a version bump and validation across LSTs, wrapped
assets, stablecoins and memecoins.
