const { checkToolCall, guardedCall, auditToolList, classify, CLASS } = require('./capability-firewall');
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));

const LIVE = ['add_option_to_watchlist','add_to_watchlist','cancel_equity_order','cancel_option_exercise',
'cancel_option_order','create_scan','create_watchlist','exercise_option','follow_watchlist','get_accounts',
'get_earnings_calendar','get_earnings_results','get_equity_fundamentals','get_equity_historicals',
'get_equity_orders','get_equity_positions','get_equity_price_book','get_equity_quotes','get_equity_tax_lots',
'get_equity_technical_indicators','get_equity_tradability','get_financials','get_index_historicals',
'get_index_quotes','get_indexes','get_limited_margin_upgrade_info','get_option_chains','get_option_historicals',
'get_option_instruments','get_option_level_upgrade_info','get_option_orders','get_option_positions',
'get_option_quotes','get_option_watchlist','get_pnl_trade_history','get_popular_watchlists','get_portfolio',
'get_realized_pnl','get_scanner_filter_specs','get_scans','get_watchlist_items','get_watchlists',
'place_equity_order','place_option_order','remove_from_watchlist','remove_option_from_watchlist',
'review_equity_order','review_option_order','run_scan','search','unfollow_watchlist','update_scan_config',
'update_scan_filters','update_watchlist'];

console.log('\nevery live tool is classified');
const unclassified = LIVE.filter(n => classify(n) === CLASS.UNKNOWN);
t('54 tools present', LIVE.length === 54);
t('none unclassified', unclassified.length === 0 || console.log('    still unknown:', unclassified.join(', ')));

console.log('\nnothing that moves capital is allowed');
['place_equity_order','place_option_order','cancel_equity_order','cancel_option_order',
 'exercise_option','cancel_option_exercise'].forEach(n =>
  t(n + ' denied', checkToolCall(n).decision === 'DENY'));

console.log('\nmetadata mutation denied in phase 0');
['create_watchlist','update_scan_filters','follow_watchlist','remove_from_watchlist'].forEach(n =>
  t(n + ' denied', checkToolCall(n).decision === 'DENY'));

console.log('\nsimulation: equity review promoted, options review still denied');
/* review_equity_order was promoted 2026-08-14 on Robinhood's stated semantics and verified
   non-executing by before/after order state. review_option_order stays denied - options are
   not permitted on the agentic account. */
let rq = checkToolCall('review_equity_order');
t('review_equity_order allowed', rq.decision === 'ALLOW');
t('by capability-specific promotion', rq.reason === 'CAPABILITY_SPECIFIC_PROMOTION');
let ro = checkToolCall('review_option_order');
t('review_option_order still denied', ro.decision === 'DENY');
t('review_option_order classed SIMULATE', ro.capability_class === CLASS.SIMULATE);

console.log('\nobservation allowed');
['get_accounts','get_portfolio','get_equity_positions','get_realized_pnl','get_equity_quotes',
 'get_equity_historicals','get_equity_technical_indicators','search'].forEach(n =>
  t(n + ' allowed', checkToolCall(n).decision === 'ALLOW'));

console.log('\nunknown tools default deny');
['some_future_tool','place_crypto_order','',null,undefined].forEach(n =>
  t(String(n) + ' denied', checkToolCall(n).decision === 'DENY'));

console.log('\nno denied tool reaches the transport');
(async () => {
  const reached = [];
  const transport = async (n) => { reached.push(n); return { ok: true }; };
  const denied = LIVE.filter(n => checkToolCall(n).decision === 'DENY');
  for (const n of denied) {
    try { await guardedCall(transport, n, {}); t(n + ' should have thrown', false); } catch (e) {}
  }
  t(denied.length + ' denied tools blocked before transport', reached.length === 0);

  const allowed = LIVE.filter(n => checkToolCall(n).decision === 'ALLOW');
  await guardedCall(transport, allowed[0], {});
  t('an allowed tool does reach transport', reached.length === 1);

  console.log('\ncapability surface receipt');
  const a = auditToolList(LIVE, { name: 'robinhood-trading', version: '1.1.1' });
  t('server recorded', a.server === 'robinhood-trading' && a.server_version === '1.1.1');
  t('54 observed', a.tools_observed === 54);
  t('0 unclassified', a.unclassified === 0);
  t('mutation disabled', a.mutation_enabled === false);
  t('credential not persisted', a.credential_persisted === false);
  console.log('    allowed now:', a.allowed_now.length, '| denied now:', a.denied_now.length);

  console.log('\ncapability drift');
  const drifted = auditToolList(LIVE.concat(['place_crypto_order','new_analytics_tool']), {});
  t('new tools surface as unclassified', drifted.unclassified === 2);
  t('and are denied', checkToolCall('place_crypto_order').decision === 'DENY');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
