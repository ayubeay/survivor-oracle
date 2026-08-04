# Holder structure: four variants, and why none shipped - 2026-08-04

## The question
Top-10 concentration saturates: the legacy curve gives 20 to anything above 70%, producing
4 distinct subscores across 15 tokens. RAY and TNSR both report ~76% and score identically,
but RAY's largest owner holds 49% of supply against TNSR's 20%.

## Variant A - min(top10_subscore, largest_owner_subscore)
Safe but non-discriminating. The legacy score is nearly always the lower of the two, so
min() returned it and the owner signal never spoke. 7 distinct subscores. Deltas of 0, 0,
-1, -1 on the four test tokens. Did not separate RAY from TNSR.

## Variant B - largest owner primary, minus a collective-concentration penalty
13 distinct subscores across 15 tokens, and it did separate RAY (5) from TNSR (45).

Failed the incremental-information test. Three penalty scales - [0,5,10,15,20],
[0,4,8,12,16], [0,3,7,10,15] - produced rankings differing in 2 of 15 positions, both
adjacent swaps at the top. The owner-only ranking matched all three within one position.
The penalty was complexity without information.

## Variant C - largest owner alone
Ranks well. But 14 of 16 tokens moved upward, mean delta about +2, and two gates loosened
CHALLENGE -> ALLOW. More importantly it could not be interpreted at all - see below.

## What actually blocked promotion: the percentage is uninterpretable alone
Classifying the largest owner's address changed the reading entirely:

| token | share of sample | owner | status |
|---|---|---|---|
| SLERF | 92.0% | 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1 | Raydium AMM v4 pool authority, PROVEN by derivation |
| RAY | 64.2% | 8pFhUqCU7Fkxfg.. | wallet, economically controllable |
| PYUSD | 67.4% | 5gUuDFHswKi2QM.. | wallet, economically controllable |
| BOME | 37.0% | 9WzDXwBbmkg8ZT.. | wallet, economically controllable |
| JUP | 37.1% | EXJHiMkj6NRFDf.. | off-curve, controlling program unresolved |

SLERF's owner was proven, not guessed: findProgramAddressSync([Buffer.from("amm authority")],
675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8) reproduces the address exactly. It is the
Raydium AMM v4 pool authority holding pool balances - liquidity, not a whale.

So "one owner holds 92%" and "one owner holds 64%" describe opposite realities. Scoring the
percentage alone would repeat the burned-LP error: a correct number under a misleading name.

## Two classifier bugs found along the way
Both were the same mistake: testing curve position before account existence, so an off-curve
address with no account was labelled PROGRAM_DERIVED when nothing proved a program controls
it. Fixed twice - once in the holder-structure probe, once in the extreme-owner inspector.

## The signal worth building
Not largest_owner_percent. Largest ECONOMICALLY CONTROLLABLE owner, with program-derived
and unresolved balances reported separately:

    largest_economically_controllable_owner_percent   scoreable
    largest_program_derived_owner_percent             reported, scored only when the
                                                      controlling program is identified
    unresolved_owner_percent                          neither safe nor dangerous

Owner classes: WALLET, WALLET_NO_ACCOUNT, MULTISIG, PDA_PROGRAM_OWNED, PDA_SYSTEM_OWNED,
PROGRAM_OWNED, BURN_OR_IRRECOVERABLE, UNRESOLVED.

## Doctrine
A balance percentage says nothing about control until the holder's class is established.
And "unresolved by our derivation attempts" is not "unresolvable" - JUP's owner did not
match four candidate program-and-seed combinations, which is a limit of the attempt, not a
property of the address.
