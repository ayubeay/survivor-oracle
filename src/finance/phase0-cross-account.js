/* Phase 0 cross-account observation.
 *
 * Robinhood already grants a connected agent read access across all accounts. Cross-account
 * VISIBILITY is therefore not SURVIVOR's differentiator - it comes with the token. What a
 * control plane adds is aggregation and deterministic policy over that visibility: a
 * position that looks fine inside one account may violate a portfolio-wide constraint.
 *
 * This pass demonstrates the aggregation. It does NOT evaluate policy - no finance
 * semantics have been calibrated, and a score computed here would measure nothing.
 *
 * Account numbers are used in memory to route calls and never printed or persisted.
 */

const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');

function alias(acct, idx) {
  if (acct.agentic_allowed) return 'agentic_account';
  return 'account_' + (idx + 1) + '_' + (acct.type || 'unknown');
}

function parseAmount(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isFinite(n) ? n : null;
}

(async () => {
  console.log('SURVIVOR Phase 0 - cross-account observation. Reads only.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  await client.initialize();

  async function read(tool, args) {
    const { result } = await client.callTool(tool, args || {});
    const raw = result && result.content && result.content[0] && result.content[0].text;
    if (!raw) return result;
    try { return JSON.parse(raw); } catch (e) { return { _text: raw }; }
  }

  const accountsPayload = await read('get_accounts');
  const accounts = (accountsPayload && accountsPayload.data && accountsPayload.data.accounts) || [];
  console.log('accounts visible: ' + accounts.length + '\n');

  const perAccount = {};
  const symbolExposure = {};

  for (let i = 0; i < accounts.length; i++) {
    const acct = accounts[i];
    const name = alias(acct, i);
    const entry = {
      type: acct.type || null,
      agentic_allowed: acct.agentic_allowed === true,
      option_level: acct.option_level || null,
      state: acct.state || null,
    };

    try {
      const p = await read('get_portfolio', { account_number: acct.account_number });
      const d = (p && p.data) || {};
      entry.portfolio = {
        total_value: parseAmount(d.total_value),
        equity_value: parseAmount(d.equity_value),
        options_value: parseAmount(d.options_value),
        crypto_value: parseAmount(d.crypto_value),
        cash: parseAmount(d.cash),
        pending_deposits: parseAmount(d.pending_deposits),
        buying_power: d.buying_power ? parseAmount(d.buying_power.buying_power) : null,
        unleveraged_buying_power: d.buying_power ? parseAmount(d.buying_power.unleveraged_buying_power) : null,
      };
    } catch (e) { entry.portfolio_error = e.message.slice(0, 100); }

    try {
      const pos = await read('get_equity_positions', { account_number: acct.account_number });
      const list = (pos && pos.data && pos.data.positions) || [];
      entry.positions = list.map(function (p) {
        const sym = p.symbol || p.instrument_symbol || null;
        const qty = parseAmount(p.quantity);
        const val = parseAmount(p.market_value || p.equity);
        if (sym) {
          symbolExposure[sym] = symbolExposure[sym] || { total_quantity: 0, total_value: 0, accounts: [] };
          symbolExposure[sym].total_quantity += (qty || 0);
          symbolExposure[sym].total_value += (val || 0);
          if (symbolExposure[sym].accounts.indexOf(name) === -1) symbolExposure[sym].accounts.push(name);
        }
        return { symbol: sym, quantity: qty, market_value: val };
      });
      entry.position_count = entry.positions.length;
    } catch (e) { entry.positions_error = e.message.slice(0, 100); }

    perAccount[name] = entry;
    console.log('  ' + name.padEnd(26) +
      'value ' + String(entry.portfolio ? entry.portfolio.total_value : '-').padStart(10) +
      '  positions ' + (entry.position_count !== undefined ? entry.position_count : '-'));
  }

  const totals = Object.values(perAccount).reduce(function (acc, e) {
    if (!e.portfolio) return acc;
    ['total_value','equity_value','options_value','crypto_value','cash'].forEach(function (k) {
      if (typeof e.portfolio[k] === 'number') acc[k] = (acc[k] || 0) + e.portfolio[k];
    });
    return acc;
  }, {});

  const overlapping = Object.keys(symbolExposure).filter(function (s) {
    return symbolExposure[s].accounts.length > 1;
  });

  const receipt = {
    receipt_type: 'survivor.robinhood.phase0.cross_account_observation',
    mode: 'PHASE_0_CROSS_ACCOUNT_OBSERVATION',
    observed_at: new Date().toISOString(),
    accounts_visible: accounts.length,
    agentic_accounts: accounts.filter(function (a) { return a.agentic_allowed === true; }).length,
    per_account: perAccount,
    aggregate: {
      totals: totals,
      symbol_exposure: symbolExposure,
      symbols_held_in_multiple_accounts: overlapping,
      overlap_demonstrated: overlapping.length > 0,
      overlap_note: overlapping.length > 0
        ? 'Consolidated exposure computed across accounts.'
        : 'No symbol currently appears in more than one account, so consolidation is ' +
          'structurally demonstrated but not exercised against real overlap. Recorded ' +
          'honestly rather than illustrated with a fabricated example.',
    },
    capital_movement_enabled: false,
    mutation_enabled: false,
    simulation_enabled: false,
    credential_persisted: false,
    policy_evaluation: 'NOT_ACTIVATED',
    policy_evaluation_reason:
      'Finance-specific admissibility semantics are not calibrated. Cross-account read ' +
      'access is granted by Robinhood, not created by SURVIVOR; the contribution would be ' +
      'aggregation plus deterministic policy, and the policy does not exist yet.',
    execution: 'NONE',
  };

  console.log('\n=== cross-account receipt ===');
  console.log(JSON.stringify(receipt, null, 2));

  session.discard();
  console.log('\n[auth] token discarded. Revoke this grant in Robinhood settings when finished.');
  process.exit(0);
})().catch(function (e) { console.error('\nFAILED:', e.message); process.exit(1); });
