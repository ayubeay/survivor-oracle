/**
 * SURVIVOR Receipt Persistence
 * SQLite-backed storage for execution receipts.
 *
 * Uses the Gate service volume mount for persistence across deploys.
 * Default path: /data/receipts.db (Railway volume)
 * Fallback:     /tmp/survivor_receipts.db
 */

'use strict';

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

// ── Config ──────────────────────────────────────────────────────────────────

const DB_DIR  = process.env.RECEIPT_DB_DIR || '/data';
const DB_PATH = process.env.RECEIPT_DB_PATH || path.join(DB_DIR, 'receipts.db');

// ── Init ────────────────────────────────────────────────────────────────────

let db;

function initReceiptDb() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  } catch { /* ignore */ }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      receipt_id    TEXT PRIMARY KEY,
      status        TEXT NOT NULL DEFAULT 'PREPARED',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      caller_ref    TEXT,
      intent_hash   TEXT,
      agent_id      TEXT,
      decision      TEXT,
      drift_score   REAL,
      outcome       TEXT,
      tx_signature  TEXT,
      receipt_json  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_receipts_status     ON receipts(status);
    CREATE INDEX IF NOT EXISTS idx_receipts_agent       ON receipts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_receipts_created     ON receipts(created_at);
    CREATE INDEX IF NOT EXISTS idx_receipts_intent_hash ON receipts(intent_hash);
    CREATE INDEX IF NOT EXISTS idx_receipts_caller_ref  ON receipts(caller_ref);
  `);

  const count = db.prepare('SELECT COUNT(*) as n FROM receipts').get();
  console.log(`[receipt-db] path: ${DB_PATH}`);
  console.log(`[receipt-db] existing receipts: ${count.n}`);

  return db;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

const stmts = {};

function ensureStatements() {
  if (stmts.insert) return;
  stmts.insert = db.prepare(`
    INSERT INTO receipts (
      receipt_id, status, created_at, updated_at, caller_ref,
      intent_hash, agent_id, decision, drift_score,
      outcome, tx_signature, receipt_json
    ) VALUES (
      @receipt_id, @status, @created_at, @updated_at, @caller_ref,
      @intent_hash, @agent_id, @decision, @drift_score,
      @outcome, @tx_signature, @receipt_json
    )
  `);

  stmts.update = db.prepare(`
    UPDATE receipts SET
      status       = @status,
      updated_at   = @updated_at,
      outcome      = @outcome,
      tx_signature = @tx_signature,
      drift_score  = @drift_score,
      receipt_json = @receipt_json
    WHERE receipt_id = @receipt_id
  `);

  stmts.getById = db.prepare('SELECT receipt_json FROM receipts WHERE receipt_id = ?');
  stmts.listRecent = db.prepare('SELECT receipt_json FROM receipts ORDER BY created_at DESC LIMIT ?');
  stmts.listByAgent = db.prepare('SELECT receipt_json FROM receipts WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?');
  stmts.listByStatus = db.prepare('SELECT receipt_json FROM receipts WHERE status = ? ORDER BY created_at DESC LIMIT ?');
  stmts.countByStatus = db.prepare('SELECT status, COUNT(*) as n FROM receipts GROUP BY status');
  stmts.stats = db.prepare(`
    SELECT
      COUNT(*)                                         as total,
      SUM(CASE WHEN status = 'PREPARED' THEN 1 ELSE 0 END)  as prepared,
      SUM(CASE WHEN status = 'FINALIZED' THEN 1 ELSE 0 END) as finalized,
      AVG(drift_score)                                 as avg_drift,
      MIN(created_at)                                  as earliest,
      MAX(created_at)                                  as latest
    FROM receipts
  `);
}

function saveReceipt(receipt) {
  ensureStatements();
  const row = {
    receipt_id:   receipt.header.receipt_id,
    status:       receipt.header.status,
    created_at:   receipt.header.created_at,
    updated_at:   receipt.header.updated_at,
    caller_ref:   receipt.header.caller_ref || null,
    intent_hash:  receipt.intent.intent_hash || null,
    agent_id:     receipt.actor.agent_id || null,
    decision:     receipt.attestation.decision || null,
    drift_score:  receipt.attestation.drift_score || 0,
    outcome:      receipt.execution.outcome || null,
    tx_signature: receipt.execution.tx_signature || null,
    receipt_json: JSON.stringify(receipt),
  };

  stmts.insert.run(row);
  return receipt;
}

function updateReceipt(receipt) {
  ensureStatements();
  const row = {
    receipt_id:   receipt.header.receipt_id,
    status:       receipt.header.status,
    updated_at:   receipt.header.updated_at,
    outcome:      receipt.execution.outcome || null,
    tx_signature: receipt.execution.tx_signature || null,
    drift_score:  receipt.attestation.drift_score || 0,
    receipt_json: JSON.stringify(receipt),
  };

  const result = stmts.update.run(row);
  if (result.changes === 0) throw new Error('Receipt not found');
  return receipt;
}

function getReceipt(receiptId) {
  ensureStatements();
  const row = stmts.getById.get(receiptId);
  if (!row) return null;
  return JSON.parse(row.receipt_json);
}

function listReceipts(limit = 20) {
  ensureStatements();
  return stmts.listRecent.all(limit).map(r => JSON.parse(r.receipt_json));
}

function listByAgent(agentId, limit = 20) {
  ensureStatements();
  return stmts.listByAgent.all(agentId, limit).map(r => JSON.parse(r.receipt_json));
}

function listByStatus(status, limit = 20) {
  ensureStatements();
  return stmts.listByStatus.all(status, limit).map(r => JSON.parse(r.receipt_json));
}

function getStats() {
  ensureStatements();
  return stmts.stats.get();
}

// ── Module ──────────────────────────────────────────────────────────────────

module.exports = {
  initReceiptDb,
  saveReceipt,
  updateReceipt,
  getReceipt,
  listReceipts,
  listByAgent,
  listByStatus,
  getStats,
  DB_PATH,
};
