/* Equity surface collector.
 *
 * Records what the Robinhood equity surface showed at a point in time. Nothing here
 * decides what to trade or scores an opportunity - it builds the observation base that any
 * later calibration would need, and that does not exist yet.
 *
 * Read-only. Observation tools only. No review, no orders.
 *
 * Design notes:
 * - append-only JSONL, one snapshot per line, so a partial run leaves usable data
 * - every record carries observed_at and the session state, because a quote after hours
 *   means something different from the same quote at 10am
 * - identifiers are not recorded; this is market data, not account data
 */

const fs = require('fs');
const path = require('path');
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');

const OUT_DIR = process.env.COLLECTOR_DIR || path.join(process.env.HOME, '.survivor-equity-data');
const UNIVERSE = (process.env.COLLECTOR_SYMBOLS ||
  'AAPL,MSFT,NVDA,TSLA,AMD,META,GOOGL,AMZN,SPY,QQQ').split(',');

/* Which session are we in? A snapshot without this is uninterpretable later. */
function sessionState(now) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6) return 'WEEKEND';
  if (mins < 4 * 60) return 'CLOSED';
  if (mins < 9 * 60 + 30) return 'PREMARKET';
  if (mins < 16 * 60) return 'REGULAR';
  if (mins < 20 * 60) return 'AFTERHOURS';
  return 'CLOSED';
}

function append(file, record) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(path.join(OUT_DIR, file), JSON.stringify(record) + '\n');
}

(async () => {
  const started = new Date();
  const session = sessionState(started);
  console.log('Equity surface collector | ' + started.toISOString() + ' | session ' + session);
  console.log('universe: ' + UNIVERSE.join(', '));
  console.log('output:   ' + OUT_DIR + '\n');

  const auth = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(auth);
  await client.initialize();

  async function read(tool, args) {
    const t0 = Date.now();
    const { result } = await client.callTool(tool, args || {});
    const raw = result && result.content && result.content[0] && result.content[0].text;
    let p = null, parseError = null;
    /* Do not swallow this. A parse failure that returns null looks identical to an empty
       result, and the collector would write zero rows while reporting success - the same
       shape of silent failure the quota incident turned on. */
    try { p = JSON.parse(raw); }
    catch (e) { parseError = e.message; console.log('    [parse failed] ' + tool + ': ' +
                 e.message.slice(0,60) + ' | raw starts: ' + String(raw).slice(0,80)); }
    return { p, ms: Date.now() - t0, parseError, raw };
  }

  const stamp = { observed_at: started.toISOString(), session: session };
  let wrote = 0;

  /* Quotes - the spread is the closest thing to an execution-cost observation we get. */
  try {
    const { p, ms } = await read('get_equity_quotes', { symbols: UNIVERSE });
    const results = (p && p.data && p.data.results) || [];
    results.forEach(r => {
      const q = r.quote || r;
      const bid = parseFloat(q.bid_price), ask = parseFloat(q.ask_price);
      append('quotes.jsonl', Object.assign({}, stamp, {
        symbol: q.symbol,
        last_trade_price: q.last_trade_price,
        last_non_reg_trade_price: q.last_non_reg_trade_price,
        bid_price: q.bid_price, ask_price: q.ask_price,
        spread_abs: isFinite(bid) && isFinite(ask) ? +(ask - bid).toFixed(4) : null,
        spread_bps: isFinite(bid) && isFinite(ask) && ask > 0
          ? +(((ask - bid) / ask) * 10000).toFixed(2) : null,
        previous_close: q.previous_close,
        venue_bid_time: q.venue_bid_time, venue_ask_time: q.venue_ask_time,
        state: q.state, read_ms: ms,
      }));
      wrote++;
    });
    console.log('  quotes          ' + results.length + '  ' + ms + 'ms');
  } catch (e) { console.log('  quotes          FAILED ' + e.message.slice(0,60)); }

  /* Book depth - size at each level, which spread alone does not capture. */
  try {
    /* The book tool caps at 4 symbols per call and says so in plain text - which was
       invisible for three runs because the parse failure was swallowed. */
    const books = [];
    let ms = 0;
    for (let i = 0; i < UNIVERSE.length; i += 4) {
      const batch = UNIVERSE.slice(i, i + 4);
      const r0 = await read('get_equity_price_book', { symbols: batch });
      ms += r0.ms;
      const got = (r0.p && r0.p.data && r0.p.data.books) || [];
      if (!got.length) console.log('    [book empty] ' + batch.join(',') + ' | ' +
        String(r0.raw).slice(0, 100));
      got.forEach(b => books.push(b));
    }
    books.forEach(b => {
      const depth = (side) => (b[side] || []).slice(0, 5).map(l => ({
        price: l.price, quantity: l.quantity }));
      const total = (side) => (b[side] || []).reduce((s, l) => s + (l.quantity || 0), 0);
      append('books.jsonl', Object.assign({}, stamp, {
        symbol: b.symbol, updated_at: b.updated_at,
        top_bids: depth('bids'), top_asks: depth('asks'),
        total_bid_size: total('bids'), total_ask_size: total('asks'),
        bid_levels: (b.bids || []).length, ask_levels: (b.asks || []).length,
        read_ms: ms,
      }));
      wrote++;
    });
    console.log('  books           ' + books.length + '  ' + ms + 'ms');
  } catch (e) { console.log('  books           FAILED ' + e.message.slice(0,60)); }

  /* Minute bars since the last run, so history accumulates rather than being re-fetched. */
  /* bounds defaults to "regular", so a 2-hour window after 4pm ET returns nothing. Reach
     back far enough to cover the last session, and ask for extended bounds so pre and post
     market activity is captured too - that is a real condition, not noise. */
  const since = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  try {
    const { p, ms } = await read('get_equity_historicals',
      { symbols: UNIVERSE, start_time: since, interval: 'minute', bounds: 'extended' });
    const results = (p && p.data && p.data.results) || [];
    let bars = 0;
    results.forEach(r => {
      /* Skip interpolated bars: the guide says they are gap-fill carrying no new
         information, and recording them would pollute any later measurement. */
      const list = (r.bars || r.historicals || []).filter(b => b.interpolated !== true);
      list.forEach(b => { append('bars_minute.jsonl', Object.assign({}, stamp, {
        symbol: r.symbol || r.instrument_symbol,
        interval: r.interval, bounds: r.bounds, bar: b })); bars++; });
    });
    console.log('  minute bars     ' + bars + '  ' + ms + 'ms');
    wrote += bars;
  } catch (e) { console.log('  minute bars     FAILED ' + e.message.slice(0,60)); }

  /* Fundamentals change slowly; recorded so a later analysis can control for them. */
  try {
    const { p, ms } = await read('get_equity_fundamentals', { symbols: UNIVERSE });
    const results = (p && p.data && p.data.results) || [];
    results.forEach(r => { append('fundamentals.jsonl', Object.assign({}, stamp, r)); wrote++; });
    console.log('  fundamentals    ' + results.length + '  ' + ms + 'ms');
  } catch (e) { console.log('  fundamentals    FAILED ' + e.message.slice(0,60)); }

  auth.discard();
  console.log('\n' + wrote + ' records written. No review, no orders, nothing executed.');
  console.log('run again later to accumulate history.');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
