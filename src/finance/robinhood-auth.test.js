const { redact, EXPIRY_MARGIN_MS } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');
let pass = 0, fail = 0;
const t = (n, c) => c ? (pass++, console.log('  ok  ' + n)) : (fail++, console.log('  FAIL ' + n));

console.log('\nredaction');
const leaky = { access_token: 'secret', refresh_token: 'secret', code_verifier: 'secret',
                code: 'secret', account_number: '7527', nested: { access_token: 'secret', symbol: 'AAPL' } };
const r = redact(leaky);
t('access_token redacted', r.access_token === '[REDACTED]');
t('refresh_token redacted', r.refresh_token === '[REDACTED]');
t('code_verifier redacted', r.code_verifier === '[REDACTED]');
t('code redacted', r.code === '[REDACTED]');
t('nested token redacted', r.nested.access_token === '[REDACTED]');
t('non-secret preserved', r.nested.symbol === 'AAPL');

console.log('\ntoken lifetime');
const live = { accessToken: 'x', expiresAt: Date.now() + 3600000,
  isUsable() { return Date.now() < this.expiresAt - EXPIRY_MARGIN_MS; },
  secondsRemaining() { return Math.max(0, Math.round((this.expiresAt - Date.now())/1000)); } };
const nearExpiry = { ...live, expiresAt: Date.now() + 30000 };
const expired = { ...live, expiresAt: Date.now() - 1000 };
t('fresh token usable', live.isUsable() === true);
t('near-expiry token refused', nearExpiry.isUsable() === false);
t('expired token refused', expired.isUsable() === false);

console.log('\nno bypass path to transport');
const c = createClient(live);
t('no rpc method exposed', typeof c.rpc === 'undefined');
t('no transport method exposed', typeof c.transport === 'undefined');
t('no raw method exposed', typeof c.raw === 'undefined');
t('callTool is the only tool path', typeof c.callTool === 'function');

console.log('\nfirewall reachable through the client');
t('place denied via wouldAllow', c.wouldAllow('place_equity_order').decision === 'DENY');
t('equity review allowed via wouldAllow', c.wouldAllow('review_equity_order').decision === 'ALLOW');
t('option review still denied', c.wouldAllow('review_option_order').decision === 'DENY');
t('get_portfolio allowed', c.wouldAllow('get_portfolio').decision === 'ALLOW');
t('unknown denied', c.wouldAllow('anything_new').decision === 'DENY');

console.log('\nexpired session refuses before any call');
(async () => {
  const dead = createClient(expired);
  try { await dead.callTool('get_portfolio', {}); t('expired session should throw', false); }
  catch (e) { t('expired session refuses', /expired|re-authorize/i.test(e.message)); }

  console.log('\nno refresh persistence path');
  const src = require('fs').readFileSync(__dirname + '/robinhood-auth.js', 'utf8');
  t('no keychain use', !/security add-generic-password|keytar/.test(src));
  t('no file write of tokens', !/writeFileSync|createWriteStream/.test(src));
  t('refresh_token never assigned', !/refreshToken\s*[:=]\s*body\.refresh_token/.test(src));
  t('refreshPersisted flag false', /refreshPersisted:\s*false/.test(src));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
