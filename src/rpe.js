'use strict';

const express = require('express');
const router = express.Router();

// ── Policy Configuration ──────────────────────────────────────────────────────

const POLICY_VERSION = 'rpe-2026-03-02';

const DEFAULT_POLICY = {
  min_score: 40,
  challenge_range: [40, 54],
  allow_min: 55,
  max_tier: 3,
  min_ttl_seconds: 60,
  // Amount limits scale with score
  amount_limits: [
    { min_score: 80, max_usd: null },       // unlimited
    { min_score: 65, max_usd: 10000 },
    { min_score: 55, max_usd: 5000 },
    { min_score: 40, max_usd: 500 },         // challenge range
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAmountLimit(score) {
  for (var i = 0; i < DEFAULT_POLICY.amount_limits.length; i++) {
    var t = DEFAULT_POLICY.amount_limits[i];
    if (score >= t.min_score) return t.max_usd;
  }
  return 0;
}

function scoreToRiskLevel(score) {
  if (score >= 75) return 'LOW';
  if (score >= 55) return 'MEDIUM';
  if (score >= 35) return 'HIGH';
  if (score >= 20) return 'VERY_HIGH';
  return 'EXTREME';
}

// ── Core Evaluation Logic ─────────────────────────────────────────────────────

function evaluate(attestation, checks, context) {
  var reasons = [];
  var denials = [];
  var now = Math.floor(Date.now() / 1000);
  var mode = (context && context.mode) || 'default';
  var amount_usd = (context && context.amount_usd) || 0;

  var score = Number(attestation.score) || 0;
  var tier = Number(attestation.tier) || 99;
  var expires_at = Number(attestation.expires_at) || 0;
  var ttl_remaining = expires_at - now;

  // Signature
  if (checks.signature_valid === false) { denials.push('SIGNATURE_INVALID'); }
  else { reasons.push('SIGNATURE_OK'); }

  // Signer
  if (checks.signer_matches === false) { denials.push('SIGNER_MISMATCH'); }
  else { reasons.push('SIGNER_OK'); }

  // Program
  if (checks.program_matches === false) { denials.push('PROGRAM_MISMATCH'); }
  else { reasons.push('PROGRAM_OK'); }

  // TTL
  if (expires_at > 0 && ttl_remaining < DEFAULT_POLICY.min_ttl_seconds) { denials.push('ATTESTATION_EXPIRED'); }
  else { reasons.push('TTL_OK'); }

  // Tier
  if (tier > DEFAULT_POLICY.max_tier) { denials.push('TIER_TOO_HIGH'); }
  else { reasons.push('TIER_OK'); }

  // Score
  if (score < DEFAULT_POLICY.min_score) { denials.push('SCORE_TOO_LOW'); }
  else { reasons.push('SCORE_OK'); }

  // Amount-aware gating
  var amountLimit = getAmountLimit(score);
  if (amount_usd > 0 && amountLimit !== null && amount_usd > amountLimit) {
    denials.push('AMOUNT_EXCEEDS_LIMIT');
  }

  // Decision
  var decision;
  var limits = {};
  if (amountLimit !== null) limits.max_amount_usd = amountLimit;

  if (denials.length > 0) {
    decision = 'DENY';
  } else if (score >= DEFAULT_POLICY.challenge_range[0] && score <= DEFAULT_POLICY.challenge_range[1]) {
    decision = 'CHALLENGE';
    limits.max_amount_usd = DEFAULT_POLICY.amount_limits[DEFAULT_POLICY.amount_limits.length - 1].max_usd || 500;
    reasons.push('SCORE_IN_CHALLENGE_RANGE');
  } else {
    decision = 'ALLOW';
  }

  return {
    decision: decision,
    reason_codes: denials.length > 0 ? denials.concat(reasons) : reasons,
    denials: denials,
    policy_version: POLICY_VERSION,
    limits: limits,
    evaluation: {
      score: score,
      tier: tier,
      ttl_remaining: ttl_remaining,
      mode: mode,
      amount_usd: amount_usd,
      amount_limit: amountLimit,
    },
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Public: current policy
router.get('/policy', function (req, res) {
  res.json({
    policy_version: POLICY_VERSION,
    thresholds: {
      min_score: DEFAULT_POLICY.min_score,
      challenge_range: DEFAULT_POLICY.challenge_range,
      allow_min: DEFAULT_POLICY.allow_min,
      max_tier: DEFAULT_POLICY.max_tier,
      min_ttl_seconds: DEFAULT_POLICY.min_ttl_seconds,
    },
    amount_limits: DEFAULT_POLICY.amount_limits,
    decisions: ['ALLOW', 'DENY', 'CHALLENGE'],
    updated: '2026-03-02',
  });
});

// Quote: simulate decision + cost without charging credits
router.post('/quote', express.json(), function (req, res) {
  try {
    var body = req.body || {};
    var score = Number(body.score) || 0;
    var tier = Number(body.tier) || 1;
    var amount_usd = Number(body.amount_usd) || 0;

    var now = Math.floor(Date.now() / 1000);
    var simAttestation = { score: score, tier: tier, issued_at: now, expires_at: now + 3600 };

    var result = evaluate(simAttestation, {
      signature_valid: true, signer_matches: true, program_matches: true,
    }, { mode: 'quote', amount_usd: amount_usd });

    // Estimate credit cost
    var creditCost = null;
    try {
      var creditsModule = require('./credits');
      creditCost = creditsModule.computeCost(score, scoreToRiskLevel(score));
    } catch (e) {}

    res.json({
      quote: true,
      decision: result.decision,
      reason_codes: result.reason_codes,
      limits: result.limits,
      amount_limit: getAmountLimit(score),
      policy_version: POLICY_VERSION,
      credit_cost: creditCost ? creditCost.credits : null,
      cost_breakdown: creditCost ? creditCost.breakdown : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Evaluate: full policy evaluation with attestation
router.post('/evaluate', express.json(), function (req, res) {
  try {
    var body = req.body || {};
    var attestation = body.attestation;
    var checks = body.checks || {};
    var context = body.context || {};

    if (!attestation) {
      return res.status(400).json({ error: 'missing attestation object' });
    }

    var result = evaluate(attestation, checks, context);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { rpeRouter: router, evaluate, getAmountLimit, scoreToRiskLevel, POLICY_VERSION };
