/**
 * SURVIVOR pump.fun Monitor
 * Detects new token launches and auto-scores them
 * Built by SURVIVOR Agent #598
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore } = require('./scorer');

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

// pump.fun program ID
const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Store scored tokens
const recentScores = [];
const MAX_RECENT = 100;
const scoredMints = new Set();

function getRecentScores() { return recentScores; }

async function scoreNewToken(mintAddress) {
  if (scoredMints.has(mintAddress)) return null;
  scoredMints.add(mintAddress);

  try {
    console.log(`[SURVIVOR] 🆕 New token detected: ${mintAddress}`);
    const tokenData = await fetchTokenData(mintAddress);
    const result = calculateSurvivalScore(tokenData);

    const entry = {
      mint: mintAddress,
      name: tokenData.name,
      symbol: tokenData.symbol,
      score: result.score,
      riskLevel: result.riskLevel,
      safe: result.score >= 55,
      breakdown: result.breakdown,
      detectedAt: new Date().toISOString(),
    };

    recentScores.unshift(entry);
    if (recentScores.length > MAX_RECENT) recentScores.pop();

    const emoji = result.score >= 55 ? '✅' : result.score >= 35 ? '⚠️' : '🚨';
    console.log(`[SURVIVOR] ${emoji} ${tokenData.symbol || mintAddress.slice(0,8)}: ${result.score}/100 ${result.riskLevel}`);

    return entry;
  } catch (error) {
    console.error(`[SURVIVOR] ❌ Failed to score ${mintAddress}: ${error.message}`);
    return null;
  }
}

// Method 1: Poll recent pump.fun transactions
async function pollPumpFun() {
  console.log(`[SURVIVOR] 🔍 Polling pump.fun for new tokens...`);
  let lastSignature = null;

  setInterval(async () => {
    try {
      const opts = { limit: 25 };
      if (lastSignature) opts.until = lastSignature;

      const signatures = await connection.getSignaturesForAddress(PUMP_FUN_PROGRAM, opts);
      if (signatures.length === 0) return;

      // Update cursor
      if (!lastSignature) lastSignature = signatures[0].signature;
      else lastSignature = signatures[0].signature;

      // Parse each transaction for new mints
      for (const sig of signatures.slice(0, 5)) {
        try {
          const tx = await connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx || !tx.meta) continue;

          // Look for new token mints in post-token balances
          const postTokenBalances = tx.meta.postTokenBalances || [];
          for (const balance of postTokenBalances) {
            if (balance.mint && !scoredMints.has(balance.mint)) {
              // Small delay to let DexScreener index
              setTimeout(() => scoreNewToken(balance.mint), 3000);
            }
          }
        } catch (e) {
          // Skip failed tx parse
        }
      }
    } catch (error) {
      console.error(`[SURVIVOR] Poll error: ${error.message}`);
    }
  }, 15000); // Poll every 15 seconds
}

// Method 2: WebSocket subscription (faster but less reliable)
async function subscribePumpFun() {
  console.log(`[SURVIVOR] 📡 Subscribing to pump.fun logs via WebSocket...`);

  try {
    connection.onLogs(
      PUMP_FUN_PROGRAM,
      async (logs) => {
        if (!logs.logs) return;

        // Look for 'create' or 'initialize' in logs
        const isCreate = logs.logs.some(log =>
          log.includes('Create') || log.includes('create') || log.includes('InitializeMint')
        );

        if (isCreate && logs.signature) {
          try {
            const tx = await connection.getParsedTransaction(logs.signature, {
              maxSupportedTransactionVersion: 0,
            });
            if (!tx || !tx.meta) return;

            const postTokenBalances = tx.meta.postTokenBalances || [];
            for (const balance of postTokenBalances) {
              if (balance.mint && !scoredMints.has(balance.mint)) {
                setTimeout(() => scoreNewToken(balance.mint), 5000);
              }
            }
          } catch (e) {
            // Skip
          }
        }
      },
      'confirmed'
    );
  } catch (error) {
    console.error(`[SURVIVOR] WebSocket error: ${error.message}`);
    console.log(`[SURVIVOR] Falling back to polling mode...`);
    pollPumpFun();
  }
}

// Start monitoring - try WebSocket first, fallback to polling
async function startMonitor(mode = 'poll') {
  console.log(`\n🔄 SURVIVOR Monitor starting (mode: ${mode})...`);
  console.log(`📌 Watching: pump.fun (${PUMP_FUN_PROGRAM.toString().slice(0, 16)}...)`);
  console.log(`⏱️  New tokens will be auto-scored\n`);

  if (mode === 'ws') {
    await subscribePumpFun();
  } else {
    await pollPumpFun();
  }
}

module.exports = { startMonitor, scoreNewToken, getRecentScores };
