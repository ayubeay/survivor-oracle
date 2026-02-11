/**
 * SURVIVOR Phase 2 — Rescore Worker
 * Background loop that rescores tokens at t+5m, t+30m, t+2h
 * Detects score volatility and bait-and-switch patterns
 * Built by SURVIVOR Agent #598 | v0.4.1
 */

const { fetchTokenData } = require('./fetcher');
const {
  calculateSurvivalScore, buildStructuredReasons, getConfidenceFloat,
  SCORING_VERSION, MODEL_VERSION,
} = require('./scorer');
const {
  getDueRescoresList, completeRescore, saveScoreHistory, getLastScore,
} = require('./database');

// Bait-and-switch: score drops this many points or more between windows
const BAIT_SWITCH_THRESHOLD = 15;
// Volatility: score swings this much in either direction
const VOLATILITY_THRESHOLD = 10;

let rescoreCount = 0;
let rescoreErrors = 0;

async function rescoreToken(queueItem) {
  const mint = queueItem.mint;
  const window = queueItem.window;

  try {
    const tokenData = await fetchTokenData(mint);
    const result = calculateSurvivalScore(tokenData);
    const structuredReasons = buildStructuredReasons(result.breakdown, tokenData);
    const confidence = getConfidenceFloat(tokenData);
    const reasonCodes = structuredReasons.map(r => r.code);

    // Get previous score for delta calculation
    const prev = getLastScore(mint);
    const scoreDelta = prev ? result.score - prev.score : null;

    // Volatility: big swing in either direction
    const volatilityFlag = scoreDelta !== null && Math.abs(scoreDelta) >= VOLATILITY_THRESHOLD;

    // Bait-and-switch: score was okay-ish, now dropped hard
    const baitAndSwitchFlag = scoreDelta !== null && scoreDelta <= -BAIT_SWITCH_THRESHOLD;

    saveScoreHistory({
      mint,
      score: result.score,
      riskLevel: result.riskLevel,
      confidence,
      modelVersion: MODEL_VERSION,
      scoringVersion: SCORING_VERSION,
      reasonCodes,
      scoreDelta,
      volatilityFlag,
      baitAndSwitchFlag,
      rescoreWindow: window,
    });

    completeRescore(queueItem.id);
    rescoreCount++;

    const flags = [];
    if (volatilityFlag) flags.push('VOLATILE');
    if (baitAndSwitchFlag) flags.push('BAIT_SWITCH');
    const flagStr = flags.length > 0 ? ' [' + flags.join(',') + ']' : '';

    console.log(
      '[RESCORE] ' + mint.slice(0, 12) + '... @' + window +
      ': ' + result.score + '/100' +
      (scoreDelta !== null ? ' (delta: ' + (scoreDelta >= 0 ? '+' : '') + scoreDelta + ')' : '') +
      flagStr
    );

    return { mint, score: result.score, scoreDelta, volatilityFlag, baitAndSwitchFlag };
  } catch (err) {
    rescoreErrors++;
    console.error('[RESCORE] Failed ' + mint.slice(0, 12) + '... @' + window + ': ' + err.message);
    completeRescore(queueItem.id);
    return null;
  }
}

async function processRescoreQueue() {
  const due = getDueRescoresList();
  if (due.length === 0) return;

  console.log('[RESCORE] Processing ' + due.length + ' due rescore(s)...');

  for (const item of due) {
    await rescoreToken(item);
    // Small delay between rescores to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }
}

function startRescorer(intervalMs) {
  const interval = intervalMs || 30000; // check every 30 seconds
  console.log('[RESCORE] Worker started, checking every ' + (interval / 1000) + 's');

  setInterval(async () => {
    try {
      await processRescoreQueue();
    } catch (err) {
      console.error('[RESCORE] Queue error: ' + err.message);
    }
  }, interval);
}

function getRescoreStats() {
  return { rescored: rescoreCount, errors: rescoreErrors };
}

module.exports = { startRescorer, getRescoreStats };
