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
const expired = mint();
expired.expires_at = new Date(Date.now() - 1000).toISOString();
expired.authorization_hash = undefined;
const { actionFingerprint } = require('./execution-authorization');
r = checkToolCall('place_equity_order', ORDER, expired, SNAP);
t('tampering to extend expiry is caught', r.decision === 'DENY' &&
  ['AUTHORIZATION_TAMPERED','AUTHORIZATION_EXPIRED'].indexOf(r.authorization_failure) !== -1);

reset();
const short = issueAuthorization({ policyReceipt: ALLOW_RECEIPT, order: ORDER,
                                   capability: 'place_equity_order', ttlSeconds: -1 });
r = checkToolCall('place_equity_order', ORDER, short, SNAP);
t('expired authorization rejected', r.decision === 'DENY' && r.authorization_failure === 'AUTHORIZATION_EXPIRED');

reset();
const tampered = mint();
tampered.action_summary.notional_usd = 99999;
r = checkToolCall('place_equity_order', ORDER, tampered, SNAP);
t('edited authorization rejected', r.decision === 'DENY' && r.authorization_failure === 'AUTHORIZATION_TAMPERED');

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

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
