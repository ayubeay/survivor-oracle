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
  if (top10Percent <= 30) return 100;
  if (top10Percent >= 90) return 0;
  return Math.round(100 - ((top10Percent - 30) / 60) * 100);
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
  if (hours < 1) return 10;
  if (hours < 6) return 30;
  if (hours < 24) return 50;
  if (hours < 72) return 70;
  if (hours < 168) return 85;
  return 100;
}

function scoreLiquidityDepth(usd) {
  if (usd < 1000) return 10;
  if (usd < 5000) return 30;
  if (usd < 10000) return 50;
  if (usd < 50000) return 70;
  if (usd < 100000) return 85;
  return 100;
}

function calculateSurvivalScore(tokenData) {
  const breakdown = {
    mintAuthority: scoreMintAuthority(tokenData.mintAuthorityRevoked),
    freezeAuthority: scoreFreezeAuthority(tokenData.freezeAuthorityRevoked),
    lpLocked: scoreLpLocked(tokenData.lpInfo),
    holderConcentration: scoreHolderConcentration(tokenData.top10HolderPercent || 80),
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
  if (score >= 80) riskLevel = 'LOW';
  else if (score >= 60) riskLevel = 'MEDIUM';
  else if (score >= 40) riskLevel = 'HIGH';
  else if (score >= 20) riskLevel = 'VERY_HIGH';
  else riskLevel = 'EXTREME';

  return { score, riskLevel, breakdown, weights: WEIGHTS, timestamp: new Date().toISOString() };
}

module.exports = { calculateSurvivalScore, WEIGHTS };
