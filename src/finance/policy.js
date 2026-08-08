/* Phase 1A - finance policy semantics.
 *
 * Answers one question: an agent CAN request this financial action; should the control
 * plane admit it?
 *
 * Three concepts stay separate and must never collapse into each other:
 *
 *     BROKER CAPABILITY     what the account can technically transact
 *     SURVIVOR AUTHORISATION what capital this agent has been permitted to deploy
 *     PORTFOLIO ECONOMICS   what the resulting position would look like
 *
 * Robinhood's buying_power answers the first. It is telemetry, never the budget. Phase 0
 * observed buying_power = -196.6 against a cash balance of -49.15 - margin leverage applied
 * to a negative balance. A policy deriving its budget from that inherits the broker's
 * leverage and the broker's sign errors.
 */

const POLICY_MODEL = 'survivor-finance-policy-v1a';

/* Gate order matters. Impossible actions never reach risk evaluation; unmeasurable state
   never produces a confident answer. */
const GATES = ['STRUCTURAL', 'STATE_SUFFICIENCY', 'CAPITAL_BUDGET', 'EXPOSURE', 'VELOCITY'];

const DEFAULTS = {
  configured_capital_budget_usd: 0,     // must be set explicitly; 0 authorises nothing
  single_order_ceiling_usd: 0,
  max_symbol_fraction_of_budget: 0.20,
  max_asset_class_fraction_of_budget: 0.50,
  max_orders_per_hour: 6,
  max_notional_per_hour_usd: 0,
  symbol_cooldown_seconds: 300,
  max_state_age_seconds: 120,
};

function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[$,]/g, ''));
    return isFinite(n) ? n : null;
  }
  return null;
}

/* 1. STRUCTURAL - can this action exist at all? No risk judgment involved. */
function gateStructural(order, state) {
  const fail = (code, detail) => ({ gate: 'STRUCTURAL', decision: 'DENY',
    category: 'STRUCTURAL_INVALID', code, detail });

  if (!order || typeof order !== 'object') return fail('INVALID_ORDER_SCHEMA', 'no order');
  if (!order.account_alias) return fail('INVALID_ORDER_SCHEMA', 'no account specified');
  if (!order.symbol) return fail('INSTRUMENT_UNRESOLVED', 'no symbol');
  if (!order.side || ['buy', 'sell'].indexOf(order.side) === -1)
    return fail('INVALID_ORDER_SCHEMA', 'side must be buy or sell');
  const notional = num(order.notional_usd);
  if (notional === null || notional <= 0)
    return fail('INVALID_ORDER_SCHEMA', 'notional must be a positive number');

  /* If NO accounts were observed, the account cannot be said to be missing - we simply
     could not see. That is a state problem, and reporting it as ACCOUNT_NOT_FOUND would
     tell an agent its account had vanished. Defer to the state gate. */
  const observed = (state && state.per_account) ? Object.keys(state.per_account) : [];
  if (!observed.length) return { gate: 'STRUCTURAL', decision: 'PASS',
    note: 'account existence not determinable - no accounts observed; deferred to state gate' };

  const acct = state.per_account[order.account_alias];
  if (!acct) return fail('ACCOUNT_NOT_FOUND', order.account_alias);
  if (acct.state && acct.state !== 'active') return fail('ACCOUNT_INACTIVE', acct.state);
  /* Robinhood's own boundary. An order against an account it has not marked agentic is
     impossible, not merely unwise - no risk question arises. */
  if (acct.agentic_allowed !== true) return fail('ACCOUNT_NOT_AGENTIC', order.account_alias);

  return { gate: 'STRUCTURAL', decision: 'PASS' };
}

/* 2. STATE SUFFICIENCY - is the evidence present, fresh and interpretable?
   A missing observation must not be scored as a favourable one. */
function gateStateSufficiency(order, state, cfg) {
  const defer = (code, detail) => ({ gate: 'STATE_SUFFICIENCY', decision: 'DEFER',
    category: 'STATE_INSUFFICIENT', code, detail });

  if (!state || !state.per_account) return defer('SNAPSHOT_INCOMPLETE', 'no account snapshot');
  const accounts = Object.keys(state.per_account);
  if (!accounts.length) return defer('SNAPSHOT_INCOMPLETE', 'no accounts observed');

  if (state.observed_at) {
    const age = (Date.now() - new Date(state.observed_at).getTime()) / 1000;
    if (age > (cfg.max_state_age_seconds || DEFAULTS.max_state_age_seconds))
      return defer('STALE_MARKET_DATA', Math.round(age) + 's old');
  } else {
    return defer('SNAPSHOT_INCOMPLETE', 'snapshot carries no timestamp');
  }

  /* Every account must have contributed exposure data, or aggregate exposure is unknown -
     and an unknown aggregate cannot support a concentration decision. */
  const missing = accounts.filter(a => {
    const e = state.per_account[a];
    return !e || e.positions === undefined || e.portfolio_error || e.positions_error;
  });
  if (missing.length) return defer('EXPOSURE_UNKNOWN', missing.length + ' account(s) incomplete');

  return { gate: 'STATE_SUFFICIENCY', decision: 'PASS' };
}

/* 3. CAPITAL BUDGET - SURVIVOR's number, never the broker's.
   Broker feasibility is reported separately and never expands the budget. */
function gateCapitalBudget(order, state, cfg, deployed) {
  const budget = num(cfg.configured_capital_budget_usd) || 0;
  const notional = num(order.notional_usd);
  const ceiling = num(cfg.single_order_ceiling_usd) || 0;
  const used = num(deployed) || 0;
  const deny = (code, detail) => ({ gate: 'CAPITAL_BUDGET', decision: 'DENY',
    category: 'POLICY_BREACH', code, detail });

  if (budget <= 0) return deny('CAPITAL_BUDGET_EXCEEDED',
    'no capital budget configured - nothing is authorised by default');
  if (ceiling > 0 && notional > ceiling)
    return deny('SINGLE_ORDER_LIMIT_EXCEEDED', '$' + notional + ' exceeds ceiling $' + ceiling);
  if (used + notional > budget)
    return deny('CAPITAL_BUDGET_EXCEEDED',
      '$' + notional + ' would take deployed capital to $' + (used + notional) + ' of $' + budget);

  return { gate: 'CAPITAL_BUDGET', decision: 'PASS',
           budget_remaining_usd: budget - used - notional };
}

/* 4. EXPOSURE - measured against the AUTHORISED BUDGET, not against portfolio value.
   An empty account opening its first position is not "100% concentrated"; it has deployed
   a fraction of what it was permitted to deploy. Dividing by a portfolio worth zero, or
   worth -49.15, produces a number that means nothing. */
function gateExposure(order, state, cfg) {
  const budget = num(cfg.configured_capital_budget_usd) || 0;
  const notional = num(order.notional_usd);
  const deny = (code, detail) => ({ gate: 'EXPOSURE', decision: 'DENY',
    category: 'POLICY_BREACH', code, detail });

  const existing = (state.aggregate && state.aggregate.symbol_exposure &&
                    state.aggregate.symbol_exposure[order.symbol]) || null;
  const existingValue = existing ? (num(existing.total_value) || 0) : 0;
  const postTrade = order.side === 'buy' ? existingValue + notional : existingValue - notional;

  const symbolCap = budget * (cfg.max_symbol_fraction_of_budget ?? DEFAULTS.max_symbol_fraction_of_budget);
  if (order.side === 'buy' && postTrade > symbolCap) {
    return deny('SYMBOL_CONCENTRATION_EXCEEDED',
      order.symbol + ' post-trade $' + postTrade.toFixed(2) + ' exceeds cap $' + symbolCap.toFixed(2) +
      (existing && existing.accounts && existing.accounts.length > 1
        ? ' (held across ' + existing.accounts.length + ' accounts)' : ''));
  }

  return {
    gate: 'EXPOSURE', decision: 'PASS',
    symbol_exposure_post_trade_usd: postTrade,
    symbol_cap_usd: symbolCap,
    held_in_accounts: existing ? existing.accounts : [],
    /* Reserved and deliberately not evaluated. Correlation needs a return interval,
       lookback, data source, minimum observations, ETF and factor treatment, options
       nonlinearity and regime handling. Producing a number without those would be the
       error phase 0 spent all day avoiding. */
    correlation_policy: 'NOT_CALIBRATED',
  };
}

/* 5. VELOCITY - temporary breaches THROTTLE rather than DENY. Waiting resolves them. */
function gateVelocity(order, cfg, history) {
  const now = Date.now();
  const recent = (history || []).filter(h => now - h.at < 3600000);
  const throttle = (code, detail) => ({ gate: 'VELOCITY', decision: 'THROTTLE',
    category: 'VELOCITY_LIMIT', code, detail });

  const maxOrders = cfg.max_orders_per_hour ?? DEFAULTS.max_orders_per_hour;
  if (recent.length >= maxOrders)
    return throttle('ORDER_RATE_EXCEEDED', recent.length + ' orders in the last hour, limit ' + maxOrders);

  const maxNotional = num(cfg.max_notional_per_hour_usd) || 0;
  if (maxNotional > 0) {
    const spent = recent.reduce((s, h) => s + (num(h.notional_usd) || 0), 0);
    if (spent + num(order.notional_usd) > maxNotional)
      return throttle('NOTIONAL_RATE_EXCEEDED', '$' + spent + ' deployed this hour, limit $' + maxNotional);
  }

  const cooldown = cfg.symbol_cooldown_seconds ?? DEFAULTS.symbol_cooldown_seconds;
  const lastSame = recent.filter(h => h.symbol === order.symbol).sort((a, b) => b.at - a.at)[0];
  if (lastSame && (now - lastSame.at) / 1000 < cooldown)
    return throttle('SYMBOL_COOLDOWN_ACTIVE',
      order.symbol + ' traded ' + Math.round((now - lastSame.at) / 1000) + 's ago, cooldown ' + cooldown + 's');

  return { gate: 'VELOCITY', decision: 'PASS' };
}

function evaluateOrder({ order, state, config, deployed_usd, history }) {
  const cfg = Object.assign({}, DEFAULTS, config || {});
  const evaluated = [];
  const at = new Date().toISOString();

  const run = [
    () => gateStructural(order, state),
    () => gateStateSufficiency(order, state, cfg),
    () => gateCapitalBudget(order, state, cfg, deployed_usd),
    () => gateExposure(order, state, cfg),
    () => gateVelocity(order, cfg, history),
  ];

  for (const g of run) {
    const r = g();
    evaluated.push(r);
    if (r.decision !== 'PASS') {
      return {
        receipt_type: 'survivor.finance.policy.decision',
        model_version: POLICY_MODEL,
        evaluated_at: at,
        decision: r.decision,
        category: r.category,
        code: r.code,
        detail: r.detail,
        failed_gate: r.gate,
        gates_evaluated: evaluated.map(e => e.gate),
        gates_not_reached: GATES.slice(evaluated.length),
        enforced: false,
        order_summary: { symbol: order && order.symbol, side: order && order.side,
                         notional_usd: order && order.notional_usd,
                         account: order && order.account_alias },
      };
    }
  }

  const exposure = evaluated.find(e => e.gate === 'EXPOSURE');
  const capital = evaluated.find(e => e.gate === 'CAPITAL_BUDGET');
  return {
    receipt_type: 'survivor.finance.policy.decision',
    model_version: POLICY_MODEL,
    evaluated_at: at,
    decision: 'ALLOW',
    gates_evaluated: GATES,
    gates_not_reached: [],
    budget_remaining_usd: capital.budget_remaining_usd,
    symbol_exposure_post_trade_usd: exposure.symbol_exposure_post_trade_usd,
    symbol_cap_usd: exposure.symbol_cap_usd,
    correlation_policy: exposure.correlation_policy,
    enforced: false,
    note: 'Shadow decision. Nothing is executed. Broker feasibility is a separate question ' +
          'and this ALLOW does not assert the order would succeed at Robinhood.',
    order_summary: { symbol: order.symbol, side: order.side,
                     notional_usd: order.notional_usd, account: order.account_alias },
  };
}

module.exports = { evaluateOrder, DEFAULTS, GATES, POLICY_MODEL,
                   gateStructural, gateStateSufficiency, gateCapitalBudget, gateExposure, gateVelocity };
