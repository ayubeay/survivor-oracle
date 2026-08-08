/* Phase 2A - receipt-bound execution authorization.
 *
 * A policy ALLOW is an opinion about a proposal. It is NOT permission to execute. This
 * module issues a separate artifact - an execution authorization - bound to one exact
 * action, valid briefly, usable once.
 *
 * The capability firewall's posture for MUTATE_ORDER changes from
 *
 *     DENY
 *
 * to
 *
 *     DENY_BY_DEFAULT, ALLOW_ONLY_WITH_VALID_EXECUTION_AUTHORIZATION
 *
 * which is a different statement. Nothing is "turned on". A capital-moving capability
 * becomes reachable for a specific authorized action and closes again immediately.
 *
 * TOCTOU: policy evaluates a snapshot, then time passes. Another account could acquire the
 * same symbol before execution. A short TTL plus a snapshot-identity check bounds that
 * window; it does not eliminate it, and the authorization says so.
 */

const crypto = require('crypto');

const AUTH_MODEL = 'survivor-execution-authorization-v1';
const DEFAULT_TTL_SECONDS = 30;

/* Consumed authorizations. In-process only - a restart invalidates everything, which is
   the safe direction. */
const consumed = new Set();

function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* The action this authorization permits, and nothing else. Any field differing means a
   different action. */
function actionFingerprint(order) {
  return hash(canonical({
    account_alias: order.account_alias,
    symbol: order.symbol,
    side: order.side,
    notional_usd: order.notional_usd,
    quantity: order.quantity ?? null,
    order_type: order.order_type ?? 'market',
    limit_price: order.limit_price ?? null,
  }));
}

function issueAuthorization({ policyReceipt, order, capability, ttlSeconds }) {
  if (!policyReceipt || policyReceipt.decision !== 'ALLOW') {
    throw new Error('Execution authorization requires a policy ALLOW; got ' +
                    (policyReceipt ? policyReceipt.decision : 'nothing'));
  }
  const now = Date.now();
  const ttl = (ttlSeconds || DEFAULT_TTL_SECONDS) * 1000;
  const auth = {
    authorization_id: crypto.randomUUID(),
    model_version: AUTH_MODEL,
    policy_model_version: policyReceipt.model_version,
    policy_receipt_hash: hash(canonical(policyReceipt)),
    state_snapshot_id: policyReceipt.state_snapshot_id || null,
    execution_capability: capability,
    action_fingerprint: actionFingerprint(order),
    action_summary: {
      account_alias: order.account_alias, symbol: order.symbol, side: order.side,
      notional_usd: order.notional_usd, order_type: order.order_type ?? 'market',
    },
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl).toISOString(),
    single_use: true,
    limitation: 'Authorizes exactly this action, once, before expiry, against the named ' +
                'snapshot. State may drift between issuance and execution; the TTL bounds ' +
                'that window rather than closing it.',
  };
  /* TAMPER EVIDENCE, NOT AUTHENTICITY.
     An unkeyed digest over the canonical payload. It detects accidental or casual
     modification and binds the fields together. An attacker able to edit the object can
     recompute it. Within a single trusted runtime that is sufficient - the authorization
     never leaves the process - but this must not be described as unforgeable.

     Hardening path: a keyed MAC or signature over the same canonical payload adds
     authenticity to the integrity this provides. Needed when an authorization crosses a
     trust boundary. */
  auth.integrity_model = 'UNKEYED_DIGEST_TRUSTED_RUNTIME_ONLY';
  auth.authorization_hash = hash(canonical(auth));
  return auth;
}

/* Every reason an authorization can fail to permit an action. Each is distinct because
   "you altered the order" and "you waited too long" are different mistakes. */
function verifyAuthorization({ auth, order, capability, currentSnapshotId }) {
  const at = new Date().toISOString();
  const bad = (code, detail) => ({ valid: false, code, detail, checked_at: at });

  if (!auth || typeof auth !== 'object') return bad('NO_AUTHORIZATION', 'none supplied');
  if (auth.model_version !== AUTH_MODEL) return bad('UNKNOWN_AUTHORIZATION_MODEL', auth.model_version);

  /* Detects a hand-edited authorization: the hash covers every other field. */
  const claimed = auth.authorization_hash;
  const recomputed = hash(canonical(Object.assign({}, auth, { authorization_hash: undefined })));
  const withoutHash = {};
  Object.keys(auth).forEach(k => { if (k !== 'authorization_hash') withoutHash[k] = auth[k]; });
  if (claimed !== hash(canonical(withoutHash))) return bad('AUTHORIZATION_TAMPERED', 'hash mismatch');

  if (consumed.has(auth.authorization_id)) return bad('AUTHORIZATION_ALREADY_USED', auth.authorization_id);
  if (Date.now() > new Date(auth.expires_at).getTime())
    return bad('AUTHORIZATION_EXPIRED', 'expired at ' + auth.expires_at);
  if (auth.execution_capability !== capability)
    return bad('CAPABILITY_MISMATCH', 'authorized for ' + auth.execution_capability + ', attempted ' + capability);
  if (actionFingerprint(order) !== auth.action_fingerprint)
    return bad('ACTION_MISMATCH', 'the order does not match the authorized action');
  if (currentSnapshotId && auth.state_snapshot_id && currentSnapshotId !== auth.state_snapshot_id)
    return bad('SNAPSHOT_DRIFT', 'state changed since authorization');

  return { valid: true, authorization_id: auth.authorization_id, checked_at: at };
}

function consume(authId) { consumed.add(authId); }

// Verification and consumption must be one step. Two async callers could otherwise both
// verify before either consumed, and both would be permitted. Node's single-threaded
// execution makes this synchronous block atomic; a distributed implementation would need
// a real compare-and-set.
function verifyAndConsume(params) {
  const v = verifyAuthorization(params);
  if (v.valid) consumed.add(v.authorization_id);
  return v;
}
function reset() { consumed.clear(); }

module.exports = { issueAuthorization, verifyAuthorization, verifyAndConsume,
                   actionFingerprint, consume, reset, AUTH_MODEL, DEFAULT_TTL_SECONDS };
