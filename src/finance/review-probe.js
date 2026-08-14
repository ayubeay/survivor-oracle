/* Controlled review probe. ONE review_equity_order call, with order state verified
 * before and after. The point is not to trust Robinhood's description that review does not
 * place - it is to produce evidence that order state did not change.
 */
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');

(async () => {
  console.log('Controlled review probe. One simulation, no placement.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  await client.initialize();

  async function read(tool, args) {
    const { result } = await client.callTool(tool, args || {});
    const raw = result && result.content && result.content[0] && result.content[0].text;
    try { return JSON.parse(raw); } catch (e) { return { _text: (raw||'').slice(0,300) }; }
  }

  const accts = ((await read('get_accounts')).data || {}).accounts || [];
  const agentic = accts.filter(a => a.agentic_allowed === true)[0];
  if (!agentic) { console.log('no agentic account'); process.exit(1); }

  const before = await read('get_equity_orders', { account_number: agentic.account_number });
  const beforeList = (before.data && (before.data.orders || before.data.results)) || [];
  console.log('[before] orders on the agentic account:', beforeList.length);

  console.log('\n=== review_equity_order: buy $1 of AAPL, market ===');
  const rv = await read('review_equity_order', {
    account_number: agentic.account_number,
    symbol: 'AAPL', side: 'buy', type: 'market', dollar_amount: '1.00',
  });
  console.log(JSON.stringify(rv, null, 2).slice(0, 2000));

  const after = await read('get_equity_orders', { account_number: agentic.account_number });
  const afterList = (after.data && (after.data.orders || after.data.results)) || [];
  console.log('\n[after]  orders on the agentic account:', afterList.length);
  console.log(beforeList.length === afterList.length
    ? 'VERIFIED: no order created by the review call.'
    : 'ALERT: order count changed. Review is not non-executing. Revert the promotion.');

  session.discard();
  console.log('\n[auth] token discarded.');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
