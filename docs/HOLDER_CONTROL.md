# Holder control - the scoreable quantity - 2026-08-04

## Result
Largest owner percentage is uninterpretable without classifying whether that owner can
sign. Across 16 tokens, 6 diverge by more than 10 points between raw largest owner and
largest keypair-controllable owner.

| token | raw largest % of supply | keypair-controllable % of supply | largest owner class |
|---|---|---|---|
| SLERF | 87.93 | 2.14 | OFF_CURVE_UNATTRIBUTED |
| mSOL | 12.10 | 3.16 | OFF_CURVE_UNATTRIBUTED |
| RAY | 49.19 | 49.19 | WALLET |
| PYUSD | 57.06 | 57.06 | WALLET |
| BONK | 7.68 | 7.68 | WALLET |

The divergent set is protocol and infrastructure tokens - ORCA, PYTH, JTO, mSOL, JUP -
where supply sits in staking programs and vaults, plus SLERF where it sits in a Raydium
pool. The non-divergent set is memecoins whose large holders really are wallets.

SLERF reads as "one holder controls 88% of supply" under the old metric and "no signer
holds more than 2.14%" under the new one. Same data, opposite conclusion.

## Classes
    WALLET, WALLET_NO_ACCOUNT, TOKEN_PROGRAM_OWNED    keypair or multisig signable
    PDA_PROGRAM_OWNED, PROGRAM_OWNED                  attributed to a program
    OFF_CURVE_UNATTRIBUTED                            no keypair can sign; which program
                                                      derived it is NOT established
    UNRESOLVED                                        owner not resolved

OFF_CURVE_UNATTRIBUTED is deliberately named for what it proves. Only SLERF's dominant
owner has been attributed, by derivation: findProgramAddressSync([Buffer.from("amm
authority")], 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8) reproduces it exactly, so it
is the Raydium AMM v4 pool authority. The rest are unattributed - they could be staking
vaults, bridge escrows, or anything else.

## Denominators
share_of_sample is relative to the sampled top-10 accounts. percent_of_supply multiplies
by the top-10 share of total supply. Scoring must use the supply figure: RAY's largest
owner is 64.17% of the sample but 49.19% of supply. Reporting the sample number as a
supply number would repeat the denominator error corrected in 0.4.3.

Buckets reconcile: SLERF 7.73 + 0.31 + 91.95 = 99.99; mSOL 23.32 + 3.15 + 73.51 = 99.98.

## Limitation that must stay attached
Structural signing capability only. A wallet may be an exchange, a custodian, or an
individual - Layer 1 cannot distinguish them. "Keypair-controllable" means an address that
can sign, not a person who owns the tokens.

## Status
Reporting only. No weight. The scoreable candidate is
largest_keypair_controllable_percent_of_supply, and it needs a population migration run
against the live holder subscore before any promotion.


## Variant D measured and rejected - 2026-08-04

Largest keypair-controllable share (% of supply) replacing the top-10 subscore in the same
15-point slot, using a continuous curve.

Result across 16 tokens: 14 rose, 2 fell, 4 band crossings, 4 gate crossings - all
loosening. BOME, JUP, mSOL and SLERF all migrated CHALLENGE to ALLOW.

SLERF is the decisive case. Largest keypair-controllable owner 2.14% of supply, subscore
100, score 59 to 73, gate CHALLENGE to ALLOW. A token that collapsed in 2024 receives a
perfect concentration score and permission to execute, because its supply sits in program
accounts rather than a signer's wallet.

The measurement is correct. The inference was wrong.

## Doctrine: concentration evidence is asymmetric
A large controllable owner is evidence of risk.
No large controllable owner is only the absence of that risk - not evidence of safety.

Supply held in unattributed off-curve accounts could be healthy vaults, abandoned
liquidity, bridge custody, or program treasuries. Treating it as favourable would award
positive credit for the absence of one specific hazard.

## Adopted form: adverse-only penalty (shadow)
    largest keypair-controllable % of supply    penalty
    <= 20%                                      0
    20-35%                                      2
    35-50%                                      5
    50-70%                                      9
    > 70%                                       13

Subtracts from the total score, never adds, never loosens a gate.

Measured: SLERF 59 unchanged (2.14%), BONK 67 unchanged (7.68%), MEW 61 to 56 (36.98%),
RAY 61 to 56 (49.19%), PYUSD 42 to 33 (57.49%).

Status: shadow, enforced false. Needs a full population run before promotion.

## Known limitation carried forward
PYUSD's 57% is issuer custody, and Layer 1 cannot distinguish an issuer treasury from an
individual whale. The penalty is correct on its own terms and the interpretation gap is
real. That belongs to Layer 2 enrichment, not to a special case in the penalty.
