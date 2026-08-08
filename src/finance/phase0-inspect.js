/* Phase 0 inspection. Authenticates, lists tools, audits them against the firewall.
   Calls no account tools - if the live surface holds anything unclassified, we classify
   before reading, not after. */
const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');

(async () => {
  console.log('SURVIVOR Phase 0 - inspection only. No orders, no account reads.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  console.log('[auth] authorized. token valid for', session.secondsRemaining(), 'seconds');
  console.log('[auth] refresh token persisted:', session.refreshPersisted);

  const client = createClient(session);
  const init = await client.initialize();
  console.log('\n[mcp] server:', JSON.stringify(init.serverInfo || {}));
  console.log('[mcp] protocol:', init.protocolVersion);

  const tools = await client.listTools();
  console.log('\n[mcp] ' + tools.length + ' tools exposed:\n');
  tools.forEach(t => console.log('  ' + t.name.padEnd(32) + (t.description || '').slice(0, 70)));

  const audit = client.audit(tools.map(t => t.name));
  console.log('\n=== firewall audit ===');
  console.log('allowed (observation):', audit.allowed.length, audit.allowed.join(', ') || '-');
  console.log('known mutating       :', audit.known_mutating.length, audit.known_mutating.join(', ') || '-');
  console.log('pending classification:', audit.pending.length, audit.pending.join(', ') || '-');
  console.log('UNCLASSIFIED         :', audit.unclassified.length, audit.unclassified.join(', ') || '-');
  if (audit.unclassified.length) {
    console.log('\nUnclassified tools are DENIED by default. Classify them before phase 0 reads.');
  }
  session.discard();
  console.log('\n[auth] token discarded. Nothing persisted.');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
