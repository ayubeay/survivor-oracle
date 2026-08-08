/* Phase 0 observation pass.
 *
 * Reads the minimum account-state tools to learn what evidence Robinhood actually gives
 * SURVIVOR. The purpose is to discover the SHAPE of policy inputs, not to evaluate policy.
 *
 * Deliberately does NOT compute a score. buildPolicy() takes a 0-100 number and would
 * happily produce a decision from one, but no finance-specific scoring semantics have been
 * calibrated. Manufacturing a number from a nearly empty account to make the output look
 * complete would be exactly the failure this project keeps finding elsewhere - a value that
 * looks like evidence and is not.
 *
 * No review_*, no mutation, no order, no funding.
 */

const { authorize } = require('./robinhood-auth');
const { createClient } = require('./robinhood-client');
const { auditToolList } = require('./capability-firewall');

/* Account numbers and identifiers never reach a stored artifact or a log. */
const ID_KEYS = /(account_number|account_id|^id$|_id$|url|user_id|customer_id)/i;
function redactIds(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redactIds);
  const out = {};
  for (const k of Object.keys(v)) {
    out[k] = ID_KEYS.test(k) ? '[REDACTED]' : redactIds(v[k]);
  }
  return out;
}

/* What fields exist, not what they contain. Shape is the finding. */
function shapeOf(v, depth) {
  depth = depth || 0;
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? ['array[' + v.length + ']', shapeOf(v[0], depth + 1)] : 'array[0]';
  if (typeof v === 'object') {
    if (depth > 3) return 'object{...}';
    const out = {};
    Object.keys(v).forEach(k => { out[k] = shapeOf(v[k], depth + 1); });
    return out;
  }
  return typeof v;
}

/* Account-scoped reads need an account_number, discovered from get_accounts. The first
   pass failed on all three and that is the finding: observation is not a flat list of
   calls, it is a chain rooted in account discovery. */
const ACCOUNT_SCOPED = ['get_portfolio', 'get_equity_positions', 'get_realized_pnl'];

(async () => {
  console.log('SURVIVOR Phase 0 observation. Reads only. No orders, no mutations, no funding.\n');
  const session = await authorize({ clientName: 'SURVIVOR' });
  const client = createClient(session);
  const init = await client.initialize();
  const tools = await client.listTools();
  const audit = auditToolList(tools.map(t => t.name), init.serverInfo);

  console.log('[surface] ' + audit.tools_observed + ' tools, ' + audit.unclassified +
              ' unclassified, ' + audit.allowed_now.length + ' allowed in phase 0\n');
  if (audit.unclassified > 0) {
    console.log('Capability drift: ' + audit.unclassified_tools.join(', '));
    console.log('New tools are denied. Classify before reading.\n');
  }

  const observed = {};
  async function read(tool, args) {
    try {
      const { result, receipt } = await client.callTool(tool, args || {});
      /* Not every response is JSON. get_realized_pnl returned plain text on an account
         with no trade history - that is information, not a failure. */
      const raw = result && result.content && result.content[0] && result.content[0].text;
      let payload = result;
      if (raw) {
        try { payload = JSON.parse(raw); }
        catch (e) { console.log('       server said: ' + raw.slice(0, 120)); payload = { _non_json_response: raw.slice(0, 200) }; }
      }
      observed[tool] = { ok: true, shape: shapeOf(redactIds(payload)) };
      console.log('  ' + tool.padEnd(24) + 'OK   class ' + receipt.capability_class);
      return payload;
    } catch (e) {
      observed[tool] = { ok: false, error: e.message.slice(0, 160) };
      console.log('  ' + tool.padEnd(24) + 'FAIL ' + e.message.slice(0, 90));
      return null;
    }
  }

  const accountsPayload = await read('get_accounts');
  const accounts = (accountsPayload && accountsPayload.data && accountsPayload.data.accounts) || [];

  /* Robinhood marks which accounts an agent may trade in. That is the broker's own
     boundary, machine-readable - worth recording as a policy input in its own right. */
  const agenticAccounts = accounts.filter(a => a.agentic_allowed === true);
  console.log('\n  accounts: ' + accounts.length +
              ' | agentic_allowed: ' + agenticAccounts.length +
              ' | types: ' + accounts.map(a => a.type).join(', ') +
              ' | option_levels: ' + accounts.map(a => a.option_level || 'none').join(', ') + '\n');

  const target = agenticAccounts[0] || accounts[0];
  if (target) {
    for (const tool of ACCOUNT_SCOPED) {
      await read(tool, { account_number: target.account_number });
    }
  } else {
    console.log('  no account available to scope reads against');
  }

  console.log('\n=== response shapes, identifiers redacted ===');
  console.log(JSON.stringify(observed, null, 2));

  const receipt = {
    receipt_type: 'survivor.robinhood.phase0.observation',
    mode: 'PHASE_0_OBSERVATION',
    observed_at: new Date().toISOString(),
    server: audit.server,
    server_version: audit.server_version,
    capability_surface: {
      tools_observed: audit.tools_observed,
      classified: audit.classified,
      unclassified: audit.unclassified,
      allowed_in_phase_0: audit.allowed_now.length,
      denied_in_phase_0: audit.denied_now.length,
    },
    capital_movement_enabled: false,
    mutation_enabled: false,
    simulation_enabled: false,
    credential_persisted: false,
    tools_invoked: ['get_accounts'].concat(ACCOUNT_SCOPED),
    account_model: {
      accounts_visible: accounts.length,
      agentic_allowed_count: agenticAccounts.length,
      types: accounts.map(a => a.type),
      option_levels: accounts.map(a => a.option_level || null),
      note: 'agentic_allowed is a per-account boolean set by Robinhood. An order proposed ' +
            'against an account where it is false is malformed before any risk question.',
    },
    inputs_available: Object.keys(observed).filter(k => observed[k].ok),
    inputs_unavailable: Object.keys(observed).filter(k => !observed[k].ok),
    policy_evaluation: 'NOT_ACTIVATED',
    policy_evaluation_reason:
      'Finance-specific admissibility semantics have not been calibrated. No score was ' +
      'computed. A 0-100 value derived from this account would not measure anything.',
    execution: 'NONE',
  };

  console.log('\n=== phase 0 shadow receipt ===');
  console.log(JSON.stringify(receipt, null, 2));

  session.discard();
  console.log('\n[auth] token discarded. Nothing persisted.');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
