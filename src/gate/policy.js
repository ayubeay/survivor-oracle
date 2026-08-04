/**
 * SURVIVOR Gate — Policy Engine
 * Converts score + risk_tier + reasons → canonical execution authority
 *
 * Score scale (higher = safer):
 *   < 40  → DENY       (VERY_HIGH, almost all pump.fun tokens)
 *   40-49 → READ_ONLY  (VERY_HIGH but borderline)
 *   50-62 → THROTTLE   (HIGH)
 *   63-74 → THROTTLE   (MEDIUM, loose constraints)
 *   75+   → ALLOW      (LOW — rare)
 *
 * Irreversible action types always tighten one level.
 */

const IRREVERSIBLE_KINDS = new Set(['bridge', 'lp_remove', 'lp_add']);

/**
 * @param {object} args
 * @param {number} args.score        0-100, higher = safer
 * @param {string} args.risk_tier    VERY_HIGH | HIGH | MEDIUM | LOW
 * @param {number} args.confidence   0-1 float
 * @param {Array}  args.reasons      [{code, severity, detail?}]
 * @param {string} args.kind         swap | lp_add | lp_remove | bridge | limit
 * @returns {SurvivorPolicy}
 */
function buildPolicy({ score, risk_tier, confidence, reasons = [], kind = 'swap', coverage = null, notional_usd = 0, score_basis = 'unknown', transfer_control = null, owner_control = null }) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 300; // policy valid for 5 minutes

  const mappedReasons = reasons.map(r => ({
    code: r.code || r.flag || 'UNKNOWN',
    severity: r.severity || 'medium',
  }));

  let policy;

  if (score < 40) {
    policy = {
      decision: 'DENY',
      constraints: { cooldown_seconds: 3600 },
      confidence: confidence || 0.85,
      reasons: mappedReasons.length ? mappedReasons : [{ code: 'RISK_TOO_HIGH', severity: 'high' }],
      expires_at: expiresAt,
    };
  } else if (score < 50) {
    policy = {
      decision: 'READ_ONLY',
      constraints: { cooldown_seconds: 1800 },
      confidence: confidence || 0.80,
      reasons: mappedReasons.length ? mappedReasons : [{ code: 'RISK_ELEVATED', severity: 'high' }],
      expires_at: expiresAt,
    };
  } else if (score < 63) {
    policy = {
      decision: 'THROTTLE',
      constraints: {
        max_notional_usd: 500,
        max_slippage_bps: 50,
        cooldown_seconds: 900,
      },
      confidence: confidence || 0.75,
      reasons: mappedReasons.length ? mappedReasons : [{ code: 'RISK_MODERATE', severity: 'medium' }],
      expires_at: expiresAt,
    };
  } else if (score < 75) {
    policy = {
      decision: 'THROTTLE',
      constraints: {
        max_notional_usd: 2000,
        max_slippage_bps: 80,
        cooldown_seconds: 300,
      },
      confidence: confidence || 0.70,
      reasons: mappedReasons.length ? mappedReasons : [{ code: 'RISK_MODERATE_LOW', severity: 'low' }],
      expires_at: expiresAt,
    };
  } else {
    policy = {
      decision: 'ALLOW',
      constraints: {
        max_notional_usd: 5000,
        max_slippage_bps: 100,
        cooldown_seconds: 0,
      },
      confidence: confidence || 0.65,
      reasons: mappedReasons.length ? mappedReasons : [{ code: 'RISK_ACCEPTABLE', severity: 'low' }],
      expires_at: expiresAt,
    };
  }

  // Irreversible actions always tighten one level
  if (IRREVERSIBLE_KINDS.has(kind)) {
    policy = applyIrreversibilityHardening(policy, kind);
  }

  // Coverage cap - SHADOW ONLY. Computed and reported, never applied to policy.decision.
  // Promotion to enforcement happens only after harness validation of gate migrations.
  const hc = holderControlPolicy(owner_control, notional_usd);
  policy.shadow_holder_control = {
    policy_version: HOLDER_CONTROL_POLICY,
    enforced: false,
    live_decision: policy.decision,
    suggested_decision: hc.decision,
    would_change: hc.decision !== null && hc.decision !== policy.decision,
    reason: hc.reason,
    measurement_status: hc.measurement_status || 'UNAVAILABLE',
    disclosures: hc.disclosures,
    note: 'DENY is never suggested from concentration alone.',
  };

  const exec = executionConstraints(transfer_control, notional_usd);
  policy.shadow_execution_constraints = {
    policy_version: EXECUTION_CONSTRAINT_POLICY,
    enforced: false,
    live_decision: policy.decision,
    suggested_decision: exec.decision,
    would_change: exec.decision !== null && exec.decision !== policy.decision,
    reason: exec.reason,
    disclosures: exec.disclosures,
  };

  const shadow = coverageCap(policy.decision, coverage, notional_usd, score_basis);
  policy.shadow_coverage_policy = {
    policy_version: COVERAGE_CAP_POLICY,
    live_decision: policy.decision,
    shadow_decision: shadow.decision,
    would_change: shadow.capped,
    score_basis: score_basis,
    coverage_percent: shadow.coverage_percent ?? null,
    reason: shadow.reason,
    unmeasured: shadow.unmeasured || [],
    notional_usd: notional_usd || 0,
  };

  return policy;
}

/* Coverage cap - constitution v0.5.1, SHADOW ONLY.
   Coverage constrains permission; it never grants it. A downgrade-only mapping, matching
   applyIrreversibilityHardening. Evidence measured on thin coverage should not buy the
   same permission as the identical score measured on full coverage. */
const COVERAGE_CAP_POLICY = 'coverage-cap-v0.5.1-shadow';

function coverageCap(decision, coverage, notionalUsd, scoreBasis) {
  // A curated score is not evidence-derived, so evidence coverage cannot constrain it.
  if (scoreBasis === 'curated') {
    return { decision, capped: false, reason: 'COVERAGE_NOT_APPLICABLE_TO_CURATED_SCORE',
             coverage_percent: null };
  }
  const pct = coverage && typeof coverage.weight_coverage_percent === 'number'
    ? coverage.weight_coverage_percent : null;
  if (pct === null) {
    // A computed score arriving without coverage is a pipeline defect, not thin evidence.
    return { decision, capped: false,
             reason: scoreBasis === 'computed' ? 'COVERAGE_MISSING_FOR_COMPUTED_SCORE' : 'COVERAGE_UNKNOWN',
             coverage_percent: null };
  }

  const rank = { DENY: 0, READ_ONLY: 1, THROTTLE: 2, ALLOW: 3 };
  let ceiling = 'ALLOW', reason = null;

  if (pct < 50) {
    ceiling = (notionalUsd || 0) > 100 ? 'DENY' : 'READ_ONLY';
    reason = 'COVERAGE_BELOW_50';
  } else if (pct < 70) {
    ceiling = 'THROTTLE';
    reason = 'COVERAGE_BELOW_70';
  }

  if (rank[decision] > rank[ceiling]) {
    const unmeasured = (coverage.unmeasured || []).map(u => u.reason || u.signal);
    return { decision: ceiling, capped: true, reason, coverage_percent: pct, unmeasured };
  }
  return { decision, capped: false, reason: null, coverage_percent: pct };
}

/* Active transfer constraints as an EXECUTION concern, not an evidence one - v0.5.3 shadow.
   A 2.69% transfer fee is a known transaction cost, not a probabilistic risk. It belongs
   beside slippage and route fees, computed against the actual notional. Boundaries are
   provisional and shadowed. */
const EXECUTION_CONSTRAINT_POLICY = 'execution-constraints-v0.5.3-shadow';

function executionConstraints(transferControl, notionalUsd) {
  if (!transferControl || !transferControl.state) {
    return { decision: null, reason: 'TRANSFER_CONTROL_UNKNOWN', disclosures: [] };
  }
  var controls = transferControl.controls || [];
  var disclosures = [], suggested = null, reasons = [];
  var n = Number(notionalUsd) || 0;

  controls.forEach(function (c) {
    if (c.type === 'NON_TRANSFERABLE') {
      suggested = 'DENY'; reasons.push('NON_TRANSFERABLE');
    }
    if (c.type === 'DEFAULT_ACCOUNT_STATE' && c.status === 'ACTIVE_CONSTRAINT') {
      if (suggested !== 'DENY') suggested = 'READ_ONLY';
      reasons.push('DEFAULT_ACCOUNTS_FROZEN');
    }
    if (c.type === 'TRANSFER_HOOK' && c.status === 'ACTIVE_CONSTRAINT') {
      if (!suggested) suggested = 'THROTTLE';
      reasons.push('ACTIVE_TRANSFER_HOOK_UNCLASSIFIED');
      disclosures.push({ type: 'TRANSFER_HOOK', program_id: c.program_id,
        note: 'A program runs on every transfer and may block it. Hook program not classified.' });
    }
    if (c.type === 'TRANSFER_FEE' && c.status === 'ACTIVE_CONSTRAINT') {
      var bps = c.current_basis_points || 0;
      var cost = Math.round(n * bps / 10000 * 100) / 100;
      disclosures.push({ type: 'TRANSFER_FEE', basis_points: bps,
        percent: bps / 100, estimated_cost_usd: cost,
        estimated_received_usd: Math.round((n - cost) * 100) / 100,
        authority: c.authority || null, mutable: c.mutable === true,
        note: 'Charged on every transfer. The fee authority can change this value.' });
      reasons.push('ACTIVE_TRANSFER_FEE_' + bps + 'BPS');
      if (bps > 300 && !suggested) suggested = 'READ_ONLY';
      else if (bps >= 100 && !suggested) suggested = 'THROTTLE';
    }
    if (c.type === 'PERMANENT_DELEGATE') {
      disclosures.push({ type: 'PERMANENT_DELEGATE', authority: c.authority || null,
        authority_class: c.authority_class || null,
        note: 'This authority can transfer or burn from any holder account without consent. Disclosed capability, not evidence of misuse.' });
    }
    if (c.type === 'FREEZE_AUTHORITY') {
      disclosures.push({ type: 'FREEZE_AUTHORITY', authority: c.authority || null,
        authority_class: c.authority_class || null,
        note: 'This authority can freeze token accounts, preventing transfer.' });
    }
  });

  return { decision: suggested, reason: reasons.join(',') || null, disclosures: disclosures };
}

/* Holder control as an execution concern - v0.5.5 shadow.
   A dominant controllable owner is adverse evidence, but its economic role determines how
   severe the response should be. Layer 1 cannot tell an issuer treasury from a whale, so
   this discloses and constrains rather than denying on structure alone. DENY requires
   combined adverse evidence, not concentration by itself. */
const HOLDER_CONTROL_POLICY = 'holder-control-v0.5.5-shadow';

function holderControlPolicy(ownerControl, notionalUsd) {
  if (!ownerControl) return { decision: null, measurement_status: 'UNAVAILABLE', reason: 'OWNER_CONTROL_UNAVAILABLE', disclosures: [] };
  const pct = ownerControl.largest_keypair_controllable_percent_of_supply;
  if (typeof pct !== 'number') {
    return { decision: null, reason: 'KEYPAIR_SHARE_UNRESOLVED', measurement_status: 'UNAVAILABLE',
             disclosures: [{ type: 'HOLDER_CONTROL', note: 'Controllable ownership could not be measured. Absence of a finding is not a clean result.' }] };
  }
  const disclosures = [{
    type: 'HOLDER_CONTROL',
    largest_keypair_controllable_percent_of_supply: pct,
    owner_class: ownerControl.largest_owner_class || null,
    entity_role: 'UNKNOWN',
    note: 'An address structurally able to sign holds this share. Whether it is an issuer treasury, exchange, custodian or an individual is not established at Layer 1.',
  }];
  let decision = null, reason = null;
  if (pct > 50) { decision = 'THROTTLE'; reason = 'CONTROLLABLE_OWNER_ABOVE_50_PCT'; }
  else if (pct > 35) { decision = 'CHALLENGE'; reason = 'CONTROLLABLE_OWNER_ABOVE_35_PCT'; }
  else if (pct > 20) { reason = 'CONTROLLABLE_OWNER_ABOVE_20_PCT_DISCLOSED'; }
  return { decision, reason, measurement_status: 'OBSERVED', disclosures };
}

function applyIrreversibilityHardening(policy, kind) {
  const irreversibleReason = { code: 'IRREVERSIBLE_ACTION', severity: 'high' };

  const escalations = {
    ALLOW: () => ({
      ...policy,
      decision: 'THROTTLE',
      constraints: {
        ...policy.constraints,
        max_notional_usd: Math.min(policy.constraints.max_notional_usd || 1000, 500),
      },
      reasons: [...policy.reasons, irreversibleReason],
    }),
    THROTTLE: () => ({
      ...policy,
      decision: 'READ_ONLY',
      reasons: [...policy.reasons, irreversibleReason],
    }),
    READ_ONLY: () => ({
      ...policy,
      decision: 'DENY',
      reasons: [...policy.reasons, irreversibleReason],
    }),
  };

  return escalations[policy.decision] ? escalations[policy.decision]() : policy;
}

module.exports = { buildPolicy, coverageCap, COVERAGE_CAP_POLICY, executionConstraints, EXECUTION_CONSTRAINT_POLICY, holderControlPolicy, HOLDER_CONTROL_POLICY };