# Token capability probe - raw findings

**Date:** 2026-08-02 · **Status:** OBSERVATION. No classification, no scoring, no production change.

## Feasibility: confirmed
getParsedAccountInfo decodes Token-2022 extensions natively with named types and structured
state. No manual TLV parsing required.

Cheap pre-filter: mint account data length. 82 bytes = classic SPL, no extensions possible.
Anything larger = Token-2022 with extensions present.

| token | program | mint bytes | extensions |
|---|---|---|---|
| BONK | CLASSIC_SPL | 82 | none possible |
| USDC | CLASSIC_SPL | 82 | none possible |
| mSOL | CLASSIC_SPL | 82 | none possible |
| ORE | CLASSIC_SPL | 82 | none possible |
| BERN | TOKEN_2022 | 278 | 1 |
| PYUSD | TOKEN_2022 | 866 | 8 |

## PYUSD: eight extensions, one controlling key
mintCloseAuthority, permanentDelegate, transferFeeConfig, confidentialTransferMint,
confidentialTransferFeeConfig, transferHook, metadataPointer, tokenMetadata

Every authority field resolves to the same address: 2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk
- permanentDelegate.delegate - can transfer any holder's balance without consent
- freezeAuthority - can freeze any account
- mintCloseAuthority - can close the mint
- transferFeeConfigAuthority - can set the fee
- transferHook.authority - can install a hook later
- metadataPointer.authority and tokenMetadata.updateAuthority

This is a regulated-issuer control model, not evidence of malice. But a holder acquiring
PYUSD is subject to unilateral transfer and freeze by a single key, and nothing in SURVIVOR
currently says so.

## BERN: a live transfer fee
transferFeeBasisPoints 269 (2.69%), reduced from 420 (4.2%) at epoch 624. maximumFee
3906250000000000000. Authority 7MyTjmRygJoCuDBUtAuSugiYZFULD2SWaoUTmtjtRDzD, withheld
27,661,090,930 base units.

A seller loses 2.69% to the fee authority on every transfer. This is a currently-active
economic constraint invisible to the present model.

## Two distinctions the taxonomy must hold
1. PRESENT vs ACTIVE. PYUSD's transferHook has programId: null - the extension exists and an
   authority can enable a hook later without adding a new extension. A latent capability is
   not the same as an active one, and must not be reported as either "absent" or "in use".

2. CAPABILITY vs ABUSE. A permanent delegate is a power requiring disclosure, not proof of
   intent. The signal should report powers and who holds them, and leave interpretation to
   the caller and to policy.

Also: BERN's older vs newer transfer fee shows fees are mutable by epoch. Any fee reported
is the current one, not a guarantee.

## Next
Probe a wider Token-2022 population to find defaultAccountState, nonTransferable, and
interestBearingConfig in the wild, then define states from what actually appears rather
than from the extension list in the spec.
