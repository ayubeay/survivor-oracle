'use strict';

const express = require('express');
const router = express.Router();

// ── Policy Configuration ──────────────────────────────────────────────────────

const POLICY_VERSION = 'rpe-2026-03-01';

const DEFAULT_POLICY = {
  min_score: 40,
  challenge_range: [40, 54],
  allow_min: 55,
  max_tier: 3,
  min_ttl_seconds: 60,
  challenge_max_usd: 500,
  deny_reasons: {
    SCORE_TOO_LOW: 'Score below minimum threshold',
    TIER_TOO_HIGH: 'Token risk tier exceeds maximum',
    ATTESTATION_EXPIRED: 'Attestation TTL expired or too short',
    SIGNER_MISMATCH: 'Attestation signer does not match oracle',
    PROGRAM_MISMATCH: 'Program binding mismatch',
    SIGNATURE_INVALID: 'Signature verification failed',
  }
};

// ── Policy Endpoint (public) ──────────────────────────────────────────────────

router.get('/policy', function (req, res) {
  res.json({
    policy_version: POLICY_VERSION,
    thresholds: {
      min_score: DEFAULT_POLICY.min_score,
      challenge_range: DEFAULT_POLICY.challenge_range,
      allow_min: DEFAULT_POLICY.allow_min,
      max_tier: DEFAULT_POLICY.max_tier,
      min_ttl_seconds: DEFAULT_POLICY.min_ttl_seconds,
      challenge_max_usd: DEFAULT_POLICY.challenge_max_usd,
    },
    decisions: ['ALLOW', 'DENY', 'CHALLENGE'],
    updated: '2026-03-01',
  });
});

// ── Evaluate Endpoint ─────────────────────────────────────────────────────────

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
  var issued_at = Number(attestation.issued_at) || 0;
  var ttl_remaining = expires_at - now;

  // ── Check: Signature valid (from upstream verify) ───────────────────────
  if (checks.signature_valid === false) {
    denials.push('SIGNATURE_INVALID');
  } else {
    reasons.push('SIGNATURE_OK');
  }

  // ── Check: Signer matches oracle ────────────────────────────────────────
  if (checks.signer_matches === false) {
    denials.push('SIGNER_MISMATCH');
  } else {
    reasons.push('SIGNER_OK');
  }

  // ── Check: Program binding ──────────────────────────────────────────────
  if (checks.program_matches === false) {
    denials.push('PROGRAM_MISMATCH');
  } else {
    reasons.push('PROGRAM_OK');
  }

  // ── Check: TTL ──────────────────────────────────────────────────────────
  if (expires_at > 0 && ttl_remaining < DEFAULT_POLICY.min_ttl_seconds) {
    denials.push('ATTESTATION_EXPIRED');
  } else {
    reasons.push('TTL_OK');
  }

  // ── Check: Tier ─────────────────────────────────────────────────────────
  if (tier > DEFAULT_POLICY.max_tier) {
    denials.push('TIER_TOO_HIGH');
  } else {
    reasons.push('TIER_OK');
  }

  // ── Check: Score ────────────────────────────────────────────────────────
  if (score < DEFAULT_POLICY.min_score) {
    denials.push('SCORE_TOO_LOW');
  } else {
    reasons.push('SCORE_OK');
  }

  // ── Decision Logic ──────────────────────────────────────────────────────

  var decision;
  var limits = {};

  if (denials.length > 0) {
    decision = 'DENY';
  } else if (score >= DEFAULT_POLICY.challenge_range[0] && score <= DEFAULT_POLICY.challenge_range[1]) {
    decision = 'CHALLENGE';
    limits.max_amount_usd = DEFAULT_POLICY.challenge_max_usd;
    reasons.push('SCORE_IN_CHALLENGE_RANGE');

    // If amount exceeds challenge limit, deny
    if (amount_usd > 0 && amount_usd > DEFAULT_POLICY.challenge_max_usd) {
      decision = 'DENY';
      denials.push('AMOUNT_EXCEEDS_CHALLENGE_LIMIT');
    }
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
    },
  };
}

module.exports = { rpeRouter: router, evaluate };
