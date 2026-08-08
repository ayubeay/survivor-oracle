/* MCP client for the Robinhood Trading endpoint.
 *
 * There is deliberately no public method that reaches the transport without passing
 * through guardedCall. A caller cannot opt out of the capability firewall, because the
 * only path to the wire is private to this module. */

const { guardedCall, auditToolList, checkToolCall } = require('./capability-firewall');

const MCP_URL = 'https://agent.robinhood.com/mcp/trading';

function createClient(session) {
  if (!session || !session.accessToken) throw new Error('No authenticated session');
  let sessionId = null;
  let nextId = 1;

  /* private - not exported, not attached to the returned object */
  async function rpc(method, params) {
    if (!session.isUsable()) {
      throw new Error('Access token expired or within the expiry margin - re-authorize');
    }
    const headers = {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'authorization': 'Bearer ' + session.accessToken,
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const res = await fetch(MCP_URL, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params: params || {} }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const text = await res.text();
    if (!res.ok) throw new Error('MCP ' + method + ' failed: HTTP ' + res.status);
    /* the endpoint may reply as SSE; take the last data frame */
    const line = text.includes('data:')
      ? text.split('\n').filter(l => l.startsWith('data:')).pop().slice(5).trim()
      : text;
    const body = JSON.parse(line);
    if (body.error) throw new Error('MCP ' + method + ' error: ' + (body.error.message || 'unknown'));
    return body.result;
  }

  return {
    async initialize() {
      return rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'SURVIVOR', version: '0.1.0-phase0' },
      });
    },
    async listTools() {
      const r = await rpc('tools/list');
      return (r && r.tools) || [];
    },
    /* every tool call routes through the firewall; forbidden names throw before the wire */
    async callTool(name, args) {
      return guardedCall((n, a) => rpc('tools/call', { name: n, arguments: a || {} }), name, args);
    },
    wouldAllow(name) { return checkToolCall(name); },
    audit(toolNames) { return auditToolList(toolNames); },
    sessionSecondsRemaining() { return session.secondsRemaining(); },
  };
}

module.exports = { createClient, MCP_URL };
