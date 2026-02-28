// ── boot-invariants.js ────────────────────────────────────────────────────────
// Require this at the top of index.js (or inline into the listen callback).
// Crashes hard on misconfiguration — prevents silent security downgrades.

'use strict';

function checkBootInvariants() {
  const errors = [];

  // 1. Signer key must exist
  if (!process.env.ORACLE_SIGNER_PRIVKEY) {
    errors.push('ORACLE_SIGNER_PRIVKEY is not set — oracle cannot sign attestations');
  }

  // 2. Program ID must exist
  if (!process.env.SHIELD_ROUTER_PROGRAM_ID) {
    errors.push('SHIELD_ROUTER_PROGRAM_ID is not set — attestations will have no program binding');
  }

  // 3. Signer pubkey must differ from program ID (prevents false program_matches)
  if (process.env.ORACLE_SIGNER_PRIVKEY && process.env.SHIELD_ROUTER_PROGRAM_ID) {
    try {
      const { getSignerPubkey } = require('./signer');
      const signerPub = getSignerPubkey();
      if (signerPub === process.env.SHIELD_ROUTER_PROGRAM_ID) {
        errors.push(
          'FATAL: signer pubkey === SHIELD_ROUTER_PROGRAM_ID (' + signerPub + '). ' +
          'This means program_matches check is meaningless. Use different keys.'
        );
      }
    } catch (e) {
      errors.push('Could not derive signer pubkey: ' + e.message);
    }
  }

  // 4. Domain sanity
  try {
    const { DOMAIN } = require('./signer');
    if (DOMAIN !== 'shield-router-v1') {
      errors.push('Signer DOMAIN is "' + DOMAIN + '", expected "shield-router-v1"');
    }
  } catch (e) {
    // signer not loadable — already caught above
  }

  if (errors.length > 0) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  BOOT INVARIANT FAILURE — Oracle cannot start safely        ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    errors.forEach(function(e) { console.error('  ✗ ' + e); });
    console.error('');
    process.exit(1);
  }

  // Log clean boot identity
  try {
    const { getSignerPubkey } = require('./signer');
    console.log('[boot] Oracle signer: ' + getSignerPubkey());
    console.log('[boot] Program binding: ' + process.env.SHIELD_ROUTER_PROGRAM_ID);
    console.log('[boot] Signer ≠ Program: ✓');
  } catch (e) {
    // already validated above
  }
}

module.exports = { checkBootInvariants };
