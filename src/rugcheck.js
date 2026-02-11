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
      lp_locked_pct: data.lpLockedPct ?? null,
    };
  } catch (err) {
    return { available: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

module.exports = { fetchRugCheck };
