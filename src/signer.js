/**
 * signer.js — ORACLE_SIGNER ed25519 signing for Shield Router attestations
 *
 * Loads ORACLE_SIGNER_PRIVKEY from env (base58-encoded 64-byte keypair).
 * Produces borsh-serialized, ed25519-signed attestations.
 *
 * Required env vars:
 *   ORACLE_SIGNER_PRIVKEY  — base58 encoded 64-byte keypair (from oracle_signer.json)
 *   SHIELD_ROUTER_PROGRAM_ID — deployed program address
 */

const nacl = require('tweetnacl');
const bs58mod = require('bs58'); const bs58 = bs58mod.default || bs58mod;
function b58decode(s){return Buffer.from(bs58.decode(s));}
function b58encode(b){return bs58.encode(Buffer.from(b));}


const BN = require('bn.js');

// ── Constants ─────────────────────────────────────────────────────────────────

const DOMAIN = 'shield-router-v1';
const DEFAULT_TTL_SECONDS = 3600; // 1 hour max

// Tier mapping — mirrors Survivor risk levels
const TIER_MAP = {
  LOW:       0, // GREEN
  MEDIUM:    1, // YELLOW
  HIGH:      2, // ORANGE
  VERY_HIGH: 3, // RED
  EXTREME:   3, // RED
};

// ── Keypair loading ───────────────────────────────────────────────────────────

let _keypair = null;

function loadKeypair() {
  if (_keypair) return _keypair;

  const privkeyEnv = process.env.ORACLE_SIGNER_PRIVKEY;
  if (!privkeyEnv) {
    throw new Error('ORACLE_SIGNER_PRIVKEY not set in environment');
  }

  const keypairBytes = b58decode(privkeyEnv);
  if (keypairBytes.length !== 64) {
    throw new Error(`ORACLE_SIGNER_PRIVKEY must be 64 bytes, got ${keypairBytes.length}`);
  }

  _keypair = {
    secretKey: keypairBytes,
    publicKey: keypairBytes.slice(32), // last 32 bytes = pubkey in Solana format
  };

  return _keypair;
}

function getSignerPubkey() {
  return b58encode(loadKeypair().publicKey);
}

// ── Borsh serialization ───────────────────────────────────────────────────────
// Manual borsh to avoid heavy dependency. Fields must match on-chain schema exactly.
//
// AttestationData layout (little-endian):
//   mint:             [u8; 32]
//   tier:             u8
//   score:            u8
//   issued_at:        i64 (8 bytes LE)
//   expires_at:       i64 (8 bytes LE)
//   domain_len:       u32 (4 bytes LE)
//   domain:           [u8; domain_len]
//   router_program_id:[u8; 32]
//   nonce:            [u8; 16]

function serializeAttestation(attest) {
  const mintBytes     = b58decode(attest.mint);
  const routerBytes   = b58decode(attest.router_program_id);
  const domainBytes   = Buffer.from(attest.domain, 'utf8');
  const nonceBytes    = attest.nonce; // Buffer[16]

  if (mintBytes.length !== 32)   throw new Error('mint must be 32 bytes');
  if (routerBytes.length !== 32) throw new Error('router_program_id must be 32 bytes');
  if (nonceBytes.length !== 16)  throw new Error('nonce must be 16 bytes');

  const buf = Buffer.alloc(
    32 +            // mint
    1  +            // tier
    1  +            // score
    8  +            // issued_at
    8  +            // expires_at
    4  +            // domain length prefix
    domainBytes.length +
    32 +            // router_program_id
    16              // nonce
  );

  let offset = 0;

  mintBytes.copy(buf, offset);            offset += 32;
  buf.writeUInt8(attest.tier, offset);    offset += 1;
  buf.writeUInt8(attest.score, offset);   offset += 1;

  // i64 as two u32 (little-endian, no BigInt for broader Node compat)
  writeI64LE(buf, attest.issued_at, offset);   offset += 8;
  writeI64LE(buf, attest.expires_at, offset);  offset += 8;

  buf.writeUInt32LE(domainBytes.length, offset); offset += 4;
  domainBytes.copy(buf, offset);                 offset += domainBytes.length;

  routerBytes.copy(buf, offset);          offset += 32;
  nonceBytes.copy(buf, offset);           offset += 16;

  return buf;
}

function writeI64LE(buf, value, offset) {
  // Handle unix timestamps safely without BigInt
  const lo = value >>> 0;
  const hi = Math.floor(value / 0x100000000);
  buf.writeUInt32LE(lo, offset);
  buf.writeInt32LE(hi, offset + 4);
}

// ── Nonce generation ──────────────────────────────────────────────────────────

function generateNonce() {
  return Buffer.from(nacl.randomBytes(16));
}

// ── Core: build + sign attestation ───────────────────────────────────────────

/**
 * buildAttestation(mint, survivorScore, survivorRiskLevel)
 *
 * @param {string} mint           — base58 token mint
 * @param {number} survivorScore  — 0-100 (higher = safer, Survivor convention)
 * @param {string} riskLevel      — 'LOW'|'MEDIUM'|'HIGH'|'VERY_HIGH'|'EXTREME'
 * @returns {{ attestation, signature, signer }}
 */
function buildAttestation(mint, survivorScore, riskLevel) {
  const keypair = loadKeypair();

  const routerProgramId = process.env.SHIELD_ROUTER_PROGRAM_ID;
  if (!routerProgramId) throw new Error('SHIELD_ROUTER_PROGRAM_ID not set');

  const tier = TIER_MAP[riskLevel];
  if (tier === undefined) throw new Error(`Unknown riskLevel: ${riskLevel}`);

  const ttl = parseInt(process.env.ATTESTATION_TTL_SECONDS || DEFAULT_TTL_SECONDS, 10);
  const issuedAt  = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttl;
  const nonce     = generateNonce();

  const attestation = {
    mint,
    tier,
    score:            Math.min(100, Math.max(0, Math.round(survivorScore))),
    issued_at:        issuedAt,
    expires_at:       expiresAt,
    domain:           DOMAIN,
    router_program_id: routerProgramId,
    nonce:            nonce.toString('hex'),
  };

  // Serialize and sign
  const attestationBytes = serializeAttestation({
    ...attestation,
    nonce, // pass Buffer for serialization
  });

  const signature = nacl.sign.detached(attestationBytes, keypair.secretKey);

  return {
    attestation,
    signature:  b58encode(signature),
    signer:     b58encode(keypair.publicKey),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  buildAttestation,
  getSignerPubkey,
  TIER_MAP,
  DOMAIN,
};
