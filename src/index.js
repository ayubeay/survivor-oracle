/**
 * SURVIVOR Token Risk Oracle
 * Autonomous risk intelligence for Solana pump.fun tokens
 * Built by SURVIVOR Agent #598 | Colosseum AI Agent Hackathon 2026
 * v0.4.0: live dashboard, persistent dedup, pump filter, honest scoring
 */

const express = require('express');
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore, generateReasons, getConfidence, WEIGHTS, ENGINE, SCORING_VERSION, MODEL_VERSION, buildStructuredReasons, getConfidenceFloat, buildMeta, buildFeatureSnapshot, normalizeRiskTier } = require('./scorer');
const { startMonitor, getRecentScores, getMonitorStats } = require('./monitor');
const { startRescorer, getRescoreStats } = require("./rescorer");
const { saveScore, getScoreHistory, getRecentScoresDB, getStats, getExtremes, getScoreDistribution, getHourlyActivity } = require('./database');
const { sanitizeText } = require('./sanitizer');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.4.0';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function formatUptime(seconds) {
  var s = Math.floor(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return h + 'h ' + m + 'm ' + sec + 's';
}

app.get('/', function (req, res) {
  var stats = getStats();
  var extremes = getExtremes(5);
  var distribution = getScoreDistribution();
  var hourly = getHourlyActivity();
  var monStats = getMonitorStats();
  var recent = getRecentScores().slice(0, 15);
  res.setHeader('Content-Type', 'text/html');
  res.send(generateDashboard(stats, extremes, distribution, hourly, monStats, recent));
});

app.get('/health', function (req, res) {
  var stats = getStats();
  var monStats = getMonitorStats();
  res.json({
    status: 'healthy', agent: 'SURVIVOR #598', version: VERSION,
    monitoring: true, persistence: 'sqlite', pumpFilter: true, persistentDedup: true,
    totalScored: stats.totalScored, averageScore: stats.averageScore,
    last24h: stats.last24h, skippedNonMints: stats.skippedNonMints,
    monitor: monStats, recentDetections: getRecentScores().length,
    uptime: formatUptime(process.uptime()),
  });
});

app.get('/score/:mint', async function (req, res) {
  try {
    var mint = req.params.mint;
    var quick = req.query.quick === 'true';
    var cached = cache.get(mint);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      if (quick) {
        var cr = cached.data;
        var cReasons = buildStructuredReasons(cr.breakdown, cr._tokenData || {});
        return res.json({
          engine: ENGINE, chain: "solana", mint: mint,
          score: cr.score, risk_tier: normalizeRiskTier(cr.riskLevel), safe: cr.score >= 55,
          confidence: getConfidenceFloat(cr._tokenData || {}),
          reasons: cReasons,
          meta: buildMeta(cr._tokenData || {}, cReasons),
          name: cr.name, symbol: cr.symbol, riskLevel: cr.riskLevel, cached: true,
        });
      }
      return res.json(cached.data);
    }
    var tokenData = await fetchTokenData(mint);
    var result = calculateSurvivalScore(tokenData);
    var structuredReasons = buildStructuredReasons(result.breakdown, tokenData);
    var confidenceFloat = getConfidenceFloat(tokenData);
    var riskTier = normalizeRiskTier(result.riskLevel);
    var meta = buildMeta({ ...tokenData, timestamp: result.timestamp }, structuredReasons);
    var fullResult = {
      engine: ENGINE, chain: "solana",
      mint: mint, name: tokenData.name, symbol: tokenData.symbol,
      score: result.score, risk_tier: riskTier, safe: result.score >= 55,
      confidence: confidenceFloat,
      reasons: structuredReasons,
      meta: meta,
      riskLevel: result.riskLevel,
      breakdown: result.breakdown, weights: result.weights,
      holderNote: tokenData.holderNote, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, timestamp: result.timestamp,
      _tokenData: tokenData,
    };
    if (result.mode) fullResult.mode = result.mode;
    if (!quick) {
      fullResult.feature_snapshot = buildFeatureSnapshot(result.breakdown, tokenData);
      fullResult.legacyReasons = generateReasons(tokenData, result.breakdown);
      fullResult.legacyConfidence = getConfidence(tokenData);
    }
    saveScore({
      mint: mint, name: tokenData.name, symbol: tokenData.symbol,
      score: result.score, riskLevel: result.riskLevel, safe: result.score >= 55,
      breakdown: result.breakdown, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, holderNote: tokenData.holderNote, source: 'api',
    });
    cache.set(mint, { ts: Date.now(), data: fullResult });
    var response = Object.assign({}, fullResult);
    delete response._tokenData;
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Failed to score token', message: error.message });
  }
});

app.get('/history/:mint', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  var history = getScoreHistory(req.params.mint, limit);
  res.json({ mint: req.params.mint, count: history.length, history: history });
});

app.get('/stats', function (req, res) {
  var stats = getStats();
  var extremes = getExtremes();
  var distribution = getScoreDistribution();
  var monStats = getMonitorStats();
  res.json({
    agent: 'SURVIVOR #598', version: VERSION, persistence: 'sqlite',
    pumpFilter: true, persistentDedup: true,
    totalScored: stats.totalScored, averageScore: stats.averageScore,
    byRiskLevel: stats.byRiskLevel, distribution: distribution,
    uniqueMonitored: stats.uniqueMonitored, last24h: stats.last24h,
    skippedNonMints: stats.skippedNonMints, errors: stats.errors,
    extremes: extremes, monitor: monStats, weights: WEIGHTS,
    uptimeSeconds: Math.floor(process.uptime()), uptime: formatUptime(process.uptime()),
  });
});

app.get('/recent', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json({ count: Math.min(limit, getRecentScores().length), tokens: getRecentScores().slice(0, limit) });
});

app.get('/db/recent', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 50, 200);
  var risk = req.query.risk || null;
  var scores = getRecentScoresDB(limit, risk ? risk.toUpperCase() : null);
  res.json({ count: scores.length, source: 'database', tokens: scores });
});

app.get('/feed', function (req, res) {
  var minScore = parseInt(req.query.minScore) || 0;
  var maxScore = parseInt(req.query.maxScore) || 100;
  var riskLevel = req.query.risk;
  var limit = Math.min(parseInt(req.query.limit) || 50, 100);
  var tokens = getRecentScores();
  tokens = tokens.filter(function (t) { return t.score >= minScore && t.score <= maxScore; });
  if (riskLevel) tokens = tokens.filter(function (t) { return t.riskLevel === riskLevel.toUpperCase(); });
  tokens = tokens.slice(0, limit);
  res.json({ count: tokens.length, tokens: tokens });
});

app.get('/feed/latest', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json({ count: Math.min(limit, getRecentScores().length), tokens: getRecentScores().slice(0, limit) });
});

app.get('/activity', function (req, res) {
  res.json({ hourly: getHourlyActivity() });
});

function generateDashboard(stats, extremes, distribution, hourly, monStats, recent) {
  var riskColors = { LOW: '#22c55e', MEDIUM: '#eab308', HIGH: '#f97316', VERY_HIGH: '#ef4444', EXTREME: '#dc2626' };

  var distBars = distribution.map(function (d) {
    var color = riskColors[d.bucket] || '#6b7280';
    var width = stats.totalScored > 0 ? Math.max(2, (d.count / stats.totalScored) * 100) : 2;
    return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">'
      + '<span style="width:80px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px">' + d.bucket + '</span>'
      + '<div style="flex:1;background:#1e293b;border-radius:4px;height:24px;overflow:hidden">'
      + '<div style="width:' + width + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.5s"></div>'
      + '</div>'
      + '<span style="width:50px;text-align:right;font-size:13px;color:#e2e8f0;font-variant-numeric:tabular-nums">' + d.count + '</span>'
      + '</div>';
  }).join('');

  var recentRows = recent.map(function (t) {
    var color = riskColors[t.riskLevel] || '#6b7280';
    var symbol = sanitizeText(t.symbol || 'UNKNOWN');
    var mintShort = t.mint.slice(0, 6) + '...' + t.mint.slice(-4);
    var time = t.detectedAt ? new Date(t.detectedAt).toLocaleTimeString('en-US', { hour12: false }) : '-';
    return '<tr>'
      + '<td style="padding:8px 12px;color:#e2e8f0;font-weight:500">' + symbol + '</td>'
      + '<td style="padding:8px 12px"><code style="font-size:11px;color:#64748b;background:#1e293b;padding:2px 6px;border-radius:3px">' + mintShort + '</code></td>'
      + '<td style="padding:8px 12px;text-align:center"><span style="display:inline-block;min-width:32px;padding:2px 8px;border-radius:4px;font-weight:700;font-size:13px;color:#0f172a;background:' + color + '">' + t.score + '</span></td>'
      + '<td style="padding:8px 12px;color:' + color + ';font-size:12px;text-transform:uppercase;letter-spacing:0.5px">' + t.riskLevel + '</td>'
      + '<td style="padding:8px 12px;color:#64748b;font-size:12px;font-variant-numeric:tabular-nums">' + time + '</td>'
      + '</tr>';
  }).join('');

  var safestCards = extremes.safest.slice(0, 3).map(function (t) {
    var color = riskColors[t.risk_level] || '#22c55e';
    return '<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:14px 16px;min-width:160px">'
      + '<div style="font-size:13px;font-weight:600;color:#e2e8f0">' + sanitizeText(t.symbol || t.name || 'UNKNOWN') + '</div>'
      + '<div style="font-size:28px;font-weight:800;color:' + color + ';margin:4px 0">' + t.score + '</div>'
      + '<div style="font-size:11px;color:#64748b;text-transform:uppercase">' + t.risk_level + '</div>'
      + '</div>';
  }).join('');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>SURVIVOR Oracle \u2014 Live Dashboard</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#020617;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;min-height:100vh}.noise{position:fixed;inset:0;pointer-events:none;opacity:.025;background-image:url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")}.glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:600px;height:400px;background:radial-gradient(ellipse,rgba(249,115,22,.08) 0%,transparent 70%);pointer-events:none}.container{max-width:1200px;margin:0 auto;padding:32px 24px;position:relative;z-index:1}.header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:40px;flex-wrap:wrap;gap:12px}.title{font-family:JetBrains Mono,monospace;font-size:28px;font-weight:800;letter-spacing:-.5px}.title span{color:#f97316}.badge{font-family:JetBrains Mono,monospace;font-size:11px;color:#64748b;background:#1e293b;padding:4px 10px;border-radius:4px;border:1px solid #334155}.live-dot{display:inline-block;width:7px;height:7px;background:#22c55e;border-radius:50%;margin-right:6px;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:36px}.stat-card{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:18px 20px}.stat-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}.stat-value{font-family:JetBrains Mono,monospace;font-size:32px;font-weight:800;color:#f8fafc;line-height:1}.stat-sub{font-size:12px;color:#475569;margin-top:4px}.section{margin-bottom:36px}.section-title{font-family:JetBrains Mono,monospace;font-size:14px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px;display:flex;align-items:center;gap:8px}.section-title::before{content:"";display:block;width:3px;height:14px;background:#f97316;border-radius:2px}.table-wrap{overflow-x:auto;border:1px solid #1e293b;border-radius:10px;background:#0f172a}table{width:100%;border-collapse:collapse}thead th{padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;text-align:left;border-bottom:1px solid #1e293b;background:#020617}tbody tr{border-bottom:1px solid #0f172a}tbody tr:hover{background:#1e293b40}.safest-row{display:flex;gap:12px;flex-wrap:wrap}.footer{margin-top:48px;padding-top:24px;border-top:1px solid #1e293b;font-size:12px;color:#475569;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}.footer a{color:#f97316;text-decoration:none}.api-ref{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:18px 20px;font-family:JetBrains Mono,monospace;font-size:12px;color:#94a3b8;line-height:1.8}.api-ref span{color:#f97316}@media(max-width:640px){.title{font-size:20px}.stat-value{font-size:24px}.stats-grid{grid-template-columns:repeat(2,1fr)}}</style></head><body><div class="noise"></div><div class="glow"></div><div class="container"><div class="header"><div><div class="title">SURVIVOR<span>.</span>oracle</div><div style="font-size:13px;color:#64748b;margin-top:4px">Autonomous token risk intelligence for Solana</div></div><div style="display:flex;gap:8px;align-items:center"><span class="badge"><span class="live-dot"></span>LIVE</span><span class="badge">v' + VERSION + '</span><span class="badge">Agent #598</span></div></div><div class="stats-grid"><div class="stat-card"><div class="stat-label">Tokens Scored</div><div class="stat-value">' + stats.totalScored + '</div><div class="stat-sub">' + stats.last24h + ' in last 24h</div></div><div class="stat-card"><div class="stat-label">Avg Risk Score</div><div class="stat-value">' + stats.averageScore + '</div><div class="stat-sub">out of 100 (higher = safer)</div></div><div class="stat-card"><div class="stat-label">Non-Mints Filtered</div><div class="stat-value">' + stats.skippedNonMints + '</div><div class="stat-sub">SOL/USDC/junk blocked</div></div><div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value" style="font-size:22px">' + formatUptime(process.uptime()) + '</div><div class="stat-sub">' + monStats.inMemoryCache + ' mints cached</div></div></div><div class="section"><div class="section-title">Risk Distribution</div><div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px">' + (distBars || '<div style="color:#475569;font-size:13px">No data yet...</div>') + '</div></div><div class="section"><div class="section-title">Safest Tokens Detected</div><div class="safest-row">' + (safestCards || '<div style="color:#475569;font-size:13px">Scoring in progress...</div>') + '</div></div><div class="section"><div class="section-title">Recent Scores (live)</div><div class="table-wrap"><table><thead><tr><th>Token</th><th>Mint</th><th style="text-align:center">Score</th><th>Risk</th><th>Time</th></tr></thead><tbody>' + (recentRows || '<tr><td colspan="5" style="padding:20px;color:#475569;text-align:center">Waiting for first tokens...</td></tr>') + '</tbody></table></div></div><div class="section"><div class="section-title">API Reference</div><div class="api-ref"><span>GET</span> /health \u2014 Status, uptime, score count<br><span>GET</span> /score/:mint \u2014 Full risk score with breakdown<br><span>GET</span> /score/:mint?quick=true \u2014 Score + confidence + reasons<br><span>GET</span> /stats \u2014 Analytics with safest/riskiest tokens<br><span>GET</span> /history/:mint \u2014 Score history for a token<br><span>GET</span> /recent \u2014 Recently auto-detected tokens<br><span>GET</span> /db/recent \u2014 Persistent scores from database<br><span>GET</span> /feed \u2014 Filtered feed for agent integrations<br><span>GET</span> /activity \u2014 Hourly scoring activity</div></div><div class="footer"><div>SURVIVOR Agent #598 \u2022 Colosseum AI Agent Hackathon 2026 \u2022 <a href="https://github.com/ayubeay/survivor-oracle" target="_blank">GitHub</a></div><div>Auto-refreshes every 30s \u2022 ' + new Date().toISOString() + '</div></div></div></body></html>';
}

app.listen(PORT, function () {
  console.log('');
  console.log('SURVIVOR Oracle v' + VERSION + ' running on http://localhost:' + PORT);
  console.log('SQLite persistence active');
  console.log('Pump filter: ON | Persistent dedup: ON');
  console.log('Dashboard: http://localhost:' + PORT + '/');
  console.log('Endpoints: /health /score/:mint /history/:mint /stats /recent /db/recent /feed /feed/latest /activity');
  console.log('');
  startMonitor('poll');
  startRescorer(30000);
});
