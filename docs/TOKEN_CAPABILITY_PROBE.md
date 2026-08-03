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


## Wider sweep (8 tokens) - the signal is transfer control, not Token-2022

| token | program | bytes | controls |
|---|---|---|---|
| PYUSD | T22 | 866 | permanentDelegate, freezeAuthority, fee 0% latent, hook latent |
| USDG | T22 | 866 | identical set, SAME KEY as PYUSD |
| BERN | T22 | 278 | transfer fee 2.69% ACTIVE (was 4.2% at epoch 624) |
| EURC | SPL | 82 | freezeAuthority only |
| USDS | SPL | 82 | freezeAuthority only |
| FDUSD | SPL | 82 | freezeAuthority only |
| CHILLGUY | SPL | 82 | none |
| GOAT | SPL | 82 | none |

Not observed in this sample: defaultAccountState, nonTransferable, pausable,
interestBearingConfig. The taxonomy should be built from what appears, not from the spec.

### One key controls two stablecoins
2apBGMsS6ti9RyF5TwQTDswXBWskiJP2LD4cUEDqYJjk is simultaneously the permanent delegate AND
freeze authority for both PYUSD and USDG. Verified with full addresses, not truncated
prefixes. Paxos issues both; this is their control model, not a defect. But a holder of
either token is subject to unilateral transfer and freeze by that single key.

### Design consequence
The right signal is not "Token-2022 capabilities". It is transfer control: who can stop me
selling, and how. Freeze authority is the most common answer and lives on classic SPL,
where no extension is involved. Three of five classic-SPL tokens in this sample carry one.

Proposed scope, spanning both programs:
    freeze authority        both        who holds it, and is it a wallet, PDA, or multisig
    permanent delegate      T22         who holds it
    transfer fee            T22         current bps, authority, and whether active or latent
    transfer hook           T22         active with programId, or latent with authority
    default account state   T22         frozen would block transfers by default
    non-transferable        T22         absolute
    close authority         T22         who can close the mint

### Related
The existing freezeAuthority signal is a 10-weight boolean with no classification of the
holder. The same treatment mint authority received in 0.4.4 applies here.
