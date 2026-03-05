# VYRE Artifact Specification
## v0.1 — Deterministic Evidence Format for Agent Execution

---

## What VYRE Is

VYRE is a signed, portable artifact bundle that packages every decision made
by the Agent OS stack into a single verifiable file.

One execution attempt → one `.vyre` file.
One `.vyre` file → complete, auditable proof.

---

## Canonical Manifest Structure

Every `.vyre` artifact contains a `manifest.json` at root:

```json
{
  "vyre_version": "0.1",
  "artifact_id": "vyre_<16-char-hex>",
  "created_at": "<ISO 8601 UTC>",
  "schema": "execution_decision",

  "components": {
    "gate":   "gate_decision.json",
    "oracle": "oracle_attestation.json",
    "verity": "verity_ais.json",
    "iam":    "iam_actor.json"
  },

  "manifest_hash": "<SHA-256 of sorted component file contents>",
  "signature": "<Ed25519 signature over manifest_hash>",
  "signer":    "<public key hex>"
}
```

`components` lists only the files present in this artifact.
Not all artifacts include all components — a token scan with no agent lookup
omits `verity` and `iam`.

---

## Component Schemas

### gate_decision.json
Derived directly from `POST /gate` response.

```json
{
  "component": "gate_decision",
  "version":   "1.0",
  "mode":      "FORWARD | SIMULATE | BLOCK",
  "decision":  "ALLOW | THROTTLE | READ_ONLY | DENY",
  "constrained": false,
  "intent": {
    "chain":        "solana",
    "from_asset":   "SOL",
    "to_asset":     "<mint>",
    "notional_usd": 500,
    "slippage_bps": 50,
    "kind":         "swap"
  },
  "policy": {
    "constraints": {
      "max_notional_usd": 5000,
      "max_slippage_bps": 100,
      "cooldown_seconds": 0
    },
    "confidence": 0.9,
    "reasons": [
      { "code": "MEGACAP_TOKEN", "severity": "low" }
    ],
    "expires_at": 1772683758
  },
  "evaluated_at": "2026-03-05T04:04:18.757Z"
}
```

### oracle_attestation.json
Derived from `/attest` or `/score/:mint` response.

```json
{
  "component": "oracle_attestation",
  "version":   "0.4",
  "mint":      "<token address>",
  "name":      "Wrapped SOL",
  "symbol":    "SOL",
  "score":     88,
  "risk_tier": "LOW",
  "safe":      true,
  "reasons":   [],
  "signature": "<Ed25519 hex>",
  "signed_at": "2026-03-05T04:04:18.500Z"
}
```

### verity_ais.json
Derived directly from `ais_scores.jsonl` record.

```json
{
  "component":        "verity_ais",
  "version":          "1.0",
  "wallet":           "0xef7df433...",
  "ais":              78,
  "tier":             0,
  "tier_label":       "TRUSTED",
  "confidence":       0.9936,
  "win_rate":         0.8119,
  "resolved_debates": 101,
  "flag_reasons":     [],
  "scored_at":        "2026-03-05T03:00:00.000Z"
}
```

### iam_actor.json
Emitted by IAM engine (v0 — identity binding layer).

```json
{
  "component":       "iam_actor",
  "version":         "0.1",
  "identity_id":     "<stable cluster ID>",
  "primary_wallet":  "0xef7df433...",
  "linked_wallets":  [],
  "drift_detected":  false,
  "attributed_at":   "2026-03-05T04:04:18.000Z"
}
```

---

## Artifact File Layout

```
artifact_id.vyre/          (directory or zip)
  manifest.json            ← always present, always first
  gate_decision.json       ← present when Gate was queried
  oracle_attestation.json  ← present when Oracle was queried
  verity_ais.json          ← present when VERITY was queried
  iam_actor.json           ← present when IAM was queried
```

A `.vyre` file is a zip archive of this directory.
Unpacked, it is a flat folder of JSON files + manifest.

---

## Manifest Hash Computation

```
1. For each component file listed in manifest.components:
   - read raw bytes
   - compute SHA-256
   - store as { filename: hex_digest }

2. Sort entries by filename (lexicographic)

3. Serialize as compact JSON (no spaces):
   {"gate_decision.json":"<hash>","oracle_attestation.json":"<hash>",...}

4. SHA-256 the serialized string → manifest_hash
```

This makes the manifest hash deterministic and tamper-evident.
Any change to any component file changes the manifest hash.

---

## Signature

```
sign(manifest_hash, ed25519_private_key) → signature_hex
```

Verification:
```
verify(manifest_hash, signature_hex, signer_public_key) → true | false
```

Signer is the SURVIVOR oracle key already used for `/attest` signatures.
No new key infrastructure required.

---

## CLI Grammar (v0.1)

```bash
vyre pack   <folder>           -o <artifact_id>.vyre
vyre unpack <artifact_id>.vyre [-o <folder>]
vyre verify <artifact_id>.vyre
vyre show   <artifact_id>.vyre [--component gate|oracle|verity|iam]
```

`vyre verify` exits 0 on valid, 1 on tampered, 2 on missing signature.

---

## Artifact ID Format

```
vyre_<8-char-timestamp-hex><8-char-random-hex>
```

Example: `vyre_65f8a1c00a3f92d1`

Timestamp hex = `Math.floor(Date.now()/1000).toString(16)`
Random hex = `crypto.randomBytes(4).toString('hex')`

---

## Integration Points

| System | Emits | Component |
|---|---|---|
| SURVIVOR Gate | `POST /gate` response | `gate_decision.json` |
| SURVIVOR Oracle | `/attest` response | `oracle_attestation.json` |
| VERITY | AIS score record | `verity_ais.json` |
| IAM | Actor attribution | `iam_actor.json` |
| SURVIVOR Escrow | Settlement state | `escrow_state.json` (v0.2) |

---

## What VYRE Is Not

- Not a guard. Gate is the guard.
- Not a database. It's a portable export format.
- Not a blockchain. It's a signed file.
- Not a product. It's the evidence format the OS emits.

---

## First Build Target

Wire Gate to auto-emit a `.vyre` after every decision:

```javascript
// In src/gate/server.js, after enforce()
if (process.env.VYRE_EMIT === "1") {
  await emitVyre({ gate: decision, oracle: oracleSnapshot });
}
```

Output directory: `VYRE_DIR` env var (default: `./artifacts`).

That's v0.1. No CLI needed yet. Just files on disk.

---

*VYRE v0.1 · SURVIVOR Agent OS · 2026*
