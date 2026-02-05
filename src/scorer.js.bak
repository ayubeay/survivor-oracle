/**
 * SURVIVOR Token Risk Scorer
 * Score ranges from 0 (extreme risk) to 100 (low risk).
 * Built by SURVIVOR Agent #598
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

function scoreMintAuthority(revoked) { return revoked ? 100 : 0; }
function scoreFreezeAuthority(revoked) { return revoked ? 100 : 0; }

function scoreLpLocked(lpInfo) {
  if (!lpInfo || !lpInfo.locked) return 0;
  let score = Math.min(lpInfo.percentLocked || 0, 100) * 0.5;
  score += Math.min((lpInfo.lockDuration || 0) / 30, 1) * 50;
  return Math.round(score);
}

function scoreHolderConcentration(top10Percent) {
  // Null = mega-cap or unknown, assume distributed (safer)
  if (top10Percent === null || top10Percent === undefined) return 70;
  if (top10Percent <= 20) return 100;
  if (top10Percent <= 35) return 80;
  if (top10Percent <= 50) return 60;
  if (top10Percent <= 70) return 40;
  if (top10Percent <= 85) return 20;
  return 10;
}

function scoreDevWalletActivity(devActivity) {
  if (!devActivity) return 50;
  let score = 100;
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
  const breakdown = {
    mintAuthority: scoreMintAuthority(tokenData.mintAuthorityRevoked),
    freezeAuthority: scoreFreezeAuthority(tokenData.freezeAuthorityRevoked),
    lpLocked: scoreLpLocked(tokenData.lpInfo),
    holderConcentration: scoreHolderConcentration(tokenData.top10HolderPercent),
    devWalletActivity: scoreDevWalletActivity(tokenData.devActivity),
    tokenAge: scoreTokenAge(tokenData.ageInHours || 0),
    liquidityDepth: scoreLiquidityDepth(tokenData.liquidityUsd || 0),
  };

  let totalScore = 0;
  totalScore += (breakdown.mintAuthority * WEIGHTS.mintAuthority) / 100;
  totalScore += (breakdown.freezeAuthority * WEIGHTS.freezeAuthority) / 100;
  totalScore += (breakdown.lpLocked * WEIGHTS.lpLocked) / 100;
  totalScore += (breakdown.holderConcentration * WEIGHTS.topHolderConcentration) / 100;
  totalScore += (breakdown.devWalletActivity * WEIGHTS.devWalletActivity) / 100;
  totalScore += (breakdown.tokenAge * WEIGHTS.tokenAge) / 100;
  totalScore += (breakdown.liquidityDepth * WEIGHTS.liquidityDepth) / 100;

  const score = Math.round(totalScore);
  let riskLevel;
  if (score >= 75) riskLevel = 'LOW';
  else if (score >= 55) riskLevel = 'MEDIUM';
  else if (score >= 35) riskLevel = 'HIGH';
  else if (score >= 20) riskLevel = 'VERY_HIGH';
  else riskLevel = 'EXTREME';

  return { score, riskLevel, breakdown, weights: WEIGHTS, timestamp: new Date().toISOString() };
}

function generateReasons(tokenData, breakdown) {
  var reasons = [];
  if (breakdown.mintAuthority === 0) reasons.push('MINT_AUTH_ACTIVE');
  if (breakdown.freezeAuthority === 0) reasons.push('FREEZE_AUTH_ACTIVE');
  if (breakdown.lpLocked === 0) reasons.push('LP_NOT_LOCKED');
  if (breakdown.holderConcentration <= 20) reasons.push('HIGH_CONCENTRATION');
  if (breakdown.tokenAge <= 15) reasons.push('VERY_NEW');
  if (breakdown.liquidityDepth <= 20) reasons.push('LOW_LIQUIDITY');
  if (breakdown.mintAuthority === 100) reasons.push('MINT_REVOKED');
  if (breakdown.freezeAuthority === 100) reasons.push('FREEZE_REVOKED');
  if (breakdown.tokenAge >= 85) reasons.push('ESTABLISHED');
  if (breakdown.liquidityDepth >= 85) reasons.push('DEEP_LIQUIDITY');
  return reasons;
}

function getConfidence(tokenData) {
  var confidence = 'HIGH';
  if (tokenData.holderNote === 'MEGACAP_SKIP' || tokenData.holderNote === 'MEGA_CAP_FALLBACK') confidence = 'MEDIUM';
  if (tokenData.liquidityUsd === 0 && tokenData.ageInHours === 0) confidence = 'LOW';
  return confidence;
}

module.exports = { calculateSurvivalScore, generateReasons, getConfidence, WEIGHTS };
