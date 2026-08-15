const { issueMandate, revoke, suspend, mandateState, checkAgainstMandate, issuerIdentity } = require('./mandate');
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));

const base = () => issueMandate({
  issuer_identity: 'operator:ayuba',
  subject_agent: 'robinhood_equity_sniper',
  strategy_id: 'rh_equity_v0',
  capabilities: ['equity.trade'],
  venues: ['robinhood_agentic'],
  instruments: { allow: ['AAPL','MSFT','NVDA'], deny: ['GME'] },
  capital: { total_budget_usd: 100, max_order_usd: 10, max_position_usd: 25,
             daily_loss_limit_usd: 15 },
  expires_at: new Date(Date.now() + 7*86400000).toISOString(),
  risk: { max_concentration_fraction: 0.25, max_orders_per_hour: 4 },
  execution: { autonomous_within_mandate: true, review_required_above_usd: 5 },
  enforcement: { total_budget_usd: 'CLIENT_ENFORCED', max_order_usd: 'CLIENT_ENFORCED' },
});

const order = (o) => Object.assign({ symbol: 'AAPL', side: 'buy', notional_usd: 3 }, o);
const chk = (m, o, extra) => checkAgainstMandate(Object.assign(
  { mandate: m, order: o || order(), capability: 'equity.trade', venue: 'robinhood_agentic',
    deployed_usd: 0 }, extra || {}));

console.log('\nissuance requires real bounds');
try { issueMandate({ issuer_identity:'x', subject_agent:'y', capabilities:['equity.trade'],
                     venues:['v'], capital:{ total_budget_usd: 0 },
                     expires_at: new Date(Date.now()+1000).toISOString() });
      t('zero budget should throw', false); }
catch (e) { t('a zero budget authorises nothing', /authorises nothing/.test(e.message)); }
try { issueMandate({ issuer_identity:'x', subject_agent:'y', capabilities:['equity.trade'],
                     venues:['v'], capital:{ total_budget_usd: 100 } });
      t('no expiry should throw', false); }
catch (e) { t('a mandate must expire', /must expire/.test(e.message)); }

console.log('\nan action inside the envelope');
let r = chk(base());
t('within mandate', r.within_mandate === true);
t('carries mandate id', typeof r.mandate_id === 'string');
t('carries mandate hash', typeof r.mandate_hash === 'string');
t('autonomous permitted', r.autonomous_permitted === true);
t('budget remaining computed', r.budget_remaining_usd === 97);

console.log('\noutside the envelope');
t('capability not mandated', chk(base(), order(), { capability: 'options.trade' }).code === 'CAPABILITY_NOT_MANDATED');
t('venue not mandated', chk(base(), order(), { venue: 'crypto_com_agent' }).code === 'VENUE_NOT_MANDATED');
t('denied instrument', chk(base(), order({ symbol: 'GME' })).code === 'INSTRUMENT_DENIED');
t('not in allowlist', chk(base(), order({ symbol: 'TSLA' })).code === 'INSTRUMENT_NOT_IN_ALLOWLIST');
t('over order limit', chk(base(), order({ notional_usd: 11 })).code === 'EXCEEDS_MANDATE_ORDER_LIMIT');
t('over total budget', chk(base(), order({ notional_usd: 5 }), { deployed_usd: 96 }).code === 'EXCEEDS_MANDATE_BUDGET');

console.log('\nreview threshold');
t('under threshold needs no review', chk(base(), order({ notional_usd: 3 })).review_required === false);
t('over threshold requires review', chk(base(), order({ notional_usd: 8 })).review_required === true);

console.log('\nlifecycle and revocation');
let m = base();
t('starts ACTIVE', mandateState(m) === 'ACTIVE');
suspend(m, 'operator:ayuba', 'investigating');
t('SUSPENDED after suspend', mandateState(m) === 'SUSPENDED');
t('suspended blocks action', chk(m).code === 'MANDATE_NOT_ACTIVE');
m = base(); revoke(m, 'operator:ayuba', 'done testing');
t('REVOKED after revoke', mandateState(m) === 'REVOKED');
t('revoked blocks action', chk(m).code === 'MANDATE_NOT_ACTIVE');
t('revocation records who and why', m.revocation.revoked_by === 'operator:ayuba' && !!m.revocation.reason);

console.log('\nrevocation does not look like tampering');
m = base(); revoke(m, 'operator:ayuba', 'kill switch');
const afterRevoke = chk(m);
t('reports NOT_ACTIVE not SIGNATURE_INVALID', afterRevoke.code === 'MANDATE_NOT_ACTIVE');

console.log('\nexpiry');
m = issueMandate({ issuer_identity:'op', subject_agent:'a', capabilities:['equity.trade'],
  venues:['robinhood_agentic'], capital:{ total_budget_usd: 100 },
  expires_at: new Date(Date.now() - 1000).toISOString() });
t('EXPIRED past its expiry', mandateState(m) === 'EXPIRED');
t('expired blocks action', chk(m).code === 'MANDATE_NOT_ACTIVE');

console.log('\ntampering');
m = base(); m.capital.total_budget_usd = 100000;
t('raising the budget breaks the signature', chk(m).code === 'MANDATE_SIGNATURE_INVALID');
m = base(); m.instruments.allow.push('TSLA');
t('widening the allowlist breaks the signature', chk(m).code === 'MANDATE_SIGNATURE_INVALID');
t('no mandate at all is refused', chk(null).code === 'NO_MANDATE');

console.log('\nissuer identity');
const id = issuerIdentity();
t('key id exposed', typeof id.key_id === 'string');
t('public key exposed', /BEGIN PUBLIC KEY/.test(id.public_key_pem));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
