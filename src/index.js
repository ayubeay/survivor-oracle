require("dotenv").config();
/**
 * SURVIVOR Token Risk Oracle
 * Autonomous risk intelligence for Solana pump.fun tokens
 * Built by SURVIVOR Agent #598 | Colosseum AI Agent Hackathon 2026
 * v0.4.0: live dashboard, persistent dedup, pump filter, honest scoring
 */

const express = require('express');
var { initBilling } = require("./billing");
const { fetchTokenData } = require('./fetcher');
const { calculateSurvivalScore, generateReasons, getConfidence, WEIGHTS, ENGINE, SCORING_VERSION, MODEL_VERSION, buildStructuredReasons, getConfidenceFloat, buildMeta, buildFeatureSnapshot, normalizeRiskTier, evidenceBand, EVIDENCE_BAND_SCHEMA } = require('./scorer');
const { startMonitor, getRecentScores, getMonitorStats } = require('./monitor');
const { startRescorer, getRescoreStats } = require("./rescorer");
const { saveScore, getScoreHistory, getRecentScoresDB, getStats, getExtremes, getScoreDistribution, getHourlyActivity, getScoreHistoryPhase2 } = require('./database');
const { fetchRugCheck } = require("./rugcheck");
const { authMiddleware, createApiKey, listApiKeys, revokeApiKey, canUseExt, canUseDebug } = require("./auth");
const { sanitizeText } = require('./sanitizer');
const { x402Middleware, initX402, x402SuccessLogger } = require('./x402');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.4.1';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function formatUptime(seconds) {
  var s = Math.floor(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return h + 'h ' + m + 'm ' + sec + 's';
}

app.use((req, res, next) => { if (req.path.startsWith('/score/') && req.query.quick === 'true') return next(); return x402Middleware(req, res, next); });
app.use(x402SuccessLogger);
app.use(function(req, res, next) {
  if (req.path.startsWith("/attest")) return next();
  if (req.path.startsWith("/whoami")) return next();
  if (req.path.startsWith("/rpe")) return next();
  if (req.path.startsWith("/docs")) return next();
  if (req.path.startsWith("/pricing")) return next();
  if (req.path.startsWith("/credits")) return next();
  if (req.path.startsWith("/billing")) return next();
  if (req.path.startsWith("/admin")) return next();
  return authMiddleware(req, res, next);
});
// Billing webhook needs raw body — must be before express.json()
initBilling(app);

app.use(express.json());
const attestRouter = require('./attest');
app.use('/attest', attestRouter);
app.get('/', function (req, res) {
  var stats = getStats();
  var extremes = getExtremes(5);
  var distribution = getScoreDistribution();
  var hourly = getHourlyActivity();
  var monStats = getMonitorStats();
  var recent = getRecentScores().slice(0, 15);
  var rescoreStats = getRescoreStats();
  res.setHeader('Content-Type', 'text/html');
  res.send(generateDashboard(stats, extremes, distribution, hourly, monStats, recent, rescoreStats));
});

app.get('/health', function (req, res) {
  var stats = getStats();
  var monStats = getMonitorStats();
  res.json({
    status: 'healthy', agent: 'SURVIVOR #598', version: VERSION,
    monitoring: true, persistence: 'sqlite', pumpFilter: true, persistentDedup: true,
    totalScored: stats.totalScored, averageScore: stats.averageScore,
    last24h: stats.last24h, skippedNonMints: stats.skippedNonMints,
    monitor: monStats, rescore: getRescoreStats(), recentDetections: getRecentScores().length,
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
          score: cr.score, risk_tier: normalizeRiskTier(cr.riskLevel), safe: cr.score >= 60,
          evidence_score: cr.score, evidence_band: evidenceBand(cr.score),
          evidence_band_schema: EVIDENCE_BAND_SCHEMA,
          confidence: getConfidenceFloat(cr._tokenData || {}),
          reasons: cReasons,
          meta: buildMeta(cr._tokenData || {}, cReasons),
          name: cr.name, symbol: cr.symbol, riskLevel: cr.riskLevel, cached: true,
          signals: cr.signals ?? null,
          coverage: cr.coverage ?? null,
          shadow_denominator: cr.shadow_denominator ?? null,
          score_basis: cr.score_basis || ((cr._tokenData && cr._tokenData.megacap) ? 'curated' : 'computed'),
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
      score: result.score, risk_tier: riskTier, safe: result.score >= 60,
      evidence_score: result.score, evidence_band: evidenceBand(result.score),
      evidence_band_schema: EVIDENCE_BAND_SCHEMA,
      confidence: confidenceFloat,
      reasons: structuredReasons,
      meta: meta,
      riskLevel: result.riskLevel,
      breakdown: result.breakdown,
      /* Coverage is only meaningful for computed scores. A curated megacap score is
         assigned, not derived from signals, so 0% coverage would mean "no signals were
         needed" - not "we measured nothing". Those must not collapse into one number. */
      score_basis: tokenData.megacap ? 'curated' : 'computed',
      coverage: tokenData.megacap ? null : result.coverage,
      shadow_denominator: result.shadow_denominator ?? null,
      holderNote: tokenData.holderNote, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, timestamp: result.timestamp,
      signals: {
        mint_authority_revoked: tokenData.mintAuthorityRevoked ?? null,
        mint_authority_class: tokenData.mintAuthorityClass ?? null,
        freeze_authority_revoked: tokenData.freezeAuthorityRevoked ?? null,
        lp: tokenData.lpInfo ? {
          locked: !!tokenData.lpInfo.locked,
          percent_locked: tokenData.lpInfo.percentLocked ?? null,
          lock_duration_days: tokenData.lpInfo.lockDuration ?? null,
        } : null,
        top10_holder_percent: tokenData.top10HolderPercent ?? null,
        total_holders: tokenData.totalHolders ?? null,
        holder_note: tokenData.holderNote ?? null,
        concentration_basis: tokenData.concentrationBasis ?? null,
        dev_activity: tokenData.devActivity ? {
          recent_sells: tokenData.devActivity.recentSells ?? null,
          percent_sold: tokenData.devActivity.percentSold ?? null,
          wallet_age_days: tokenData.devActivity.walletAge ?? null,
        } : null,
        age_hours: tokenData.ageInHours ?? null,
        liquidity_usd: tokenData.liquidityUsd ?? null,
        liquidity_pool: tokenData.pairAddress ? { pair: tokenData.pairAddress, dex: tokenData.dexId ?? null } : null,
        observed_total_liquidity_usd: tokenData.observedTotalLiquidityUsd ?? null,
        pair_count: tokenData.pairCount ?? null,
        earliest_observed_pair_age_hours: tokenData.ageInHours ?? null,
        market_data_source: "DexScreener",
      },
      _tokenData: tokenData,
      // megacap mode uses sentinel values, not measurements — do not publish them as facts
      ...(tokenData.megacap ? { signals_note: "MEGACAP_MODE: signals are not measured for recognized major assets" } : {}),
    };
    if (result.mode) fullResult.mode = result.mode;
    if (!quick) {
      fullResult.feature_snapshot = buildFeatureSnapshot(result.breakdown, tokenData);
      if (req.query.debug === "true") { if (!canUseDebug(req)) { return res.status(403).json({ error: "forbidden", feature: "debug", message: "Debug weights require Pro tier." }); } fullResult.weights = result.weights; }
      fullResult.legacyReasons = generateReasons(tokenData, result.breakdown);
      fullResult.legacyConfidence = getConfidence(tokenData);
    }
    saveScore({
      mint: mint, name: tokenData.name, symbol: tokenData.symbol,
      score: result.score, riskLevel: result.riskLevel, safe: result.score >= 60,
      breakdown: result.breakdown, liquidityUsd: tokenData.liquidityUsd,
      ageInHours: tokenData.ageInHours, holderNote: tokenData.holderNote, source: 'api',
    });
    cache.set(mint, { ts: Date.now(), data: fullResult });
    var response = Object.assign({}, fullResult);
    delete response._tokenData;
    // Phase 3: external signals (opt-in via ?ext=true)
    if (req.query.ext === 'true') {
      if (!canUseExt(req)) {
        return res.status(402).json({ error: "tier_required", feature: "ext", message: "External engine signals require a paid tier. DM @youngs_modulus on X for access." });
      }
      var rugResult = await fetchRugCheck(mint);
      response.external_signals = { rugcheck: rugResult };
      if ((tokenData || {}).ageInHours != null && tokenData.ageInHours < 0.2) {
        response.meta.caveats.push("External engine signals may be incomplete for fresh tokens; treat as advisory.");
      }
      if (rugResult.available) {
        var survivorVerdict = response.risk_tier;
        var rugVerdict = rugResult.verdict;
        response.agreement = {
          survivor: survivorVerdict,
          rugcheck: rugVerdict,
          status: survivorVerdict === rugVerdict ? 'AGREE' : 'DISAGREE',
        };
      }
    }
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Failed to score token', message: error.message });
  }
});

app.get('/history/:mint', function (req, res) {
  var limit = Math.min(parseInt(req.query.limit) || 20, 100);
  var mint = req.params.mint;
  var phase2 = getScoreHistoryPhase2(mint, limit);
  if (phase2.length > 0) {
    var entries = phase2.map(function (h) {
      return {
        score: h.score,
        risk_level: h.risk_level,
        confidence: h.confidence,
        model_version: h.model_version,
        scoring_version: h.scoring_version,
        reason_codes: h.reason_codes ? JSON.parse(h.reason_codes) : [],
        score_delta: h.score_delta,
        volatility_flag: !!h.volatility_flag,
        bait_and_switch_flag: !!h.bait_and_switch_flag,
        rescore_window: h.rescore_window,
        scored_at: h.created_at,
      };
    });
    return res.json({ mint: mint, count: entries.length, source: 'score_history', entries: entries });
  }
  var legacy = getScoreHistory(mint, limit);
  res.json({ mint: mint, count: legacy.length, source: 'scores', history: legacy });
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
    extremes: extremes, monitor: monStats,
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

// Admin endpoints — protected by ADMIN_TOKEN env var
var ADMIN_TOKEN = process.env.ADMIN_TOKEN || "survivor_admin_change_me";

// Admin key routes moved to apikeys.js mountAdminRoutes()

function generateDashboard(stats, extremes, distribution, hourly, monStats, recent, rescoreStats) {
  var riskColors = { LOW: '#22c55e', MEDIUM: '#eab308', HIGH: '#f97316', VERY_HIGH: '#ef4444', EXTREME: '#dc2626' };
  var rs = rescoreStats || { rescored: 0, errors: 0 };

  var distBars = distribution.map(function (d) {
    var color = riskColors[d.bucket] || '#6b7280';
    var width = stats.totalScored > 0 ? Math.max(2, (d.count / stats.totalScored) * 100) : 2;
    return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">'
      + '<span style="width:80px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-family:JetBrains Mono,monospace">' + d.bucket + '</span>'
      + '<div style="flex:1;background:#1e293b;border-radius:4px;height:24px;overflow:hidden">'
      + '<div style="width:' + width + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.5s"></div>'
      + '</div>'
      + '<span style="width:50px;text-align:right;font-size:13px;color:#e2e8f0;font-variant-numeric:tabular-nums;font-family:JetBrains Mono,monospace">' + d.count + '</span>'
      + '</div>';
  }).join('');

  var recentRows = recent.map(function (t) {
    var color = riskColors[t.riskLevel] || '#6b7280';
    var symbol = sanitizeText(t.symbol || 'UNKNOWN');
    var mintShort = t.mint.slice(0, 6) + '...' + t.mint.slice(-4);
    var time = t.detectedAt ? new Date(t.detectedAt).toLocaleTimeString('en-US', { hour12: false }) : '-';
    var decisionColor = t.riskLevel === 'LOW' ? '#22c55e' : t.riskLevel === 'MEDIUM' ? '#eab308' : t.riskLevel === 'HIGH' ? '#f97316' : '#ef4444';
    var decision = t.score >= 65 ? 'ALLOW' : t.score >= 40 ? 'CHALLENGE' : 'DENY';
    var decisionBg = t.score >= 65 ? 'rgba(34,197,94,0.12)' : t.score >= 40 ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.12)';
    return '<tr>'
      + '<td style="padding:10px 14px;color:#e2e8f0;font-weight:600;font-size:13px">' + symbol + '</td>'
      + '<td style="padding:10px 14px"><code style="font-size:11px;color:#64748b;background:#1e293b;padding:2px 6px;border-radius:3px">' + mintShort + '</code></td>'
      + '<td style="padding:10px 14px;text-align:center"><span style="display:inline-block;min-width:36px;padding:3px 10px;border-radius:5px;font-weight:800;font-size:14px;color:#0f172a;background:' + color + '">' + t.score + '</span></td>'
      + '<td style="padding:10px 14px;color:' + color + ';font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-family:JetBrains Mono,monospace">' + t.riskLevel + '</td>'
      + '<td style="padding:10px 14px"><span style="font-size:11px;font-weight:700;font-family:JetBrains Mono,monospace;color:' + decisionColor + ';background:' + decisionBg + ';padding:3px 8px;border-radius:4px">' + decision + '</span></td>'
      + '<td style="padding:10px 14px;color:#64748b;font-size:12px;font-variant-numeric:tabular-nums;font-family:JetBrains Mono,monospace">' + time + '</td>'
      + '</tr>';
  }).join('');

  var safestCards = extremes.safest.slice(0, 4).map(function (t) {
    var color = riskColors[t.risk_level] || '#22c55e';
    var gateDecision = t.score >= 65 ? 'ALLOW' : t.score >= 40 ? 'CHALLENGE' : 'DENY';
    var gateColor = t.score >= 65 ? '#22c55e' : t.score >= 40 ? '#eab308' : '#ef4444';
    return '<div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px 18px;min-width:140px;flex:1">'
      + '<div style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:4px;font-family:JetBrains Mono,monospace">' + sanitizeText(t.symbol || t.name || 'UNKNOWN') + '</div>'
      + '<div style="font-size:36px;font-weight:800;color:' + color + ';margin:4px 0;line-height:1;font-family:JetBrains Mono,monospace">' + t.score + '</div>'
      + '<div style="font-size:10px;color:' + gateColor + ';text-transform:uppercase;letter-spacing:1px;font-family:JetBrains Mono,monospace">' + gateDecision + ' · ' + (t.risk_level || 'LOW') + '</div>'
      + '</div>';
  }).join('');

  var regimeColor = { calm: '#22c55e', speculative: '#eab308', mania: '#f97316', crisis: '#ef4444' };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>SURVIVOR Oracle — Shield Router · Live Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#020617;color:#e2e8f0;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;overflow-x:hidden}
code,pre,.mono{font-family:'JetBrains Mono',monospace}
a{color:#f97316;text-decoration:none}
a:hover{text-decoration:underline}

.noise{position:fixed;inset:0;pointer-events:none;opacity:.02;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.glow{position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:800px;height:500px;background:radial-gradient(ellipse,rgba(249,115,22,.06) 0%,transparent 70%);pointer-events:none}

.container{max-width:1100px;margin:0 auto;padding:48px 24px;position:relative;z-index:1}

/* ── HEADER ── */
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:72px;flex-wrap:wrap;gap:16px}
.logo{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:800;letter-spacing:-0.5px}
.logo span{color:#f97316}
.header-badges{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.badge{font-family:'JetBrains Mono',monospace;font-size:11px;color:#64748b;background:#0f172a;padding:4px 10px;border-radius:4px;border:1px solid #1e293b}
.live-dot{display:inline-block;width:6px;height:6px;background:#22c55e;border-radius:50%;margin-right:5px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* ── HERO ── */
.hero{text-align:center;padding:24px 0 80px;max-width:720px;margin:0 auto}
.hero-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;color:#f97316;text-transform:uppercase;letter-spacing:3px;margin-bottom:20px}
.hero-title{font-size:52px;font-weight:700;line-height:1.1;letter-spacing:-1.5px;color:#f8fafc;margin-bottom:20px}
.hero-title em{color:#f97316;font-style:normal}
.hero-sub{font-size:18px;color:#64748b;line-height:1.6;margin-bottom:36px;max-width:560px;margin-left:auto;margin-right:auto}
.hero-cta{display:inline-flex;align-items:center;gap:12px;background:#f97316;color:#020617;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;padding:14px 28px;border-radius:8px;text-decoration:none;transition:opacity 0.2s}
.hero-cta:hover{opacity:0.85;text-decoration:none}
.hero-cta-sub{font-size:12px;color:#475569;margin-top:12px;font-family:'JetBrains Mono',monospace}

/* ── CODE BLOCK ── */
.code-block{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px;text-align:left;margin:48px 0;overflow-x:auto}
.code-block pre{font-family:'JetBrains Mono',monospace;font-size:12px;color:#94a3b8;line-height:1.8;white-space:pre}
.code-block .kw{color:#f97316}
.code-block .str{color:#22c55e}
.code-block .cm{color:#475569}

/* ── DIVIDER ── */
.section-divider{border:none;border-top:1px solid #1e293b;margin:64px 0}

/* ── FEATURES ── */
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-bottom:64px}
.feature-card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px}
.feature-icon{font-size:24px;margin-bottom:12px}
.feature-title{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:#f8fafc;margin-bottom:8px}
.feature-desc{font-size:14px;color:#64748b;line-height:1.6}

/* ── HOW IT WORKS ── */
.steps{display:flex;gap:0;margin-bottom:64px;overflow-x:auto}
.step{flex:1;min-width:140px;padding:24px 16px;text-align:center;position:relative}
.step:not(:last-child)::after{content:"→";position:absolute;right:-8px;top:50%;transform:translateY(-50%);color:#334155;font-size:16px}
.step-num{font-family:'JetBrains Mono',monospace;font-size:10px;color:#f97316;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
.step-label{font-size:13px;color:#94a3b8;font-weight:500}

/* ── DECISIONS ── */
.decisions{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:64px}
.decision-card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px}
.decision-card.allow{border-color:rgba(34,197,94,0.3)}
.decision-card.challenge{border-color:rgba(234,179,8,0.3)}
.decision-card.deny{border-color:rgba(239,68,68,0.3)}
.decision-label{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:800;margin-bottom:8px}
.decision-card.allow .decision-label{color:#22c55e}
.decision-card.challenge .decision-label{color:#eab308}
.decision-card.deny .decision-label{color:#ef4444}
.decision-desc{font-size:13px;color:#64748b;line-height:1.5}

/* ── PRICING ── */
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-bottom:64px}
.price-card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:28px;position:relative}
.price-card.popular{border-color:#f97316}
.popular-tag{position:absolute;top:-10px;right:16px;background:#f97316;color:#020617;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;padding:3px 10px;border-radius:4px;text-transform:uppercase;letter-spacing:1px}
.price-tier{font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#64748b;margin-bottom:12px}
.price-amount{font-family:'JetBrains Mono',monospace;font-size:36px;font-weight:800;color:#f8fafc;line-height:1;margin-bottom:4px}
.price-credits{font-size:13px;color:#475569;margin-bottom:20px}
.price-features{font-size:13px;color:#94a3b8;line-height:2}

/* ── INTEL SECTION ── */
.intel-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
.intel-title{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:800;color:#f8fafc;text-transform:uppercase;letter-spacing:2px}
.intel-subtitle{font-size:13px;color:#475569;margin-top:4px}
.regime-pill{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:1px}

.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
.stat-card{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px 18px}
.stat-label{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;font-family:'JetBrains Mono',monospace}
.stat-value{font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:800;color:#f8fafc;line-height:1}
.stat-sub{font-size:11px;color:#334155;margin-top:4px}

.section-label{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.section-label::before{content:"";display:block;width:3px;height:12px;background:#f97316;border-radius:2px}

.table-wrap{overflow-x:auto;border:1px solid #1e293b;border-radius:10px;background:#0f172a;margin-bottom:28px}
table{width:100%;border-collapse:collapse}
thead th{padding:10px 14px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1px;text-align:left;border-bottom:1px solid #1e293b;background:#020617;font-family:'JetBrains Mono',monospace}
tbody tr{border-bottom:1px solid #0f172a40}
tbody tr:hover{background:#1e293b30}

.safest-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px}

/* ── API REF ── */
.api-ref{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px 24px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#64748b;line-height:2.2}
.api-ref .method{color:#f97316;font-weight:700}
.api-ref .ep{color:#94a3b8}
.api-ref .auth{font-size:10px;color:#334155;background:#1e293b;padding:1px 5px;border-radius:3px;margin-left:4px}

/* ── FOOTER ── */
.footer{margin-top:64px;padding-top:24px;border-top:1px solid #1e293b;font-size:12px;color:#334155;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-family:'JetBrains Mono',monospace}
.footer a{color:#475569}

@media(max-width:640px){
  .hero-title{font-size:34px}
  .decisions{grid-template-columns:1fr}
  .steps{flex-direction:column}
  .step:not(:last-child)::after{content:"↓";right:auto;left:50%;top:auto;bottom:-12px}
  .stats-grid{grid-template-columns:repeat(2,1fr)}
}
</style>
</head>
<body>
<div class="noise"></div>
<div class="glow"></div>
<div class="container">

  <!-- HEADER -->
  <div class="header">
    <div class="logo">SURVIVOR<span>.</span>oracle</div>
    <div class="header-badges">
      <span class="badge"><span class="live-dot"></span>LIVE</span>
      <span class="badge">v${VERSION}</span>
      <span class="badge">Agent #598</span>
      <span class="badge">Shield Router</span>
    </div>
  </div>

  <!-- HERO -->
  <div class="hero">
    <div class="hero-eyebrow">Risk-Aware Execution Control · Solana</div>
    <h1 class="hero-title">Sign every decision.<br><em>Gate every risk.</em></h1>
    <p class="hero-sub">Risk gate for Solana bots, scanners, and execution agents. Prevent unsafe swaps before capital is deployed — signed attestations, regime-adaptive pricing, three-state policy in one API call.</p>
    <a href="https://x.com/youngs_modulus" target="_blank" class="hero-cta">Get API Key — From $29 →</a>
    <div class="hero-cta-sub">DM @youngs_modulus · contact@identityaware.ai</div>
  </div>

  <!-- CODE DEMO -->
  <div class="code-block">
    <pre><span class="cm">// npm i @survivorshield/shield</span>
<span class="kw">const</span> { createShield } = require(<span class="str">'@survivorshield/shield'</span>);
<span class="kw">const</span> shield = createShield({ apiKey: process.env.SURVIVOR_KEY });

<span class="kw">const</span> gate = <span class="kw">await</span> shield.attestAndGate({
  mint:      <span class="str">"TOKEN_MINT"</span>,
  amountUsd: 2500,
});

<span class="kw">if</span> (gate.allow)     executeSwap();
<span class="kw">if</span> (gate.challenge) reducePosition(gate.limits.max_amount_usd);
<span class="kw">if</span> (gate.deny)      console.log(<span class="str">"Blocked"</span>, gate.reasonCodes);</pre>
  </div>

  <hr class="section-divider">

  <!-- FEATURES -->
  <div class="features-grid">
    <div class="feature-card">
      <div class="feature-icon">🔏</div>
      <div class="feature-title">Ed25519 Attestations</div>
      <div class="feature-desc">Every risk score is cryptographically signed with borsh serialization. Verifiable on-chain. Tamper-proof audit trail per decision.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">⚡</div>
      <div class="feature-title">Three-State Decisions</div>
      <div class="feature-desc">ALLOW / CHALLENGE / DENY with score-based amount limits. Not just pass/fail — graduated risk control that scales with exposure.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">📊</div>
      <div class="feature-title">Regime-Adaptive Pricing</div>
      <div class="feature-desc">Credits adjust dynamically across calm, speculative, mania, and crisis regimes. Pay less when risk is low. Cost reflects real conditions.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🛡</div>
      <div class="feature-title">Drop-in SDK</div>
      <div class="feature-desc">npm i @survivorshield/shield — gate swaps in 3 lines. TypeScript definitions included. Zero dependencies.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">💳</div>
      <div class="feature-title">Self-Serve Billing</div>
      <div class="feature-desc">Buy credits via Stripe. Get your API key instantly. No DMs. No approval process. Start in 60 seconds.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🔍</div>
      <div class="feature-title">Preflight Quotes</div>
      <div class="feature-desc">Simulate policy decisions and credit costs before executing. No charge for /rpe/quote calls. Know your cost before committing.</div>
    </div>
  </div>

  <!-- HOW IT WORKS -->
  <div class="section-label">How It Works</div>
  <div class="steps">
    <div class="step"><div class="step-num">01</div><div class="step-label">Buy Credits<br><span style="color:#334155;font-size:11px">Stripe checkout</span></div></div>
    <div class="step"><div class="step-num">02</div><div class="step-label">Get API Key<br><span style="color:#334155;font-size:11px">Instant delivery</span></div></div>
    <div class="step"><div class="step-num">03</div><div class="step-label">Call /attest<br><span style="color:#334155;font-size:11px">Score + sign + decide</span></div></div>
    <div class="step"><div class="step-num">04</div><div class="step-label">Gate Execution<br><span style="color:#334155;font-size:11px">ALLOW / CHALLENGE / DENY</span></div></div>
    <div class="step"><div class="step-num">05</div><div class="step-label">Credits Deduct<br><span style="color:#334155;font-size:11px">Risk-adjusted cost</span></div></div>
  </div>

  <!-- POLICY DECISIONS -->
  <div class="section-label" style="margin-bottom:20px">Policy Decisions</div>
  <div class="decisions">
    <div class="decision-card allow">
      <div class="decision-label">ALLOW</div>
      <div class="decision-desc">Score ≥ 65 — Execute swap. Full attestation returned with Ed25519 signature. Capital cleared for deployment.</div>
    </div>
    <div class="decision-card challenge">
      <div class="decision-label">CHALLENGE</div>
      <div class="decision-desc">Score 40–64 — Proceed only if you reduce size to the returned max. Limits vary by score and active regime.</div>
    </div>
    <div class="decision-card deny">
      <div class="decision-label">DENY</div>
      <div class="decision-desc">Score &lt; 40 — Hard block. Structured reason codes returned for audit. No capital at risk. No attestation issued.</div>
    </div>
  </div>
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px 20px;margin-bottom:64px;font-size:13px;color:#475569;line-height:1.7">
    Typical /attest costs 1–8 credits depending on risk level and regime. /rpe/quote is always free. We never take custody of funds or sign transactions — attestations only. Credits never expire.
  </div>

  <!-- PRICING -->
  <div class="section-label" style="margin-bottom:20px">Pricing</div>
  <div class="pricing-grid">
    <div class="price-card">
      <div class="price-tier">Starter</div>
      <div class="price-amount">$29</div>
      <div class="price-credits">1,000 credits — one-time<br><span style="font-size:11px;color:#334155">~500–1,000 standard checks</span></div>
      <div class="price-features">✓ Signed attestations<br>✓ Three-state policy<br>✓ Regime-aware pricing<br>✓ SDK access<br>✓ Credits never expire</div>
    </div>
    <div class="price-card popular">
      <div class="popular-tag">POPULAR</div>
      <div class="price-tier">Builder</div>
      <div class="price-amount">$99</div>
      <div class="price-credits">5,000 credits — one-time<br><span style="font-size:11px;color:#334155">~2,500–5,000 standard checks</span></div>
      <div class="price-features">✓ Everything in Starter<br>✓ 5× the credits<br>✓ Best value per call<br>✓ Higher daily limits<br>✓ Credits never expire</div>
    </div>
    <div class="price-card">
      <div class="price-tier">Pro</div>
      <div class="price-amount">$399</div>
      <div class="price-credits">25,000 credits — one-time<br><span style="font-size:11px;color:#334155">~2,500–5,000 standard checks</span></div>
      <div class="price-features">✓ Everything in Builder<br>✓ 25× the credits<br>✓ Volume pricing<br>✓ Custom integrations<br>✓ Credits never expire</div>
    </div>
  </div>

  <hr class="section-divider">

  <!-- LIVE INTELLIGENCE FEED -->
  <div class="intel-header">
    <div>
      <div class="intel-title"><span class="live-dot"></span> Live Intelligence Feed</div>
      <div class="intel-subtitle">Oracle scoring in real time — proof of work, not a pitch deck</div>
    <div style="font-size:11px;color:#475569;margin-top:6px;font-family:JetBrains Mono,monospace">Risk labels describe token profile. Gate decisions reflect policy thresholds and exposure sizing.</div>
    </div>
    <span class="regime-pill" style="background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.2)">REGIME: CALM · 1×</span>
  </div>

  <!-- STATS -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Tokens Scored</div>
      <div class="stat-value">${stats.totalScored}</div>
      <div class="stat-sub">${stats.last24h} in last 24h</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Avg Risk Score</div>
      <div class="stat-value">${stats.averageScore}</div>
      <div class="stat-sub">higher = safer · out of 100</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Rescored</div>
      <div class="stat-value">${rs.rescored}</div>
      <div class="stat-sub">5m / 30m / 2h windows</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Filtered</div>
      <div class="stat-value">${stats.skippedNonMints}</div>
      <div class="stat-sub">SOL/USDC/junk blocked</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Uptime</div>
      <div class="stat-value" style="font-size:20px">${formatUptime(process.uptime())}</div>
      <div class="stat-sub">${monStats.inMemoryCache} mints cached</div>
    </div>
  </div>

  <!-- RISK DISTRIBUTION -->
  <div class="section-label">Risk Distribution</div>
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:20px 24px;margin-bottom:28px">
    ${distBars || '<div style="color:#334155;font-size:13px;font-family:JetBrains Mono,monospace">No data yet — scoring in progress...</div>'}
  </div>

  <!-- SAFEST TOKENS -->
  <div class="section-label">Safest Tokens Detected</div>
  <div class="safest-row">
    ${safestCards || '<div style="color:#334155;font-size:13px;font-family:JetBrains Mono,monospace">Scoring in progress...</div>'}
  </div>

  <!-- RECENT SCORES -->
  <div class="section-label">Recent Scores · Live</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Token</th>
          <th>Mint</th>
          <th style="text-align:center">Score</th>
          <th>Risk</th>
          <th>Gate Decision</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${recentRows || '<tr><td colspan="6" style="padding:24px;color:#334155;text-align:center;font-family:JetBrains Mono,monospace;font-size:12px">Waiting for first tokens...</td></tr>'}
      </tbody>
    </table>
  </div>

  <hr class="section-divider">

  <!-- API REFERENCE -->
  <div class="section-label" style="margin-bottom:16px">API Reference</div>
  <div class="api-ref">
    <span class="method">POST</span> <span class="ep">/attest</span><span class="auth">x-api-key</span> — Signed attestation + pricing + policy decision<br>
    <span class="method">POST</span> <span class="ep">/attest/verify</span> — 7-check signature verification<br>
    <span class="method">GET</span>  <span class="ep">/attest/signer</span> — Oracle pubkey + program binding<br>
    <span class="method">POST</span> <span class="ep">/rpe/quote</span> — Preflight policy + cost simulation <em style="color:#22c55e;font-size:10px">free</em><br>
    <span class="method">POST</span> <span class="ep">/rpe/evaluate</span><span class="auth">x-api-key</span> — Full policy evaluation<br>
    <span class="method">GET</span>  <span class="ep">/rpe/policy</span> — Policy version + thresholds<br>
    <span class="method">GET</span>  <span class="ep">/billing/plans</span> — Available credit packages<br>
    <span class="method">POST</span> <span class="ep">/billing/checkout</span> — Create Stripe checkout session<br>
    <span class="method">GET</span>  <span class="ep">/credits/balance</span><span class="auth">x-api-key</span> — Check credit balance<br>
    <span class="method">GET</span>  <span class="ep">/credits/ledger</span><span class="auth">x-api-key</span> — Credit transaction history<br>
    <span class="method">GET</span>  <span class="ep">/pricing</span> — Current regime + multipliers<br>
    <span class="method">GET</span>  <span class="ep">/whoami</span><span class="auth">x-api-key</span> — Account info + usage<br>
    <span class="method">GET</span>  <span class="ep">/score/:mint</span> — Token risk score with structured reasons<br>
    <span class="method">GET</span>  <span class="ep">/health</span> — Status, uptime, score count<br>
    <span class="method">GET</span>  <span class="ep">/docs</span> — Full API documentation (JSON)
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div>SURVIVOR Agent #598 · Shield Router Oracle · <a href="https://github.com/ayubeay/survivor-oracle" target="_blank">GitHub</a> · <a href="https://npmjs.com/package/@survivorshield/shield" target="_blank">npm</a> · Built by <a href="https://x.com/youngs_modulus" target="_blank">@youngs_modulus</a></div>
    <div>Auto-refreshes every 30s · ${new Date().toISOString()}</div>
  </div>

</div>
</body>
</html>`;
}


initX402().then(() => app.listen(PORT, function () {
  console.log('');
  console.log('SURVIVOR Oracle v' + VERSION + ' running on http://localhost:' + PORT);
  console.log('SQLite persistence active');
  console.log('Pump filter: ON | Persistent dedup: ON');
  console.log('Dashboard: http://localhost:' + PORT + '/');
  console.log('Endpoints: /health /score/:mint /history/:mint /stats /recent /db/recent /feed /feed/latest /activity');
  console.log('');
  var { mountAdminRoutes } = require("./apikeys");
var { mountCreditRoutes } = require("./credits");
  var { rpeRouter } = require("./rpe");
  var { checkBootInvariants } = require("./boot-invariants");
  checkBootInvariants();
  mountAdminRoutes(app);
  app.use("/rpe", rpeRouter);
  mountCreditRoutes(app);
  if(process.env.MONITOR_ENABLED!=="false") startMonitor("poll"); else console.log("Monitor: DISABLED (Oracle mode)");
  if(process.env.RESCORE_ENABLED!=="false") startRescorer(30000); else console.log("Rescorer: DISABLED (Oracle mode)");
}));
