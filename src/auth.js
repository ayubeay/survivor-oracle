/**
 * SURVIVOR Phase 4 — API Key Auth + Rate Limiting
 * Simple key-based access control with tier enforcement
 * Built by SURVIVOR Agent #598 | v0.4.1
 *
 * Keys stored in SQLite. No external auth service needed.
 * Tiers: free (no key), early ($199), pro ($499)
 */

const { db } = require('./database');

// Create API keys table
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    daily_limit INTEGER NOT NULL DEFAULT 50,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    endpoint TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_keys_key ON api_keys(key);
  CREATE INDEX IF NOT EXISTS idx_usage_key_date ON api_usage(key, created_at);
`);

const getKey = db.prepare('SELECT * FROM api_keys WHERE key = ? AND active = 1');
const insertUsage = db.prepare('INSERT INTO api_usage (key, endpoint) VALUES (?, ?)');
const getDailyUsage = db.prepare(
  "SELECT COUNT(*) as count FROM api_usage WHERE key = ? AND created_at > datetime('now', '-1 day')"
);
const insertKey = db.prepare(
  'INSERT OR IGNORE INTO api_keys (key, name, tier, daily_limit) VALUES (?, ?, ?, ?)'
);
const listKeys = db.prepare('SELECT key, name, tier, daily_limit, active, created_at FROM api_keys');
const deactivateKey = db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?');

// Tier config
const TIERS = {
  free:  { daily_limit: 50,     ext: false, debug: false, history: true  },
  early: { daily_limit: 1700,   ext: true,  debug: false, history: true  },  // ~50k/mo
  pro:   { daily_limit: 8500,   ext: true,  debug: true,  history: true  },  // ~250k/mo
  admin: { daily_limit: 999999, ext: true,  debug: true,  history: true  },
};

function generateKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'sv_';
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function createApiKey(name, tier) {
  const key = generateKey();
  const limit = (TIERS[tier] || TIERS.free).daily_limit;
  insertKey.run(key, name || null, tier || 'free', limit);
  return { key, name, tier, daily_limit: limit };
}

function listApiKeys() {
  return listKeys.all();
}

function revokeApiKey(key) {
  return deactivateKey.run(key);
}

/**
 * Express middleware for API key auth + rate limiting.
 * 
 * Rules:
 * - No key = free tier (50 calls/day, no ext, no debug)
 * - Invalid key = 401
 * - Over limit = 429
 * - Valid key = proceed with tier permissions
 *
 * Gated endpoints: /score, /history, /feed, /db/recent
 * Open endpoints: /, /health, /stats, /recent, /activity
 */
function authMiddleware(req, res, next) {

  // Open endpoints — no auth needed
  const openPaths = ['/', '/health', '/stats', '/recent', '/activity'];
  if (openPaths.includes(req.path)) return next();

  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    // /score/ requires x402 payment or API key — no free tier
    if (req.path.startsWith('/score/')) {
      console.log('[PAYMENT_REQUIRED]', new Date().toISOString(), req.path, req.ip);
      return res.status(402).json({
        error: 'payment_required',
        message: 'This endpoint requires payment. Pay $0.01 USDC via x402 or use an API key.',
        upgrade: 'DM @youngs_modulus on X for API access',
      });
    }
    // Free tier — rate limit by IP for other endpoints
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const freeKey = 'free_' + ip;
    const usage = getDailyUsage.get(freeKey);
    if (usage && usage.count >= TIERS.free.daily_limit) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Free tier: ' + TIERS.free.daily_limit + ' calls/day. Get an API key for higher limits.',
        upgrade: 'DM @youngs_modulus on X for API access',
      });
    }
    insertUsage.run(freeKey, req.path);
    req.tier = 'free';
    req.tierConfig = TIERS.free;
    return next();
  }

  // Validate key
  const keyData = getKey.get(apiKey);
  if (!keyData) {
    return res.status(401).json({
      error: 'Invalid API key',
      message: 'Check your key or DM @youngs_modulus on X for access',
    });
  }

  // Check rate limit
  const usage = getDailyUsage.get(apiKey);
  if (usage && usage.count >= keyData.daily_limit) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      tier: keyData.tier,
      daily_limit: keyData.daily_limit,
      used: usage.count,
      message: 'Upgrade your tier for higher limits',
    });
  }

  // Log usage
  insertUsage.run(apiKey, req.path);

  // Attach tier info to request
  req.tier = keyData.tier;
  req.tierConfig = TIERS[keyData.tier] || TIERS.free;
  req.apiKeyName = keyData.name;

  next();
}

/**
 * Gate specific features by tier.
 * Call in route handlers to check permissions.
 */
function canUseExt(req) {
  return req.tierConfig && req.tierConfig.ext;
}

function canUseDebug(req) {
  return req.tierConfig && req.tierConfig.debug;
}

module.exports = {
  authMiddleware,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  canUseExt,
  canUseDebug,
  TIERS,
};
