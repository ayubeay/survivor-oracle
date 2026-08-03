# Signal definition: mint authority

**Status:** IMPLEMENTED as Layer 1 in scoring 0.4.4 (2026-08-01). Layer 2 governance enrichment still reserved.
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

## Refinement (2026-07-31): PROGRAM_CONTROLLED is not one state
A PDA is safer than an unconstrained wallet only under conditions the current taxonomy does
not capture. An upgradeable program can rewrite its own minting rules, so the risk has moved
one layer down rather than disappearing. Proposed subdivision:

    PROGRAM_CONTROLLED_IMMUTABLE    upgrade authority revoked; minting rules cannot change
    PROGRAM_CONTROLLED_GOVERNED     upgrade authority is a multisig or governance program
    PROGRAM_CONTROLLED_UPGRADEABLE  a single upgrade authority can change minting behaviour
    PROGRAM_CONTROLLED_UNKNOWN      upgrade authority not resolved

Classification should be reported regardless; scoring credit should depend on which of these
applies. Treating all PDAs as equally safe would repeat the pattern this document exists to
correct - a label standing in for a measurement.

Resolvable with one lookup: the ProgramData account is derived from the program ID under
BPFLoaderUpgradeab1e11111111111111111111111; a null upgrade authority means immutable.

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


## Implemented: Layer 1 authority doctrine v1 (scoring 0.4.4)

Credit reflects only what the mint address proves. No credit for assumed program behaviour,
custody arrangements, or institutional identity.

| state | subscore | basis |
|---|---|---|
| REVOKED | 100 | no mint authority exists |
| PROGRAM_DERIVED | 60 | off-curve, so no keypair can sign; controlling program unknown |
| MULTISIG | min(75, 35 + 25*(m/n) + 5*min(m,4)) | threshold known; signer identity and custody unknown |
| WALLET | 0 | a single on-curve system account can mint |
| ON_CURVE_OTHER / UNRESOLVED | null | excluded from scoring - unknown is not unsafe |

The 75 multisig cap exists because Layer 1 cannot establish whether signers are independent,
who custodies the keys, whether the signer set can be changed, or whether off-chain issuance
controls exist. A multisig should never equal a revoked authority on structure alone.

### Why the four-way PROGRAM_CONTROLLED split was not implemented
It is not resolvable from a mint address. An off-curve authority PDA carries no pointer to
the program that derives it - mSOL's authority account does not exist on chain, and
jitoSOL's and bSOL's are System-owned with no data. Derivation only runs forward. Verifying
the controlling program requires a candidate program ID, which means a maintained registry.
That belongs to Layer 2, clearly marked as enrichment rather than derivation.

### Measured effect
mSOL 47 -> 59, jitoSOL 50 -> 62. BONK unchanged at 67 (already REVOKED). USDC and USDT
unchanged (megacap assigns their score) but now report 2-of-4 and 2-of-3 respectively.
The megacap fast path was changed to classify authority before returning: it may skip
costly market analysis, but not cheap decision-relevant facts.

These assets did not become safer. The scorer stopped treating a program-derived authority
as equivalent to an anonymous keypair.


## Bug found and fixed 2026-08-03 (0.5.2)
Token-2022 multisig authorities were classified ON_CURVE_OTHER and therefore excluded from
scoring entirely. The multisig branch checked only for the classic Token Program as account
owner; a multisig owned by TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb fell through.

Effect: every Token-2022 token with a multisig mint authority silently lost its 20-weight
mint-authority signal. PYUSD scored 31 with 45% coverage; it now scores 40 with 65%.
Also fixed: mintAuthorityRaw was computed in getTokenMintInfo but never propagated to
fetchTokenData output.

Verified against raw account bytes rather than the decoder alone: data[0]=1, data[1]=4
matches the reported 1-of-4.

Shipped in 0.4.4, invisible for three days because the entire test sample was classic SPL.
It surfaced only when the transfer-control probe introduced Token-2022 tokens.

### Doctrine question raised
PYUSD is 1-of-4: any single one of four signers can mint unilaterally. The formula scores
it 46 (35 + 25*(1/4) + 5*1), correctly placing it between a wallet and a real quorum. But
the formula was written before a 1-of-n was observed in the wild, and a 46-point gap
between 1-of-4 and a single wallet may overstate the practical difference. Worth revisiting
once more thresholds are observed.
