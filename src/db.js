'use strict';
var path = require('path');
var fs = require('fs');
var Database = require('better-sqlite3');

var DB_PATH = process.env.ATTEST_DB_PATH || path.join(__dirname, '..', 'attestations.db');
var DB_DIR = path.dirname(DB_PATH);
try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch(e) {}

var db = new Database(DB_PATH);
db.pragma('journal_mode = DELETE');
db.pragma('synchronous = FULL');
db.pragma('busy_timeout = 5000');

console.log('[db] path: ' + DB_PATH);
console.log('[db] journal_mode: ' + JSON.stringify(db.prepare('PRAGMA journal_mode').get()));
console.log('[db] database_list: ' + JSON.stringify(db.prepare('PRAGMA database_list').all()));

module.exports = { db: db, DB_PATH: DB_PATH };
