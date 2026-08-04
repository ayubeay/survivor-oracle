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
