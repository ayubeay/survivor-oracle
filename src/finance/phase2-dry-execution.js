/* Phase 2B - live state to dry execution boundary.
 *
 * Proves the whole chain with real Robinhood account state and a synthetic proposal:
 *
 *     live read -> normalise -> five gates -> ALLOW -> authorization
 *     -> firewall verification -> DRY BOUNDARY -> no broker call
 *
 * The dry adapter performs every check the real path would, then stops immediately before
 * tools/call. No review, no place, no cancel, no funding.
 */

const crypto = require('crypto');
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');
const { evaluateOrder } = require('./policy');
const { issueAuthorization } = require('./execution-authorization');
const { checkToolCall } = require('./capability-firewall');

const CONFIG = {
  configured_capital_budget_usd: 10000, single_order_ceiling_usd: 2500,
  max_symbol_fraction_of_budget: 0.20, max_orders_per_hour: 6,
  max_notional_per_hour_usd: 5000, symbol_cooldown_seconds: 0, max_state_age_seconds: 120,
};

const num = (v) => { if (v == null) return null; const n = parseFloat(String(v).replace(/[$,]/g,'')); return isFinite(n)?n:null; };
const fingerprint = (s) => crypto.createHash('sha256').update(JSON.stringify(s, Object.keys(s).sort())).digest('hex').slice(0,16);

/* Every check the live path performs, terminating before the wire. */
let dryAttempts = 0, brokerCalls = 0;
async function dryExecute(tool, order, auth, snapshotId) {
  dryAttempts++;
  const check = checkToolCall(tool, order, auth, snapshotId);
  if (check.decision !== 'ALLOW') {
    return { reached_boundary: false, decision: check.decision,
             reason: check.reason, authorization_failure: check.authorization_failure };
  }
  /* The real path would call tools/call here. It does not. */
  return { reached_boundary: true, decision: 'WOULD_EXECUTE',
           authorization_id: check.authorization_id,
           note: 'Terminated at the dry boundary. No broker call was made.' };
}

(async () => {
  console.log('SURVIVOR Phase 2B - live state, synthetic proposal, dry execution boundary.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  await client.initialize();

  async function read(tool, args) {
    const { result } = await client.callTool(tool, args || {});
    const raw = result && result.content && result.content[0] && result.content[0].text;
    if (!raw) return result;
    try { return JSON.parse(raw); } catch (e) { return { _text: raw }; }
  }

  const accounts = ((await read('get_accounts')).data || {}).accounts || [];
  const perAccount = {}; const symbolExposure = {};
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const name = a.agentic_allowed ? 'agentic_account' : 'account_' + (i+1) + '_' + (a.type || 'unknown');
    const e = { type: a.type, agentic_allowed: a.agentic_allowed === true, state: a.state };
    const p = ((await read('get_portfolio', { account_number: a.account_number })).data) || {};
    e.portfolio = { total_value: num(p.total_value), cash: num(p.cash),
                    buying_power: p.buying_power ? num(p.buying_power.buying_power) : null };
    const pos = ((await read('get_equity_positions', { account_number: a.account_number })).data) || {};
    e.positions = (pos.positions || []).map(x => ({ symbol: x.symbol, market_value: num(x.market_value) }));
    perAccount[name] = e;
  }
  const STATE = { observed_at: new Date().toISOString(), per_account: perAccount,
                  aggregate: { symbol_exposure: symbolExposure } };
  const snapshotId = fingerprint(STATE);
  session.discard();
  console.log('[state] snapshot ' + snapshotId + ', token discarded\n');

  const agentic = Object.keys(perAccount).find(k => perAccount[k].agentic_allowed);
  const PROPOSAL = { account_alias: agentic, symbol: 'NVDA', side: 'buy',
                     notional_usd: 1000, order_type: 'market' };

  console.log('=== the authorized path ===');
  const policy = Object.assign(evaluateOrder({ order: PROPOSAL, state: STATE, config: CONFIG,
                                               deployed_usd: 0, history: [] }),
                               { state_snapshot_id: snapshotId });
  console.log('  policy decision        ' + policy.decision);
  if (policy.decision !== 'ALLOW') { console.log('  chain stops here'); process.exit(0); }

  const auth = issueAuthorization({ policyReceipt: policy, order: PROPOSAL,
                                    capability: 'place_equity_order' });
  console.log('  authorization issued   ' + auth.authorization_id.slice(0, 8) +
              '  expires in ' + Math.round((new Date(auth.expires_at) - Date.now())/1000) + 's');
  console.log('  integrity model        ' + auth.integrity_model);

  let r = await dryExecute('place_equity_order', PROPOSAL, auth, snapshotId);
  console.log('  dry execution          ' + r.decision + ' — ' + (r.note || r.reason));

  console.log('\n=== the same authorization against altered actions ===');
  const attacks = [
    ['notional raised after authorization', Object.assign({}, PROPOSAL, { notional_usd: 2400 })],
    ['symbol swapped', Object.assign({}, PROPOSAL, { symbol: 'TSLA' })],
    ['side flipped', Object.assign({}, PROPOSAL, { side: 'sell' })],
    ['redirected to another account', Object.assign({}, PROPOSAL, { account_alias: Object.keys(perAccount).find(k => !perAccount[k].agentic_allowed) })],
  ];
  for (const [label, order] of attacks) {
    const a = await dryExecute('place_equity_order', order, auth, snapshotId);
    console.log('  ' + label.padEnd(38) + a.decision + '  ' + (a.authorization_failure || a.reason || ''));
  }

  console.log('\n=== state drift after authorization ===');
  r = await dryExecute('place_equity_order', PROPOSAL, auth, 'snapshot_changed_meanwhile');
  console.log('  drifted snapshot                      ' + r.decision + '  ' + (r.authorization_failure || ''));

  console.log('\n=== no authorization at all ===');
  r = await dryExecute('place_equity_order', PROPOSAL, null, snapshotId);
  console.log('  bare order                            ' + r.decision + '  ' + (r.reason || ''));

  console.log('\n=== run summary ===');
  console.log('state source              ROBINHOOD_LIVE_READ');
  console.log('proposal source           SYNTHETIC_LOCAL');
  console.log('dry execution attempts   ', dryAttempts);
  console.log('broker calls made        ', brokerCalls);
  console.log('capital movement          NONE');
  console.log('broker simulation         NONE');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
