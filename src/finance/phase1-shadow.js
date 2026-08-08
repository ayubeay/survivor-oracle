/* Phase 1B - shadow control plane against live state.
 *
 * Real broker state enters SURVIVOR. Synthetic financial actions are evaluated locally
 * against deterministic policy. Every capital-moving broker capability stays inaccessible.
 *
 * The proposals are SYNTHETIC and never leave this process. Nothing is sent to Robinhood
 * beyond the observation reads the capability firewall already permits - no review, no
 * place, no cancel. The receipts say so explicitly so nobody later mistakes a shadow
 * decision for a submitted order.
 */

const crypto = require('crypto');
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');
const { evaluateOrder } = require('./policy');

/* Config drives the expectations, not the other way round. If a case does not produce the
   expected decision, the finding is a mismatch - not a reason to adjust the numbers. */
const CONFIG = {
  configured_capital_budget_usd: 10000,
  single_order_ceiling_usd: 2500,
  max_symbol_fraction_of_budget: 0.20,
  max_orders_per_hour: 3,
  max_notional_per_hour_usd: 5000,
  symbol_cooldown_seconds: 0,      // isolate the order-rate limit from the cooldown
  max_state_age_seconds: 120,
};

function num(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isFinite(n) ? n : null;
}

/* Deterministic fingerprint of the normalised snapshot. Every decision in this run points
   at the same state_snapshot_id, so the run is replayable against the same evidence. */
function fingerprint(state) {
  const canonical = JSON.stringify(state, Object.keys(state).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

(async () => {
  console.log('SURVIVOR Phase 1B - shadow control plane. Live state, synthetic proposals.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  await client.initialize();

  async function read(tool, args) {
    const { result } = await client.callTool(tool, args || {});
    const raw = result && result.content && result.content[0] && result.content[0].text;
    if (!raw) return result;
    try { return JSON.parse(raw); } catch (e) { return { _text: raw }; }
  }

  const acctPayload = await read('get_accounts');
  const accounts = (acctPayload && acctPayload.data && acctPayload.data.accounts) || [];

  const perAccount = {};
  const symbolExposure = {};
  const aliasOf = {};

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const name = a.agentic_allowed ? 'agentic_account' : 'account_' + (i + 1) + '_' + (a.type || 'unknown');
    aliasOf[name] = a.account_number;
    const entry = { type: a.type || null, agentic_allowed: a.agentic_allowed === true,
                    option_level: a.option_level || null, state: a.state || null };
    try {
      const p = await read('get_portfolio', { account_number: a.account_number });
      const d = (p && p.data) || {};
      entry.portfolio = {
        total_value: num(d.total_value), equity_value: num(d.equity_value),
        cash: num(d.cash), buying_power: d.buying_power ? num(d.buying_power.buying_power) : null,
      };
    } catch (e) { entry.portfolio_error = e.message.slice(0, 80); }
    try {
      const pos = await read('get_equity_positions', { account_number: a.account_number });
      const list = (pos && pos.data && pos.data.positions) || [];
      entry.positions = list.map(p => {
        const sym = p.symbol || p.instrument_symbol || null;
        const val = num(p.market_value || p.equity) || 0;
        if (sym) {
          symbolExposure[sym] = symbolExposure[sym] || { total_value: 0, accounts: [] };
          symbolExposure[sym].total_value += val;
          if (symbolExposure[sym].accounts.indexOf(name) === -1) symbolExposure[sym].accounts.push(name);
        }
        return { symbol: sym, market_value: val };
      });
    } catch (e) { entry.positions_error = e.message.slice(0, 80); }
    perAccount[name] = entry;
  }

  /* Frozen. Every proposal below is evaluated against this exact snapshot. */
  const STATE = { observed_at: new Date().toISOString(), per_account: perAccount,
                  aggregate: { symbol_exposure: symbolExposure } };
  const snapshotId = fingerprint(STATE);

  session.discard();
  console.log('[state] ' + Object.keys(perAccount).length + ' accounts, snapshot ' + snapshotId);
  console.log('[auth] token discarded - all evaluation below is local\n');

  const agentic = Object.keys(perAccount).find(k => perAccount[k].agentic_allowed);
  const nonAgentic = Object.keys(perAccount).find(k => !perAccount[k].agentic_allowed);

  /* Expectations derive from CONFIG, not from convenient numbers. */
  const withinLimits = Math.min(CONFIG.single_order_ceiling_usd,
                                CONFIG.configured_capital_budget_usd * CONFIG.max_symbol_fraction_of_budget) / 2;
  const aboveCeiling = CONFIG.single_order_ceiling_usd + 1;

  const staleState = Object.assign({}, STATE,
    { observed_at: new Date(Date.now() - (CONFIG.max_state_age_seconds + 60) * 1000).toISOString() });

  const cases = [
    { label: 'within all limits', expect: 'ALLOW',
      order: { account_alias: agentic, symbol: 'NVDA', side: 'buy', notional_usd: withinLimits },
      state: STATE },
    { label: 'non-agentic account', expect: 'DENY',
      order: { account_alias: nonAgentic, symbol: 'NVDA', side: 'buy', notional_usd: withinLimits },
      state: STATE },
    { label: 'above single-order ceiling', expect: 'DENY',
      order: { account_alias: agentic, symbol: 'NVDA', side: 'buy', notional_usd: aboveCeiling },
      state: STATE },
    { label: 'stale state', expect: 'DEFER',
      order: { account_alias: agentic, symbol: 'NVDA', side: 'buy', notional_usd: withinLimits },
      state: staleState },
  ];

  const receipts = [];
  const ledger = [];   // local velocity ledger, synthetic timestamps only

  function decide(c, history) {
    const r = evaluateOrder({ order: c.order, state: c.state, config: CONFIG,
                              deployed_usd: 0, history: history || [] });
    const receipt = Object.assign({}, r, {
      state_snapshot_id: snapshotId,
      state_source: 'ROBINHOOD_LIVE_READ',
      proposal_source: 'SYNTHETIC_LOCAL',
      broker_execution_attempted: false,
      broker_simulation_attempted: false,
      capital_movement: false,
    });
    receipts.push(receipt);
    const match = r.decision === c.expect ? 'as expected' : 'UNEXPECTED, expected ' + c.expect;
    console.log('  ' + c.label.padEnd(30) + r.decision.padEnd(9) +
                (r.code || '').padEnd(32) + match);
    return r;
  }

  console.log('=== synthetic proposals against live state ===\n');
  cases.forEach(c => decide(c));

  console.log('\n  velocity - repeated valid proposals, synthetic timestamps');
  for (let i = 0; i < CONFIG.max_orders_per_hour + 1; i++) {
    const c = { label: '  proposal ' + (i + 1), expect: i < CONFIG.max_orders_per_hour ? 'ALLOW' : 'THROTTLE',
                order: { account_alias: agentic, symbol: 'NVDA', side: 'buy', notional_usd: withinLimits },
                state: STATE };
    const r = decide(c, ledger.slice());
    if (r.decision === 'ALLOW') ledger.push({ at: Date.now() - (i * 1000), symbol: 'NVDA',
                                              notional_usd: withinLimits });
  }

  const decisions = receipts.map(r => r.decision);
  console.log('\n=== run summary ===');
  console.log('snapshot           ', snapshotId);
  console.log('proposals evaluated', receipts.length);
  console.log('decisions          ', ['ALLOW','DENY','DEFER','THROTTLE']
    .map(d => d + ':' + decisions.filter(x => x === d).length).join('  '));
  console.log('vocabulary covered ', ['ALLOW','DENY','DEFER','THROTTLE']
    .every(d => decisions.indexOf(d) !== -1) ? 'all four' : 'INCOMPLETE');
  console.log('broker execution   ', 'NONE');
  console.log('broker simulation  ', 'NONE');
  console.log('capital movement   ', 'NONE');

  console.log('\n=== sample receipt ===');
  console.log(JSON.stringify(receipts[0], null, 2));
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
