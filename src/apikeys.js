'use strict';

var { db, DB_PATH } = require("./db");

// Schema
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

console.log("[apikeys] DB path: " + DB_PATH);
var initCount = db.prepare("SELECT count(*) as c FROM api_keys").get();
console.log("[apikeys] Existing keys on boot: " + initCount.c);

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayUTC() {
  var d = new Date();
  return d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
}

function extractApiKey(req) {
  var h = req.headers;
  var direct = h['x-api-key'] || h['x-api-token'];
  if (direct) return String(direct).trim();
  var auth = h['authorization'];
  if (auth && typeof auth === 'string') {
    var m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

// ── Gate: check + consume ─────────────────────────────────────────────────────

function checkAndConsume(req, opts) {
  var freeDailyLimit = (opts && opts.freeDailyLimit) || 50;
  var yyyymmdd = todayUTC();
  var key = extractApiKey(req);

  // No key = free tier
  if (!key) {
    return { ok: true, tier: 'free', daily_limit: freeDailyLimit, used: null, key: null };
  }

  var row = db.prepare('SELECT key, name, tier, daily_limit, enabled FROM api_keys WHERE key = ?').get(key);

  if (!row) return { ok: false, status: 401, error: 'invalid_api_key' };
  if (!row.enabled) return { ok: false, status: 403, error: 'api_key_revoked' };

  // Ensure usage row
  db.prepare('INSERT INTO api_usage_daily (key, yyyymmdd, count) VALUES (?, ?, 0) ON CONFLICT(key, yyyymmdd) DO NOTHING').run(key, yyyymmdd);
  var usage = db.prepare('SELECT count FROM api_usage_daily WHERE key = ? AND yyyymmdd = ?').get(key, yyyymmdd);
  var currentCount = (usage && usage.count) || 0;
  var limit = Number(row.daily_limit || freeDailyLimit);

  if (currentCount >= limit) {
    return { ok: false, status: 429, error: 'rate_limited', tier: row.tier, daily_limit: limit, used: currentCount };
  }

  db.prepare('UPDATE api_usage_daily SET count = ? WHERE key = ? AND yyyymmdd = ?').run(currentCount + 1, key, yyyymmdd);

  return { ok: true, key: key, tier: row.tier, daily_limit: limit, used: currentCount + 1 };
}

// ── Middleware ─────────────────────────────────────────────────────────────────

function apiKeyGate(req, res, next) {
  var result = checkAndConsume(req, { freeDailyLimit: 50 });
  if (!result.ok) {
    return res.status(result.status || 401).json({
      error: result.error,
      tier: result.tier,
      daily_limit: result.daily_limit,
      used: result.used,
    });
  }
  req.api = result;
  next();
}

// ── Admin routes ──────────────────────────────────────────────────────────────

function mountAdminRoutes(app) {
  var ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  function checkAdmin(req, res) {
    var token = req.headers['x-admin-token'];
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // Create key with round-trip verification
  app.post('/admin/keys/create', function (req, res) {
    if (!checkAdmin(req, res)) return;
    try {
      var body = req.body || {};
      var key = crypto.randomBytes(24).toString('hex');
      var name = body.name || '';
      var tier = body.tier || 'paid';
      var daily_limit = Number(body.daily_limit) || (tier === 'free' ? 50 : 50000);
      var created_at = Math.floor(Date.now() / 1000);

      var info = db.prepare('INSERT INTO api_keys (key, name, tier, daily_limit, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(key, name, tier, daily_limit, created_at);

      // Round-trip: read back immediately
      var row = db.prepare('SELECT key, name, tier, daily_limit, enabled, created_at FROM api_keys WHERE key = ?').get(key);

      if (!row) {
        return res.status(500).json({
          error: 'DB_WRITE_FAILED',
          message: 'insert reported success but row not found',
          debug: { DB_PATH: DB_PATH, changes: info.changes }
        });
      }

      console.log('[apikeys] Created key: ' + key.slice(0, 8) + '... tier=' + tier + ' round-trip=OK');
      res.json({ created: row });
    } catch (e) {
      console.error('[apikeys] Create error: ' + e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // List keys with debug info
  app.get('/admin/keys', function (req, res) {
    if (!checkAdmin(req, res)) return;
    try {
      var keys = db.prepare('SELECT key, name, tier, daily_limit, enabled, created_at FROM api_keys ORDER BY created_at DESC').all();
      var tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
      var count = db.prepare('SELECT count(*) as c FROM api_keys').get();
      res.json({ keys: keys, _debug: { db_path: DB_PATH, tables: tables, count: count } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Revoke key
  app.post('/admin/keys/revoke', function (req, res) {
    if (!checkAdmin(req, res)) return;
    var key = (req.body || {}).key;
    if (!key) return res.status(400).json({ error: 'missing key' });
    db.prepare('UPDATE api_keys SET enabled = 0 WHERE key = ?').run(key);
    console.log('[apikeys] Revoked key: ' + key.slice(0, 8) + '...');
    res.json({ revoked: true });
  });

  // Public docs
  app.get("/docs", function (req, res) {
    res.json({
      name: "SURVIVOR Shield Router Oracle",
      version: "v1",
      base_url: "https://survivor-oracle-production.up.railway.app",
      endpoints: {
        "POST /attest": { auth: "x-api-key (paid) or none (free 50/day)", body: { mint: "string", router_program_id: "string" }, returns: "signed attestation + meta" },
        "POST /attest/verify": { auth: "none", body: "attestation response from /attest", returns: "7-check verification result" },
        "GET /attest/signer": { auth: "none", returns: "oracle pubkey + program binding" },
        "GET /attest/cache/stats": { auth: "none", returns: "cache hit/miss metrics" },
        "GET /whoami": { auth: "x-api-key", returns: "tier + usage + remaining quota" }
      },
      errors: {
        invalid_api_key: "401 - key not found",
        api_key_revoked: "403 - key disabled",
        rate_limited: "429 - daily limit exceeded",
        PROGRAM_MISMATCH: "400 - router_program_id does not match configured program"
      },
      quick_start: "curl -sX POST $BASE/attest -H \"Content-Type: application/json\" -d '{\"mint\":\"TOKEN_MINT\",\"router_program_id\":\"Dw5bpnjUeY6XX9oCwqbDUTsAH3vAoSSszr98bfSpMcv\"}\" | jq .",
      built_by: "@youngs_modulus"
    });
  });

  // Whoami - customer self-service
  app.get("/whoami", function (req, res) {
    var key = (req.headers["x-api-key"] || "").trim();
    if (!key) return res.status(401).json({ error: "provide x-api-key header" });
    var row = db.prepare("SELECT key, name, tier, daily_limit, enabled FROM api_keys WHERE key = ?").get(key);
    if (!row) return res.status(401).json({ error: "invalid_api_key" });
    if (!row.enabled) return res.status(403).json({ error: "api_key_revoked" });
    var d = new Date();
    var yyyymmdd = d.getUTCFullYear().toString() + String(d.getUTCMonth()+1).padStart(2,"0") + String(d.getUTCDate()).padStart(2,"0");
    var usage = db.prepare("SELECT count FROM api_usage_daily WHERE key = ? AND yyyymmdd = ?").get(key, yyyymmdd);
    var used = (usage && usage.count) || 0;
    res.json({ tier: row.tier, daily_limit: row.daily_limit, used_today: used, remaining_today: row.daily_limit - used, day: yyyymmdd.slice(0,4)+"-"+yyyymmdd.slice(4,6)+"-"+yyyymmdd.slice(6,8), status: "ok" });
  });

  // Admin stats
  app.get("/admin/keys/stats", function (req, res) {
    if (!checkAdmin(req, res)) return;
    try {
      var tables = db.prepare("SELECT name FROM sqlite_master WHERE type=\"table\"").all().map(function(r){ return r.name; });
      var total = db.prepare("SELECT count(*) as c FROM api_keys").get().c;
      var enabled = db.prepare("SELECT count(*) as c FROM api_keys WHERE enabled=1").get().c;
      res.json({ db_path: DB_PATH, tables: tables, keys: { total: total, enabled: enabled } });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Usage stats
  app.get('/admin/keys/usage', function (req, res) {
    if (!checkAdmin(req, res)) return;
    var usage = db.prepare('SELECT key, yyyymmdd, count FROM api_usage_daily WHERE yyyymmdd = ? ORDER BY count DESC').all(todayUTC());
    res.json({ date: todayUTC(), usage: usage });
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  apiKeyGate,
  mountAdminRoutes,
  checkAndConsume,
};


// Flush WAL on shutdown so keys persist across deploys
process.on("SIGTERM", function() {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    console.log("[apikeys] WAL checkpoint done");
    db.close();
  } catch(e) { console.error("[apikeys] shutdown err:", e.message); }
  process.exit(0);
});
