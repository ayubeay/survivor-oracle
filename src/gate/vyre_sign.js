const nacl = require('tweetnacl');

function hexToU8(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) throw new Error('VYRE_SIGNING_KEY_HEX must be 32 bytes (64 hex chars)');
  const u8 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) u8[i] = parseInt(clean.slice(i*2, i*2+2), 16);
  return u8;
}

function u8ToHex(u8) { return Buffer.from(u8).toString('hex'); }

function signManifestHash(manifestHashHex, seedHex) {
  const seed = hexToU8(seedHex);
  const kp   = nacl.sign.keyPair.fromSeed(seed);
  const msg  = Buffer.from(manifestHashHex, 'hex');
  const sig  = nacl.sign.detached(new Uint8Array(msg), kp.secretKey);
  return { signature_hex: u8ToHex(sig), signer_pubkey_hex: u8ToHex(kp.publicKey) };
}

function verifyManifest(manifestHashHex, signatureHex, pubkeyHex) {
  const msg = Buffer.from(manifestHashHex, 'hex');
  const sig = Buffer.from(signatureHex, 'hex');
  const pub = Buffer.from(pubkeyHex, 'hex');
  return nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(sig), new Uint8Array(pub));
}

module.exports = { signManifestHash, verifyManifest };
