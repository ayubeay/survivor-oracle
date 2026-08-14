/* Equity lane characterisation. Read-only, permitted tools only.
 * No review calls - review_* remains PENDING until deliberately promoted.
 */
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');

(async () => {
  console.log('Equity lane characterisation. Read-only.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  await client.initialize();

  async function read(tool, args) {
    const t0 = Date.now();
    const { result } = await client.callTool(tool, args || {});
    const ms = Date.now() - t0;
    const raw = result && result.content && result.content[0] && result.content[0].text;
    let p = null;
    try { p = JSON.parse(raw); } catch (e) { p = { _text: (raw||'').slice(0,200) }; }
    return { p, ms };
  }

  /* The scanner is the closest thing to a built-in candidate source. What can it filter on? */
  console.log('=== scanner filter specs ===');
  try {
    const { p, ms } = await read('get_scanner_filter_specs');
    const specs = (p.data && p.data.filter_specs) || p.filter_specs || [];
    console.log('  ' + specs.length + ' filters, ' + ms + 'ms\n');
    specs.slice(0, 40).forEach(s => {
      const name = s.name || s.type || s.id || JSON.stringify(s).slice(0,40);
      const desc = (s.description || s.label || '').slice(0, 70);
      console.log('    ' + String(name).padEnd(30) + desc);
    });
    if (specs.length > 40) console.log('    ...and ' + (specs.length - 40) + ' more');
  } catch (e) { console.log('  FAILED ' + e.message.slice(0,90)); }

  /* Quote freshness and latency - can a strategy react on this surface at all? */
  console.log('\n=== quote latency and freshness, 3 samples ===');
  for (let i = 0; i < 3; i++) {
    try {
      const { p, ms } = await read('get_equity_quotes', { symbols: ['AAPL','NVDA','TSLA'] });
      const r = (p.data && p.data.results) || [];
      const first = r[0] || {};
      console.log('  ' + String(ms + 'ms').padEnd(8) + Object.keys(first).join(', ').slice(0,120));
      if (i === 0) console.log('    sample: ' + JSON.stringify(first).slice(0, 240));
    } catch (e) { console.log('  FAILED ' + e.message.slice(0,80)); }
    await new Promise(r => setTimeout(r, 1000));
  }

  /* Order-book depth - how much structure is visible? */
  console.log('\n=== price book depth ===');
  try {
    const { p, ms } = await read('get_equity_price_book', { symbols: ['AAPL'] });
    const books = (p.data && p.data.books) || [];
    const b = books[0] || {};
    console.log('  ' + ms + 'ms | keys: ' + Object.keys(b).join(', '));
    console.log('  ' + JSON.stringify(b).slice(0, 320));
  } catch (e) { console.log('  FAILED ' + e.message.slice(0,90)); }

  /* Historical intervals - what horizons can a strategy actually model? */
  console.log('\n=== historical intervals ===');
  const since = new Date(Date.now() - 5*86400000).toISOString();
  for (const interval of ['15second','minute','5minute','10minute','hour','day','week']) {
    try {
      const { p, ms } = await read('get_equity_historicals',
        { symbols: ['AAPL'], start_time: since, interval });
      const r = (p.data && p.data.results) || [];
      const bars = (r[0] && (r[0].historicals || r[0].bars)) || [];
      console.log('  ' + interval.padEnd(10) + String(bars.length).padStart(5) + ' bars  ' + ms + 'ms');
    } catch (e) {
      console.log('  ' + interval.padEnd(10) + 'REJECTED ' + e.message.slice(0,60));
    }
  }

  /* Which indicators exist? */
  console.log('\n=== technical indicators ===');
  for (const type of ['rsi','macd','bollinger_bands','sma','ema','vwap','atr','stochastic']) {
    try {
      const { p, ms } = await read('get_equity_technical_indicators',
        { symbol: 'AAPL', type, interval: '5minute', start_time: since });
      const ind = (p.data && p.data.indicators) || [];
      console.log('  ' + type.padEnd(18) + 'OK  ' + (Array.isArray(ind) ? ind.length + ' points' : 'present') + '  ' + ms + 'ms');
    } catch (e) {
      console.log('  ' + type.padEnd(18) + 'REJECTED ' + e.message.slice(0,55));
    }
  }

  session.discard();
  console.log('\n[auth] token discarded. No review, no orders, nothing executed.');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
