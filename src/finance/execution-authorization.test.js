const { issueAuthorization, verifyAuthorization, reset } = require('./execution-authorization');
const { issueMandate, revoke } = require('./mandate');
const { checkToolCall, guardedCall } = require('./capability-firewall');
const { declareCredentialGrant } = require('./credential-grant');
const { ROBINHOOD_AGENTIC } = require('./connector-capabilities');
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));

const SNAP = 'snapshot_abc123';
const ORDER = { account_alias: 'agentic_account', symbol: 'NVDA', side: 'buy',
                notional_usd: 1000, order_type: 'market' };
const ALLOW_RECEIPT = { decision: 'ALLOW', model_version: 'survivor-finance-policy-v1a',
                        state_snapshot_id: SNAP, budget_remaining_usd: 9000 };

// Every authorization now needs a mandate behind it - a policy ALLOW is a judgment, not
// authority. Kept broad so it is not the thing under test here.
const MANDATE = () => issueMandate({
  issuer_identity: 'operator:test', subject_agent: 'test_agent',
  capabilities: ['place_equity_order', 'cancel_equity_order'],
  venues: ['robinhood_agentic'],
  capital: { total_budget_usd: 100000, max_order_usd: 100000 },
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  execution: { autonomous_within_mandate: true },
});
let MANDATE_FOR_TESTS = MANDATE();

// Every execution now also needs the credential it will be exercised through. Robinhood
// exposes no per-credential permission surface - one OAuth scope, "internal" - so the
// grant here is explicitly unbounded rather than narrowed. That has to be acknowledged out
// loud; declareCredentialGrant refuses to infer it. Kept broad so it is not the thing
// under test, exactly like the mandate above.
const CRED = declareCredentialGrant({
  credential_alias: 'robinhood_agentic_oauth',
  connector: ROBINHOOD_AGENTIC,
  acknowledge_unbounded: true,
  credential_status: 'ISSUED',
});

const mint = (o) => issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: o || ORDER,
                                         capability: 'place_equity_order',
                                         mandate: MANDATE_FOR_TESTS,
                                         credentialGrant: CRED });

console.log('\nan ALLOW alone is not permission');
let r = checkToolCall('place_equity_order', ORDER);
t('no authorization means denied', r.decision === 'DENY');
t('reason names the missing authorization', r.reason === 'NO_EXECUTION_AUTHORIZATION');

console.log('\nauthorization cannot be issued from a non-ALLOW');
['DENY','DEFER','THROTTLE'].forEach(d => {
  try { issueAuthorization({ policyReceipt: { decision: d }, order: ORDER, capability: 'place_equity_order' });
        t(d + ' should not issue', false); }
  catch (e) { t(d + ' cannot issue an authorization', /requires a policy ALLOW/.test(e.message)); }
});

console.log('\na valid authorization permits exactly its action');
reset();
r = checkToolCall('place_equity_order', ORDER, mint(), SNAP, MANDATE_FOR_TESTS, CRED);
t('permitted', r.decision === 'ALLOW' && r.reason === 'VALID_EXECUTION_AUTHORIZATION');
t('marked single use', r.single_use === true);

console.log('\nany alteration is a different action');
const cases = [
  ['notional changed', { notional_usd: 1001 }],
  ['symbol changed', { symbol: 'AAPL' }],
  ['side flipped', { side: 'sell' }],
  ['account changed', { account_alias: 'account_1_margin' }],
  ['order type changed', { order_type: 'limit' }],
];
cases.forEach(([label, patch]) => {
  reset();
  const auth = mint();
  const altered = Object.assign({}, ORDER, patch);
  const c = checkToolCall('place_equity_order', altered, auth, SNAP, MANDATE_FOR_TESTS, CRED);
  t(label + ' rejected', c.decision === 'DENY' && c.authorization_failure === 'ACTION_MISMATCH');
});

console.log('\nreplay, expiry, tampering, drift, capability');
reset();
const once = mint();
const t1 = checkToolCall('place_equity_order', ORDER, once, SNAP, MANDATE_FOR_TESTS, CRED);
require('./execution-authorization').consume(once.authorization_id);
const t2 = checkToolCall('place_equity_order', ORDER, once, SNAP, MANDATE_FOR_TESTS, CRED);
t('first use permitted', t1.decision === 'ALLOW');
t('replay rejected', t2.decision === 'DENY' && t2.authorization_failure === 'AUTHORIZATION_ALREADY_USED');

reset();
const extended = mint();
extended.expires_at = new Date(Date.now() + 86400000).toISOString();
r = checkToolCall('place_equity_order', ORDER, extended, SNAP, MANDATE_FOR_TESTS, CRED);
t('extending expiry breaks the signature', r.decision === 'DENY' &&
  r.authorization_failure === 'AUTHORIZATION_SIGNATURE_INVALID');

reset();
const short = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                   capability: 'place_equity_order', ttlSeconds: -1,
                                   mandate: MANDATE_FOR_TESTS, credentialGrant: CRED });
r = checkToolCall('place_equity_order', ORDER, short, SNAP, MANDATE_FOR_TESTS, CRED);
t('expired authorization rejected', r.decision === 'DENY' && r.authorization_failure === 'AUTHORIZATION_EXPIRED');

reset();
const tampered = mint();
tampered.action_summary.notional_usd = 99999;
r = checkToolCall('place_equity_order', ORDER, tampered, SNAP, MANDATE_FOR_TESTS, CRED);
t('edited authorization rejected', r.decision === 'DENY' &&
  r.authorization_failure === 'AUTHORIZATION_SIGNATURE_INVALID');

reset();
r = checkToolCall('place_equity_order', ORDER, mint(), 'snapshot_changed_since', MANDATE_FOR_TESTS, CRED);
t('snapshot drift rejected', r.decision === 'DENY' && r.authorization_failure === 'SNAPSHOT_DRIFT');

reset();
r = checkToolCall('cancel_equity_order', ORDER, mint(), SNAP, MANDATE_FOR_TESTS, CRED);
t('authorization for place does not permit cancel', r.decision === 'DENY' &&
  r.authorization_failure === 'CAPABILITY_MISMATCH');

reset();
r = checkToolCall('place_equity_order', ORDER, { authorization_id: 'fake', model_version: 'x' }, SNAP, MANDATE_FOR_TESTS, CRED);
t('fabricated authorization rejected', r.decision === 'DENY');

console.log('\nnothing unauthorized reaches the transport');
(async () => {
  reset();
  const reached = [];
  const transport = async (n, a) => { reached.push({ n, a }); return { ok: true }; };

  const attempts = [
    ['no authorization', ORDER, null],
    ['altered notional', Object.assign({}, ORDER, { notional_usd: 5000 }), mint()],
    ['different symbol', Object.assign({}, ORDER, { symbol: 'TSLA' }), mint()],
    ['fabricated', ORDER, { authorization_id: 'fake' }],
  ];
  for (const [label, order, auth] of attempts) {
    try { await guardedCall(transport, 'place_equity_order', order, auth, SNAP, MANDATE_FOR_TESTS, CRED);
          t(label + ' should have thrown', false); }
    catch (e) { t(label + ' blocked before transport', !!e.receipt); }
  }
  t('transport never invoked', reached.length === 0);

  reset();
  const good = mint();
  await guardedCall(transport, 'place_equity_order', ORDER, good, SNAP, MANDATE_FOR_TESTS, CRED);
  t('authorized action reaches transport exactly once', reached.length === 1);

  try { await guardedCall(transport, 'place_equity_order', ORDER, good, SNAP, MANDATE_FOR_TESTS, CRED);
        t('replay through transport should throw', false); }
  catch (e) { t('replay blocked after consumption', e.receipt.authorization_failure === 'AUTHORIZATION_ALREADY_USED'); }
  t('transport still invoked only once', reached.length === 1);

  console.log('\nauthorization is spent even when execution fails');
  reset();
  const auth = mint();
  const failing = async () => { throw new Error('broker rejected'); };
  try { await guardedCall(failing, 'place_equity_order', ORDER, auth, SNAP, MANDATE_FOR_TESTS, CRED); } catch (e) {}
  const after = checkToolCall('place_equity_order', ORDER, auth, SNAP, MANDATE_FOR_TESTS, CRED);
  t('a failed execution does not leave a reusable grant',
    after.decision === 'DENY' && after.authorization_failure === 'AUTHORIZATION_ALREADY_USED');

  console.log('\nconcurrent use of one authorization');
  reset();
  const raced = mint();
  const hits = [];
  const slow = async (n, a) => { await new Promise(r => setTimeout(r, 10)); hits.push(n); return { ok: true }; };
  const results = await Promise.allSettled([
    guardedCall(slow, 'place_equity_order', ORDER, raced, SNAP, MANDATE_FOR_TESTS, CRED),
    guardedCall(slow, 'place_equity_order', ORDER, raced, SNAP, MANDATE_FOR_TESTS, CRED),
  ]);
  const ok = results.filter(r => r.status === 'fulfilled').length;
  t('exactly one concurrent attempt succeeds', ok === 1);
  t('transport invoked once despite the race', hits.length === 1);

  console.log('\nintegrity claim is stated honestly');
  const a2 = mint();
  t('signed by the governor', a2.integrity_model === 'ED25519_SIGNED_BY_EXECUTION_GOVERNOR');
  t('carries a signature', typeof a2.signature === 'string' && a2.signature.length > 40);
  t('names the issuing key', typeof a2.governor_key_id === 'string');

  console.log('\nauthority vs evidence');
  t('the policy receipt is not signed', ALLOW_RECEIPT.signature === undefined);
  t('the authorization is', a2.signature !== undefined);

  console.log('\nforgery');
  const { governorIdentity, authorizationState, verifyAuthorization } = require('./execution-authorization');
  const forged = JSON.parse(JSON.stringify(a2));
  forged.action_summary.notional_usd = 99999;
  forged.action_fingerprint = require('./execution-authorization')
    .actionFingerprint(Object.assign({}, ORDER, { notional_usd: 99999 }));
  let f = checkToolCall('place_equity_order', Object.assign({}, ORDER, { notional_usd: 99999 }), forged, SNAP, MANDATE_FOR_TESTS, CRED);
  t('rebuilding the fingerprint does not help without the key',
    f.decision === 'DENY' && f.authorization_failure === 'AUTHORIZATION_SIGNATURE_INVALID');

  const unsigned = JSON.parse(JSON.stringify(a2));
  delete unsigned.signature;
  f = checkToolCall('place_equity_order', ORDER, unsigned, SNAP, MANDATE_FOR_TESTS, CRED);
  t('unsigned authorization rejected', f.authorization_failure === 'AUTHORIZATION_UNSIGNED');

  console.log('\nstate machine');
  reset();
  const sm = mint();
  t('starts ISSUED', authorizationState(sm, null) === 'ISSUED');
  t('VERIFIED before consumption', authorizationState(sm, verifyAuthorization(
    { auth: sm, order: ORDER, capability: 'place_equity_order', currentSnapshotId: SNAP, mandate: MANDATE_FOR_TESTS, credentialGrant: CRED })) === 'VERIFIED');
  require('./execution-authorization').consume(sm.authorization_id);
  t('CONSUMED after use', authorizationState(sm, verifyAuthorization(
    { auth: sm, order: ORDER, capability: 'place_equity_order', currentSnapshotId: SNAP, mandate: MANDATE_FOR_TESTS, credentialGrant: CRED })) === 'CONSUMED');
  const junk = mint(); junk.signature = 'nonsense';
  t('REJECTED is reserved for genuinely invalid', authorizationState(junk, verifyAuthorization(
    { auth: junk, order: ORDER, capability: 'place_equity_order', currentSnapshotId: SNAP, mandate: MANDATE_FOR_TESTS, credentialGrant: CRED })) === 'REJECTED');
  const drifted = mint();
  t('INVALIDATED_BY_DRIFT on snapshot change', authorizationState(drifted, verifyAuthorization(
    { auth: drifted, order: ORDER, capability: 'place_equity_order', currentSnapshotId: 'other', mandate: MANDATE_FOR_TESTS, credentialGrant: CRED })) === 'INVALIDATED_BY_DRIFT');

  console.log('\ngovernor identity');
  const gid = governorIdentity();
  t('key id exposed', typeof gid.key_id === 'string');
  t('public key exposed', /BEGIN PUBLIC KEY/.test(gid.public_key_pem));
  t('algorithm named', gid.algorithm === 'ed25519');

  console.log('\nmandate is the source of authority');
  reset();
  try { issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                             capability: 'place_equity_order' });
        t('no mandate should throw', false); }
  catch (e) { t('an authorization cannot exist without a mandate', /requires a mandate/.test(e.message)); }

  const narrow = issueMandate({
    issuer_identity: 'operator:test', subject_agent: 'test_agent',
    capabilities: ['place_equity_order'], venues: ['robinhood_agentic'],
    capital: { total_budget_usd: 100, max_order_usd: 5 },
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  try { issueAuthorization({ policyReceipt: ALLOW_RECEIPT,
                             order: Object.assign({}, ORDER, { notional_usd: 50 }),
                             capability: 'place_equity_order', mandate: narrow,
                             credentialGrant: CRED });
        t('over-mandate order should throw', false); }
  catch (e) { t('an order beyond the mandate cannot be authorized',
                /EXCEEDS_MANDATE_ORDER_LIMIT/.test(e.message)); }

  console.log('\nrevocation is immediate, not deferred to expiry');
  reset();
  const live = MANDATE();
  const liveAuth = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                  capability: 'place_equity_order', mandate: live,
                                  credentialGrant: CRED });
  let vr = verifyAuthorization({ auth: liveAuth, order: ORDER, capability: 'place_equity_order',
                                 currentSnapshotId: SNAP, mandate: live, credentialGrant: CRED });
  t('valid while the mandate is active', vr.valid === true);
  revoke(live, 'operator:test', 'kill switch');
  vr = verifyAuthorization({ auth: liveAuth, order: ORDER, capability: 'place_equity_order',
                             currentSnapshotId: SNAP, mandate: live, credentialGrant: CRED });
  t('dies the moment the mandate is revoked', vr.code === 'MANDATE_NO_LONGER_ACTIVE');
  t('and not by waiting for its own expiry', vr.code !== 'AUTHORIZATION_EXPIRED');

  // The test that matters most. verifyAuthorization was already checking the mandate, but
  // checkToolCall and guardedCall did not pass it through - so revocation worked when the
  // function was called directly and did nothing on the real path. A component test can
  // pass while the path that uses it never supplies the data.
  console.log('\nrevocation survives the real execution path');
  reset();
  const pathMandate = MANDATE();
  const pathAuth = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                        capability: 'place_equity_order', mandate: pathMandate,
                                        credentialGrant: CRED });
  const pathHits = [];
  const tport = async (n) => { pathHits.push(n); return { ok: true }; };

  await guardedCall(tport, 'place_equity_order', ORDER, pathAuth, SNAP, pathMandate, CRED);
  t('authorized call reaches transport', pathHits.length === 1);

  reset();
  const m2 = MANDATE();
  const a3 = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                  capability: 'place_equity_order', mandate: m2,
                                  credentialGrant: CRED });
  revoke(m2, 'operator:test', 'kill switch mid-flight');
  try { await guardedCall(tport, 'place_equity_order', ORDER, a3, SNAP, m2, CRED);
        t('revoked mandate should block the path', false); }
  catch (e) { t('revoked mandate blocks at the firewall',
                e.receipt && e.receipt.authorization_failure === 'MANDATE_NO_LONGER_ACTIVE'); }
  t('transport not invoked after revocation', pathHits.length === 1);

  reset();
  const m3 = MANDATE();
  const a4 = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                  capability: 'place_equity_order', mandate: m3,
                                  credentialGrant: CRED });
  try { await guardedCall(tport, 'place_equity_order', ORDER, a4, SNAP, null, CRED);
        t('missing mandate should block', false); }
  catch (e) { t('an unsupplied mandate blocks the path',
                e.receipt && e.receipt.authorization_failure === 'MANDATE_NOT_SUPPLIED'); }
  t('transport still not invoked', pathHits.length === 1);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
