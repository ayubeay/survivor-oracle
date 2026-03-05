// vyre.js — VYRE v0.1 artifact emitter
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const zlib    = require('zlib');
const { signManifestHash } = require('./vyre_sign');

const VYRE_DIR = process.env.VYRE_DIR || path.join(__dirname, '../../artifacts');

function canonicalJson(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function sha256hex(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

async function emitVyre({ gate, oracle, verity, iam, runtime }) {
  try {
    const ts  = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
    const rnd = crypto.randomBytes(4).toString('hex');
    const id  = `vyre_${ts}${rnd}`;

    const components = {};
    const files      = {};

    // gate_decision — always present
    const gateDoc = { component: 'gate_decision', version: '1.0', ...gate };
    components.gate = 'gate_decision.json';
    files['gate_decision.json'] = canonicalJson(gateDoc);

    // oracle_attestation — always present
    if (oracle) {
      const oracleDoc = { component: 'oracle_attestation', version: '0.4', ...oracle };
      components.oracle = 'oracle_attestation.json';
      files['oracle_attestation.json'] = canonicalJson(oracleDoc);
    }

    // verity_ais — optional
    if (verity) {
      const verityDoc = { component: 'verity_ais', version: '1.0', ...verity };
      components.verity = 'verity_ais.json';
      files['verity_ais.json'] = canonicalJson(verityDoc);
    }

    // iam_actor — optional
    if (iam) {
      const iamDoc = { component: 'iam_actor', version: '0.1', ...iam };
      components.iam = 'iam_actor.json';
      files['iam_actor.json'] = canonicalJson(iamDoc);
    }

    // runtime — always present
    const runtimeDoc = {
      component:  'runtime',
      version:    '0.1',
      gate_url:   runtime?.gate_url   || '',
      oracle_url: runtime?.oracle_url || '',
      git_sha:    runtime?.git_sha    || 'unknown',
      env:        runtime?.env        || 'production',
      emitted_at: new Date().toISOString(),
    };
    components.runtime = 'runtime.json';
    files['runtime.json'] = canonicalJson(runtimeDoc);

    // component hashes
    const component_hashes = {};
    for (const [filename, content] of Object.entries(files)) {
      component_hashes[filename] = sha256hex(content);
    }

    // manifest core → hash → sign (unsigned in v0.1 if no key set)
    const manifestCore = {
      artifact_id: id,
      components,
      component_hashes,
      created_at:   new Date().toISOString(),
      schema:       'execution_decision',
      signer_role:  'gate',
      vyre_version: '0.1',
    };
    const manifestHash = sha256hex(canonicalJson(manifestCore));

    const seedHex = process.env.VYRE_SIGNING_KEY_HEX;
    let signature = null, signer = null;
    if (seedHex) {
      try {
        const { signature_hex, signer_pubkey_hex } = signManifestHash(manifestHash, seedHex);
        signature = signature_hex;
        signer    = signer_pubkey_hex;
      } catch(e) { console.error('[vyre] sign error:', e?.message); }
    }
    const manifest = {
      ...manifestCore,
      manifest_hash: manifestHash,
      signature,
      signer,
    };

    files['manifest.json'] = JSON.stringify(manifest, null, 2);

    // write to disk (flat folder, no zip in v0.1)
    fs.mkdirSync(VYRE_DIR, { recursive: true });
    const artifactDir = path.join(VYRE_DIR, id);
    fs.mkdirSync(artifactDir, { recursive: true });

    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(artifactDir, filename), content, 'utf8');
    }

    console.log(`[vyre] emitted ${id}`);
    return id;
  } catch (e) {
    console.error('[vyre] emit failed:', e?.message);
  }
}

module.exports = { emitVyre };
