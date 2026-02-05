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
`);

const insertScore = db.prepare('INSERT INTO scores (mint,name,symbol,score,risk_level,safe,mint_authority,freeze_authority,lp_locked,holder_concentration,dev_wallet,token_age,liquidity_depth,liquidity_usd,age_in_hours,holder_note,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insertMonitorLog = db.prepare('INSERT INTO monitor_log (mint,event,details) VALUES (?,?,?)');

function saveScore(data) {
  return insertScore.run(data.mint, data.name||null, data.symbol||null, data.score, data.riskLevel, data.safe?1:0, data.breakdown?.mintAuthority??null, data.breakdown?.freezeAuthority??null, data.breakdown?.lpLocked??null, data.breakdown?.holderConcentration??null, data.breakdown?.devWalletActivity??null, data.breakdown?.tokenAge??null, data.breakdown?.liquidityDepth??null, data.liquidityUsd||null, data.ageInHours||null, data.holderNote||null, data.source||'api');
}

function logMonitorEvent(mint, event, details) {
  return insertMonitorLog.run(mint, event, details||null);
}

function getScoreHistory(mint, limit=20) {
  return db.prepare('SELECT * FROM scores WHERE mint=? ORDER BY created_at DESC LIMIT ?').all(mint, limit);
}

function getRecentScoresDB(limit=50, riskLevel=null) {
  const rows = db.prepare('SELECT * FROM scores ORDER BY created_at DESC LIMIT ?').all(limit);
  return riskLevel ? rows.filter(s => s.risk_level === riskLevel) : rows;
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM scores').get();
  const byRisk = db.prepare('SELECT risk_level, COUNT(*) as count FROM scores GROUP BY risk_level ORDER BY count DESC').all();
  const avgScore = db.prepare('SELECT AVG(score) as avg FROM scores').get();
  const monitored = db.prepare('SELECT COUNT(DISTINCT mint) as count FROM monitor_log').get();
  const last24h = db.prepare("SELECT COUNT(*) as count FROM scores WHERE created_at > datetime('now', '-1 day')").get();
  return { totalScored: total.count, averageScore: Math.round((avgScore.avg||0)*10)/10, byRiskLevel: byRisk, uniqueMonitored: monitored.count, last24h: last24h.count };
}

function getExtremes(limit=5) {
  const safest = db.prepare('SELECT DISTINCT mint,name,symbol,score,risk_level,created_at FROM scores ORDER BY score DESC LIMIT ?').all(limit);
  const riskiest = db.prepare('SELECT DISTINCT mint,name,symbol,score,risk_level,created_at FROM scores ORDER BY score ASC LIMIT ?').all(limit);
  return { safest, riskiest };
}

module.exports = { db, saveScore, logMonitorEvent, getScoreHistory, getRecentScoresDB, getStats, getExtremes };
