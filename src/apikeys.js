'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Use same DB as attestation cache
const DB_PATH = process.env.ATTEST_DB_PATH || path.join(__dirname, '..', 'attestations.db');
const DB_DIR = path.dirname(DB_PATH);
try { require('fs').mkdirSync(DB_DIR, { recursive: true }); } catch (e) {}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
console.log('[apikeys] DB path: '+DB_PATH);

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key         TEXT PRIMARY KEY,
    name        TEXT DEFAULT '',
    tier        TEXT NOT NULL DEFAULT 'free',
    daily_limit INTEGER NOT NULL DEFAULT 50,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_usage_daily (
    key      TEXT NOT NULL,
    yyyymmdd TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key, yyyymmdd)
  );
`);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmts = {
  getKey:     db.prepare('SELECT key, name, tier, daily_limit, enabled FROM api_keys WHERE key = ?'),
  insertKey:  db.prepare('INSERT INTO api_keys (key, name, tier, daily_limit, enabled, created_at) VALUES (@key, @name, @tier, @daily_limit, 1, @created_at)'),
  listKeys:   db.prepare('SELECT key, name, tier, daily_limit, enabled, created_at FROM api_keys ORDER BY created_at DESC'),
  revokeKey:  db.prepare('UPDATE api_keys SET enabled = 0 WHERE key = ?'),
  enableKey:  db.prepare('UPDATE api_keys SET enabled = 1 WHERE key = ?'),
  upsertUsage: db.prepare('INSERT INTO api_usage_daily (key, yyyymmdd, count) VALUES (?, ?, 0) ON CONFLICT(key, yyyymmdd) DO NOTHING'),
  getUsage:   db.prepare('SELECT count FROM api_usage_daily WHERE key = ? AND yyyymmdd = ?'),
  incUsage:   db.prepare('UPDATE api_usage_daily SET count = ? WHERE key = ? AND yyyymmdd = ?'),
  allUsage:   db.prepare('SELECT key, yyyymmdd, count FROM api_usage_daily WHERE yyyymmdd = ? ORDER BY count DESC'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayUTC() {
  const d = new Date();
  return d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
}

function extractApiKey(req) {
  const h = req.headers;
  const direct = h['x-api-key'] || h['x-api-token'];
  if (direct) return String(direct).trim();
  const auth = h['authorization'];
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

// ── Core: check + consume ─────────────────────────────────────────────────────

function checkAndConsume(req, opts) {
  const freeDailyLimit = (opts && opts.freeDailyLimit) || 50;
  const yyyymmdd = todayUTC();
  const key = extractApiKey(req);

  // No key = free tier (limited)
  if (!key) {
    return { ok: true, tier: 'free', daily_limit: freeDailyLimit, used: null, key: null };
  }

  const row = stmts.getKey.get(key);

  // Unknown key
  if (!row) return { ok: false, status: 401, error: 'invalid_api_key' };

  // Revoked key
  if (!row.enabled) return { ok: false, status: 403, error: 'api_key_revoked' };

  // Ensure usage row exists
  stmts.upsertUsage.run(key, yyyymmdd);
  const usage = stmts.getUsage.get(key, yyyymmdd);
  const currentCount = (usage && usage.count) || 0;
  const limit = Number(row.daily_limit || freeDailyLimit);

  // Over limit
  if (currentCount >= limit) {
    return {
      ok: false,
      status: 429,
      error: 'rate_limited',
      tier: row.tier,
      daily_limit: limit,
      used: currentCount,
    };
  }

  // Consume
  stmts.incUsage.run(currentCount + 1, key, yyyymmdd);

  return {
    ok: true,
    key: key,
    tier: row.tier,
    daily_limit: limit,
    used: currentCount + 1,
  };
}

// ── Admin functions ───────────────────────────────────────────────────────────

function createApiKey(opts) {
  const key = (opts && opts.key) || crypto.randomBytes(24).toString('hex');
  const name = (opts && opts.name) || '';
  const tier = (opts && opts.tier) || 'paid';
  const daily_limit = Number((opts && opts.daily_limit) || (tier === 'free' ? 50 : 50000));
  const created_at = Math.floor(Date.now() / 1000);

  stmts.insertKey.run({ key, name, tier, daily_limit, created_at });
  return { key, name, tier, daily_limit, enabled: true, created_at };
}

function listApiKeys() {
  return stmts.listKeys.all();
}

function revokeApiKey(key) {
  stmts.revokeKey.run(key);
  return true;
}

function getUsageToday() {
  return stmts.allUsage.all(todayUTC());
}

// ── Express middleware ─────────────────────────────────────────────────────────

function apiKeyGate(req, res, next) {
  const result = checkAndConsume(req, { freeDailyLimit: 50 });

  if (!result.ok) {
    return res.status(result.status || 401).json({
      error: result.error,
      tier: result.tier,
      daily_limit: result.daily_limit,
      used: result.used,
    });
  }

  // Attach to request for downstream use
  req.api = result;
  next();
}

// ── Admin route handler ───────────────────────────────────────────────────────

function mountAdminRoutes(app) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  function checkAdmin(req, res) {
    const token = req.headers['x-admin-token'];
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // Create API key
  app.post('/admin/keys/create', function (req, res) {
    if (!checkAdmin(req, res)) return;
    try {
      const body = req.body || {};
      const created = createApiKey({
        name: body.name,
        tier: body.tier,
        daily_limit: body.daily_limit,
      });
      console.log('[apikeys] Created key: ' + created.key.slice(0, 8) + '... tier=' + created.tier);
      res.json({ created });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // List all keys
  app.get('/admin/keys', function (req, res) {
    if (!checkAdmin(req, res)) return;
    res.json({ keys: listApiKeys() });
  });

  // Revoke a key
  app.post('/admin/keys/revoke', function (req, res) {
    if (!checkAdmin(req, res)) return;
    const key = (req.body || {}).key;
    if (!key) return res.status(400).json({ error: 'missing key' });
    revokeApiKey(key);
    console.log('[apikeys] Revoked key: ' + key.slice(0, 8) + '...');
    res.json({ revoked: true });
  });

  // Usage stats
  app.get('/admin/keys/usage', function (req, res) {
    if (!checkAdmin(req, res)) return;
    res.json({ date: todayUTC(), usage: getUsageToday() });
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  apiKeyGate,
  mountAdminRoutes,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  checkAndConsume,
  getUsageToday,
};
