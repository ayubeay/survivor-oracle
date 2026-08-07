# RESERVE - Historical State Intelligence (Temporal Receipts)

**Status:** RESERVED
**Urgency:** MEDIUM-HIGH. The highest-value SURVIVOR reserve and the one with the clearest
path from current work. Not blocking, but the architectural rule below should be applied
now rather than retrofitted.

## Purpose
Move from evaluating the current state of a token to explaining how that state came to be.

    now:     what is true?
    future:  how did it become true?

## Philosophy
Historical chain data is infrastructure - anyone can buy archive RPC. The value is
producing governed receipts that explain structural change, separate signal from noise and
support reproducible reasoning. History without a receipt explaining why an observation
matters is just a data dump.

## Receipt types
**Holder** - concentration over time, largest controllable owner over time, largest
program-derived owner over time, decentralisation trend, accumulation and distribution.

**Authority** - mint, freeze, transfer-hook, metadata and governance authority changes.

**Liquidity** - LP creation, burns, migrations, concentration changes, protocol custody
evolution.

**Governance** - treasury movement, DAO upgrades, multisig changes, migrations.

**Execution** - structural events rather than isolated values:

    mint authority        wallet -> multisig -> revoked
    largest controllable  41% -> 23% -> 11% -> 4%
    program custody        8% -> 31% -> 74%
    LP                    created -> burned -> migrated

Every transition carries evidence, slot, timestamp and confidence.

## Questions it should answer
What did this wallet control last month? What did supply look like before the exploit?
When did decentralisation actually happen? When did protocol custody increase? Was
liquidity added before appreciation? Did ownership become safer, or merely move into
protocol custody?

That last one matters most - it is the temporal form of the distinction the holder-control
work established between keypair-signable and program-held balances.

## Reuse
Holder classification (controllable / attributed program / unattributed off-curve /
unresolved), the existing authority classifiers, the receipt framework, VERITY for
evidence, and Gate optionally referencing history when evaluating execution risk.

## Architectural rule to apply NOW
Every classifier added to SURVIVOR - holder class, authority class, transfer control,
governance state - should be designed to answer three questions, not one:

    what is true now?
    what was true at slot X?
    what changed between slot A and slot B?

Classifiers written point-in-time only will need rewriting. Ones that take a slot
parameter and read state at that slot will not. This costs almost nothing today and saves
a refactor of every classifier later.

## Providers
Archive access is interchangeable infrastructure - Alchemy, Helius, Triton, native archive
services. No provider-specific assumption belongs in doctrine.

## Sequencing
Do not interrupt the holder-control research. This layer consumes its outputs once the
classification doctrine is stable. Incremental overlap is fine where it reuses the existing
pipeline; scope expansion is not.
