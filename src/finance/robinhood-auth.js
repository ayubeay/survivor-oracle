/* Ephemeral OAuth for the Robinhood Trading MCP.
 *
 * Phase 0 holds NOTHING. The access token lives in memory for the process lifetime and is
 * discarded on exit. A refresh token, if returned, is dropped unread - it would be a
 * standing brokerage credential on disk whose authority includes placing orders, and the
 * capability firewall constrains this runtime, not a token that escapes it.
 */

const crypto = require('crypto');
const http = require('http');
const { exec } = require('child_process');

const AUTHORIZE_URL = 'https://robinhood.com/oauth';
const TOKEN_URL = 'https://api.robinhood.com/oauth2/token/';
const REGISTER_URL = 'https://agent.robinhood.com/oauth/trading/register';
const REDIRECT_PORT = 8765;
const REDIRECT_URI = 'http://localhost:' + REDIRECT_PORT + '/callback';
const CALLBACK_TIMEOUT_MS = 180000;
const EXPIRY_MARGIN_MS = 60000;

function b64url(buf) {
  return buf.toString('base64').split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

const SECRET_KEYS = /(access_token|refresh_token|code_verifier|authorization_code|^code$|id_token|client_secret)/i;
function redact(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out = {};
  for (const k of Object.keys(obj)) {
    out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(obj[k]);
  }
  return out;
}

async function registerClient(clientName) {
  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName || 'SURVIVOR',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    }),
  });
  if (!res.ok) throw new Error('Client registration failed: HTTP ' + res.status);
  const body = await res.json();
  if (!body.client_id) throw new Error('Registration returned no client_id');
  return body.client_id;
}

function awaitCallback(expectedState) {
  return new Promise(function (resolve, reject) {
    let server, timer, settled = false;
    function done(fn, arg) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (server) server.close();
      fn(arg);
    }
    server = http.createServer(function (req, res) {
      const url = new URL(req.url, 'http://localhost:' + REDIRECT_PORT);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      function reply(msg) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;padding:40px"><h2>' + msg +
                '</h2><p>You can close this tab.</p></body></html>');
      }
      if (error) { reply('Authorization declined'); return done(reject, new Error('Authorization error: ' + error)); }
      if (!state || state !== expectedState) { reply('State mismatch'); return done(reject, new Error('OAuth state mismatch - authorization rejected')); }
      if (!code) { reply('No authorization code'); return done(reject, new Error('Callback carried no authorization code')); }
      reply('SURVIVOR authorized');
      done(resolve, code);
    });
    server.on('error', function (e) { done(reject, new Error('Callback server failed: ' + e.message)); });
    server.listen(REDIRECT_PORT, '127.0.0.1');
    timer = setTimeout(function () { done(reject, new Error('Authorization timed out after 180s')); }, CALLBACK_TIMEOUT_MS);
  });
}

async function authorize(opts) {
  opts = opts || {};
  const cid = opts.clientId || await registerClient(opts.clientName);
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(32));

  const url = AUTHORIZE_URL + '?' + new URLSearchParams({
    client_id: cid, response_type: 'code', redirect_uri: REDIRECT_URI,
    code_challenge: challenge, code_challenge_method: 'S256', state: state,
    scope: 'internal',
  }).toString();

  console.log('\n[auth] Open this URL to authorize SURVIVOR:\n' + url + '\n');
  if (opts.openBrowser !== false) exec('open "' + url + '"');

  const code = await awaitCallback(state);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT_URI,
      client_id: cid, code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(redact(await res.json())); } catch (e) {}
    throw new Error('Token exchange failed: HTTP ' + res.status + ' ' + detail);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error('Token exchange returned no access token');

  const expiresAt = Date.now() + ((body.expires_in || 3600) * 1000);
  return {
    accessToken: body.access_token,
    expiresAt: expiresAt,
    clientId: cid,
    refreshPersisted: false,
    isUsable: function () { return Date.now() < (expiresAt - EXPIRY_MARGIN_MS); },
    secondsRemaining: function () { return Math.max(0, Math.round((expiresAt - Date.now()) / 1000)); },
    discard: function () { this.accessToken = null; },
  };
}

module.exports = { authorize, registerClient, redact, REDIRECT_URI, EXPIRY_MARGIN_MS };
