/**
 * attest.js — POST /attest endpoint for Shield Router
 *
 * Plugs into the Survivor Express app.
 * Scores the mint via Survivor's internal scorer,
 * then returns a signed attestation.
 *
 * Mount in your main server file:
 *   const attestRouter = require('./attest');
 *   app.use('/attest', attestRouter);
 *
 * Or as a single route:
 *   app.post('/attest', require('./attest').handler);
 */

const express = require('express');
const path = require('path');
const router  = express.Router();
const { apiKeyGate } = require("./apikeys");
const credits = require("./credits");
const bs58mod = require("bs58");
const bs58 = bs58mod.default || bs58mod;
const nacl = require("tweetnacl");
const { buildAttestation, getSignerPubkey } = require('./signer');

// ── Internal scorer ───────────────────────────────────────────────────────────
// Calls Survivor's own scoring logic. Adjust import path to match your structure.
// Common patterns:
//   require('./scorer')       if scorer.js is at root
//   require('./src/scorer')   if inside src/
//
// Your scorer must export: scoreToken(mint) → { score, riskLevel, reasons, ... }
// scoreToken can be async.

const { fetchTokenData } = require("./fetcher");
const { calculateSurvivalScore: calcScore } = require("./scorer");

async function scoreToken(mint) {
  const data = await fetchTokenData(mint);
  if (!data) throw new Error("fetchTokenData returned null");
  const result = calcScore(data);
  const score = typeof result === "object" ? result.score : result;
  const riskLevel = typeof result === "object" ? result.riskLevel : (score >= 75 ? "LOW" : score >= 55 ? "MEDIUM" : score >= 35 ? "HIGH" : score >= 20 ? "VERY_HIGH" : "EXTREME");
  return { score, riskLevel, reasons: result.reasons || [] };
}

// ── Validation ────────────────────────────────────────────────────────────────

const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function validateRequest(body) {
  const { mint, router_program_id, domain } = body;

  if (!mint || !BASE58_MINT_RE.test(mint)) {
    return 'Invalid or missing mint address';
  }
  if (!router_program_id || !BASE58_MINT_RE.test(router_program_id)) {
    return 'Invalid or missing router_program_id';
  }
  if (domain && domain !== 'shield-router-v1') {
    return 'Invalid domain — must be "shield-router-v1"';
  }
  return null;
}

// ── Score fetcher ─────────────────────────────────────────────────────────────

async function fetchScore(mint) {
  // Path 1: use internal scorer function directly (fastest, no HTTP overhead)
  if (scoreToken) {
    const result = await scoreToken(mint);
    return {
      score:     result.score,
      riskLevel: result.riskLevel || result.risk_level,
      reasons:   result.reasons || [],
    };
  }

  // Path 2: call own /score endpoint (fallback if scorer not directly importable)
  const baseUrl = process.env.SURVIVOR_INTERNAL_URL || 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/score/${mint}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Survivor score HTTP ${res.status}`);
  const data = await res.json();

  return {
    score:     data.score,
    riskLevel: data.riskLevel || data.risk_level,
    reasons:   data.reasons || [],
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req, res) {
  // Validate request body
  const validationError = validateRequest(req.body);
  if (validationError) {
    return res.status(400).json({
      error:   'INVALID_REQUEST',
      message: validationError,
    });
  }

  const { mint, router_program_id, domain = 'shield-router-v1' } = req.body;

  // Verify router_program_id matches configured program (prevent mis-targeting)
  const configuredProgramId = process.env.SHIELD_ROUTER_PROGRAM_ID;
  if (configuredProgramId && router_program_id !== configuredProgramId) {
    return res.status(400).json({
      error:   'PROGRAM_MISMATCH',
      message: 'router_program_id does not match configured Shield Router program',
    });
  }

  // Cache check
  if(attestCache){try{var nowSec=Math.floor(Date.now()/1000);var cached=attestCache.get.get(mint,domain,router_program_id,nowSec);if(cached){cacheHits++;console.log("[attest] CACHE HIT "+mint.slice(0,12)+"...");return res.json({attestation:JSON.parse(cached.attestation_json),signature:cached.signature,signer:cached.signer,meta:{score:cached.score,risk_level:cached.risk_level,reasons:[],scored_at:cached.created_at,cached:true}});}}catch(e){console.warn("[attest] Cache read err:",e.message);}}
  cacheMisses++;
  // Fetch Survivor score
  let scoreData;
  try {
    scoreData = await fetchScore(mint);
  } catch (err) {
    console.error(`[attest] Score fetch failed for ${mint}:`, err.message);
    return res.status(503).json({
      error:   'SCORING_FAILED',
      message: 'Could not score mint — try again shortly',
    });
  }

  const { score, riskLevel, reasons } = scoreData;

  if (score === undefined || score === null || !riskLevel) {
    return res.status(503).json({
      error:   'SCORING_INCOMPLETE',
      message: 'Scorer returned incomplete data',
    });
  }

  // Build signed attestation
  let attestationResult;
  try {
    attestationResult = buildAttestation(mint, score, riskLevel);
  } catch (err) {
    console.error(`[attest] Signing failed for ${mint}:`, err.message);
    return res.status(500).json({
      error:   'SIGNING_FAILED',
      message: 'Attestation signing failed — check ORACLE_SIGNER_PRIVKEY',
    });
  }

  const { attestation, signature, signer } = attestationResult;

  // Cache store
  if(attestCache){try{attestCache.set.run(mint,domain,router_program_id,JSON.stringify(attestation),signature,signer,score,riskLevel,attestation.expires_at);}catch(e){console.warn("[attest] Cache write err:",e.message);}}
  // Log for audit trail
  console.log(
    `[attest] ${mint} → tier=${attestation.tier} score=${score} risk=${riskLevel} ` +
    `expires=${attestation.expires_at} nonce=${attestation.nonce.slice(0, 8)}...`
  );

  // Response
  return res.status(200).json({
    attestation,
    signature,
    signer,
    meta: {
      score,
      risk_level: riskLevel,
      reasons,
      scored_at:  new Date().toISOString(),
    },
  });
}

// ── Rate limiting (simple in-memory, replace with Redis for prod) ──────────────


// ── Attestation Cache (SQLite) ────────────────────────────────────────────────
let attestCache=null,cacheHits=0,cacheMisses=0;
if(process.env.ATTEST_CACHE_ENABLED!=="false"){try{
const Database=require("better-sqlite3");
const DB_DIR=path.dirname(process.env.ATTEST_DB_PATH||path.join(__dirname,"..","attestations.db"));
try{require("fs").mkdirSync(DB_DIR,{recursive:true});}catch(e){}
const DB_PATH=process.env.ATTEST_DB_PATH||path.join(__dirname,"..","attestations.db");
const adb=new Database(DB_PATH);adb.pragma("journal_mode = WAL");
adb.exec("CREATE TABLE IF NOT EXISTS attestation_cache(mint TEXT NOT NULL,domain TEXT NOT NULL,router_program_id TEXT NOT NULL,attestation_json TEXT NOT NULL,signature TEXT NOT NULL,signer TEXT NOT NULL,score INTEGER NOT NULL,risk_level TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT DEFAULT(datetime(\x27now\x27)),PRIMARY KEY(mint,domain,router_program_id));CREATE INDEX IF NOT EXISTS idx_attest_expires ON attestation_cache(expires_at);");
attestCache={
get:adb.prepare("SELECT * FROM attestation_cache WHERE mint=? AND domain=? AND router_program_id=? AND expires_at>? LIMIT 1"),
set:adb.prepare("INSERT OR REPLACE INTO attestation_cache(mint,domain,router_program_id,attestation_json,signature,signer,score,risk_level,expires_at)VALUES(?,?,?,?,?,?,?,?,?)"),
prune:adb.prepare("DELETE FROM attestation_cache WHERE expires_at<?"),
stats:adb.prepare("SELECT COUNT(*)as total,SUM(CASE WHEN expires_at>? THEN 1 ELSE 0 END)as active FROM attestation_cache")
};
attestCache.prune.run(Math.floor(Date.now()/1000));
try{var files=require("fs").readdirSync("/app/data");console.log("[attest] /app/data contents: "+JSON.stringify(files));}catch(e){console.log("[attest] /app/data error: "+e.message);}
console.log("[attest] Cache DB path: "+DB_PATH);
process.on("SIGTERM",function(){try{adb.pragma("wal_checkpoint(TRUNCATE)");adb.close();console.log("[attest] DB flushed and closed");}catch(e){}});
console.log("[attest] Attestation cache: SQLite active");
}catch(e){console.warn("[attest] Cache disabled: "+e.message);}}

const _rateMap = new Map(); // mint → [timestamps]
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_MINT = 10; // max 10 attestations per mint per minute

function rateLimitCheck(mint) {
  const now = Date.now();
  const timestamps = (_rateMap.get(mint) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_PER_MINT) return false;
  timestamps.push(now);
  _rateMap.set(mint, timestamps);
  return true;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post('/', apiKeyGate, async (req, res) => {
  const mint = req.body?.mint;

  // Rate limit per mint
  if (mint && !rateLimitCheck(mint)) {
    return res.status(429).json({
      error:   'RATE_LIMITED',
      message: 'Too many attestation requests for this mint — wait 60s',
    });
  }

  return handler(req, res);
});

// Health/info endpoint
router.get('/signer', (req, res) => {
  try {
    res.json({
      signer:  getSignerPubkey(),
      domain:  'shield-router-v1',
      program: process.env.SHIELD_ROUTER_PROGRAM_ID || 'not_configured',
      status:  'ok',
    });
  } catch (err) {
    res.status(500).json({ error: 'SIGNER_NOT_LOADED', message: err.message });
  }
});


// ── POST /attest/verify ───────────────────────────────────────────────────────
router.post("/verify",function(req,res){try{
var body=req.body||{};var att=body.attestation,sigB58=body.signature,signerB58=body.signer;
if(!att||!sigB58||!signerB58)return res.status(400).json({valid:false,reason:"Missing attestation, signature, or signer"});
var checks={signature_valid:false,signer_matches_oracle:false,not_expired:false,domain_valid:false,program_matches:false,score_in_range:false,tier_consistent:false};
var sigBytes=Buffer.from(bs58.decode(sigB58)),pubBytes=Buffer.from(bs58.decode(signerB58));
if(sigBytes.length!==64)return res.status(400).json({valid:false,reason:"Signature must be 64 bytes",checks:checks});
if(pubBytes.length!==32)return res.status(400).json({valid:false,reason:"Signer must be 32 bytes",checks:checks});
var nonceBuf=Buffer.from(att.nonce,"hex");
if(nonceBuf.length!==16)return res.status(400).json({valid:false,reason:"Invalid nonce",checks:checks});
var mintB=Buffer.from(bs58.decode(att.mint)),routerB=Buffer.from(bs58.decode(att.router_program_id)),domB=Buffer.from(att.domain,"utf8");
var buf=Buffer.alloc(32+1+1+8+8+4+domB.length+32+16),off=0;
mintB.copy(buf,off);off+=32;buf.writeUInt8(att.tier,off);off+=1;buf.writeUInt8(att.score,off);off+=1;
var lo,hi;lo=att.issued_at>>>0;hi=Math.floor(att.issued_at/0x100000000);buf.writeUInt32LE(lo,off);buf.writeInt32LE(hi,off+4);off+=8;
lo=att.expires_at>>>0;hi=Math.floor(att.expires_at/0x100000000);buf.writeUInt32LE(lo,off);buf.writeInt32LE(hi,off+4);off+=8;
buf.writeUInt32LE(domB.length,off);off+=4;domB.copy(buf,off);off+=domB.length;routerB.copy(buf,off);off+=32;nonceBuf.copy(buf,off);
checks.signature_valid=nacl.sign.detached.verify(new Uint8Array(buf),new Uint8Array(sigBytes),new Uint8Array(pubBytes));
try{checks.signer_matches_oracle=(signerB58===getSignerPubkey());}catch(e){}
var nowSec=Math.floor(Date.now()/1000);
checks.not_expired=att.expires_at>nowSec;checks.domain_valid=att.domain==="shield-router-v1";
var cp=process.env.SHIELD_ROUTER_PROGRAM_ID;checks.program_matches=cp?att.router_program_id===cp:true;
checks.score_in_range=att.score>=0&&att.score<=100;
var et=att.score>=75?0:att.score>=55?1:att.score>=35?2:3;checks.tier_consistent=att.tier===et;
var allOk=Object.values(checks).every(function(v){return v===true;});
var failed=Object.entries(checks).filter(function(e){return e[1]===false;}).map(function(e){return e[0];});
return res.json({valid:allOk,reason:allOk?"All checks passed":"Failed: "+failed.join(", "),checks:checks,meta:{verified_at:new Date().toISOString(),ttl_remaining:checks.not_expired?att.expires_at-nowSec:0}});
}catch(err){return res.status(500).json({valid:false,reason:"Verify error: "+err.message});}});

// ── GET /attest/cache/stats ───────────────────────────────────────────────────
router.get("/cache/stats",function(req,res){
if(!attestCache)return res.json({enabled:false,hits:cacheHits,misses:cacheMisses});
try{var nowSec=Math.floor(Date.now()/1000);var r=attestCache.stats.get(nowSec);
res.json({enabled:true,total:r.total,active:r.active,expired:r.total-r.active,hits:cacheHits,misses:cacheMisses,hit_rate:(cacheHits+cacheMisses)>0?Math.round(cacheHits/(cacheHits+cacheMisses)*100)+"%":"N/A"});
}catch(e){res.status(500).json({enabled:true,error:e.message});}});

module.exports = router;
module.exports.handler = handler;
