const { issueAuthorization, verifyAuthorization, reset } = require('./execution-authorization');
const { checkToolCall, guardedCall } = require('./capability-firewall');
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));

const SNAP = 'snapshot_abc123';
const ORDER = { account_alias: 'agentic_account', symbol: 'NVDA', side: 'buy',
                notional_usd: 1000, order_type: 'market' };
const ALLOW_RECEIPT = { decision: 'ALLOW', model_version: 'survivor-finance-policy-v1a',
                        state_snapshot_id: SNAP, budget_remaining_usd: 9000 };

const mint = (o) => issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: o || ORDER,
                                         capability: 'place_equity_order' });

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
r = checkToolCall('place_equity_order', ORDER, mint(), SNAP);
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
  const c = checkToolCall('place_equity_order', altered, auth, SNAP);
  t(label + ' rejected', c.decision === 'DENY' && c.authorization_failure === 'ACTION_MISMATCH');
});

console.log('\nreplay, expiry, tampering, drift, capability');
reset();
const once = mint();
const t1 = checkToolCall('place_equity_order', ORDER, once, SNAP);
require('./execution-authorization').consume(once.authorization_id);
const t2 = checkToolCall('place_equity_order', ORDER, once, SNAP);
t('first use permitted', t1.decision === 'ALLOW');
t('replay rejected', t2.decision === 'DENY' && t2.authorization_failure === 'AUTHORIZATION_ALREADY_USED');

reset();
const extended = mint();
extended.expires_at = new Date(Date.now() + 86400000).toISOString();
r = checkToolCall('place_equity_order', ORDER, extended, SNAP);
t('extending expiry breaks the signature', r.decision === 'DENY' &&
  r.authorization_failure === 'AUTHORIZATION_SIGNATURE_INVALID');

reset();
const short = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                   capability: 'place_equity_order', ttlSeconds: -1 });
r = checkToolCall('place_equity_order', ORDER, short, SNAP);
t('expired authorization rejected', r.decision === 'DENY' && r.authorization_failure === 'AUTHORIZATION_EXPIRED');

reset();
const tampered = mint();
tampered.action_summary.notional_usd = 99999;
r = checkToolCall('place_equity_order', ORDER, tampered, SNAP);
t('edited authorization rejected', r.decision === 'DENY' &&
  r.authorization_failure === 'AUTHORIZATION_SIGNATURE_INVALID');

reset();
r = checkToolCall('place_equity_order', ORDER, mint(), 'snapshot_changed_since');
t('snapshot drift rejected', r.decision === 'DENY' && r.authorization_failure === 'SNAPSHOT_DRIFT');

reset();
r = checkToolCall('cancel_equity_order', ORDER, mint(), SNAP);
t('authorization for place does not permit cancel', r.decision === 'DENY' &&
  r.authorization_failure === 'CAPABILITY_MISMATCH');

reset();
r = checkToolCall('place_equity_order', ORDER, { authorization_id: 'fake', model_version: 'x' }, SNAP);
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
    try { await guardedCall(transport, 'place_equity_order', order, auth, SNAP);
          t(label + ' should have thrown', false); }
    catch (e) { t(label + ' blocked before transport', !!e.receipt); }
  }
  t('transport never invoked', reached.length === 0);

  reset();
  const good = mint();
  await guardedCall(transport, 'place_equity_order', ORDER, good, SNAP);
  t('authorized action reaches transport exactly once', reached.length === 1);

  try { await guardedCall(transport, 'place_equity_order', ORDER, good, SNAP);
        t('replay through transport should throw', false); }
  catch (e) { t('replay blocked after consumption', e.receipt.authorization_failure === 'AUTHORIZATION_ALREADY_USED'); }
  t('transport still invoked only once', reached.length === 1);

  console.log('\nauthorization is spent even when execution fails');
  reset();
  const auth = mint();
  const failing = async () => { throw new Error('broker rejected'); };
  try { await guardedCall(failing, 'place_equity_order', ORDER, auth, SNAP); } catch (e) {}
  const after = checkToolCall('place_equity_order', ORDER, auth, SNAP);
  t('a failed execution does not leave a reusable grant',
    after.decision === 'DENY' && after.authorization_failure === 'AUTHORIZATION_ALREADY_USED');

  console.log('\nconcurrent use of one authorization');
  reset();
  const raced = mint();
  const hits = [];
  const slow = async (n, a) => { await new Promise(r => setTimeout(r, 10)); hits.push(n); return { ok: true }; };
  const results = await Promise.allSettled([
    guardedCall(slow, 'place_equity_order', ORDER, raced, SNAP),
    guardedCall(slow, 'place_equity_order', ORDER, raced, SNAP),
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
  let f = checkToolCall('place_equity_order', Object.assign({}, ORDER, { notional_usd: 99999 }), forged, SNAP);
  t('rebuilding the fingerprint does not help without the key',
    f.decision === 'DENY' && f.authorization_failure === 'AUTHORIZATION_SIGNATURE_INVALID');

  const unsigned = JSON.parse(JSON.stringify(a2));
  delete unsigned.signature;
  f = checkToolCall('place_equity_order', ORDER, unsigned, SNAP);
  t('unsigned authorization rejected', f.authorization_failure === 'AUTHORIZATION_UNSIGNED');

  console.log('\nstate machine');
  reset();
  const sm = mint();
  t('starts ISSUED', authorizationState(sm, null) === 'ISSUED');
  t('VERIFIED before consumption', authorizationState(sm, verifyAuthorization(
    { auth: sm, order: ORDER, capability: 'place_equity_order', currentSnapshotId: SNAP })) === 'VERIFIED');
  require('./execution-authorization').consume(sm.authorization_id);
  t('CONSUMED after use', authorizationState(sm, verifyAuthorization(
    { auth: sm, order: ORDER, capability: 'place_equity_order', currentSnapshotId: SNAP })) === 'CONSUMED');
  const junk = mint(); junk.signature = 'nonsense';
  t('REJECTED is reserved for genuinely invalid', authorizationState(junk, verifyAuthorization(
    { auth: junk, order: ORDER, capability: 'place_equity_order', currentSnapshotId: SNAP })) === 'REJECTED');
  const drifted = mint();
  t('INVALIDATED_BY_DRIFT on snapshot change', authorizationState(drifted, verifyAuthorization(
    { auth: drifted, order: ORDER, capability: 'place_equity_order', currentSnapshotId: 'other' })) === 'INVALIDATED_BY_DRIFT');

  console.log('\ngovernor identity');
  const gid = governorIdentity();
  t('key id exposed', typeof gid.key_id === 'string');
  t('public key exposed', /BEGIN PUBLIC KEY/.test(gid.public_key_pem));
  t('algorithm named', gid.algorithm === 'ed25519');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
