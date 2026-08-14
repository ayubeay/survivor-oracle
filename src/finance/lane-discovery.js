/* Discovery: what markets, instruments and data does Robinhood actually expose to an
 * agent? Read-only, through the firewall. Establishes which strategy lanes are possible
 * rather than assuming an equities-only path or that a Solana strategy transfers.
 */
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');

(async () => {
  console.log('Robinhood lane discovery. Read-only, no orders.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  const init = await client.initialize();
  const tools = await client.listTools();

  /* Group the surface by what asset class each tool serves - that is the lane question. */
  const lanes = { equity: [], option: [], index: [], crypto: [], other: [] };
  tools.forEach(t => {
    const n = t.name;
    if (/crypto|coin|btc|eth|sol/i.test(n)) lanes.crypto.push(n);
    else if (/equity/.test(n)) lanes.equity.push(n);
    else if (/option/.test(n)) lanes.option.push(n);
    else if (/index/.test(n)) lanes.index.push(n);
    else lanes.other.push(n);
  });

  console.log('=== instrument surface ===');
  Object.keys(lanes).forEach(k => {
    console.log('  ' + k.padEnd(8) + lanes[k].length + '  ' + lanes[k].slice(0,6).join(', ') +
                (lanes[k].length > 6 ? ' ...' : ''));
  });

  /* Does search resolve non-equity instruments? That is the cheapest test of whether a
     crypto lane exists at all. */
  console.log('\n=== does search reach beyond equities? ===');
  for (const q of ['SOL', 'bitcoin', 'AAPL']) {
    try {
      const { result } = await client.callTool('search', { query: q });
      const raw = result && result.content && result.content[0] && result.content[0].text;
      const txt = (raw || '').slice(0, 160).replace(/\s+/g, ' ');
      console.log('  ' + q.padEnd(10) + txt);
    } catch (e) { console.log('  ' + q.padEnd(10) + 'FAILED ' + e.message.slice(0,80)); }
  }

  /* Market-data depth per lane determines what a strategy can even see. */
  console.log('\n=== market data schemas ===');
  ['get_equity_quotes','get_equity_price_book','get_equity_fundamentals',
   'get_equity_historicals','get_equity_technical_indicators'].forEach(n => {
    const t = tools.filter(x => x.name === n)[0];
    if (!t) return;
    const s = t.inputSchema || {};
    console.log('  ' + n.padEnd(32) + 'required ' + JSON.stringify(s.required || []) +
                '  props ' + Object.keys(s.properties || {}).join(',').slice(0,90));
  });

  console.log('\n=== market data available for an equity ===');
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  for (const [tool, args] of [
    ['get_equity_quotes', { symbols: ['AAPL'] }],
    ['get_equity_price_book', { symbols: ['AAPL'] }],
    ['get_equity_fundamentals', { symbols: ['AAPL'] }],
    ['get_equity_historicals', { symbols: ['AAPL'], start_time: dayAgo, interval: '5minute' }],
    ['get_equity_technical_indicators', { symbol: 'AAPL', type: 'rsi', interval: '5minute', start_time: dayAgo }],
    ['get_scanner_filter_specs', {}],
  ]) {
    try {
      const { result } = await client.callTool(tool, args);
      const raw = result && result.content && result.content[0] && result.content[0].text;
      let keys = 'n/a';
      try { const p = JSON.parse(raw); keys = Object.keys(p.data || p).join(', ').slice(0,140); }
      catch (e) { keys = (raw||'').slice(0,100); }
      console.log('  ' + tool.padEnd(26) + keys);
    } catch (e) { console.log('  ' + tool.padEnd(26) + 'FAILED ' + e.message.slice(0,70)); }
  }

  /* The order schemas we never captured - what parameters, and what review returns. */
  console.log('\n=== order schemas ===');
  ['review_equity_order','place_equity_order','review_option_order'].forEach(n => {
    const t = tools.filter(x => x.name === n)[0];
    if (!t) { console.log('  ' + n + ' not present'); return; }
    const s = t.inputSchema || {};
    console.log('  ' + n);
    console.log('    required: ' + JSON.stringify(s.required || []));
    console.log('    props:    ' + Object.keys(s.properties || {}).join(', ').slice(0,200));
    console.log('    desc:     ' + (t.description || '').slice(0, 200));
  });

  /* Full account object - the earlier pass only printed fields I had guessed at, so any
     crypto or capability flags would have been invisible. */
  console.log('\n=== full account object, identifiers redacted ===');
  try {
    const { result } = await client.callTool('get_accounts', {});
    const raw = result && result.content && result.content[0] && result.content[0].text;
    const p = JSON.parse(raw);
    const accts = (p.data && p.data.accounts) || [];
    accts.forEach(a => {
      const shown = {};
      Object.keys(a).forEach(k => {
        shown[k] = /account_number|_id$/.test(k) ? '[REDACTED]' : a[k];
      });
      console.log('  ' + JSON.stringify(shown));
    });
  } catch (e) { console.log('  FAILED ' + e.message.slice(0,90)); }

  session.discard();
  console.log('\n[auth] token discarded. No orders, no review calls, nothing executed.');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
