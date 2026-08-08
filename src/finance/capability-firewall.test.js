const { checkToolCall, guardedCall, auditToolList } = require('./capability-firewall');
let pass = 0, fail = 0;
function t(name, cond) { cond ? (pass++, console.log('  ok  ' + name)) : (fail++, console.log('  FAIL ' + name)); }

console.log('\nobservation tools allowed');
['get_portfolio','get_positions','get_pnl','get_orders','get_quote'].forEach(n =>
  t(n, checkToolCall(n).decision === 'ALLOW'));

console.log('\norder placement denied');
['place_equity_order','place_option_order'].forEach(n => {
  const r = checkToolCall(n);
  t(n + ' denied', r.decision === 'DENY');
  t(n + ' reason', r.reason === 'PHASE_0_MUTATION_DISABLED');
});

console.log('\nmutations denied');
['cancel_equity_order','replace_equity_order','create_watchlist','add_to_watchlist'].forEach(n =>
  t(n, checkToolCall(n).decision === 'DENY'));

console.log('\nreview_* denied pending classification');
['review_equity_order','review_option_order'].forEach(n => {
  const r = checkToolCall(n);
  t(n + ' denied', r.decision === 'DENY');
  t(n + ' pending', r.reason === 'PHASE_0_PENDING_CLASSIFICATION');
});

console.log('\nunknown tools default deny');
['some_future_tool','',null,undefined,'get_portfolio_but_actually_places_orders'].forEach(n =>
  t(String(n) + ' denied', checkToolCall(n).decision === 'DENY'));

console.log('\nno forbidden call reaches the transport');
(async () => {
  let reached = [];
  const transport = async (n) => { reached.push(n); return { ok: true }; };
  for (const n of ['place_equity_order','cancel_equity_order','review_equity_order','unknown_tool']) {
    try { await guardedCall(transport, n, {}); t(n + ' should have thrown', false); }
    catch (e) { t(n + ' blocked before transport', !!e.receipt && e.receipt.decision === 'DENY'); }
  }
  t('transport never invoked for forbidden tools', reached.length === 0);

  const ok = await guardedCall(transport, 'get_portfolio', {});
  t('allowed tool reaches transport', reached.length === 1 && reached[0] === 'get_portfolio');
  t('allowed call carries a receipt', ok.receipt.decision === 'ALLOW' && ok.receipt.executed === true);

  console.log('\naudit surfaces unclassified tools');
  const a = auditToolList(['get_portfolio','place_equity_order','review_equity_order','brand_new_tool']);
  t('unclassified surfaced', a.unclassified.length === 1 && a.unclassified[0] === 'brand_new_tool');
  t('default deny asserted', a.all_unclassified_default_deny === true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
