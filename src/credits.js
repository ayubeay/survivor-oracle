'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.ATTEST_DB_PATH || path.join(__dirname, '..', 'attestations.db');
const DB_DIR = path.dirname(DB_PATH);
try { require('fs').mkdirSync(DB_DIR, { recursive: true }); } catch (e) {}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS credit_wallets (
    api_key     TEXT PRIMARY KEY,
    credits     INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key    TEXT NOT NULL,
    action     TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    balance    INTEGER NOT NULL,
    reason     TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rpe_state (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );
`);

// Bootstrap regime state if empty
var stateCount = db.prepare('SELECT count(*) as c FROM rpe_state').get().c;
if (stateCount === 0) {
  db.prepare("INSERT INTO rpe_state (k, v) VALUES ('regime', 'calm')").run();
  db.prepare("INSERT INTO rpe_state (k, v) VALUES ('base_cost', '1')").run();
  db.prepare("INSERT INTO rpe_state (k, v) VALUES ('load_multiplier', '1.0')").run();
  console.log('[credits] Bootstrapped RPE state: regime=calm, base_cost=1');
}

console.log('[credits] DB path: ' + DB_PATH);
var walletCount = db.prepare('SELECT count(*) as c FROM credit_wallets').get().c;
console.log('[credits] Existing wallets: ' + walletCount);

// ── State helpers ─────────────────────────────────────────────────────────────

function getState(key, fallback) {
  var row = db.prepare('SELECT v FROM rpe_state WHERE k = ?').get(key);
  return row ? row.v : (fallback || null);
}

function setState(key, value) {
  db.prepare('INSERT OR REPLACE INTO rpe_state (k, v) VALUES (?, ?)').run(key, String(value));
}

// ── Cost computation ──────────────────────────────────────────────────────────

var RISK_MULTIPLIERS = {
  LOW: 1,
  MEDIUM: 1.5,
  HIGH: 2.5,
  VERY_HIGH: 4,
  EXTREME: 8,
};

var REGIME_MULTIPLIERS = {
  calm: 1.0,
  speculative: 1.2,
  mania: 1.5,
  crisis: 0.8,
};

function scoreToRiskLevel(score) {
  if (score >= 75) return 'LOW';
  if (score >= 55) return 'MEDIUM';
  if (score >= 35) return 'HIGH';
  if (score >= 20) return 'VERY_HIGH';
  return 'EXTREME';
}

function computeCost(score, riskLevel) {
  var baseCost = Number(getState('base_cost', '1'));
  var loadMult = Number(getState('load_multiplier', '1.0'));
  var regime = getState('regime', 'calm');

  var level = riskLevel || scoreToRiskLevel(score || 0);
  var riskMult = RISK_MULTIPLIERS[level] || 1;
  var regimeMult = REGIME_MULTIPLIERS[regime] || 1.0;

  var raw = baseCost * riskMult * regimeMult * loadMult;
  var credits = Math.max(1, Math.ceil(raw));

  return {
    credits: credits,
    breakdown: {
      base_cost: baseCost,
      risk_level: level,
      risk_multiplier: riskMult,
      regime: regime,
      regime_multiplier: regimeMult,
      load_multiplier: loadMult,
      raw: raw,
    },
  };
}

// ── Wallet operations ─────────────────────────────────────────────────────────

function getWallet(apiKey) {
  if (!apiKey) return null;
  return db.prepare('SELECT api_key, credits, total_spent, created_at FROM credit_wallets WHERE api_key = ?').get(apiKey);
}

function ensureWallet(apiKey) {
  var existing = getWallet(apiKey);
  if (existing) return existing;
  var now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT OR IGNORE INTO credit_wallets (api_key, credits, total_spent, created_at) VALUES (?, 0, 0, ?)').run(apiKey, now);
  return getWallet(apiKey);
}

function topupCredits(apiKey, amount, reason) {
  var wallet = ensureWallet(apiKey);
  var now = Math.floor(Date.now() / 1000);
  var newBalance = (wallet.credits || 0) + amount;

  db.prepare('UPDATE credit_wallets SET credits = ? WHERE api_key = ?').run(newBalance, apiKey);
  db.prepare('INSERT INTO credit_ledger (api_key, action, amount, balance, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    apiKey, 'topup', amount, newBalance, reason || 'admin_topup', now
  );

  return { api_key: apiKey, credits: newBalance, added: amount };
}

function chargeCredits(apiKey, amount, reason) {
  var wallet = getWallet(apiKey);
  if (!wallet) return { ok: false, error: 'no_wallet', credits: 0 };
  if (wallet.credits < amount) return { ok: false, error: 'insufficient_credits', credits: wallet.credits, required: amount };

  var now = Math.floor(Date.now() / 1000);
  var newBalance = wallet.credits - amount;
  var newSpent = (wallet.total_spent || 0) + amount;

  db.prepare('UPDATE credit_wallets SET credits = ?, total_spent = ? WHERE api_key = ?').run(newBalance, newSpent, apiKey);
  db.prepare('INSERT INTO credit_ledger (api_key, action, amount, balance, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    apiKey, 'charge', amount, newBalance, reason || 'attest', now
  );

  return { ok: true, charged: amount, credits: newBalance, total_spent: newSpent };
}

function getBalance(apiKey) {
  var wallet = getWallet(apiKey);
  if (!wallet) return null;
  return { api_key: apiKey, credits: wallet.credits, total_spent: wallet.total_spent };
}

function getLedger(apiKey, limit) {
  return db.prepare('SELECT action, amount, balance, reason, created_at FROM credit_ledger WHERE api_key = ? ORDER BY created_at DESC LIMIT ?').all(apiKey, limit || 20);
}

function listWallets() {
  return db.prepare('SELECT api_key, credits, total_spent, created_at FROM credit_wallets ORDER BY credits DESC').all();
}

// ── Express routes ────────────────────────────────────────────────────────────

function mountCreditRoutes(app) {
  var ADMIN_TOKEN = process.env.ADMIN_TOKEN;

  function checkAdmin(req, res) {
    var token = req.headers['x-admin-token'];
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return false;
    }
    return true;
  }

  // Public: current pricing
  app.get('/pricing', function (req, res) {
    var regime = getState('regime', 'calm');
    var baseCost = Number(getState('base_cost', '1'));
    var loadMult = Number(getState('load_multiplier', '1.0'));

    res.json({
      regime: regime,
      base_cost: baseCost,
      load_multiplier: loadMult,
      risk_multipliers: RISK_MULTIPLIERS,
      regime_multipliers: REGIME_MULTIPLIERS,
      example_costs: {
        LOW_calm: computeCost(80, 'LOW').credits,
        MEDIUM_calm: computeCost(60, 'MEDIUM').credits,
        HIGH_calm: computeCost(40, 'HIGH').credits,
        EXTREME_calm: computeCost(10, 'EXTREME').credits,
        MEDIUM_mania: Math.ceil(1 * 1.5 * 1.5 * loadMult),
      },
    });
  });

  // Public: check balance (with api key)
  app.get('/credits/balance', function (req, res) {
    var key = (req.headers['x-api-key'] || '').trim();
    if (!key) return res.status(401).json({ error: 'provide x-api-key header' });
    var balance = getBalance(key);
    if (!balance) return res.json({ api_key: key, credits: 0, total_spent: 0, wallet_exists: false });
    balance.wallet_exists = true;
    res.json(balance);
  });

  // Public: check ledger (with api key)
  app.get('/credits/ledger', function (req, res) {
    var key = (req.headers['x-api-key'] || '').trim();
    if (!key) return res.status(401).json({ error: 'provide x-api-key header' });
    var entries = getLedger(key, 50);
    res.json({ api_key: key, entries: entries });
  });

  // Admin: top up credits
  app.post('/admin/credits/topup', function (req, res) {
    if (!checkAdmin(req, res)) return;
    var body = req.body || {};
    var apiKey = body.api_key;
    var amount = Number(body.amount);
    if (!apiKey || !amount || amount <= 0) return res.status(400).json({ error: 'api_key and positive amount required' });
    var result = topupCredits(apiKey, amount, body.reason || 'admin_topup');
    console.log('[credits] Topup: ' + apiKey.slice(0, 8) + '... +' + amount + ' credits');
    res.json(result);
  });

  // Admin: list all wallets
  app.get('/admin/wallets', function (req, res) {
    if (!checkAdmin(req, res)) return;
    res.json({ wallets: listWallets() });
  });

  // Admin: set regime state
  app.post('/admin/regime', function (req, res) {
    if (!checkAdmin(req, res)) return;
    var body = req.body || {};
    if (body.regime) {
      if (!['calm', 'speculative', 'mania', 'crisis'].includes(body.regime)) {
        return res.status(400).json({ error: 'regime must be: calm, speculative, mania, crisis' });
      }
      setState('regime', body.regime);
    }
    if (body.load_multiplier) setState('load_multiplier', String(body.load_multiplier));
    if (body.base_cost) setState('base_cost', String(body.base_cost));

    console.log('[credits] Regime updated: ' + getState('regime') + ' load=' + getState('load_multiplier'));
    res.json({
      regime: getState('regime'),
      base_cost: Number(getState('base_cost')),
      load_multiplier: Number(getState('load_multiplier')),
    });
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  computeCost,
  getWallet,
  ensureWallet,
  topupCredits,
  chargeCredits,
  getBalance,
  getLedger,
  getState,
  setState,
  mountCreditRoutes,
};


// Flush WAL on shutdown
process.on("SIGTERM", function() {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    console.log("[credits] WAL checkpoint done");
    db.close();
  } catch(e) {}
  process.exit(0);
});
