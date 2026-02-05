/**
 * SURVIVOR Token Monitor
 * Polls pump.fun for new token launches and auto-scores them.
 * Built by SURVIVOR Agent #598
 * v0.3.2: sanitized log output, mint validation gate
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { fetchTokenData, validateMint } = require('./fetcher');
const { calculateSurvivalScore } = require('./scorer');
const { saveScore, logMonitorEvent } = require('./database');
const { sanitizeText } = require('./sanitizer');

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const recentScores = [];
const MAX_RECENT = 100;
const scoredMints = new Set();

function getRecentScores() { return recentScores; }

async function scoreNewToken(mintAddress) {
  if (scoredMints.has(mintAddress)) return null;
  scoredMints.add(mintAddress);
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
  setInterval(async function() {
    try {
      var opts = { limit: 25 };
      if (lastSignature) opts.until = lastSignature;
      var signatures = await connection.getSignaturesForAddress(PUMP_FUN_PROGRAM, opts);
      if (signatures.length === 0) return;
      lastSignature = signatures[0].signature;
      for (var i = 0; i < Math.min(signatures.length, 5); i++) {
        try {
          var parsedTx = await connection.getParsedTransaction(signatures[i].signature, { maxSupportedTransactionVersion: 0 });
          if (parsedTx === null || parsedTx === undefined) continue;
          if (parsedTx.meta === null || parsedTx.meta === undefined) continue;
          var balances = parsedTx.meta.postTokenBalances || [];
          for (var j = 0; j < balances.length; j++) {
            if (balances[j].mint && scoredMints.has(balances[j].mint) === false) {
              (function(m) { setTimeout(function() { scoreNewToken(m); }, 3000); })(balances[j].mint);
            }
          }
        } catch (pe) {}
      }
    } catch (error) {
      console.error('[SURVIVOR] Poll error: ' + error.message);
    }
  }, 15000);
}

async function startMonitor(mode) {
  console.log('');
  console.log('SURVIVOR Monitor starting (mode: ' + (mode || 'poll') + ')...');
  console.log('Watching: pump.fun (' + PUMP_FUN_PROGRAM.toString().slice(0, 16) + '...)');
  console.log('New tokens auto-scored + persisted to SQLite');
  console.log('');
  await pollPumpFun();
}

module.exports = { startMonitor, scoreNewToken, getRecentScores };
