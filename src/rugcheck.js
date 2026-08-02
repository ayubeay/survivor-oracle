/**
 * SURVIVOR Phase 3 — RugCheck External Signal
 * Fetches independent risk assessment from RugCheck API
 * No API key required
 * Built by SURVIVOR Agent #598 | v0.4.1
 */

const RUGCHECK_BASE = "https://api.rugcheck.xyz/v1/tokens";
const TIMEOUT_MS = 5000;

async function fetchRugCheck(mint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `${RUGCHECK_BASE}/${mint}/report/summary`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      return { available: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();

    // RugCheck score: 0 = safest, higher = riskier
    // Normalize to our convention: higher = safer
    const rawScore = data.score_normalised ?? data.score ?? null;
    let normalizedScore = null;
    let verdict = "UNKNOWN";

    if (rawScore !== null) {
      // RugCheck: 0-1000 scale, lower = safer
      // Invert: 100 - (raw/10) to match our 0-100 higher=safer
      normalizedScore = Math.max(0, Math.min(100, Math.round(100 - (rawScore / 10))));
      if (normalizedScore >= 75) verdict = "LOW";
      else if (normalizedScore >= 55) verdict = "MEDIUM";
      else verdict = "HIGH";
    }

    return {
      available: true,
      source: "rugcheck.xyz",
      raw_score: rawScore,
      normalized_score: normalizedScore,
      verdict: verdict,
      risks: Array.isArray(data.risks) ? data.risks.map(r => {
        if (typeof r === 'string') return r;
        return r.name || r.description || JSON.stringify(r);
      }).slice(0, 5) : [],
      /* Verified on-chain 2026-08-02: this value is (LP ever minted - LP in circulation),
         i.e. burned LP. It is not a time-lock and carries no unlock date. Checked against
         WIF's largest pool: rugcheck total 3,102,901,079,517 minus locked
         3,092,351,215,846 = 10,549,863,671, matching the actual LP mint supply of
         10,548,813,355 to 0.01%. See docs/LP_SOURCE_SEMANTICS.md */
      burned_lp_percent: data.lpLockedPct ?? null,
      burned_lp_semantics: {
        meaning: "Percentage of historical LP supply removed from circulation across recognized pools",
        irreversible: true,
        is_time_lock: false,
        unlock_date_available: false,
        source_field: "lpLockedPct",
        caveat: "Burned LP closes one withdrawal route. It does not establish asset safety - SLERF burned 99.97% of its LP.",
      },
      // deprecated: the source's field name implies escrow. Retained for compatibility only.
      lp_locked_pct: data.lpLockedPct ?? null,
      lp_locked_pct_deprecated: true,
    };
  } catch (err) {
    return { available: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

module.exports = { fetchRugCheck };
