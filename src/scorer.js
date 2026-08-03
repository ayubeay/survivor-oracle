/**
 * SURVIVOR Token Risk Scorer
 * Score ranges from 0 (extreme risk) to 100 (low risk).
 * Built by SURVIVOR Agent #598
 * v0.4.0: penalize missing holder data, improved confidence model
 */

const WEIGHTS = {
  mintAuthority: 20,
  freezeAuthority: 10,
  lpLocked: 20,
  topHolderConcentration: 15,
  devWalletActivity: 15,
  tokenAge: 10,
  liquidityDepth: 10,
};

/* Layer 1 authority doctrine v1 (2026-08-01).
   Credit reflects only what the mint address proves. No credit for assumed program
   behaviour, custody arrangements, or institutional identity. */
const AUTHORITY_DOCTRINE_VERSION = 'layer1-authority-v1';

function scoreMintAuthority(revoked, authorityClass) {
  if (!authorityClass) return revoked ? 100 : 0;
  switch (authorityClass.state) {
    case 'REVOKED':
      return 100;
    case 'PROGRAM_DERIVED':
      return 60;
    case 'MULTISIG': {
      var m = authorityClass.threshold_m || 1;
      var n = authorityClass.signers_n || 1;
      return Math.round(Math.min(75, 35 + 25 * (m / n) + 5 * Math.min(m, 4)));
    }
    case 'WALLET':
      return 0;
    default:
      return null;
  }
}

function scoreFreezeAuthority(revoked) {
  return revoked ? 100 : 0;
}

/* Returns null when LP lock status was not measured. An absent measurement is not
   evidence of an unlocked pool, and must not be scored as though it were. */
function scoreLpLocked(lpInfo) {
  if (!lpInfo) return null;
  if (!lpInfo.locked) return 0;
  var score = Math.min(lpInfo.percentLocked || 0, 100) * 0.5;
  score += Math.min((lpInfo.lockDuration || 0) / 30, 1) * 50;
  return Math.round(score);
}

function scoreHolderConcentration(top10Percent) {
  if (top10Percent === null || top10Percent === undefined) return 30;
  if (top10Percent <= 20) return 100;
  if (top10Percent <= 35) return 80;
  if (top10Percent <= 50) return 60;
  if (top10Percent <= 70) return 40;
  if (top10Percent <= 85) return 20;
  return 10;
}

function scoreDevWalletActivity(devActivity) {
  if (!devActivity) return 50;
  var score = 100;
  if (devActivity.recentSells > 0) score -= Math.min(devActivity.recentSells * 20, 60);
  if (devActivity.percentSold > 10) score -= Math.min((devActivity.percentSold - 10) * 2, 30);
  if (devActivity.walletAge > 30) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreTokenAge(hours) {
  if (hours < 1) return 5;
  if (hours < 3) return 15;
  if (hours < 6) return 25;
  if (hours < 12) return 35;
  if (hours < 24) return 50;
  if (hours < 72) return 70;
  if (hours < 168) return 85;
  return 100;
}

function scoreLiquidityDepth(usd) {
  if (usd < 1000) return 5;
  if (usd < 5000) return 20;
  if (usd < 10000) return 40;
  if (usd < 25000) return 55;
  if (usd < 50000) return 70;
  if (usd < 100000) return 85;
  return 100;
}

function calculateSurvivalScore(tokenData) {
  if (tokenData.megacap) {
    var mc = tokenData.megacap;
    return {
      score: mc.baseScore, riskLevel: mc.riskLevel, mode: mc.mode,
      breakdown: {
        mintAuthority: 'N/A', freezeAuthority: 'N/A', lpLocked: 'N/A',
        holderConcentration: 'N/A', devWalletActivity: 'N/A',
        tokenAge: 100, liquidityDepth: 100,
      },
      weights: WEIGHTS,
      shadow_denominator: { score: null, model_version: 'measured-evidence-v0.5.1-shadow',
                            enforced: false, reason: 'NOT_APPLICABLE_TO_CURATED_SCORE' },
      coverage: { signals_expected: 7, signals_measured: 0, weight_coverage_percent: 0,
                  unmeasured: [], note: 'MEGACAP_MODE: score is assigned, not computed from signals' },
      timestamp: new Date().toISOString(),
    };
  }

  var breakdown = {
    mintAuthority: scoreMintAuthority(tokenData.mintAuthorityRevoked, tokenData.mintAuthorityClass),
    freezeAuthority: scoreFreezeAuthority(tokenData.freezeAuthorityRevoked),
    lpLocked: scoreLpLocked(tokenData.lpInfo),
    holderConcentration: scoreHolderConcentration(tokenData.top10HolderPercent),
    devWalletActivity: scoreDevWalletActivity(tokenData.devActivity),
    tokenAge: scoreTokenAge(tokenData.ageInHours || 0),
    liquidityDepth: scoreLiquidityDepth(tokenData.liquidityUsd || 0),
  };

  var totalScore = 0;
  totalScore += (breakdown.mintAuthority * WEIGHTS.mintAuthority) / 100;
  totalScore += (breakdown.freezeAuthority * WEIGHTS.freezeAuthority) / 100;
  totalScore += (breakdown.lpLocked * WEIGHTS.lpLocked) / 100;
  totalScore += (breakdown.holderConcentration * WEIGHTS.topHolderConcentration) / 100;
  totalScore += (breakdown.devWalletActivity * WEIGHTS.devWalletActivity) / 100;
  totalScore += (breakdown.tokenAge * WEIGHTS.tokenAge) / 100;
  totalScore += (breakdown.liquidityDepth * WEIGHTS.liquidityDepth) / 100;

  // Measurement coverage - reported, not applied. Scoring is unchanged in this version.
  var signalChecks = [
    { signal: 'mintAuthority',       w: WEIGHTS.mintAuthority,          measured: breakdown.mintAuthority !== null && breakdown.mintAuthority !== undefined,                              reason: 'MINT_INFO_UNAVAILABLE' },
    { signal: 'freezeAuthority',     w: WEIGHTS.freezeAuthority,        measured: typeof tokenData.freezeAuthorityRevoked === 'boolean',                            reason: 'MINT_INFO_UNAVAILABLE' },
    { signal: 'lpLocked',            w: WEIGHTS.lpLocked,               measured: breakdown.lpLocked !== null && breakdown.lpLocked !== undefined,                                                               reason: 'LP_DATA_UNAVAILABLE' },
    { signal: 'holderConcentration', w: WEIGHTS.topHolderConcentration, measured: typeof tokenData.top10HolderPercent === 'number',                                 reason: tokenData.holderNote || 'HOLDER_DATA_UNAVAILABLE' },
    { signal: 'devWalletActivity',   w: WEIGHTS.devWalletActivity,      measured: !!tokenData.devActivity,                                                          reason: 'DEV_ACTIVITY_NOT_COLLECTED' },
    { signal: 'tokenAge',            w: WEIGHTS.tokenAge,               measured: typeof tokenData.ageInHours === 'number' && tokenData.ageInHours > 0,             reason: 'NO_MARKET_HISTORY' },
    { signal: 'liquidityDepth',      w: WEIGHTS.liquidityDepth,         measured: typeof tokenData.liquidityUsd === 'number' && tokenData.liquidityUsd > 0,         reason: 'NO_LIQUIDITY_DATA' },
  ];
  var totalW = signalChecks.reduce(function (s, c) { return s + c.w; }, 0);
  var measuredW = signalChecks.reduce(function (s, c) { return s + (c.measured ? c.w : 0); }, 0);
  var coverage = {
    signals_expected: signalChecks.length,
    signals_measured: signalChecks.filter(function (c) { return c.measured; }).length,
    weight_coverage_percent: totalW > 0 ? Math.round((measuredW / totalW) * 100) : 0,
    unmeasured: signalChecks.filter(function (c) { return !c.measured; })
      .map(function (c) { return { signal: c.signal, weight: c.w, reason: c.reason }; }),
    note: 'reported only; unmeasured signals still contribute their neutral default to the score in this version',
  };

  /* Shadow denominator - constitution v0.5.1, OBSERVATIONAL ONLY.
     Recomputes the evidence score over signals that are both measured and valid, with the
     denominator reduced accordingly. Never affects score, band, or gate.
       lpLocked          measures burned LP, a launch convention rather than a universal
                         safety property (verified 2026-08-02; SLERF burned 99.97%)
       devWalletActivity never collected; its scorer always returns the no-data default */
  var SHADOW_EXCLUDE = {
    lpLocked: 'NOT_A_UNIVERSAL_SAFETY_SIGNAL',
    devWalletActivity: 'NOT_MEASURED',
  };
  var shadowIncluded = [], shadowExcluded = [], shadowWeight = 0, shadowWeighted = 0;
  signalChecks.forEach(function (c) {
    if (SHADOW_EXCLUDE[c.signal]) {
      shadowExcluded.push({ signal: c.signal, weight: c.w, reason: SHADOW_EXCLUDE[c.signal] });
      return;
    }
    if (!c.measured) {
      shadowExcluded.push({ signal: c.signal, weight: c.w, reason: c.reason || 'UNMEASURED' });
      return;
    }
    var sub = breakdown[c.signal];
    if (typeof sub !== 'number') {
      shadowExcluded.push({ signal: c.signal, weight: c.w, reason: 'SUBSCORE_UNAVAILABLE' });
      return;
    }
    shadowIncluded.push(c.signal);
    shadowWeight += c.w;
    shadowWeighted += sub * c.w;
  });
  var shadowDenominator = {
    score: shadowWeight > 0 ? Math.round(shadowWeighted / shadowWeight) : null,
    measured_weight: shadowWeight,
    included_signals: shadowIncluded,
    excluded_signals: shadowExcluded,
    model_version: 'measured-evidence-v0.5.1-shadow',
    enforced: false,
  };

  var score = Math.round(totalScore);
  var riskLevel;
  if (score >= 75) riskLevel = 'LOW';
  else if (score >= 60) riskLevel = 'MEDIUM';
  else if (score >= 50) riskLevel = 'HIGH';
  else if (score >= 40) riskLevel = 'VERY_HIGH';
  else riskLevel = 'EXTREME';

  return { score: score, riskLevel: riskLevel, breakdown: breakdown, weights: WEIGHTS, coverage: coverage,
    shadow_denominator: shadowDenominator, timestamp: new Date().toISOString() };
}

function generateReasons(tokenData, breakdown) {
  if (tokenData.megacap) {
    return tokenData.megacap.reasons || ['MEGACAP_TOKEN', 'ESTABLISHED'];
  }
  var reasons = [];
  if (breakdown.mintAuthority === 0) reasons.push('MINT_AUTH_ACTIVE');
  if (breakdown.freezeAuthority === 0) reasons.push('FREEZE_AUTH_ACTIVE');
  if (breakdown.lpLocked === 0) reasons.push('LP_NOT_LOCKED');
  if (breakdown.holderConcentration <= 20) reasons.push('HIGH_CONCENTRATION');
  if (breakdown.holderConcentration === 30 && (tokenData.top10HolderPercent === null || tokenData.top10HolderPercent === undefined)) {
    reasons.push('HOLDER_DATA_UNAVAILABLE');
  }
  if (breakdown.tokenAge <= 15) reasons.push('VERY_NEW');
  if (breakdown.liquidityDepth <= 20) reasons.push('LOW_LIQUIDITY');
  if (breakdown.mintAuthority === 100) reasons.push('MINT_REVOKED');
  if (breakdown.freezeAuthority === 100) reasons.push('FREEZE_REVOKED');
  if (breakdown.tokenAge >= 85) reasons.push('ESTABLISHED');
  if (breakdown.liquidityDepth >= 85) reasons.push('DEEP_LIQUIDITY');
  return reasons;
}

function getConfidence(tokenData) {
  if (tokenData.megacap) return 'HIGH';
  var confidence = 'HIGH';
  if (tokenData.holderNote === 'MEGACAP_SKIP' || tokenData.holderNote === 'MEGA_CAP_FALLBACK') confidence = 'MEDIUM';
  if (tokenData.holderNote === 'HOLDER_QUERY_FAILED') confidence = 'LOW';
  if (tokenData.holderNote === 'NOT_A_TOKEN_MINT' || tokenData.holderNote === 'ACCOUNT_NOT_FOUND') confidence = 'LOW';
  if (tokenData.liquidityUsd === 0 && tokenData.ageInHours === 0) confidence = 'LOW';
  return confidence;
}


// =========================================================
// PHASE 1: Structured reason codes, float confidence, meta
// v0.4.1 — zero changes to scoring math above
// =========================================================

const ENGINE = "survivor.oracle";
const SCORING_VERSION = "0.5.2";
const MODEL_VERSION = "scoring-v3";

const CONTRIBUTION_BUCKETS = [0.10, 0.15, 0.20, 0.25, 0.30];

function bucketContribution(x) {
  if (x == null) return undefined;
  const v = Math.max(0, Math.min(1, Number(x)));
  let best = CONTRIBUTION_BUCKETS[0];
  let bestDiff = Math.abs(v - best);
  for (const c of CONTRIBUTION_BUCKETS) {
    const d = Math.abs(v - c);
    if (d < bestDiff) { best = c; bestDiff = d; }
  }
  return best;
}

function buildStructuredReasons(breakdown, tokenData) {
  if (tokenData.megacap) {
    return [{ code: "MEGACAP_TOKEN", severity: "low", signal: "onchain", detail: "Recognized megacap/native asset", contribution: 0.30 }];
  }
  const b = breakdown || {};
  const ageInHours = tokenData.ageInHours || 0;
  const holderNote = tokenData.holderNote;
  const reasons = [];

  if (b.mintAuthority === 0) {
    reasons.push({ code: "MINT_AUTHORITY_PRESENT", severity: "high", signal: "onchain", detail: "Mint authority is still active (not revoked)", contribution: bucketContribution(0.18) });
  }
  if (b.freezeAuthority === 0) {
    reasons.push({ code: "FREEZE_AUTHORITY_PRESENT", severity: "high", signal: "onchain", detail: "Freeze authority is still active (not revoked)", contribution: bucketContribution(0.13) });
  }
  if (b.lpLocked != null && b.lpLocked < 20) {
    reasons.push({ code: "LP_UNLOCKED", severity: "high", signal: "dex", detail: b.lpLocked === 0 ? "No LP lock detected" : "LP lock is weak or partial", contribution: bucketContribution(0.22) });
  }
  if (b.liquidityDepth != null && b.liquidityDepth < 20) {
    const liqUsd = tokenData.liquidityUsd || 0;
    reasons.push({ code: "NO_LIQUIDITY", severity: "high", signal: "dex", detail: liqUsd === 0 ? "No liquidity detected" : "Liquidity is very thin (~$" + liqUsd.toLocaleString() + ")", contribution: bucketContribution(0.18) });
  }
  if (b.holderConcentration != null && b.holderConcentration <= 30) {
    const isDataMissing = holderNote === "HOLDER_QUERY_FAILED" || (tokenData.top10HolderPercent === null || tokenData.top10HolderPercent === undefined);
    reasons.push({ code: "HOLDER_CONCENTRATION", severity: "high", signal: "onchain", detail: isDataMissing ? "Holder data unavailable; assuming concentrated supply" : "Top holder concentration is high", contribution: bucketContribution(0.16) });
  }
  if (b.tokenAge != null && b.tokenAge <= 15) {
    let detail;
    if (ageInHours < 0.017) detail = "Token created less than 1 minute ago";
    else if (ageInHours < 0.10) detail = "Token created less than 6 minutes ago";
    else if (ageInHours < 1) detail = "Token is ~" + Math.round(ageInHours * 60) + " minutes old";
    else detail = "Token is ~" + ageInHours.toFixed(1) + " hours old";
    reasons.push({ code: "FRESH_MINT", severity: "medium", signal: "onchain", detail: detail, contribution: bucketContribution(0.10) });
  }

  return reasons.sort((a, c) => (c.contribution || 0) - (a.contribution || 0)).slice(0, 6);
}

function getConfidenceFloat(tokenData) {
  if (tokenData.megacap) return 0.90;
  let conf = 0.85;
  if (tokenData.holderNote === 'HOLDER_QUERY_FAILED') conf -= 0.25;
  if (tokenData.holderNote === 'NOT_A_TOKEN_MINT' || tokenData.holderNote === 'ACCOUNT_NOT_FOUND') conf -= 0.30;
  if (tokenData.holderNote === 'MEGACAP_SKIP' || tokenData.holderNote === 'MEGA_CAP_FALLBACK') conf -= 0.15;
  if (tokenData.liquidityUsd === 0 && (tokenData.ageInHours || 0) === 0) conf -= 0.15;
  return Math.round(Math.max(0.20, conf) * 100) / 100;
}

/* Evidence bands - constitution v0.5. Same numeric boundaries as the risk tiers they
   sit alongside; only the naming changed. Boundaries stay provisional until the
   denominator question is settled, because bands and denominators cannot be chosen
   independently. */
const EVIDENCE_BAND_SCHEMA = 'evidence-band-v0.5-provisional';

function evidenceBand(score) {
  if (typeof score !== 'number') return 'UNKNOWN';
  if (score >= 75) return 'STRONGLY_FAVORABLE';
  if (score >= 60) return 'MIXED_FAVORABLE';
  if (score >= 50) return 'MIXED';
  if (score >= 40) return 'ADVERSE';
  return 'STRONGLY_ADVERSE';
}

function normalizeRiskTier(riskLevel) {
  switch ((riskLevel || "").toUpperCase()) {
    case "LOW": return "LOW";
    case "MEDIUM": return "MEDIUM";
    case "HIGH": return "HIGH";
    case "VERY_HIGH": return "VERY_HIGH";
    case "EXTREME": return "EXTREME";
    default: return "UNKNOWN";
  }
}

function ageBucket(h) { if (h == null) return "unknown"; if (h < 0.10) return "<6m"; if (h < 1) return "<1h"; if (h < 6) return "<6h"; if (h < 24) return "<24h"; return ">=24h"; }
function liquidityBucket(u) { if (u == null) return "unknown"; if (u <= 0) return "$0"; if (u < 500) return "<$500"; if (u < 5000) return "<$5k"; if (u < 50000) return "<$50k"; return ">=$50k"; }
function holderBucket(s) { if (s == null) return "unknown"; if (s <= 20) return "very_concentrated"; if (s <= 40) return "concentrated"; if (s <= 60) return "moderate"; return "distributed"; }

function buildCaveats(tokenData) {
  const caveats = ["Score based on on-chain signals; no off-chain intelligence applied."];
  if ((tokenData.ageInHours || 0) < 0.1667) caveats.push("Token age < 10 minutes; confidence may improve with rescoring.");
  if (tokenData.holderNote === "HOLDER_QUERY_FAILED") caveats.push("Holder data unavailable; holder concentration is estimated.");
  if (tokenData.liquidityUsd === 0) caveats.push("No liquidity data found; token may not be tradeable yet.");
  return caveats;
}

function buildMeta(tokenData, structuredReasons) {
  const sources = new Set(["onchain"]);
  for (const r of structuredReasons) { if (r.signal) sources.add(r.signal); }
  return {
    scored_at: tokenData.timestamp || new Date().toISOString(),
    scoring_version: SCORING_VERSION,
    model_version: MODEL_VERSION,
    sources: Array.from(sources),
    caveats: buildCaveats(tokenData),
    ttl_seconds: 300,
  };
}

function buildFeatureSnapshot(breakdown, tokenData) {
  if (tokenData.megacap) return { category: "megacap" };
  return { age_bucket: ageBucket(tokenData.ageInHours), liquidity_bucket: liquidityBucket(tokenData.liquidityUsd), holder_bucket: holderBucket(breakdown.holderConcentration) };
}

module.exports = { AUTHORITY_DOCTRINE_VERSION, EVIDENCE_BAND_SCHEMA, evidenceBand, calculateSurvivalScore, generateReasons, getConfidence, WEIGHTS, ENGINE, SCORING_VERSION, MODEL_VERSION, buildStructuredReasons, getConfidenceFloat, buildMeta, buildFeatureSnapshot, normalizeRiskTier };
