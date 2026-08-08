const { evaluateOrder, GATES } = require('./policy');
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));

/* Shaped exactly like the phase 0 cross-account observation, including the negative
   margin balance that must never become a budget. */
const STATE = {
  observed_at: new Date().toISOString(),
  per_account: {
    account_1_margin: { type: 'margin', agentic_allowed: false, state: 'active',
      portfolio: { total_value: -49.15, cash: -49.15, buying_power: -196.6 }, positions: [] },
    account_2_cash: { type: 'cash', agentic_allowed: false, state: 'active',
      portfolio: { total_value: 0, cash: 0, buying_power: 0 }, positions: [] },
    agentic_account: { type: 'limited_margin', agentic_allowed: true, state: 'active',
      portfolio: { total_value: 0, cash: 0, buying_power: 0 }, positions: [] },
  },
  aggregate: { symbol_exposure: {} },
};

const CFG = { configured_capital_budget_usd: 10000, single_order_ceiling_usd: 2500,
              max_symbol_fraction_of_budget: 0.20, max_orders_per_hour: 6,
              max_notional_per_hour_usd: 5000, symbol_cooldown_seconds: 300 };

const order = (o) => Object.assign({ account_alias: 'agentic_account', symbol: 'NVDA',
                                     side: 'buy', notional_usd: 500 }, o);

console.log('\nstructural - impossible actions never reach risk evaluation');
let r = evaluateOrder({ order: order({ account_alias: 'account_1_margin' }), state: STATE, config: CFG });
t('non-agentic account denied', r.decision === 'DENY' && r.code === 'ACCOUNT_NOT_AGENTIC');
t('failed at structural gate', r.failed_gate === 'STRUCTURAL');
t('risk gates never reached', r.gates_not_reached.indexOf('EXPOSURE') !== -1);
t('categorised structural not policy', r.category === 'STRUCTURAL_INVALID');

r = evaluateOrder({ order: order({ account_alias: 'nonexistent' }), state: STATE, config: CFG });
t('unknown account denied', r.code === 'ACCOUNT_NOT_FOUND');
r = evaluateOrder({ order: order({ notional_usd: -100 }), state: STATE, config: CFG });
t('negative notional denied', r.code === 'INVALID_ORDER_SCHEMA');
r = evaluateOrder({ order: order({ side: 'short' }), state: STATE, config: CFG });
t('unsupported side denied', r.code === 'INVALID_ORDER_SCHEMA');

console.log('\nstate sufficiency - missing evidence defers, never approves');
r = evaluateOrder({ order: order(), state: { per_account: {} }, config: CFG });
t('empty snapshot defers', r.decision === 'DEFER' && r.code === 'SNAPSHOT_INCOMPLETE');
const stale = Object.assign({}, STATE, { observed_at: new Date(Date.now() - 600000).toISOString() });
r = evaluateOrder({ order: order(), state: stale, config: CFG });
t('stale snapshot defers', r.decision === 'DEFER' && r.code === 'STALE_MARKET_DATA');
const partial = JSON.parse(JSON.stringify(STATE));
partial.per_account.account_2_cash.positions_error = 'timeout';
r = evaluateOrder({ order: order(), state: partial, config: CFG });
t('incomplete account defers', r.decision === 'DEFER' && r.code === 'EXPOSURE_UNKNOWN');
t('defer is not deny', r.decision !== 'DENY');

console.log('\ncapital budget - SURVIVOR owns the number, not the broker');
r = evaluateOrder({ order: order(), state: STATE, config: { configured_capital_budget_usd: 0 } });
t('unconfigured budget authorises nothing', r.decision === 'DENY' && r.code === 'CAPITAL_BUDGET_EXCEEDED');
r = evaluateOrder({ order: order({ notional_usd: 3000 }), state: STATE, config: CFG });
t('single order ceiling enforced', r.code === 'SINGLE_ORDER_LIMIT_EXCEEDED');
r = evaluateOrder({ order: order({ notional_usd: 1000 }), state: STATE, config: CFG, deployed_usd: 9500 });
t('cumulative budget enforced', r.code === 'CAPITAL_BUDGET_EXCEEDED');

console.log('\n  the negative buying power case');
r = evaluateOrder({ order: order({ notional_usd: 500 }), state: STATE, config: CFG });
t('empty agentic account can still trade within budget', r.decision === 'ALLOW');
t('broker buying_power of -196.6 did not block it', r.decision === 'ALLOW');
t('and did not authorise it either - budget did', r.budget_remaining_usd === 9500);

console.log('\nexposure - measured against budget, not portfolio value');
r = evaluateOrder({ order: order({ notional_usd: 2000 }), state: STATE, config: CFG });
t('first position is not 100% concentration', r.decision === 'ALLOW');
t('symbol cap is 20% of budget', r.symbol_cap_usd === 2000);
r = evaluateOrder({ order: order({ notional_usd: 2001 }), state: STATE,
                    config: Object.assign({}, CFG, { single_order_ceiling_usd: 5000 }) });
t('exceeding the symbol cap denied', r.code === 'SYMBOL_CONCENTRATION_EXCEEDED');

console.log('\n  cross-account exposure aggregates');
const held = JSON.parse(JSON.stringify(STATE));
held.aggregate.symbol_exposure = { NVDA: { total_quantity: 10, total_value: 1800,
  accounts: ['account_1_margin', 'account_2_cash'] } };
r = evaluateOrder({ order: order({ notional_usd: 500 }), state: held,
                    config: Object.assign({}, CFG, { single_order_ceiling_usd: 5000 }) });
t('existing exposure elsewhere counts', r.code === 'SYMBOL_CONCENTRATION_EXCEEDED');
t('detail names the accounts', /2 accounts/.test(r.detail));

console.log('\nvelocity - temporary breaches throttle, not deny');
const recent = [];
for (let i = 0; i < 6; i++) recent.push({ at: Date.now() - 60000, symbol: 'AAPL', notional_usd: 100 });
r = evaluateOrder({ order: order(), state: STATE, config: CFG, history: recent });
t('order rate throttles', r.decision === 'THROTTLE' && r.code === 'ORDER_RATE_EXCEEDED');
t('throttle is not deny', r.decision !== 'DENY');
r = evaluateOrder({ order: order(), state: STATE, config: CFG,
                    history: [{ at: Date.now() - 30000, symbol: 'NVDA', notional_usd: 100 }] });
t('symbol cooldown throttles', r.code === 'SYMBOL_COOLDOWN_ACTIVE');
r = evaluateOrder({ order: order({ notional_usd: 1000 }), state: STATE, config: CFG,
                    history: [{ at: Date.now() - 60000, symbol: 'AAPL', notional_usd: 4500 }] });
t('notional rate throttles', r.code === 'NOTIONAL_RATE_EXCEEDED');

console.log('\nreceipt honesty');
r = evaluateOrder({ order: order(), state: STATE, config: CFG });
t('allow is not enforced', r.enforced === false);
t('correlation declared uncalibrated', r.correlation_policy === 'NOT_CALIBRATED');
t('allow does not claim broker feasibility', /does not assert/.test(r.note));
t('all gates recorded', r.gates_evaluated.length === GATES.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
