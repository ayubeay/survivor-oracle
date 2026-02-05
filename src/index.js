const express = require('express');
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore, WEIGHTS } = require('./scorer');
const { startMonitor, getRecentScores } = require('./monitor');
const { saveScore, getScoreHistory, getRecentScoresDB, getStats, getExtremes } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

app.get('/health', function(req, res) {
  var stats = getStats();
  res.json({ status: 'healthy', agent: 'SURVIVOR #598', version: '0.3.0', monitoring: true, persistence: 'sqlite', totalScored: stats.totalScored, averageScore: stats.averageScore, last24h: stats.last24h, recentDetections: getRecentScores().length });
});

app.get('/score/:mint', async function(req, res) {
  try {
    var mint = req.params.mint;
    var quick = req.query.quick === 'true';
    var cached = cache.get(mint);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      if (quick) return res.json({ mint: mint, score: cached.data.score, riskLevel: cached.data.riskLevel, safe: cached.data.score >= 55, cached: true });
      return res.json(cached.data);
    }
    var tokenData = await fetchTokenData(mint);
    var result = calculateSurvivalScore(tokenData);
    var fullResult = { mint: mint, name: tokenData.name, symbol: tokenData.symbol, score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55, breakdown: result.breakdown, weights: result.weights, holderNote: tokenData.holderNote, liquidityUsd: tokenData.liquidityUsd, ageInHours: tokenData.ageInHours, timestamp: result.timestamp };
    saveScore({ mint: mint, name: tokenData.name, symbol: tokenData.symbol, score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55, breakdown: result.breakdown, liquidityUsd: tokenData.liquidityUsd, ageInHours: tokenData.ageInHours, holderNote: tokenData.holderNote, source: 'api' });
    cache.set(mint, { ts: Date.now(), data: fullResult });
    if (quick) return res.json({ mint: mint, score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55 });
    res.json(fullResult);
  } catch (error) {
    res.status(500).json({ error: 'Failed to score token', message: error.message });
  }
});

app.get('/history/:mint', function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  var history = getScoreHistory(req.params.mint, limit);
  res.json({ mint: req.params.mint, count: history.length, history: history });
});

app.get('/stats', function(req, res) {
  var stats = getStats();
  var extremes = getExtremes();
  res.json({ agent: 'SURVIVOR #598', version: '0.3.0', persistence: 'sqlite', totalScored: stats.totalScored, averageScore: stats.averageScore, byRiskLevel: stats.byRiskLevel, uniqueMonitored: stats.uniqueMonitored, last24h: stats.last24h, extremes: extremes, weights: WEIGHTS, uptime: process.uptime() });
});

app.get('/recent', function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  var scores = getRecentScores().slice(0, limit);
  res.json({ count: scores.length, tokens: scores });
});

app.get('/db/recent', function(req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 200);
  var risk = req.query.risk || null;
  var scores = getRecentScoresDB(limit, risk ? risk.toUpperCase() : null);
  res.json({ count: scores.length, source: 'database', tokens: scores });
});

app.get('/feed', function(req, res) {
  var minScore = parseInt(req.query.minScore) || 0;
  var maxScore = parseInt(req.query.maxScore) || 100;
  var riskLevel = req.query.risk;
  var tokens = getRecentScores();
  tokens = tokens.filter(function(t) { return t.score >= minScore && t.score <= maxScore; });
  if (riskLevel) tokens = tokens.filter(function(t) { return t.riskLevel === riskLevel.toUpperCase(); });
  res.json({ count: tokens.length, tokens: tokens });
});

app.listen(PORT, function() {
  console.log('');
  console.log('SURVIVOR Oracle v0.3.0 running on http://localhost:' + PORT);
  console.log('SQLite persistence active');
  console.log('Endpoints: /health /score/:mint /history/:mint /stats /recent /db/recent /feed');
  console.log('');
  startMonitor('poll');
});
