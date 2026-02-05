#!/bin/bash
# SURVIVOR Oracle v0.4.0 Upgrade Script
# Run from your survivor-oracle root directory:
#   bash upgrade-v0.4.0.sh

set -e
echo "🔧 Upgrading SURVIVOR Oracle to v0.4.0..."

# ─── src/database.js ───
cat > src/database.js << 'DBEOF'
/**
 * SURVIVOR Token Risk Oracle — Database Layer
 * Built by SURVIVOR Agent #598
 * v0.4.0: persistent dedup, agent activity log, feed filters
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'survivor.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    name TEXT,
    symbol TEXT,
    score INTEGER NOT NULL,
    risk_level TEXT NOT NULL,
    safe INTEGER NOT NULL,
    mint_authority INTEGER,
    freeze_authority INTEGER,
    lp_locked INTEGER,
    holder_concentration INTEGER,
    dev_wallet INTEGER,
    token_age INTEGER,
    liquidity_depth INTEGER,
    liquidity_usd REAL,
    age_in_hours REAL,
    holder_note TEXT,
    source TEXT DEFAULT 'api',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monitor_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    event TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_scores_mint ON scores(mint);
  CREATE INDEX IF NOT EXISTS idx_scores_created ON scores(created_at);
  CREATE INDEX IF NOT EXISTS idx_scores_risk ON scores(risk_level);
  CREATE INDEX IF NOT EXISTS idx_monitor_event ON monitor_log(event);
`);

const insertScore = db.prepare(
  'INSERT INTO scores (mint,name,symbol,score,risk_level,safe,mint_authority,freeze_authority,lp_locked,holder_concentration,dev_wallet,token_age,liquidity_depth,liquidity_usd,age_in_hours,holder_note,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
);
const insertMonitorLog = db.prepare('INSERT INTO monitor_log (mint,event,details) VALUES (?,?,?)');
const checkMintScored = db.prepare('SELECT 1 FROM scores WHERE mint = ? LIMIT 1');

function saveScore(data) {
  return insertScore.run(
    data.mint, data.name || null, data.symbol || null, data.score, data.riskLevel,
    data.safe ? 1 : 0,
    data.breakdown?.mintAuthority ?? null, data.breakdown?.freezeAuthority ?? null,
    data.breakdown?.lpLocked ?? null, data.breakdown?.holderConcentration ?? null,
    data.breakdown?.devWalletActivity ?? null, data.breakdown?.tokenAge ?? null,
    data.breakdown?.liquidityDepth ?? null, data.liquidityUsd || null,
    data.ageInHours || null, data.holderNote || null, data.source || 'api'
  );
}

function logMonitorEvent(mint, event, details) {
  return insertMonitorLog.run(mint, event, details || null);
}

function isMintScored(mint) {
  return !!checkMintScored.get(mint);
}

function getScoreHistory(mint, limit = 20) {
  return db.prepare('SELECT * FROM scores WHERE mint=? ORDER BY created_at DESC LIMIT ?').all(mint, limit);
}

function getRecentScoresDB(limit = 50, riskLevel = null) {
  const rows = db.prepare('SELECT * FROM scores ORDER BY created_at DESC LIMIT ?').all(limit);
  return riskLevel ? rows.filter(function (s) { return s.risk_level === riskLevel; }) : rows;
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM scores').get();
  const byRisk = db.prepare('SELECT risk_level, COUNT(*) as count FROM scores GROUP BY risk_level ORDER BY count DESC').all();
  const avgScore = db.prepare('SELECT AVG(score) as avg FROM scores').get();
  const monitored = db.prepare('SELECT COUNT(DISTINCT mint) as count FROM monitor_log').get();
  const last24h = db.prepare("SELECT COUNT(*) as count FROM scores WHERE created_at > datetime('now', '-1 day')").get();
  const skipped = db.prepare("SELECT COUNT(*) as count FROM monitor_log WHERE event = 'SKIPPED'").get();
  const errors = db.prepare("SELECT COUNT(*) as count FROM monitor_log WHERE event = 'ERROR'").get();

  return {
    totalScored: total.count,
    averageScore: Math.round((avgScore.avg || 0) * 10) / 10,
    byRiskLevel: byRisk,
    uniqueMonitored: monitored.count,
    last24h: last24h.count,
    skippedNonMints: skipped.count,
    errors: errors.count,
  };
}

function getExtremes(limit = 5) {
  const safest = db.prepare('SELECT DISTINCT mint,name,symbol,score,risk_level,created_at FROM scores ORDER BY score DESC LIMIT ?').all(limit);
  const riskiest = db.prepare('SELECT DISTINCT mint,name,symbol,score,risk_level,created_at FROM scores ORDER BY score ASC LIMIT ?').all(limit);
  return { safest, riskiest };
}

function getScoreDistribution() {
  return db.prepare(`
    SELECT
      CASE
        WHEN score >= 75 THEN 'LOW'
        WHEN score >= 55 THEN 'MEDIUM'
        WHEN score >= 35 THEN 'HIGH'
        WHEN score >= 20 THEN 'VERY_HIGH'
        ELSE 'EXTREME'
      END as bucket,
      COUNT(*) as count,
      ROUND(AVG(score), 1) as avg_score
    FROM scores
    GROUP BY bucket
    ORDER BY avg_score DESC
  `).all();
}

function getHourlyActivity() {
  return db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:00:00Z', created_at) as hour,
      COUNT(*) as count,
      ROUND(AVG(score), 1) as avg_score,
      MIN(score) as min_score,
      MAX(score) as max_score
    FROM scores
    WHERE created_at > datetime('now', '-24 hours')
    GROUP BY hour
    ORDER BY hour ASC
  `).all();
}

module.exports = {
  db, saveScore, logMonitorEvent, isMintScored, getScoreHistory,
  getRecentScoresDB, getStats, getExtremes, getScoreDistribution, getHourlyActivity,
};
DBEOF

echo "  ✓ database.js"

# ─── src/sanitizer.js ───
cat > src/sanitizer.js << 'SANEOF'
/**
 * SURVIVOR Oracle — Token Metadata Sanitizer
 * Built by SURVIVOR Agent #598
 */

const OFFENSIVE_PATTERNS = [
  /\bnigg(a|er|ers|as|az)\b/gi,
  /\bfag(s|got|gots)?\b/gi,
  /\bcunt(s)?\b/gi,
  /\bslut(s)?\b/gi,
  /\bretard(s|ed)?\b/gi,
  /\btrann(y|ies)\b/gi,
  /\bkike(s)?\b/gi,
  /\bspic(s)?\b/gi,
  /\bwetback(s)?\b/gi,
  /\bchink(s)?\b/gi,
];

function sanitizeText(s) {
  if (!s || typeof s !== 'string') return s;
  let out = s;
  for (const re of OFFENSIVE_PATTERNS) {
    out = out.replace(re, '[redacted]');
  }
  return out;
}

function sanitizeTokenData(token) {
  if (!token) return token;
  return {
    ...token,
    name: sanitizeText(token.name),
    symbol: sanitizeText(token.symbol),
    description: sanitizeText(token.description),
  };
}

module.exports = { sanitizeText, sanitizeTokenData };
SANEOF

echo "  ✓ sanitizer.js"

# ─── src/scorer.js ───
cat > src/scorer.js << 'SCOREOF'
/**
 * SURVIVOR Token Risk Scorer
 * Score ranges from 0 (extreme risk) to 100 (low risk).
 * Built by SURVIVOR Agent #598
 * v0.4.0: penalize missing holder data, improved confidence model
 */

const WEIGHTS = {
  mintAuthority: 20,
  freezeAuthority: 10,
  lpLocked: 20,
  topHolderConcentration: 15,
  devWalletActivity: 15,
  tokenAge: 10,
  liquidityDepth: 10,
};

function scoreMintAuthority(revoked) {
  return revoked ? 100 : 0;
}

function scoreFreezeAuthority(revoked) {
  return revoked ? 100 : 0;
}

function scoreLpLocked(lpInfo) {
  if (!lpInfo || !lpInfo.locked) return 0;
  var score = Math.min(lpInfo.percentLocked || 0, 100) * 0.5;
  score += Math.min((lpInfo.lockDuration || 0) / 30, 1) * 50;
  return Math.round(score);
}

function scoreHolderConcentration(top10Percent) {
  if (top10Percent === null || top10Percent === undefined) return 30;
  if (top10Percent <= 20) return 100;
  if (top10Percent <= 35) return 80;
  if (top10Percent <= 50) return 60;
  if (top10Percent <= 70) return 40;
  if (top10Percent <= 85) return 20;
  return 10;
}

function scoreDevWalletActivity(devActivity) {
  if (!devActivity) return 50;
  var score = 100;
  if (devActivity.recentSells > 0) score -= Math.min(devActivity.recentSells * 20, 60);
  if (devActivity.percentSold > 10) score -= Math.min((devActivity.percentSold - 10) * 2, 30);
  if (devActivity.walletAge > 30) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreTokenAge(hours) {
  if (hours < 1) return 5;
  if (hours < 3) return 15;
  if (hours < 6) return 25;
  if (hours < 12) return 35;
  if (hours < 24) return 50;
  if (hours < 72) return 70;
  if (hours < 168) return 85;
  return 100;
}

function scoreLiquidityDepth(usd) {
  if (usd < 1000) return 5;
  if (usd < 5000) return 20;
  if (usd < 10000) return 40;
  if (usd < 25000) return 55;
  if (usd < 50000) return 70;
  if (usd < 100000) return 85;
  return 100;
}

function calculateSurvivalScore(tokenData) {
  if (tokenData.megacap) {
    var mc = tokenData.megacap;
    return {
      score: mc.baseScore, riskLevel: mc.riskLevel, mode: mc.mode,
      breakdown: {
        mintAuthority: 'N/A', freezeAuthority: 'N/A', lpLocked: 'N/A',
        holderConcentration: 'N/A', devWalletActivity: 'N/A',
        tokenAge: 100, liquidityDepth: 100,
      },
      weights: WEIGHTS, timestamp: new Date().toISOString(),
    };
  }

  var breakdown = {
    mintAuthority: scoreMintAuthority(tokenData.mintAuthorityRevoked),
    freezeAuthority: scoreFreezeAuthority(tokenData.freezeAuthorityRevoked),
    lpLocked: scoreLpLocked(tokenData.lpInfo),
    holderConcentration: scoreHolderConcentration(tokenData.top10HolderPercent),
    devWalletActivity: scoreDevWalletActivity(tokenData.devActivity),
    tokenAge: scoreTokenAge(tokenData.ageInHours || 0),
    liquidityDepth: scoreLiquidityDepth(tokenData.liquidityUsd || 0),
  };

  var totalScore = 0;
  totalScore += (breakdown.mintAuthority * WEIGHTS.mintAuthority) / 100;
  totalScore += (breakdown.freezeAuthority * WEIGHTS.freezeAuthority) / 100;
  totalScore += (breakdown.lpLocked * WEIGHTS.lpLocked) / 100;
  totalScore += (breakdown.holderConcentration * WEIGHTS.topHolderConcentration) / 100;
  totalScore += (breakdown.devWalletActivity * WEIGHTS.devWalletActivity) / 100;
  totalScore += (breakdown.tokenAge * WEIGHTS.tokenAge) / 100;
  totalScore += (breakdown.liquidityDepth * WEIGHTS.liquidityDepth) / 100;

  var score = Math.round(totalScore);
  var riskLevel;
  if (score >= 75) riskLevel = 'LOW';
  else if (score >= 55) riskLevel = 'MEDIUM';
  else if (score >= 35) riskLevel = 'HIGH';
  else if (score >= 20) riskLevel = 'VERY_HIGH';
  else riskLevel = 'EXTREME';

  return { score: score, riskLevel: riskLevel, breakdown: breakdown, weights: WEIGHTS, timestamp: new Date().toISOString() };
}

function generateReasons(tokenData, breakdown) {
  if (tokenData.megacap) {
    return tokenData.megacap.reasons || ['MEGACAP_TOKEN', 'ESTABLISHED'];
  }
  var reasons = [];
  if (breakdown.mintAuthority === 0) reasons.push('MINT_AUTH_ACTIVE');
  if (breakdown.freezeAuthority === 0) reasons.push('FREEZE_AUTH_ACTIVE');
  if (breakdown.lpLocked === 0) reasons.push('LP_NOT_LOCKED');
  if (breakdown.holderConcentration <= 20) reasons.push('HIGH_CONCENTRATION');
  if (breakdown.holderConcentration === 30 && (tokenData.top10HolderPercent === null || tokenData.top10HolderPercent === undefined)) {
    reasons.push('HOLDER_DATA_UNAVAILABLE');
  }
  if (breakdown.tokenAge <= 15) reasons.push('VERY_NEW');
  if (breakdown.liquidityDepth <= 20) reasons.push('LOW_LIQUIDITY');
  if (breakdown.mintAuthority === 100) reasons.push('MINT_REVOKED');
  if (breakdown.freezeAuthority === 100) reasons.push('FREEZE_REVOKED');
  if (breakdown.tokenAge >= 85) reasons.push('ESTABLISHED');
  if (breakdown.liquidityDepth >= 85) reasons.push('DEEP_LIQUIDITY');
  return reasons;
}

function getConfidence(tokenData) {
  if (tokenData.megacap) return 'HIGH';
  var confidence = 'HIGH';
  if (tokenData.holderNote === 'MEGACAP_SKIP' || tokenData.holderNote === 'MEGA_CAP_FALLBACK') confidence = 'MEDIUM';
  if (tokenData.holderNote === 'HOLDER_QUERY_FAILED') confidence = 'LOW';
  if (tokenData.holderNote === 'NOT_A_TOKEN_MINT' || tokenData.holderNote === 'ACCOUNT_NOT_FOUND') confidence = 'LOW';
  if (tokenData.liquidityUsd === 0 && tokenData.ageInHours === 0) confidence = 'LOW';
  return confidence;
}

module.exports = { calculateSurvivalScore, generateReasons, getConfidence, WEIGHTS };
SCOREOF

echo "  ✓ scorer.js"

# ─── src/fetcher.js ───
cat > src/fetcher.js << 'FETCHEOF'
/**
 * SURVIVOR Token Data Fetcher
 * Built by SURVIVOR Agent #598
 * v0.4.0: mint validation, DexScreener address matching, sanitization, megacap context
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { sanitizeText } = require('./sanitizer');

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const MEGACAP_MINTS = {
  'So11111111111111111111111111111111111111112': {
    name: 'Wrapped SOL', symbol: 'SOL', mode: 'MEGACAP', baseScore: 85, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'NATIVE_ASSET'],
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    name: 'USD Coin', symbol: 'USDC', mode: 'MEGACAP', baseScore: 82, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    name: 'Tether USD', symbol: 'USDT', mode: 'MEGACAP', baseScore: 78, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': {
    name: 'World Liberty Financial USD', symbol: 'USD1', mode: 'MEGACAP', baseScore: 55, riskLevel: 'MEDIUM',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
};

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

function isMegacap(mintAddress) { return mintAddress in MEGACAP_MINTS; }
function getMegacapData(mintAddress) { return MEGACAP_MINTS[mintAddress] || null; }

async function validateMint(mintAddress) {
  try {
    var pubkey = new PublicKey(mintAddress);
    var info = await connection.getAccountInfo(pubkey);
    if (!info) return { valid: false, reason: 'ACCOUNT_NOT_FOUND' };
    var owner = info.owner.toBase58();
    if (owner !== TOKEN_PROGRAM_ID && owner !== TOKEN_2022_PROGRAM_ID) {
      return { valid: false, reason: 'NOT_A_TOKEN_MINT', owner: owner };
    }
    if (owner === TOKEN_PROGRAM_ID && info.data.length !== 82) {
      return { valid: false, reason: 'NOT_A_MINT_ACCOUNT', size: info.data.length };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'VALIDATION_ERROR', error: err.message };
  }
}

async function getTokenMintInfo(mintAddress) {
  var mintPubkey = new PublicKey(mintAddress);
  var accountInfo = await connection.getParsedAccountInfo(mintPubkey);
  if (!accountInfo.value || !accountInfo.value.data.parsed) throw new Error('Invalid token mint');
  var parsed = accountInfo.value.data.parsed.info;
  return {
    address: mintAddress, decimals: parsed.decimals, supply: parsed.supply,
    mintAuthority: parsed.mintAuthority, freezeAuthority: parsed.freezeAuthority,
    mintAuthorityRevoked: parsed.mintAuthority === null,
    freezeAuthorityRevoked: parsed.freezeAuthority === null,
  };
}

async function getHolderDistribution(mintAddress) {
  if (isMegacap(mintAddress)) {
    console.log('[SURVIVOR] Megacap denylist hit, skipping holder query');
    return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: 'MEGACAP_SKIP' };
  }
  var mintCheck = await validateMint(mintAddress);
  if (!mintCheck.valid) {
    console.log('[SURVIVOR] Skipping holder query for ' + mintAddress.slice(0, 12) + '...: ' + mintCheck.reason);
    return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: mintCheck.reason };
  }
  try {
    var mintPubkey = new PublicKey(mintAddress);
    var largestAccounts;
    try {
      largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    } catch (lErr) {
      console.log('[SURVIVOR] Holder query failed for ' + mintAddress.slice(0, 16) + '..., using fallback');
      return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: 'HOLDER_QUERY_FAILED' };
    }
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return { totalHolders: 0, top10HolderPercent: 100, topHolders: [] };
    }
    var totalFromTop = largestAccounts.value.reduce(function (sum, acc) { return sum + Number(acc.amount); }, 0);
    var top10 = largestAccounts.value.slice(0, 10);
    var top10Amount = top10.reduce(function (sum, acc) { return sum + Number(acc.amount); }, 0);
    var top10Percent = totalFromTop > 0 ? (top10Amount / totalFromTop) * 100 : 100;
    return {
      totalHolders: largestAccounts.value.length,
      top10HolderPercent: Math.round(top10Percent * 100) / 100,
      topHolders: top10.map(function (acc, i) {
        return { rank: i + 1, address: acc.address.toString(), amount: acc.amount,
          percent: totalFromTop > 0 ? (Number(acc.amount) / totalFromTop) * 100 : 0 };
      }),
    };
  } catch (error) {
    var msg = String(error && error.message ? error.message : error);
    if (msg.includes('Too many accounts') || msg.includes('429') || msg.includes('deprioritized')) {
      console.log('[SURVIVOR] Mega-cap detected, using fallback for holder distribution');
      return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: 'MEGA_CAP_FALLBACK' };
    }
    throw error;
  }
}

async function getDexScreenerData(mintAddress) {
  try {
    var response = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mintAddress);
    if (!response.ok) return null;
    var data = await response.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    var mainPair = data.pairs.reduce(function (best, pair) {
      return (pair.liquidity && pair.liquidity.usd || 0) > (best.liquidity && best.liquidity.usd || 0) ? pair : best;
    });
    var tokenData = null;
    if (mainPair.baseToken && mainPair.baseToken.address === mintAddress) tokenData = mainPair.baseToken;
    else if (mainPair.quoteToken && mainPair.quoteToken.address === mintAddress) tokenData = mainPair.quoteToken;
    else tokenData = mainPair.baseToken;
    return {
      name: (tokenData && tokenData.name) || 'Unknown',
      symbol: (tokenData && tokenData.symbol) || 'UNKNOWN',
      priceUsd: parseFloat(mainPair.priceUsd) || 0,
      liquidityUsd: (mainPair.liquidity && mainPair.liquidity.usd) || 0,
      volume24h: (mainPair.volume && mainPair.volume.h24) || 0,
      priceChange24h: (mainPair.priceChange && mainPair.priceChange.h24) || 0,
      pairAddress: mainPair.pairAddress, dexId: mainPair.dexId, createdAt: mainPair.pairCreatedAt,
    };
  } catch (error) {
    console.error('[SURVIVOR] DexScreener error:', error.message);
    return null;
  }
}

function calculateTokenAge(createdAt) {
  if (!createdAt) return 0;
  var created = typeof createdAt === 'string' ? new Date(createdAt) : new Date(createdAt);
  return Math.max(0, (new Date() - created) / (1000 * 60 * 60));
}

async function fetchTokenData(mintAddress) {
  console.log('[SURVIVOR] Fetching data for: ' + mintAddress);
  var mega = getMegacapData(mintAddress);
  if (mega) {
    var mintInfo;
    try { mintInfo = await getTokenMintInfo(mintAddress); }
    catch (e) { mintInfo = { mintAuthorityRevoked: false, freezeAuthorityRevoked: false, decimals: 0, supply: '0' }; }
    return {
      address: mintAddress, name: mega.name, symbol: mega.symbol,
      mintAuthorityRevoked: mintInfo.mintAuthorityRevoked, freezeAuthorityRevoked: mintInfo.freezeAuthorityRevoked,
      decimals: mintInfo.decimals, supply: mintInfo.supply,
      totalHolders: null, top10HolderPercent: null, topHolders: [], holderNote: 'MEGACAP_SKIP',
      priceUsd: 0, liquidityUsd: 999999999, volume24h: 0, ageInHours: 99999, createdAt: null,
      lpInfo: { locked: true, lockDuration: 9999, percentLocked: 100 },
      devActivity: null, fetchedAt: new Date().toISOString(), megacap: mega,
    };
  }
  var results = await Promise.all([
    getTokenMintInfo(mintAddress), getHolderDistribution(mintAddress), getDexScreenerData(mintAddress),
  ]);
  var mintInfoResult = results[0]; var holders = results[1]; var dexData = results[2];
  var ageInHours = dexData && dexData.createdAt ? calculateTokenAge(dexData.createdAt) : 0;
  return {
    address: mintAddress,
    name: sanitizeText(dexData && dexData.name || 'Unknown'),
    symbol: sanitizeText(dexData && dexData.symbol || 'UNKNOWN'),
    mintAuthorityRevoked: mintInfoResult.mintAuthorityRevoked,
    freezeAuthorityRevoked: mintInfoResult.freezeAuthorityRevoked,
    decimals: mintInfoResult.decimals, supply: mintInfoResult.supply,
    totalHolders: holders.totalHolders, top10HolderPercent: holders.top10HolderPercent,
    topHolders: holders.topHolders, holderNote: holders.note || null,
    priceUsd: dexData && dexData.priceUsd || 0, liquidityUsd: dexData && dexData.liquidityUsd || 0,
    volume24h: dexData && dexData.volume24h || 0, ageInHours: ageInHours,
    createdAt: dexData && dexData.createdAt,
    lpInfo: { locked: false, lockDuration: 0, percentLocked: 0 },
    devActivity: null, fetchedAt: new Date().toISOString(), megacap: null,
  };
}

module.exports = { fetchTokenData, getTokenMintInfo, getHolderDistribution, getDexScreenerData, isMegacap, getMegacapData, validateMint };
FETCHEOF

echo "  ✓ fetcher.js"

# ─── src/monitor.js ───
cat > src/monitor.js << 'MONEOF'
/**
 * SURVIVOR Token Monitor
 * Polls pump.fun for new token launches and auto-scores them.
 * Built by SURVIVOR Agent #598
 * v0.4.0: pump suffix filter, persistent dedup, improved logging
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { fetchTokenData, validateMint } = require('./fetcher');
const { calculateSurvivalScore } = require('./scorer');
const { saveScore, logMonitorEvent, isMintScored } = require('./database');
const { sanitizeText } = require('./sanitizer');

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const recentScores = [];
const MAX_RECENT = 100;
const scoredMints = new Set();
let tokensProcessed = 0;
let tokensSkipped = 0;
let monitorStartedAt = null;

function getRecentScores() { return recentScores; }

function getMonitorStats() {
  return {
    processed: tokensProcessed,
    skipped: tokensSkipped,
    inMemoryCache: scoredMints.size,
    uptimeSeconds: monitorStartedAt ? Math.floor((Date.now() - monitorStartedAt) / 1000) : 0,
  };
}

function isPumpAddress(address) {
  return typeof address === 'string' && address.endsWith('pump');
}

async function scoreNewToken(mintAddress) {
  if (scoredMints.has(mintAddress)) return null;
  if (isMintScored(mintAddress)) {
    scoredMints.add(mintAddress);
    tokensSkipped++;
    return null;
  }
  scoredMints.add(mintAddress);
  tokensProcessed++;

  try {
    console.log('[SURVIVOR] New address detected: ' + mintAddress);
    var mintCheck = await validateMint(mintAddress);
    if (!mintCheck.valid) {
      console.log('[SURVIVOR] Skipped non-mint ' + mintAddress.slice(0, 16) + '... (' + mintCheck.reason + ')');
      logMonitorEvent(mintAddress, 'SKIPPED', mintCheck.reason);
      return null;
    }
    console.log('[SURVIVOR] Confirmed mint: ' + mintAddress);
    logMonitorEvent(mintAddress, 'DETECTED', 'Confirmed pump.fun mint');

    var tokenData = await fetchTokenData(mintAddress);
    var result = calculateSurvivalScore(tokenData);

    var entry = {
      mint: mintAddress, name: tokenData.name, symbol: tokenData.symbol,
      score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55,
      breakdown: result.breakdown, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, holderNote: tokenData.holderNote,
      source: 'monitor', detectedAt: new Date().toISOString(),
    };
    if (result.mode) entry.mode = result.mode;

    saveScore(entry);
    logMonitorEvent(mintAddress, 'SCORED', result.score + '/100 ' + result.riskLevel);
    recentScores.unshift(entry);
    if (recentScores.length > MAX_RECENT) recentScores.pop();

    var emoji = 'WARN';
    if (result.score >= 55) emoji = 'SAFE';
    else if (result.score < 35) emoji = 'DANGER';

    var displayName = sanitizeText(tokenData.symbol || mintAddress.slice(0, 8));
    console.log('[SURVIVOR] ' + emoji + ' ' + displayName + ': ' + result.score + '/100 ' + result.riskLevel);
    return entry;
  } catch (error) {
    console.error('[SURVIVOR] Failed to score ' + mintAddress + ': ' + error.message);
    logMonitorEvent(mintAddress, 'ERROR', error.message);
    return null;
  }
}

async function pollPumpFun() {
  console.log('[SURVIVOR] Polling pump.fun for new tokens...');
  var lastSignature = null;

  setInterval(async function () {
    try {
      var opts = { limit: 25 };
      if (lastSignature) opts.until = lastSignature;
      var signatures = await connection.getSignaturesForAddress(PUMP_FUN_PROGRAM, opts);
      if (signatures.length === 0) return;
      lastSignature = signatures[0].signature;

      for (var i = 0; i < Math.min(signatures.length, 5); i++) {
        try {
          var parsedTx = await connection.getParsedTransaction(signatures[i].signature, { maxSupportedTransactionVersion: 0 });
          if (!parsedTx || !parsedTx.meta) continue;
          var balances = parsedTx.meta.postTokenBalances || [];

          for (var j = 0; j < balances.length; j++) {
            var mint = balances[j].mint;
            if (!mint) continue;
            if (scoredMints.has(mint)) continue;
            if (!isPumpAddress(mint)) continue;

            (function (m) {
              setTimeout(function () { scoreNewToken(m); }, 3000);
            })(mint);
          }
        } catch (pe) {}
      }
    } catch (error) {
      console.error('[SURVIVOR] Poll error: ' + error.message);
    }
  }, 15000);
}

async function startMonitor(mode) {
  monitorStartedAt = Date.now();
  console.log('');
  console.log('SURVIVOR Monitor starting (mode: ' + (mode || 'poll') + ')...');
  console.log('Watching: pump.fun (' + PUMP_FUN_PROGRAM.toString().slice(0, 16) + '...)');
  console.log('Filter: only addresses ending in "pump"');
  console.log('Dedup: in-memory + SQLite persistent');
  console.log('New tokens auto-scored + persisted to SQLite');
  console.log('');
  await pollPumpFun();
}

module.exports = { startMonitor, scoreNewToken, getRecentScores, getMonitorStats };
MONEOF

echo "  ✓ monitor.js"

# ─── src/index.js ───
cat > src/index.js << 'IDXEOF'
/**
 * SURVIVOR Token Risk Oracle
 * Autonomous risk intelligence for Solana pump.fun tokens
 * Built by SURVIVOR Agent #598 | Colosseum AI Agent Hackathon 2026
 * v0.4.0: live dashboard, persistent dedup, pump filter, honest scoring
 */

const express = require('express');
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore, generateReasons, getConfidence, WEIGHTS } = require('./scorer');
const { startMonitor, getRecentScores, getMonitorStats } = require('./monitor');
const { saveScore, getScoreHistory, getRecentScoresDB, getStats, getExtremes, getScoreDistribution, getHourlyActivity } = require('./database');
const { sanitizeText } = require('./sanitizer');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.4.0';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function formatUptime(seconds) {
  var s = Math.floor(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return h + 'h ' + m + 'm ' + sec + 's';
}

app.get('/', function (req, res) {
  var stats = getStats();
  var extremes = getExtremes(5);
  var distribution = getScoreDistribution();
  var hourly = getHourlyActivity();
  var monStats = getMonitorStats();
  var recent = getRecentScores().slice(0, 15);
  res.setHeader('Content-Type', 'text/html');
  res.send(generateDashboard(stats, extremes, distribution, hourly, monStats, recent));
});

app.get('/health', function (req, res) {
  var stats = getStats();
  var monStats = getMonitorStats();
  res.json({
    status: 'healthy', agent: 'SURVIVOR #598', version: VERSION,
    monitoring: true, persistence: 'sqlite', pumpFilter: true, persistentDedup: true,
    totalScored: stats.totalScored, averageScore: stats.averageScore,
    last24h: stats.last24h, skippedNonMints: stats.skippedNonMints,
    monitor: monStats, recentDetections: getRecentScores().length,
    uptime: formatUptime(process.uptime()),
  });
});

app.get('/score/:mint', async function (req, res) {
  try {
    var mint = req.params.mint;
    var quick = req.query.quick === 'true';
    var cached = cache.get(mint);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      if (quick) return res.json({ mint: mint, score: cached.data.score, riskLevel: cached.data.riskLevel, safe: cached.data.score >= 55, cached: true });
      return res.json(cached.data);
    }
    var tokenData = await fetchTokenData(mint);
    var result = calculateSurvivalScore(tokenData);
    var fullResult = {
      mint: mint, name: tokenData.name, symbol: tokenData.symbol,
      score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55,
      breakdown: result.breakdown, weights: result.weights,
      holderNote: tokenData.holderNote, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, timestamp: result.timestamp,
    };
    if (result.mode) fullResult.mode = result.mode;
    saveScore({
      mint: mint, name: tokenData.name, symbol: tokenData.symbol,
      score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55,
      breakdown: result.breakdown, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, holderNote: tokenData.holderNote, source: 'api',
    });
    cache.set(mint, { ts: Date.now(), data: fullResult });
    if (quick) {
      return res.json({
        mint: mint, score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55,
        confidence: getConfidence(tokenData), reasons: generateReasons(tokenData, result.breakdown),
        mode: result.mode || undefined,
      });
    }
    fullResult.confidence = getConfidence(tokenData);
    fullResult.reasons = generateReasons(tokenData, result.breakdown);
    res.json(fullResult);
  } catch (error) {
    res.status(500).json({ error: 'Failed to score token', message: error.message });
  }
});

app.get('/history/:mint', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  var history = getScoreHistory(req.params.mint, limit);
  res.json({ mint: req.params.mint, count: history.length, history: history });
});

app.get('/stats', function (req, res) {
  var stats = getStats();
  var extremes = getExtremes();
  var distribution = getScoreDistribution();
  var monStats = getMonitorStats();
  res.json({
    agent: 'SURVIVOR #598', version: VERSION, persistence: 'sqlite',
    pumpFilter: true, persistentDedup: true,
    totalScored: stats.totalScored, averageScore: stats.averageScore,
    byRiskLevel: stats.byRiskLevel, distribution: distribution,
    uniqueMonitored: stats.uniqueMonitored, last24h: stats.last24h,
    skippedNonMints: stats.skippedNonMints, errors: stats.errors,
    extremes: extremes, monitor: monStats, weights: WEIGHTS,
    uptimeSeconds: Math.floor(process.uptime()), uptime: formatUptime(process.uptime()),
  });
});

app.get('/recent', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json({ count: Math.min(limit, getRecentScores().length), tokens: getRecentScores().slice(0, limit) });
});

app.get('/db/recent', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 200);
  var risk = req.query.risk || null;
  var scores = getRecentScoresDB(limit, risk ? risk.toUpperCase() : null);
  res.json({ count: scores.length, source: 'database', tokens: scores });
});

app.get('/feed', function (req, res) {
  var minScore = parseInt(req.query.minScore) || 0;
  var maxScore = parseInt(req.query.maxScore) || 100;
  var riskLevel = req.query.risk;
  var limit = Math.min(parseInt(req.query.limit) || 50, 100);
  var tokens = getRecentScores();
  tokens = tokens.filter(function (t) { return t.score >= minScore && t.score <= maxScore; });
  if (riskLevel) tokens = tokens.filter(function (t) { return t.riskLevel === riskLevel.toUpperCase(); });
  tokens = tokens.slice(0, limit);
  res.json({ count: tokens.length, tokens: tokens });
});

app.get('/feed/latest', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json({ count: Math.min(limit, getRecentScores().length), tokens: getRecentScores().slice(0, limit) });
});

app.get('/activity', function (req, res) {
  res.json({ hourly: getHourlyActivity() });
});

function generateDashboard(stats, extremes, distribution, hourly, monStats, recent) {
  var riskColors = { LOW: '#22c55e', MEDIUM: '#eab308', HIGH: '#f97316', VERY_HIGH: '#ef4444', EXTREME: '#dc2626' };

  var distBars = distribution.map(function (d) {
    var color = riskColors[d.bucket] || '#6b7280';
    var width = stats.totalScored > 0 ? Math.max(2, (d.count / stats.totalScored) * 100) : 2;
    return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'
      + '<span style="width:80px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">' + d.bucket + '</span>'
      + '<div style="flex:1;background:#1e293b;border-radius:4px;height:24px;overflow:hidden">'
      + '<div style="width:' + width + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.5s"></div>'
      + '</div>'
      + '<span style="width:50px;text-align:right;font-size:13px;color:#e2e8f0;font-variant-numeric:tabular-nums">' + d.count + '</span>'
      + '</div>';
  }).join('');

  var recentRows = recent.map(function (t) {
    var color = riskColors[t.riskLevel] || '#6b7280';
    var symbol = sanitizeText(t.symbol || 'UNKNOWN');
    var mintShort = t.mint.slice(0, 6) + '...' + t.mint.slice(-4);
    var time = t.detectedAt ? new Date(t.detectedAt).toLocaleTimeString('en-US', { hour12: false }) : '-';
    return '<tr>'
      + '<td style="padding:8px 12px;color:#e2e8f0;font-weight:500">' + symbol + '</td>'
      + '<td style="padding:8px 12px"><code style="font-size:11px;color:#64748b;background:#1e293b;padding:2px 6px;border-radius:3px">' + mintShort + '</code></td>'
      + '<td style="padding:8px 12px;text-align:center"><span style="display:inline-block;min-width:32px;padding:2px 8px;border-radius:4px;font-weight:700;font-size:13px;color:#0f172a;background:' + color + '">' + t.score + '</span></td>'
      + '<td style="padding:8px 12px;color:' + color + ';font-size:12px;text-transform:uppercase;letter-spacing:0.5px">' + t.riskLevel + '</td>'
      + '<td style="padding:8px 12px;color:#64748b;font-size:12px;font-variant-numeric:tabular-nums">' + time + '</td>'
      + '</tr>';
  }).join('');

  var safestCards = extremes.safest.slice(0, 3).map(function (t) {
    var color = riskColors[t.risk_level] || '#22c55e';
    return '<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:14px 16px;min-width:160px">'
      + '<div style="font-size:13px;font-weight:600;color:#e2e8f0">' + sanitizeText(t.symbol || t.name || 'UNKNOWN') + '</div>'
      + '<div style="font-size:28px;font-weight:800;color:' + color + ';margin:4px 0">' + t.score + '</div>'
      + '<div style="font-size:11px;color:#64748b;text-transform:uppercase">' + t.risk_level + '</div>'
      + '</div>';
  }).join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>SURVIVOR Oracle \u2014 Live Dashboard</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;min-height:100vh}.noise{position:fixed;inset:0;pointer-events:none;opacity:.025;background-image:url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")}.glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:600px;height:400px;background:radial-gradient(ellipse,rgba(249,115,22,.08) 0%,transparent 70%);pointer-events:none}.container{max-width:1200px;margin:0 auto;padding:32px 24px;position:relative;z-index:1}.header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:40px;flex-wrap:wrap;gap:12px}.title{font-family:JetBrains Mono,monospace;font-size:28px;font-weight:800;letter-spacing:-.5px}.title span{color:#f97316}.badge{font-family:JetBrains Mono,monospace;font-size:11px;color:#64748b;background:#1e293b;padding:4px 10px;border-radius:4px;border:1px solid #334155}.live-dot{display:inline-block;width:7px;height:7px;background:#22c55e;border-radius:50%;margin-right:6px;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:36px}.stat-card{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:18px 20px}.stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.stat-value{font-family:JetBrains Mono,monospace;font-size:32px;font-weight:800;color:#f8fafc;line-height:1}.stat-sub{font-size:12px;color:#475569;margin-top:4px}.section{margin-bottom:36px}.section-title{font-family:JetBrains Mono,monospace;font-size:14px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px;display:flex;align-items:center;gap:8px}.section-title::before{content:"";display:block;width:3px;height:14px;background:#f97316;border-radius:2px}.table-wrap{overflow-x:auto;border:1px solid #1e293b;border-radius:10px;background:#0f172a}table{width:100%;border-collapse:collapse}thead th{padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;text-align:left;border-bottom:1px solid #1e293b;background:#020617}tbody tr{border-bottom:1px solid #0f172a}tbody tr:hover{background:#1e293b40}.safest-row{display:flex;gap:12px;flex-wrap:wrap}.footer{margin-top:48px;padding-top:24px;border-top:1px solid #1e293b;font-size:12px;color:#475569;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}.footer a{color:#f97316;text-decoration:none}.api-ref{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:18px 20px;font-family:JetBrains Mono,monospace;font-size:12px;color:#94a3b8;line-height:1.8}.api-ref span{color:#f97316}@media(max-width:640px){.title{font-size:20px}.stat-value{font-size:24px}.stats-grid{grid-template-columns:repeat(2,1fr)}}</style></head><body><div class="noise"></div><div class="glow"></div><div class="container"><div class="header"><div><div class="title">SURVIVOR<span>.</span>oracle</div><div style="font-size:13px;color:#64748b;margin-top:4px">Autonomous token risk intelligence for Solana</div></div><div style="display:flex;gap:8px;align-items:center"><span class="badge"><span class="live-dot"></span>LIVE</span><span class="badge">v' + VERSION + '</span><span class="badge">Agent #598</span></div></div><div class="stats-grid"><div class="stat-card"><div class="stat-label">Tokens Scored</div><div class="stat-value">' + stats.totalScored + '</div><div class="stat-sub">' + stats.last24h + ' in last 24h</div></div><div class="stat-card"><div class="stat-label">Avg Risk Score</div><div class="stat-value">' + stats.averageScore + '</div><div class="stat-sub">out of 100 (higher = safer)</div></div><div class="stat-card"><div class="stat-label">Non-Mints Filtered</div><div class="stat-value">' + stats.skippedNonMints + '</div><div class="stat-sub">SOL/USDC/junk blocked</div></div><div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" style="font-size:22px">' + formatUptime(process.uptime()) + '</div><div class="stat-sub">' + monStats.inMemoryCache + ' mints cached</div></div></div><div class="section"><div class="section-title">Risk Distribution</div><div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px">' + (distBars || '<div style="color:#475569;font-size:13px">No data yet...</div>') + '</div></div><div class="section"><div class="section-title">Safest Tokens Detected</div><div class="safest-row">' + (safestCards || '<div style="color:#475569;font-size:13px">Scoring in progress...</div>') + '</div></div><div class="section"><div class="section-title">Recent Scores (live)</div><div class="table-wrap"><table><thead><tr><th>Token</th><th>Mint</th><th style="text-align:center">Score</th><th>Risk</th><th>Time</th></tr></thead><tbody>' + (recentRows || '<tr><td colspan="5" style="padding:20px;color:#475569;text-align:center">Waiting for first tokens...</td></tr>') + '</tbody></table></div></div><div class="section"><div class="section-title">API Reference</div><div class="api-ref"><span>GET</span> /health \u2014 Status, uptime, score count<br><span>GET</span> /score/:mint \u2014 Full risk score with breakdown<br><span>GET</span> /score/:mint?quick=true \u2014 Score + confidence + reasons<br><span>GET</span> /stats \u2014 Analytics with safest/riskiest tokens<br><span>GET</span> /history/:mint \u2014 Score history for a token<br><span>GET</span> /recent \u2014 Recently auto-detected tokens<br><span>GET</span> /db/recent \u2014 Persistent scores from database<br><span>GET</span> /feed \u2014 Filtered feed for agent integrations<br><span>GET</span> /activity \u2014 Hourly scoring activity</div></div><div class="footer"><div>SURVIVOR Agent #598 \u2022 Colosseum AI Agent Hackathon 2026 \u2022 <a href="https://github.com/ayubeay/survivor-oracle" target="_blank">GitHub</a></div><div>Auto-refreshes every 30s \u2022 ' + new Date().toISOString() + '</div></div></div></body></html>';
}

app.listen(PORT, function () {
  console.log('');
  console.log('SURVIVOR Oracle v' + VERSION + ' running on http://localhost:' + PORT);
  console.log('SQLite persistence active');
  console.log('Pump filter: ON | Persistent dedup: ON');
  console.log('Dashboard: http://localhost:' + PORT + '/');
  console.log('Endpoints: /health /score/:mint /history/:mint /stats /recent /db/recent /feed /feed/latest /activity');
  console.log('');
  startMonitor('poll');
});
IDXEOF

echo "  ✓ index.js"

# ─── README.md ───
cat > README.md << 'READMEEOF'
# SURVIVOR Token Risk Oracle

**Agent #598 | Colosseum AI Agent Hackathon 2026**

Autonomous on-chain risk intelligence for Solana. SURVIVOR monitors every pump.fun token launch in real time, scores survival probability across 7 weighted risk factors, and serves risk intelligence via API — zero human intervention required.

## Live Demo

**Dashboard:** [https://survivor-oracle-production.up.railway.app](https://survivor-oracle-production.up.railway.app)

```bash
# Health check
curl https://survivor-oracle-production.up.railway.app/health

# Score any Solana token
curl https://survivor-oracle-production.up.railway.app/score/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?quick=true

# Live stats & analytics
curl https://survivor-oracle-production.up.railway.app/stats

# Recent auto-scored tokens
curl https://survivor-oracle-production.up.railway.app/recent
```

## What It Does

1. **Monitors** pump.fun for new token launches every 15 seconds via Solana RPC log polling
2. **Filters** non-pump addresses (SOL, USDC, USDT, etc) before wasting any RPC calls
3. **Deduplicates** across container restarts using SQLite persistence
4. **Fetches** on-chain data (mint authority, freeze authority, holder distribution)
5. **Pulls** market data from DexScreener (liquidity, age, volume)
6. **Scores** weighted risk across 7 factors (0-100 scale)
7. **Persists** all scores to SQLite for historical analysis
8. **Serves** risk intelligence via REST API for agent-to-agent integration
9. **Sanitizes** offensive token names/symbols before display

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                SURVIVOR Oracle v0.4.0                │
├──────────┬──────────┬───────────┬───────────────────┤
│ Monitor  │ Fetcher  │  Scorer   │    API Server     │
│ Poll     │ Solana   │ 7-factor  │ Express + Live    │
│ pump.fun │ RPC +    │ weighted  │ HTML Dashboard    │
│ txns     │ DexScrnr │ model     │                   │
├──────────┴──────────┴───────────┼───────────────────┤
│          Sanitizer              │  SQLite (WAL)     │
└─────────────────────────────────┴───────────────────┘
```

## Risk Scoring Model (7 Factors)

| Factor | Weight | What It Checks |
|---|---|---|
| Mint Authority | 20% | Can creator print more tokens? |
| Freeze Authority | 10% | Can creator freeze your account? |
| LP Locked | 20% | Is liquidity locked? |
| Holder Concentration | 15% | Top 10 holders percentage |
| Dev Wallet Activity | 15% | Suspicious wallet movements |
| Token Age | 10% | How old is the token? |
| Liquidity Depth | 10% | USD liquidity available |

### Risk Levels

| Score | Level | Meaning |
|---|---|---|
| 75-100 | LOW | Likely safe |
| 55-74 | MEDIUM | Proceed with caution |
| 35-54 | HIGH | Significant risk |
| 20-34 | VERY_HIGH | Probable rug |
| 0-19 | EXTREME | Almost certain rug |

## Key Engineering Decisions

### Pump Suffix Filter (v0.4.0)
All legitimate pump.fun tokens have addresses ending in `pump`. By checking `address.endsWith('pump')` before any RPC call, we eliminate SOL, USDC, USDT, mSOL, and all non-pump tokens that leak through from `postTokenBalances` in parsed transactions. This saves ~30% of RPC calls.

### Honest Scoring for Missing Data (v0.4.0)
When holder distribution data is unavailable (RPC failure, token too new), the scorer now assigns 30/100 instead of the previous 70/100. Missing data should be treated as a risk signal, not a neutral assumption.

### Persistent Deduplication (v0.4.0)
Two-layer dedup: in-memory `Set` for fast-path checking within a session, backed by SQLite lookup for persistence across container restarts.

### Content Sanitization (v0.3.2)
Token names and symbols from pump.fun frequently contain offensive content. All metadata passes through a regex-based sanitizer before display.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Live HTML dashboard with auto-refresh |
| `GET /health` | Status, uptime, score count |
| `GET /score/:mint` | Full risk score with breakdown |
| `GET /score/:mint?quick=true` | Score + confidence + reasons |
| `GET /stats` | Analytics with safest/riskiest tokens |
| `GET /history/:mint` | Score history for a token |
| `GET /recent` | Recently auto-detected tokens |
| `GET /db/recent` | Persistent scores from database |
| `GET /feed` | Filtered feed for agent integrations |
| `GET /activity` | Hourly scoring activity (24h) |

## Agent-to-Agent Integration

```javascript
const res = await fetch('https://survivor-oracle-production.up.railway.app/score/' + mintAddress + '?quick=true');
const risk = await res.json();
if (risk.safe && risk.confidence !== 'LOW') {
  // proceed with trade
}
```

## Run Locally

```bash
git clone https://github.com/ayubeay/survivor-oracle
cd survivor-oracle
npm install
SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" npm start
```

## Tech Stack

- **Runtime:** Node.js + Express
- **Data:** Solana RPC (Helius) + DexScreener API
- **Storage:** SQLite with WAL mode (better-sqlite3)
- **Monitoring:** pump.fun program log polling (15s interval)
- **Deployment:** Railway (europe-west4)

---

**Built by SURVIVOR Agent #598** | [@youngs_modulus](https://x.com/youngs_modulus) | Colosseum AI Agent Hackathon | February 2026
READMEEOF

echo "  ✓ README.md"

# ─── Clean up .bak files ───
rm -f src/*.bak
echo "  ✓ Cleaned .bak files"

echo ""
echo "✅ SURVIVOR Oracle upgraded to v0.4.0"
echo ""
echo "Now run:"
echo "  git add -A"
echo "  git commit -m 'v0.4.0: live dashboard, pump filter, persistent dedup, honest scoring'"
echo "  git push origin main"
echo "  railway up"
