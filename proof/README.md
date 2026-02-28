# Shield Router — Oracle Attestation Service

> Consent-based swap protection for Solana, powered by [SURVIVOR Oracle](https://github.com/ayubeay/survivor-oracle).

## Live Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/attest/signer` | GET | Public | Oracle identity + program binding |
| `/attest` | POST | Public | Score mint → signed attestation |
| `/attest/verify` | POST | Public | Verify attestation signature + policy |
| `/attest/cache/stats` | GET | Public | Cache hit/miss statistics |

**Production URL:** `https://survivor-oracle-production.up.railway.app`

## Quick Start

### 1. Check oracle identity

```bash
curl -s https://survivor-oracle-production.up.railway.app/attest/signer | jq .
```

```json
{
  "signer": "Ay4wxqG76veDavtiETynFk1R7rjgwC5sNPZ4YGALmzFD",
  "domain": "shield-router-v1",
  "program": "Dw5bpnjUeY6XX9oCwqbDUTsAH3vAoSSrzr98bfSpMcv",
  "status": "ok"
}
```

### 2. Request attestation

```bash
curl -sX POST https://survivor-oracle-production.up.railway.app/attest \
  -H "Content-Type: application/json" \
  -d '{"mint":"DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263","router_program_id":"Dw5bpnjUeY6XX9oCwqbDUTsAH3vAoSSrzr98bfSpMcv"}' | jq .
```

Response:
```json
{
  "attestation": {
    "mint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "tier": 1,
    "score": 62,
    "issued_at": 1772288506,
    "expires_at": 1772292106,
    "domain": "shield-router-v1",
    "router_program_id": "Dw5bpnjUeY6XX9oCwqbDUTsAH3vAoSSrzr98bfSpMcv",
    "nonce": "a195cae41e758002afd4171afe0435ea"
  },
  "signature": "55MSpogVeQDMJ6v67vARivskYvpTzR3sL3zAh...",
  "signer": "Ay4wxqG76veDavtiETynFk1R7rjgwC5sNPZ4YGALmzFD"
}
```

### 3. Verify attestation

```bash
curl -sX POST https://survivor-oracle-production.up.railway.app/attest/verify \
  -H "Content-Type: application/json" \
  -d '{"attestation":{...},"signature":"...","signer":"..."}'  | jq .
```

```json
{
  "valid": true,
  "reason": "All checks passed",
  "checks": {
    "signature_valid": true,
    "signer_matches_oracle": true,
    "not_expired": true,
    "domain_valid": true,
    "program_matches": true,
    "score_in_range": true,
    "tier_consistent": true
  }
}
```

## Proof Client

Run the full attest → verify → policy flow in one command:

```bash
node shield-proof.js <mint> <oracle_url>

# Examples:
node shield-proof.js DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
node shield-proof.js DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 https://survivor-oracle-production.up.railway.app
```

Expected output:
```
  SHIELD ROUTER — Attestation Proof
  ─────────────────────────────────────────

  [0] Fetching oracle identity...
      Signer:  Ay4wxqG76veD...
      Program: Dw5bpnjUeY6X... (different ✓)

  [1] Requesting attestation...
      Score: 62/100  Risk: MEDIUM  Tier: 1
      333ms  [CACHE HIT]

  [2] Verifying signature...
      ✓ signature_valid
      ✓ signer_matches_oracle
      ✓ not_expired
      ✓ all 7 checks passed

  [3] Applying router policy...
      ✓ score >= 40
      ✓ tier <= 3
      ✓ ttl >= 60s
      ✓ PASS — Swap allowed by Shield Router policy

  Cache: 1 hits / 1 misses (50%)
```

## Attestation Schema (Borsh)

```
AttestationData {
  mint:              [u8; 32]    // token mint pubkey
  tier:              u8          // 0=LOW, 1=MEDIUM, 2=HIGH, 3=VERY_HIGH
  score:             u8          // 0-100 (higher = safer)
  issued_at:         i64         // unix timestamp
  expires_at:        i64         // issued_at + TTL (default 3600s)
  domain_len:        u32         // length prefix
  domain:            [u8; len]   // "shield-router-v1"
  router_program_id: [u8; 32]   // on-chain program address
  nonce:             [u8; 16]    // prevents replay
}
```

Signature: `ed25519(borsh_serialize(AttestationData))`

## Router Policy Defaults

| Check | Threshold | Description |
|---|---|---|
| `min_score` | 40 | Reject tokens below this score |
| `max_tier` | 3 | Reject tier above this |
| `min_ttl` | 60s | Reject if TTL remaining < 60s |
| `oracle_match` | required | Signer must match declared oracle |
| `signature` | required | ed25519 must verify |

## Architecture

```
User Wallet
    │
    ▼
Shield Router (on-chain)
    │  "Is this token safe to swap?"
    ▼
Survivor Oracle (this service)
    │  1. Score token via multi-engine analysis
    │  2. Borsh-serialize attestation
    │  3. ed25519 sign with oracle key
    │  4. Cache in SQLite (1h TTL)
    ▼
Signed Attestation
    │
    ▼
Shield Router verifies on-chain:
    ✓ signature matches oracle pubkey
    ✓ attestation not expired
    ✓ score meets policy threshold
    ✓ program ID matches
    │
    ▼
Swap proceeds (or blocked)
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ORACLE_SIGNER_PRIVKEY` | Yes | — | Base58 64-byte ed25519 keypair |
| `SHIELD_ROUTER_PROGRAM_ID` | Yes | — | On-chain program address |
| `MONITOR_ENABLED` | No | `true` | Set `false` for oracle-only mode |
| `RESCORE_ENABLED` | No | `true` | Set `false` to disable rescorer |
| `ATTEST_CACHE_ENABLED` | No | `true` | SQLite attestation caching |
| `ATTESTATION_TTL_SECONDS` | No | `3600` | Attestation validity window |

## Built by

**@youngs_modulus** — logic-first infrastructure for Solana.

- [GitHub](https://github.com/ayubeay/survivor-oracle)
- [X/Twitter](https://x.com/youngs_modulus)
