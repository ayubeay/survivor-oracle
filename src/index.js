/**
 * SURVIVOR Oracle API Server
 * Built by SURVIVOR Agent #598
 */

const express = require('express');
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore } = require('./scorer');

const app = express();
app.use(express.json());

const scoreCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const stats = { totalQueries: 0, uniqueTokens: new Set(), startedAt: new Date().toISOString() };

async function getScore(mintAddress) {
  const cached = scoreCache.get(mintAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return { ...cached.data, cached: true };
  const tokenData = await fetchTokenData(mintAddress);
  const score = calculateSurvivalScore(tokenData);
  scoreCache.set(mintAddress, { data: { token: tokenData, score }, timestamp: Date.now() });
  stats.totalQueries++;
  stats.uniqueTokens.add(mintAddress);
  return { token: tokenData, score, cached: false };
}

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', agent: 'SURVIVOR #598', version: '0.1.0' });
});

app.get('/score/:mint', async (req, res) => {
  try {
    const { mint } = req.params;
    if (!mint || mint.length < 32) return res.status(400).json({ error: 'Invalid mint address' });
    console.log(`[SURVIVOR] Scoring token: ${mint}`);
    const result = await getScore(mint);
    if (req.query.quick === 'true') {
      return res.json({ mint, score: result.score.score, riskLevel: result.score.riskLevel, safe: result.score.score >= 60 });
    }
    res.json(result);
  } catch (error) {
    console.error(`[SURVIVOR] Error:`, error.message);
    res.status(500).json({ error: 'Failed to score token', message: error.message });
  }
});

app.get('/stats', (req, res) => {
  res.json({ agent: 'SURVIVOR #598', totalQueries: stats.totalQueries, uniqueTokens: stats.uniqueTokens.size, startedAt: stats.startedAt });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🛡️  SURVIVOR Oracle v0.1.0 running on http://localhost:${PORT}\n`);
});
