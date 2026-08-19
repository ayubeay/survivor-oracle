/* Credential grant - the authority actually carried by the credential we issue.
 *
 * Four different things, and until 2026-08-19 this repository had names for only one:
 *
 *   CONNECTOR CAPABILITY      what the venue can do at all
 *   DEFAULT CREDENTIAL GRANT  what a credential carries if you accept the defaults
 *   MINIMUM CREDENTIAL GRANT  the narrowest grant the venue permits
 *   CONFIGURED GRANT          what the credential we actually issued carries
 *
 * And one more layer above them, added the same day when the wider account surface came
 * into view:
 *
 *   ACCOUNT CAPABILITY   IS NOT   AGENT-KEY CAPABILITY
 *                        IS NOT   CREDENTIAL GRANT
 *                        IS NOT   MANDATE AUTHORITY
 *
 * The Crypto.com account exposes crypto trading, Stocks, prediction products, Cash, Card,
 * Earn, Rewards and IRAs. None of that says an Agent Key can touch any of them. A product
 * visible in an account is not a product reachable by a credential, and reading a product
 * list as a capability list is the same error as reading a connector surface as authority -
 * one level further out.
 *
 * Crypto.com supplied the evidence that these are distinct. Its Agent Key can carry
 * `Make cash withdrawals` - the connector supports it, and `All (default)` grants it. Eight
 * of nine permissions uncheck, so a configured grant can exclude it, and one -
 * `View balance & transactions` - cannot be removed at all.
 *
 * The consequence for a capability firewall is that asking "does this venue's key support
 * withdrawals?" is the wrong question. The answer is yes and it decides nothing. The
 * question that decides something is "can withdrawal authority be excluded from the
 * credential we actually issue?"
 *
 * So authority is a property of the CREDENTIAL, not of the connector. Two keys at the same
 * venue can carry different authority, and a receipt that names only the connector cannot
 * tell them apart.
 *
 * TWO RULES, both directional:
 *
 *   A grant may only NARROW a connector's surface. Naming a permission the connector does
 *   not declare is refused - a credential cannot conjure capability the venue does not
 *   expose, and a declaration that says otherwise is fiction.
 *
 *   A grant may not UNDERSTATE the credential either. Omitting a permission the venue
 *   forces to be present is refused, because the real credential would carry it and every
 *   receipt derived from the declaration would be wrong about what was possible.
 *
 * OBSERVED IS STILL NOT ENFORCED. Unchecking a box in a setup screen proves the box
 * unchecks. It does not prove the venue refuses to honour the permission behind it. A
 * configured grant is CLIENT-enforced here - this runtime refuses to attempt what the grant
 * excludes, which is real and is ours - and remains UNVERIFIED at the venue until something
 * is actually seen to be refused.
 */

const crypto = require('crypto');

const GRANT_MODEL = 'survivor-credential-grant-v1';

/* Operation classes this module reasons about. Deliberately the same vocabulary the
   capability firewall classifies tools into - credential-grant.test.js asserts the two
   agree, because a silent divergence would make every class check here vacuous. Declared
   rather than imported: the firewall requires execution-authorization, which requires this
   module, and a cycle would be worse than a tested duplicate. */
const OPERATION_CLASS = ['OBSERVE_ACCOUNT', 'OBSERVE_MARKET', 'OBSERVE_HISTORY', 'ANALYZE',
                         'DISCOVERY', 'SIMULATE', 'MUTATE_METADATA', 'MUTATE_ORDER',
                         'EXERCISE_DERIVATIVE', 'ACCOUNT_CONFIGURATION', 'UNKNOWN'];

/* Classes where being wrong costs capital. These default closed on any missing or
   unreadable credential-grant information. The observation classes do not - denying a
   price lookup because a permission list is unparsed protects nothing and would push
   callers to bypass the check. */
const RISK_BEARING_CLASS = ['MUTATE_ORDER', 'EXERCISE_DERIVATIVE', 'ACCOUNT_CONFIGURATION'];

/* How a grant's bounds came to be believed. The first two are the whole point of the
   distinction and must never be collapsed. */
const GRANT_STATE = {
  OBSERVED_CONFIGURED: 'the permissions were selected in the venue setup surface and ' +
                       'observed to be selectable. This runtime enforces them; the venue ' +
                       'has not been seen to.',
  VERIFIED_ENFORCED: 'the venue was observed refusing an operation outside the grant. ' +
                     'Nothing is in this state.',
  UNBOUNDED_NOT_EXPOSED: 'the venue exposes no per-credential permission surface, so the ' +
                         'credential cannot be narrowed at all. Observed, not assumed - ' +
                         'and it must be acknowledged explicitly, never inferred.',
  UNKNOWN: 'nothing is established about this credential authority. Default closed.',
};

/* A credential that does not exist authorises nothing. This is the state Crypto.com is in:
   the permission surface has been read, no key has been generated, and Generate has never
   been pressed. Encoding it here means that wiring the venue up by mistake still refuses,
   rather than relying on nobody trying. */
const CREDENTIAL_STATUS = ['NOT_YET_ISSUED', 'ISSUED', 'REVOKED'];

function canonical(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);

/* Which operation classes a set of venue permissions satisfies.
 *
 * DEFAULT CLOSED BY CONSTRUCTION: a class appears only when the connector declares what
 * that class requires AND every required permission is present. A class the connector says
 * nothing about does not appear, so it is denied. Silence is not a grant. */
function derivePermittedClasses(requirements, granted) {
  const out = [];
  Object.keys(requirements || {}).forEach(cls => {
    const need = requirements[cls] || [];
    if (!need.length) return;                       // an empty requirement certifies nothing
    if (need.every(p => granted.indexOf(p) !== -1)) out.push(cls);
  });
  return out;
}

/* Declare the authority of one credential at one connector.
 *
 * Never accepts a secret. A grant names a credential by alias and describes what it may do;
 * the key material itself has no business in an authority object, and a key was exposed on
 * 2026-08-15 by being echoed where it did not belong. */
function declareCredentialGrant(spec) {
  const { credential_alias, connector, granted, credential_status,
          acknowledge_unbounded, observed_at, note } = spec || {};

  if (!credential_alias) throw new Error('credential grant requires credential_alias');
  if (!connector) throw new Error('credential grant requires the connector declaration it narrows');

  const model = connector.credential_grant_model;
  if (!model || !model.surface) {
    throw new Error('connector ' + connector.connector + ' declares no credential_grant_model; ' +
                    'a credential cannot be reconciled against it. Declare the surface - ' +
                    'including NOT_EXPOSED - before issuing authority against it.');
  }
  const status = credential_status || 'NOT_YET_ISSUED';
  if (CREDENTIAL_STATUS.indexOf(status) === -1) throw new Error('unknown credential_status ' + status);

  const base = {
    grant_id: crypto.randomUUID(),
    model_version: GRANT_MODEL,
    credential_alias,
    connector: connector.connector,
    credential_status: status,
    observed_at: observed_at || model.observed_at || null,
    note: note || null,
  };

  /* The venue exposes nothing to narrow. Robinhood: one OAuth scope, "internal", covering
     reads and trade authority together, and no per-credential permission surface found
     across five searched surfaces.

     This is OBSERVED UNBOUNDEDNESS, which is a different thing from missing information,
     and only that difference makes it safe to proceed. It still has to be said out loud -
     an unbounded credential is the riskiest kind, and inferring the acknowledgement would
     be exactly the silent widening this module exists to prevent. */
  if (model.surface === 'NOT_EXPOSED') {
    if (acknowledge_unbounded !== true) {
      throw new Error('connector ' + connector.connector + ' exposes no per-credential ' +
                      'permission surface, so this credential cannot be narrowed at the ' +
                      'venue. Pass acknowledge_unbounded: true to record that deliberately. ' +
                      'Every bound on this credential is client-side.');
    }
    if (granted && granted.length) {
      throw new Error('connector ' + connector.connector + ' exposes no per-credential ' +
                      'permissions; naming ' + granted.length + ' of them would be fiction.');
    }
    return finalize(Object.assign(base, {
      grant_state: 'UNBOUNDED_NOT_EXPOSED',
      bounded_by_venue: false,
      granted: null,
      permitted_classes: OPERATION_CLASS.filter(c => c !== 'UNKNOWN'),
      excluded: null,
      venue_enforcement: 'NONE_EXPOSED',
      client_enforcement: 'THE_ONLY_BOUND',
      evidence: model.evidence || null,
    }));
  }

  if (model.surface !== 'OBSERVED_CONFIGURABLE') {
    /* Includes UNKNOWN and anything added later that this version does not understand.
       Refusing an unrecognised surface is the same rule as an unclassified tool. */
    throw new Error('credential grant surface ' + model.surface + ' is not one this ' +
                    'version can reason about; refusing rather than guessing');
  }

  const universe = model.permissions || [];
  const mandatory = model.mandatory || [];
  const want = uniq(granted || []);

  /* NARROWING ONLY. A grant naming something the connector does not declare is refused. */
  const invented = want.filter(p => universe.indexOf(p) === -1);
  if (invented.length) {
    throw new Error('credential grant names permissions ' + connector.connector +
                    ' does not declare: ' + invented.join(', ') +
                    '. A credential narrows a connector surface; it cannot extend it.');
  }
  /* NOT UNDERSTATED EITHER. The venue forces these to be present, so a declaration without
     them would describe a credential that cannot exist. */
  const missingMandatory = mandatory.filter(p => want.indexOf(p) === -1);
  if (missingMandatory.length) {
    throw new Error('credential grant omits permissions ' + connector.connector +
                    ' does not allow to be removed: ' + missingMandatory.join(', ') +
                    '. The issued credential would carry them regardless.');
  }

  return finalize(Object.assign(base, {
    grant_state: 'OBSERVED_CONFIGURED',
    bounded_by_venue: true,
    granted: want,
    excluded: universe.filter(p => want.indexOf(p) === -1),
    permitted_classes: derivePermittedClasses(model.class_requirements, want),
    /* The distinction the repository has been holding since the enforcement-granularity
       commit, carried into this object so a receipt cannot lose it. Selecting a permission
       set is something WE did and WE enforce. Whether the venue also refuses what we
       excluded has never been observed. */
    venue_enforcement: 'UNVERIFIED',
    client_enforcement: 'ENFORCED_HERE',
    class_requirements_state: model.class_requirements_state || 'UNKNOWN',
    evidence: model.evidence || null,
  }));
}

/* The hash binds the AUTHORITY the grant describes, and deliberately excludes
   credential_status - exactly as a mandate's signature excludes its revocation block, and
   for the same reason. Lifecycle state legitimately changes after declaration; that is what
   a kill switch is. Including it would make a revoked credential indistinguishable from a
   swapped one, and an authorization bound to it would report the wrong failure.

   So a credential revoked mid-flight keeps its hash, still matches the authorization it was
   issued against, and fails on status instead - immediately, not at expiry. */
function grantAuthorityPayload(g) {
  const out = {};
  Object.keys(g).forEach(k => {
    if (k !== 'credential_status' && k !== 'grant_hash') out[k] = g[k];
  });
  return out;
}

function finalize(g) {
  g.permits_execution = g.permitted_classes.indexOf('MUTATE_ORDER') !== -1;
  g.grant_hash = hash(canonical(grantAuthorityPayload(g)));
  return g;
}

/* Is this operation class within the credential's authority?
 *
 * Every failure is a distinct code, for the same reason the authorization codes are:
 * "no credential was declared" and "the credential excludes this" are different mistakes
 * with different fixes. */
function permitsClass(grant, capabilityClass) {
  const risky = RISK_BEARING_CLASS.indexOf(capabilityClass) !== -1;

  if (!grant || typeof grant !== 'object') {
    /* THE RULE THIS MODULE EXISTS FOR. No credential-grant information is not the same as
       unrestricted authority, and reading it that way is how a default grant carrying cash
       withdrawals gets treated as a trading key. */
    return risky
      ? { permitted: false, code: 'NO_CREDENTIAL_GRANT',
          detail: 'risk-bearing capability with no declared credential authority; absence ' +
                  'defaults closed, it does not mean unrestricted' }
      : { permitted: true, code: 'NOT_RISK_BEARING' };
  }
  if (grant.model_version !== GRANT_MODEL)
    return { permitted: false, code: 'UNKNOWN_GRANT_MODEL', detail: grant.model_version };
  if (grant.grant_state === 'UNKNOWN')
    return { permitted: false, code: 'CREDENTIAL_GRANT_UNKNOWN',
             detail: 'nothing established about this credential authority' };
  if (grant.credential_status !== 'ISSUED')
    return { permitted: false, code: 'CREDENTIAL_NOT_ISSUED',
             detail: 'credential status ' + grant.credential_status +
                     '; a credential that does not exist authorises nothing' };
  if (grant.permitted_classes.indexOf(capabilityClass) === -1)
    return { permitted: false, code: 'CAPABILITY_NOT_IN_CREDENTIAL_GRANT',
             detail: capabilityClass + ' is not within the authority granted to ' +
                     grant.credential_alias };
  return { permitted: true, code: 'WITHIN_CREDENTIAL_GRANT' };
}

/* What the credential does NOT bound, stated rather than left to be assumed.
 *
 * Crypto.com's `Execute trades` is one permission. No subordinate control over spot versus
 * perpetuals versus margin or leverage appeared anywhere in the list, so a credential
 * holding it is unbounded on product on a venue with 341 perps at 50x. The mandate's
 * instruments.allowed_types and max_leverage carry that dimension with no credential-side
 * backstop, and a receipt should be able to say so. */
function residualClientBounds(grant, connector) {
  const model = (connector && connector.credential_grant_model) || {};
  /* ONLY a positive observation counts. UNKNOWN, NOT_EXPOSED and an absent field all mean
     the credential bounds nothing here - the whole point is that an absence of controls
     never becomes a claim about scope. */
  const bounds = model.product_scope_of_execution === 'OBSERVED';
  return {
    credential_bounds_product: bounds,
    /* What the permission MEANS. Unknown until some surface establishes it. */
    product_scope_state: model.product_scope_of_execution || 'UNKNOWN',
    /* What the UI OFFERS. A directly observed absence, which is a different claim and the
       only one of the two that was actually seen. */
    product_scope_controls: model.product_scope_controls || 'UNKNOWN',
    carried_by_mandate_alone: bounds
      ? [] : ['instruments.allowed_types', 'instruments.max_leverage'],
    /* Named so a receipt cannot imply the account's product list bounded anything. */
    account_surface_is_not_evidence: !!(model.account_surface &&
                                        model.account_surface.inference_permitted === false),
    venue_enforcement: (grant && grant.venue_enforcement) || 'UNKNOWN',
  };
}

/* Lifecycle transition. Returns a NEW grant - the hash is unchanged because authority is
   unchanged; only the credential's status moved. */
function revokeCredential(grant) {
  return Object.assign({}, grant, { credential_status: 'REVOKED' });
}

module.exports = { declareCredentialGrant, permitsClass, residualClientBounds,
                   derivePermittedClasses, revokeCredential, GRANT_MODEL, GRANT_STATE, OPERATION_CLASS,
                   RISK_BEARING_CLASS, CREDENTIAL_STATUS };
