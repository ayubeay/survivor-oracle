/**
 * SURVIVOR Oracle API + Monitor
 * Built by SURVIVOR Agent #598
 */

const express = require('express');
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore, WEIGHTS } = require('./scorer');
const { startMonitor, getRecentScores } = require('./monitor');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
let totalScored = 0;

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    agent: 'SURVIVOR #598',
    version: '0.2.0',
    monitoring: true,
    totalScored,
    recentDetections: getRecentScores().length,
  });
});

// Score a token
app.get('/score/:mint', async (req, res) => {
  try {
    const mint = req.params.mint;
    const quick = req.query.quick === 'true';

    // Check cache
    const cached = cache.get(mint);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      if (quick) {
        return res.json({ mint, score: cached.data.score, riskLevel: cached.data.riskLevel, safe: cached.data.score >= 55, cached: true });
      }
      return res.json(cached.data);
    }

    const tokenData = await fetchTokenData(mint);
    const result = calculateSurvivalScore(tokenData);
    totalScored++;

    const fullResult = {
      mint,
      name: tokenData.name,
      symbol: tokenData.symbol,
      score: result.score,
      riskLevel: result.riskLevel,
      safe: result.score >= 55,
      breakdown: result.breakdown,
      weights: result.weights,
      holderNote: tokenData.holderNote,
      liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours,
      timestamp: result.timestamp,
    };

    cache.set(mint, { ts: Date.now(), data: fullResult });

    if (quick) {
      return res.json({ mint, score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55 });
    }
    res.json(fullResult);
  } catch (error) {
    res.status(500).json({ error: 'Failed to score token', message: error.message });
  }
});

// Stats
app.get('/stats', (req, res) => {
  res.json({
    agent: 'SURVIVOR #598',
    version: '0.2.0',
    totalScored,
    cacheSize: cache.size,
    recentDetections: getRecentScores().length,
    uptime: process.uptime(),
    weights: WEIGHTS,
  });
});

// Recent auto-scored tokens from monitor
app.get('/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const scores = getRecentScores().slice(0, limit);
  res.json({ count: scores.length, tokens: scores });
});

// Feed endpoint (for other agents)
app.get('/feed', (req, res) => {
  const minScore = parseInt(req.query.minScore) || 0;
  const maxScore = parseInt(req.query.maxScore) || 100;
  const riskLevel = req.query.risk;

  let tokens = getRecentScores();
  tokens = tokens.filter(t => t.score >= minScore && t.score <= maxScore);
  if (riskLevel) tokens = tokens.filter(t => t.riskLevel === riskLevel.toUpperCase());

  res.json({ count: tokens.length, tokens });
});

// Start server + monitor
app.listen(PORT, () => {
  console.log(`\n🛡️  SURVIVOR Oracle v0.2.0 running on http://localhost:${PORT}`);
  console.log(`📡 Endpoints: /health, /score/:mint, /stats, /recent, /feed\n`);

  // Start pump.fun monitor
  startMonitor('poll');
});
