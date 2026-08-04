# Holder structure research - 2026-08-04

## Owner deduplication: real but rare
getTokenLargestAccounts returns accounts, not owners. One owner splitting across several
accounts is counted as several holders.

Across 14 tokens, only RAY collapses: 10 accounts -> 6 owners, with one owner holding
64.2% of the sampled top-10 across three separate token accounts. Every other token is
10-for-10.

So deduplication is a correctness fix worth making, but not a systematic miscount.

## The stronger finding: largest-owner share discriminates where top-10 does not
| token | top-10 % of supply | largest owner % of supply |
|---|---|---|
| PYUSD | 83.07 | 56.7 |
| TNSR | 75.91 | 20.0 |
| RAY | 76.66 | 49.2 |
| MEW | 75.35 | 37.6 |
| BOME | 70.36 | 26.1 |
| ORCA | 60.32 | 18.9 |
| DRIFT | 54.61 | 24.5 |
| PYTH | 48.71 | 12.7 |
| JTO | 47.36 | 21.2 |
| WIF | 44.23 | 13.7 |
| POPCAT | 41.76 | 11.2 |
| BONK | 37.79 | 7.7 |
| mSOL | 35.77 | 12.0 |
| jitoSOL | 32.45 | 9.0 |

TNSR and RAY have near-identical top-10 concentration (75.91 vs 76.66) and completely
different ownership structures: RAY's largest owner holds 49.2% of supply, TNSR's holds
20.0%. The current signal cannot tell them apart.

"One entity holds 49% of this token" is a more decision-relevant statement than "the top
ten accounts hold 77%", and it is derivable at Layer 1 with no registry.

## Account class mix also separates, but the classifier needs work
Wallet vs off-curve share across four tokens:
    BONK  91.0% wallet   RAY 88.4%   PYUSD 74.5%   mSOL 23.4%
mSOL is the inverse of the others - most of its concentration sits in off-curve addresses,
consistent with stake pool vaults rather than individual holders.

Caveat: the first classifier tested curve position before account existence, so addresses
with no account were labelled PROGRAM_DERIVED. Only two accounts in the sample have a real
program owner (a stake program on BONK, and 5ocnV1qiCg.. on mSOL). Fixed, but the class
distribution above should be re-measured before it is trusted.

## Sampling limit, stated plainly
getTokenLargestAccounts returns the top 20 accounts. Everything here describes the top 10
of those. An owner holding a 21st account is invisible. The honest label is "largest owner
among the top 10 accounts", not "largest holder".

## Candidate next signal
largest_owner_percent_of_supply, reported alongside the existing top-10 figure. Reporting
first, no weight, then test population separation as usual.
