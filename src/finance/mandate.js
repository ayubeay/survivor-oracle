/* Execution mandate - a durable human authority envelope.
 *
 * Three objects, deliberately distinct:
 *
 *   MANDATE                 durable human authority. Who may do what, with how much,
 *                           until when, and how it ends.
 *   POLICY DECISION         judgment about one proposed action. Evidence, not authority.
 *   EXECUTION AUTHORIZATION short-lived permission for one exact execution.
 *
 * The mandate exists because of what the Robinhood investigation found: the venue governs
 * connection, account eligibility and product capability, but no mechanism was observed for
 * expressing the bounds of a standing autonomous instruction. Those bounds are ours to
 * express, so they need somewhere to live that is attributable and revocable rather than a
 * config object.
 *
 * A mandate never contains strategy. It says what an agent MAY do, never what it SHOULD do.
 */

const crypto = require('crypto');

const MANDATE_MODEL = 'survivor-execution-mandate-v1';

/* Revocation is first-class. A mandate does not merely expire. */
const STATES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'];

/* Defense in depth. Where a venue enforces a constraint itself, the mandate limit should be
   at or below it - so if our layer fails, the venue still refuses. Where the venue enforces
   nothing, the mandate carries the whole responsibility and should say so. */
const ENFORCEMENT = {
  VENUE_ENFORCED: 'the venue independently rejects violations',
  CLIENT_ENFORCED: 'only this runtime prevents violations',
  BOTH: 'venue and client both constrain - preferred',
};

function canonical(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

let issuerKey = null;
function issuer() {
  if (!issuerKey) {
    issuerKey = crypto.generateKeyPairSync('ed25519');
    issuerKey.publicKeyPem = issuerKey.publicKey.export({ type: 'spki', format: 'pem' });
    issuerKey.keyId = hash(issuerKey.publicKeyPem).slice(0, 16);
  }
  return issuerKey;
}

/* One definition, used by both signing and verification. When these two drifted apart, a
   valid mandate reported SIGNATURE_INVALID and every legitimate action was refused. */
function signablePayload(m) {
  const out = {};
  Object.keys(m).forEach(k => {
    if (k !== 'signature' && k !== 'mandate_hash' && k !== 'revocation') out[k] = m[k];
  });
  return out;
}

function issueMandate(spec) {
  const required = ['issuer_identity', 'subject_agent', 'capabilities', 'venues', 'capital'];
  required.forEach(k => { if (!spec[k]) throw new Error('mandate requires ' + k); });
  if (!spec.capital.total_budget_usd || spec.capital.total_budget_usd <= 0) {
    throw new Error('a mandate with no capital budget authorises nothing - state it explicitly');
  }
  if (!spec.expires_at) {
    throw new Error('a mandate must expire. Indefinite authority is not authority, it is drift');
  }

  const now = Date.now();
  const m = {
    mandate_id: crypto.randomUUID(),
    model_version: MANDATE_MODEL,
    version: 1,

    issuer_identity: spec.issuer_identity,      // the human granting this
    subject_agent: spec.subject_agent,          // the agent it constrains
    strategy_id: spec.strategy_id || null,      // optional; a mandate may cover a strategy

    capabilities: spec.capabilities,            // e.g. ['equity.trade']
    venues: spec.venues,                        // e.g. ['robinhood_agentic']

    instruments: {
      allow: (spec.instruments && spec.instruments.allow) || null,   // null = any permitted
      deny: (spec.instruments && spec.instruments.deny) || [],
    },

    capital: {
      total_budget_usd: spec.capital.total_budget_usd,
      max_order_usd: spec.capital.max_order_usd || null,
      max_position_usd: spec.capital.max_position_usd || null,
      daily_loss_limit_usd: spec.capital.daily_loss_limit_usd || null,
    },

    time: {
      issued_at: new Date(now).toISOString(),
      effective_at: spec.effective_at || new Date(now).toISOString(),
      expires_at: spec.expires_at,
      permitted_sessions: (spec.time && spec.time.permitted_sessions) || null,
    },

    risk: {
      max_concentration_fraction: (spec.risk && spec.risk.max_concentration_fraction) || null,
      max_orders_per_hour: (spec.risk && spec.risk.max_orders_per_hour) || null,
      max_state_age_seconds: (spec.risk && spec.risk.max_state_age_seconds) || 120,
    },

    execution: {
      autonomous_within_mandate: spec.execution ? !!spec.execution.autonomous_within_mandate : false,
      review_required_above_usd: (spec.execution && spec.execution.review_required_above_usd) || null,
      human_confirmation_conditions: (spec.execution && spec.execution.human_confirmation_conditions) || [],
    },

    /* Which constraints the venue itself enforces, and which rest entirely on us. Recorded
       per mandate because it differs by venue - and because a client-enforced-only limit
       carries different risk than one the venue also rejects. */
    enforcement: spec.enforcement || {},

    revocation: { status: 'ACTIVE', revoked_at: null, revoked_by: null, reason: null },

    integrity_model: 'ED25519_SIGNED_BY_ISSUER',
  };

  /* Sign everything EXCEPT revocation. Revocation legitimately changes after issuance -
     that is the whole point of a kill switch - so including it would make every revoked
     mandate indistinguishable from a tampered one. The signature covers the authority
     envelope; revocation is a separate state transition on top of it. */
  const k = issuer();
  m.issuer_key_id = k.keyId;
  const signable = signablePayload(m);
  m.signature = crypto.sign(null, Buffer.from(canonical(signable)), k.privateKey).toString('base64');
  m.mandate_hash = hash(canonical(signable));
  return m;
}

function revoke(m, by, reason) {
  m.revocation = { status: 'REVOKED', revoked_at: new Date().toISOString(),
                   revoked_by: by, reason: reason || null };
  return m;
}
function suspend(m, by, reason) {
  m.revocation = { status: 'SUSPENDED', revoked_at: new Date().toISOString(),
                   revoked_by: by, reason: reason || null };
  return m;
}

function mandateState(m) {
  if (!m) return 'REVOKED';
  if (m.revocation && m.revocation.status === 'REVOKED') return 'REVOKED';
  if (m.revocation && m.revocation.status === 'SUSPENDED') return 'SUSPENDED';
  const now = Date.now();
  if (now > new Date(m.time.expires_at).getTime()) return 'EXPIRED';
  if (now < new Date(m.time.effective_at).getTime()) return 'DRAFT';
  return 'ACTIVE';
}

/* Does this proposed action fall inside the authority envelope? Separate from whether it is
   a good idea - that is the policy's question, and separate again from whether the venue
   will accept it. */
function checkAgainstMandate({ mandate, order, capability, venue, deployed_usd }) {
  const at = new Date().toISOString();
  const no = (code, detail) => ({ within_mandate: false, code, detail, checked_at: at,
                                  mandate_id: mandate && mandate.mandate_id });

  if (!mandate) return no('NO_MANDATE', 'no authority envelope supplied');

  const state = mandateState(mandate);
  if (state !== 'ACTIVE') return no('MANDATE_NOT_ACTIVE', state);

  /* A tampered mandate is not a mandate. */
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(canonical(signablePayload(mandate))),
                           issuer().publicKey, Buffer.from(mandate.signature, 'base64')); }
  catch (e) { ok = false; }
  if (!ok) return no('MANDATE_SIGNATURE_INVALID', 'not signed by this issuer, or altered');

  if (mandate.capabilities.indexOf(capability) === -1)
    return no('CAPABILITY_NOT_MANDATED', capability);
  if (mandate.venues.indexOf(venue) === -1)
    return no('VENUE_NOT_MANDATED', venue);

  const sym = order && order.symbol;
  if (mandate.instruments.deny.indexOf(sym) !== -1)
    return no('INSTRUMENT_DENIED', sym);
  if (mandate.instruments.allow && mandate.instruments.allow.indexOf(sym) === -1)
    return no('INSTRUMENT_NOT_IN_ALLOWLIST', sym);

  const notional = parseFloat(order && order.notional_usd) || 0;
  if (mandate.capital.max_order_usd && notional > mandate.capital.max_order_usd)
    return no('EXCEEDS_MANDATE_ORDER_LIMIT', '$' + notional + ' > $' + mandate.capital.max_order_usd);
  const used = parseFloat(deployed_usd) || 0;
  if (used + notional > mandate.capital.total_budget_usd)
    return no('EXCEEDS_MANDATE_BUDGET',
              '$' + (used + notional) + ' of $' + mandate.capital.total_budget_usd);

  return {
    within_mandate: true, checked_at: at,
    mandate_id: mandate.mandate_id, mandate_version: mandate.version,
    mandate_hash: mandate.mandate_hash,
    autonomous_permitted: mandate.execution.autonomous_within_mandate,
    review_required: !!(mandate.execution.review_required_above_usd &&
                        notional > mandate.execution.review_required_above_usd),
    budget_remaining_usd: mandate.capital.total_budget_usd - used - notional,
  };
}

function issuerIdentity() {
  const k = issuer();
  return { key_id: k.keyId, public_key_pem: k.publicKeyPem, algorithm: 'ed25519' };
}

module.exports = { issueMandate, revoke, suspend, mandateState, checkAgainstMandate,
                   issuerIdentity, MANDATE_MODEL, STATES, ENFORCEMENT };
