/**
 * SURVIVOR Token Monitor
 * Polls pump.fun for new token launches and auto-scores them.
 * Built by SURVIVOR Agent #598
 * v0.4.0: pump suffix filter, persistent dedup, improved logging
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { fetchTokenData, validateMint } = require('./fetcher');
const { calculateSurvivalScore } = require('./scorer');
const { saveScore, logMonitorEvent, isMintScored, saveScoreHistory, scheduleRescores } = require('./database');
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

    // Phase 2: save initial score to history + schedule rescores
    try {
      const { getConfidenceFloat, SCORING_VERSION, MODEL_VERSION, buildStructuredReasons } = require("./scorer");
      const structuredReasons = buildStructuredReasons(result.breakdown, tokenData);
      saveScoreHistory({
        mint: mintAddress, score: result.score, riskLevel: result.riskLevel,
        confidence: getConfidenceFloat(tokenData),
        modelVersion: MODEL_VERSION, scoringVersion: SCORING_VERSION,
        reasonCodes: structuredReasons.map(r => r.code),
        scoreDelta: null, volatilityFlag: false, baitAndSwitchFlag: false,
        rescoreWindow: "initial",
      });
      scheduleRescores(mintAddress);
    } catch (e) { console.error("[RESCORE] Init error: " + e.message); }
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
  /* Off by default. At a 15s interval this makes roughly 1,400 RPC calls an hour before
     any scoring, and pump.fun launches constantly so most ticks trigger a full score too -
     mint info, holder distribution with retries, transfer control, liquidity. It exhausted
     the Helius quota, which then broke on-demand scoring: the thing that is actually used.

     The feed it populates has no readers. Set MONITOR_ENABLED=true to run it. */
  if (process.env.MONITOR_ENABLED !== 'true') {
    console.log('[SURVIVOR] Monitor DISABLED (set MONITOR_ENABLED=true to poll pump.fun).');
    console.log('[SURVIVOR] On-demand scoring is unaffected.');
    return;
  }
  var intervalMs = parseInt(process.env.MONITOR_INTERVAL_MS || '60000', 10);
  console.log('[SURVIVOR] Polling pump.fun every ' + (intervalMs / 1000) + 's...');
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
  }, intervalMs);
}

async function startMonitor(mode) {
  monitorStartedAt = Date.now();
  /* Check before announcing. Logging "Monitor starting" and then silently returning is the
     same class of dishonesty as a health endpoint reporting OK on a broken dependency. */
  if (process.env.MONITOR_ENABLED !== 'true') {
    console.log('');
    console.log('SURVIVOR Monitor DISABLED. On-demand scoring is unaffected.');
    console.log('Set MONITOR_ENABLED=true to poll pump.fun.');
    console.log('');
    return;
  }
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
