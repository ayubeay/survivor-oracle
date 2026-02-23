#!/usr/bin/env node
/**
 * SURVIVOR MCP Server
 * Exposes Survivor-governed execution tools via stdio MCP transport.
 *
 * Compatible with Claude Desktop, Cursor, Continue, and any MCP client.
 *
 * Usage:
 *   node src/gate/mcp-server.js
 *
 * Add to claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "survivor": {
 *         "command": "node",
 *         "args": ["/path/to/survivor-oracle/src/gate/mcp-server.js"],
 *         "env": {
 *           "GATE_URL": "http://localhost:8787",
 *           "SURVIVOR_URL": "https://survivor-oracle-production.up.railway.app"
 *         }
 *       }
 *     }
 *   }
 */

const { TOOLS } = require('./mcp-tools');

// ─── MCP protocol over stdio ─────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'survivor-gate',
  version: '1.0.0',
  description: 'Survivor-governed execution tools for autonomous agents',
};

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function error(id, code, message, data) {
  send({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data && { data }) },
  });
}

function result(id, data) {
  send({ jsonrpc: '2.0', id, result: data });
}

// ─── MCP handlers ────────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // Initialization
  if (method === 'initialize') {
    return result(id, {
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: { tools: {} },
    });
  }

  if (method === 'initialized') return; // notification, no response

  // Tool list
  if (method === 'tools/list') {
    return result(id, {
      tools: Object.values(TOOLS).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  // Tool call
  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolInput = params?.arguments || {};

    const tool = TOOLS[toolName];
    if (!tool) {
      return error(id, -32601, `Tool not found: ${toolName}`);
    }

    try {
      const toolResult = await tool.handler(toolInput);
      return result(id, {
        content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }],
      });
    } catch (err) {
      return result(id, {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }],
        isError: true,
      });
    }
  }

  // Unknown method
  if (id != null) {
    return error(id, -32601, `Method not found: ${method}`);
  }
}

// ─── stdio reader ─────────────────────────────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep incomplete line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[survivor-mcp] Invalid JSON: ${trimmed}\n`);
      continue;
    }

    try {
      await handleMessage(msg);
    } catch (err) {
      process.stderr.write(`[survivor-mcp] Handler error: ${err.message}\n`);
      if (msg.id != null) {
        error(msg.id, -32603, 'Internal error', err.message);
      }
    }
  }
});

process.stdin.on('end', () => {
  process.stderr.write('[survivor-mcp] stdin closed, exiting\n');
  process.exit(0);
});

process.stderr.write(`[survivor-mcp] SURVIVOR Gate MCP Server started\n`);
process.stderr.write(`[survivor-mcp] Gate: ${process.env.GATE_URL || 'http://localhost:8787'}\n`);
process.stderr.write(`[survivor-mcp] Tools: ${Object.keys(TOOLS).join(', ')}\n`);