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
  const safest = db.prepare(
    'SELECT DISTINCT mint,name,symbol,score,risk_level,created_at FROM scores ORDER BY score DESC LIMIT ?'
  ).all(limit);

  const riskiest = db.prepare(
    'SELECT DISTINCT mint,name,symbol,score,risk_level,created_at FROM scores ORDER BY score ASC LIMIT ?'
  ).all(limit);

  return { safest, riskiest };
}

function getScoreDistribution() {
  return db.prepare(`
    SELECT
      risk_level as bucket,
      COUNT(*) as count,
      ROUND(AVG(score), 1) as avg_score
    FROM scores
    GROUP BY risk_level
    ORDER BY count DESC
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


// =========================================================
// PHASE 2: Temporal rescoring + volatility detection
// =========================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS score_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    score INTEGER NOT NULL,
    risk_level TEXT NOT NULL,
    confidence REAL,
    model_version TEXT,
    scoring_version TEXT,
    reason_codes TEXT,
    score_delta INTEGER,
    volatility_flag INTEGER DEFAULT 0,
    bait_and_switch_flag INTEGER DEFAULT 0,
    rescore_window TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rescore_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    window TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_history_mint ON score_history(mint);
  CREATE INDEX IF NOT EXISTS idx_history_created ON score_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_rescore_scheduled ON rescore_queue(scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_rescore_completed ON rescore_queue(completed);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rescore_unique ON rescore_queue(mint, window);
`);

const insertScoreHistory = db.prepare(
  'INSERT INTO score_history (mint,score,risk_level,confidence,model_version,scoring_version,reason_codes,score_delta,volatility_flag,bait_and_switch_flag,rescore_window) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
);

const insertRescoreQueue = db.prepare(
  'INSERT OR IGNORE INTO rescore_queue (mint,scheduled_at,window) VALUES (?,?,?)'
);

const markRescoreComplete = db.prepare(
  'UPDATE rescore_queue SET completed=1 WHERE id=?'
);

const getDueRescores = db.prepare(
  "SELECT * FROM rescore_queue WHERE completed=0 AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC LIMIT 10"
);

const getLastScoreForMint = db.prepare(
  'SELECT score, risk_level, created_at FROM score_history WHERE mint=? ORDER BY created_at DESC LIMIT 1'
);

const getScoreHistoryV2 = db.prepare(
  'SELECT * FROM score_history WHERE mint=? ORDER BY created_at DESC LIMIT ?'
);

function saveScoreHistory(data) {
  return insertScoreHistory.run(
    data.mint, data.score, data.riskLevel, data.confidence || null,
    data.modelVersion || null, data.scoringVersion || null,
    data.reasonCodes ? JSON.stringify(data.reasonCodes) : null,
    data.scoreDelta ?? null, data.volatilityFlag ? 1 : 0,
    data.baitAndSwitchFlag ? 1 : 0, data.rescoreWindow || 'initial'
  );
}

function scheduleRescores(mint) {
  const now = Date.now();
  const windows = [
    { offset: 5 * 60 * 1000, label: '5m' },
    { offset: 30 * 60 * 1000, label: '30m' },
    { offset: 2 * 60 * 60 * 1000, label: '2h' },
  ];
  for (const w of windows) {
    const scheduledAt = new Date(now + w.offset)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    insertRescoreQueue.run(mint, scheduledAt, w.label);
  }
}

function getDueRescoresList() {
  return getDueRescores.all();
}

function completeRescore(id) {
  return markRescoreComplete.run(id);
}

function getLastScore(mint) {
  return getLastScoreForMint.get(mint);
}

function getScoreHistoryPhase2(mint, limit = 20) {
  return getScoreHistoryV2.all(mint, limit);
}

module.exports = {
  db, saveScore, logMonitorEvent, isMintScored, getScoreHistory,
  getRecentScoresDB, getStats, getExtremes, getScoreDistribution, getHourlyActivity,
  // Phase 2
  saveScoreHistory, scheduleRescores, getDueRescoresList, completeRescore,
  getLastScore, getScoreHistoryPhase2,
};
