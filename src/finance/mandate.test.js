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

console.log('\ninstrument type and leverage - crypto.com has 50x perps');
// A symbol allowlist cannot express leverage. Crypto.com lists 343 perpetual swaps at 50x
// and 144 spot pairs with margin enabled, so a mandate silent on type would authorise
// leveraged exposure by omission. Spot at 1x is the default; leverage must be granted.
const cryptoM = issueMandate({
  issuer_identity: 'operator:test', subject_agent: 'crypto_sniper',
  capabilities: ['crypto.trade'], venues: ['crypto_com_exchange_api'],
  capital: { total_budget_usd: 5, max_order_usd: 2 },
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});
const cchk = (o) => checkAgainstMandate({ mandate: cryptoM, order: o,
  capability: 'crypto.trade', venue: 'crypto_com_exchange_api', deployed_usd: 0 });
t('spot permitted by default', cchk({ symbol:'BTC_USD', notional_usd:1 }).within_mandate === true);
t('perp refused on type', cchk({ symbol:'BTCUSD-PERP', notional_usd:1,
  instrument_type:'PERPETUAL_SWAP', leverage:50 }).code === 'INSTRUMENT_TYPE_NOT_MANDATED');
t('margin refused on leverage', cchk({ symbol:'BTC_USD', notional_usd:1, leverage:3 })
  .code === 'EXCEEDS_MANDATE_LEVERAGE');

const levM = issueMandate({
  issuer_identity: 'operator:test', subject_agent: 'crypto_sniper',
  capabilities: ['crypto.trade'], venues: ['crypto_com_exchange_api'],
  capital: { total_budget_usd: 5, max_order_usd: 2 },
  instruments: { allowed_types: ['SPOT','PERPETUAL_SWAP'], max_leverage: 3 },
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});
const lchk = (o) => checkAgainstMandate({ mandate: levM, order: o,
  capability: 'crypto.trade', venue: 'crypto_com_exchange_api', deployed_usd: 0 });
t('granted type is permitted', lchk({ symbol:'BTCUSD-PERP', notional_usd:1,
  instrument_type:'PERPETUAL_SWAP', leverage:2 }).within_mandate === true);
t('but only up to the granted leverage', lchk({ symbol:'BTCUSD-PERP', notional_usd:1,
  instrument_type:'PERPETUAL_SWAP', leverage:50 }).code === 'EXCEEDS_MANDATE_LEVERAGE');

console.log('\nreconciliation against a connector declaration');
// A mandate should not grant what a venue cannot do. Before this check, a mandate for 50x
// perpetual swaps was accepted against an equities-only broker - the instrument-type check
// skipped silently because that connector declared no instrument block. A control that does
// not run is indistinguishable from one that passed.
const { CRYPTO_COM_EXCHANGE_API, CRYPTO_COM_APP_AGENT_KEY,
        ROBINHOOD_AGENTIC } = require('./connector-capabilities');
const mk = (v, inst) => ({ issuer_identity:'op', subject_agent:'a', capabilities:['trade'],
  venues:[v], capital:{ total_budget_usd: 5 }, instruments: inst,
  expires_at: new Date(Date.now()+86400000).toISOString() });
const accepts = (fn) => { try { fn(); return true; } catch (e) { return false; } };

t('spot on the crypto.com EXCHANGE accepted', accepts(() => issueMandate(
  mk('crypto_com_exchange_api'), CRYPTO_COM_EXCHANGE_API)));
t('perps at 3x on the exchange accepted', accepts(() => issueMandate(
  mk('crypto_com_exchange_api', { allowed_types:['PERPETUAL_SWAP'], max_leverage:3 }), CRYPTO_COM_EXCHANGE_API)));
t('200x refused - beyond venue maximum', !accepts(() => issueMandate(
  mk('crypto_com_exchange_api', { max_leverage:200 }), CRYPTO_COM_EXCHANGE_API)));

// THE SPLIT, 2026-08-21. Until then these two surfaces were one declaration named for the
// Exchange, and an App Agent Key mandate passed instrument reconciliation by borrowing the
// Exchange's 930 instruments. The App surface has never had its universe enumerated, so it
// must refuse - default closed, not silently permissive.
t('spot on the APP AGENT KEY refused - instrument universe not enumerated',
  !accepts(() => issueMandate(mk('crypto_com_app_agent_key'), CRYPTO_COM_APP_AGENT_KEY)));
t('perps on the app agent key refused too', !accepts(() => issueMandate(
  mk('crypto_com_app_agent_key', { allowed_types:['PERPETUAL_SWAP'] }), CRYPTO_COM_APP_AGENT_KEY)));
t('the app declares NOT_ENUMERATED rather than an empty universe',
  CRYPTO_COM_APP_AGENT_KEY.instruments.enumeration_state === 'NOT_ENUMERATED' &&
  CRYPTO_COM_APP_AGENT_KEY.instruments.by_type === undefined);
t('and says explicitly that it did not borrow the exchange universe',
  CRYPTO_COM_APP_AGENT_KEY.instruments.borrowed_from_exchange === false);
t('exchange instrument facts appear nowhere on the app declaration',
  JSON.stringify(CRYPTO_COM_APP_AGENT_KEY).indexOf('930') === -1 &&
  CRYPTO_COM_APP_AGENT_KEY.instruments.max_leverage_observed === null);
t('both surfaces still share one venue identity',
  CRYPTO_COM_EXCHANGE_API.venue === 'crypto_com' &&
  CRYPTO_COM_APP_AGENT_KEY.venue === 'crypto_com' &&
  CRYPTO_COM_EXCHANGE_API.connector !== CRYPTO_COM_APP_AGENT_KEY.connector);

t('equity on robinhood accepted', accepts(() => issueMandate(
  mk('robinhood_agentic', { allowed_types:['EQUITY'] }), ROBINHOOD_AGENTIC)));
t('perps on robinhood refused', !accepts(() => issueMandate(
  mk('robinhood_agentic', { allowed_types:['PERPETUAL_SWAP'] }), ROBINHOOD_AGENTIC)));
t('options on robinhood refused - declared at zero', !accepts(() => issueMandate(
  mk('robinhood_agentic', { allowed_types:['OPTION'] }), ROBINHOOD_AGENTIC)));
t('leverage on robinhood refused', !accepts(() => issueMandate(
  mk('robinhood_agentic', { allowed_types:['EQUITY'], max_leverage:3 }), ROBINHOOD_AGENTIC)));
t('a connector declaring nothing is refused, not skipped', !accepts(() => issueMandate(
  mk('x'), { connector:'x', capabilities:{} })));

console.log('\nenforcement provenance');
const cm = issueMandate(mk('crypto_com_exchange_api'), CRYPTO_COM_EXCHANGE_API);
// CHANGED BY THE SPLIT. The weekly budget and key expiry are APP Agent Key controls. Before
// 2026-08-21 they sat on the Exchange declaration and an Exchange mandate inherited
// UNVERIFIED provenance from credential controls belonging to another surface. The Exchange
// has no such control of its own, so CLIENT_ONLY is the honest state.
t('the exchange no longer inherits app budget provenance',
  cm.enforcement.total_budget_usd === 'CLIENT_ONLY');
t('nor app expiry provenance', cm.enforcement.expires_at === 'CLIENT_ONLY');
t('because the exchange declares neither control',
  CRYPTO_COM_EXCHANGE_API.capabilities.venue_trading_budget === undefined &&
  CRYPTO_COM_EXCHANGE_API.capabilities.venue_key_expiry === undefined);
t('while the app still declares both, observed',
  CRYPTO_COM_APP_AGENT_KEY.capabilities.venue_trading_budget.indexOf('OBSERVED') === 0 &&
  CRYPTO_COM_APP_AGENT_KEY.capabilities.venue_key_expiry.indexOf('OBSERVED') === 0);

// The UNVERIFIED branch lost its only route through issueMandate when the surfaces split:
// the connector that declares those controls now refuses on instruments before enforcement
// is computed. Synthetic fixture, so the branch keeps coverage rather than quietly lapsing.
const synthetic = { connector: 'synthetic_venue',
  capabilities: { venue_trading_budget: 'OBSERVED_WEEKLY_WITH_REMAINING',
                  venue_key_expiry: 'OBSERVED_CONFIGURABLE_MIN_30_DAYS' },
  instruments: { by_type: { CCY_PAIR: 1 } } };
const sm = issueMandate(mk('synthetic_venue'), synthetic);
t('observed but untested venue controls are still UNVERIFIED',
  sm.enforcement.total_budget_usd === 'UNVERIFIED');
t('so is expiry', sm.enforcement.expires_at === 'UNVERIFIED');

// Robinhood exposes no equivalent control at all - a different state from unverified.
const rm = issueMandate(mk('robinhood_agentic', { allowed_types:['EQUITY'] }), ROBINHOOD_AGENTIC);
t('a venue with no such control is CLIENT_ONLY',
  rm.enforcement.total_budget_usd === 'CLIENT_ONLY');
t('records what it was reconciled against', cm.reconciled_against === 'crypto_com_exchange_api');

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
