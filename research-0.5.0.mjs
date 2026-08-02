/**
 * 0.5.0 research harness. Compares three missing-evidence policies.
 * Reads only - does not modify the scorer or any production behaviour.
 */
import { fetchTokenData } from "./src/fetcher.js";
import { calculateSurvivalScore, WEIGHTS } from "./src/scorer.js";

const TOKENS = [
  ["BONK",    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF",     "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT",  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],
  ["JUP",     "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["PYTH",    "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["JTO",     "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
  ["RAY",     "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["ORCA",    "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],
  ["mSOL",    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["jitoSOL", "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["bSOL",    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"],
  ["INF",     "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm"],
  ["W",       "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ"],
  ["TNSR",    "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6"],
  ["DRIFT",   "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7"],
  ["MEW",     "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
  ["BOME",    "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
  ["SLERF",   "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3"],
  ["USDC",    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["USDT",    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
];

const tier = s => s === null ? "UNKNOWN" : s >= 75 ? "LOW" : s >= 60 ? "MEDIUM" : s >= 50 ? "HIGH" : s >= 40 ? "VERY_HIGH" : "EXTREME";
const gate = s => s === null ? "DEFER" : s >= 65 ? "ALLOW" : s >= 40 ? "CHALLENGE" : "DENY";

// Policy 3: cap the gate when evidence is thin, regardless of how good it looks
function coverageCappedGate(evidenceScore, coverage) {
  const raw = gate(evidenceScore);
  if (coverage < 50) return { gate: "DEFER", reason: "COVERAGE_BELOW_50" };
  if (coverage < 70 && raw === "ALLOW") return { gate: "CHALLENGE", reason: "COVERAGE_BELOW_70" };
  return { gate: raw, reason: null };
}

const rows = [];
for (const [name, mint] of TOKENS) {
  try {
    const d = await fetchTokenData(mint);
    const r = calculateSurvivalScore(d);
    if (d.megacap) { rows.push({ name, megacap: true, fixed: r.score }); continue; }

    const cov = r.coverage.weight_coverage_percent;
    const b = r.breakdown;
    const measured = [
      ["mintAuthority", b.mintAuthority, WEIGHTS.mintAuthority],
      ["freezeAuthority", b.freezeAuthority, WEIGHTS.freezeAuthority],
      ["lpLocked", b.lpLocked, WEIGHTS.lpLocked],
      ["holderConcentration", b.holderConcentration, WEIGHTS.topHolderConcentration],
      ["devWalletActivity", b.devWalletActivity, WEIGHTS.devWalletActivity],
      ["tokenAge", b.tokenAge, WEIGHTS.tokenAge],
      ["liquidityDepth", b.liquidityDepth, WEIGHTS.liquidityDepth],
    ].filter(x => x[1] !== null && x[1] !== undefined);

    const mw = measured.reduce((s, x) => s + x[2], 0);
    const weighted = measured.reduce((s, x) => s + x[1] * x[2], 0);
    const evidence = mw > 0 ? Math.round(weighted / mw) : null;
    const capped = coverageCappedGate(evidence, cov);

    rows.push({
      name, megacap: false,
      lp: d.lpInfo ? Math.round(d.lpInfo.percentLocked) + '%' : 'null',
      lpSub: b.lpLocked,
      ver: r.scoring_version || (r.meta && r.meta.scoring_version) || '?',
      fixed: r.score, renorm: evidence, cov,
      t_fixed: tier(r.score), t_renorm: tier(evidence),
      g_fixed: gate(r.score), g_renorm: gate(evidence),
      g_capped: capped.gate, capReason: capped.reason,
    });
  } catch (e) {
    rows.push({ name, error: e.message.slice(0, 60) });
  }
}

console.log("\n" + "token".padEnd(9) + "cov".padStart(5) + "  | P1 fixed        | P2 renorm       | P3 capped");
console.log("-".repeat(78));
for (const r of rows) {
  if (r.error) { console.log(r.name.padEnd(9), "ERROR", r.error); continue; }
  if (r.megacap) { console.log(r.name.padEnd(9), "  -  | megacap, curated score " + r.fixed); continue; }
  console.log(
    r.name.padEnd(9) + (r.cov + "%").padStart(5) + " lp:" + String(r.lp).padEnd(5) + "sub:" + String(r.lpSub).padStart(3) + " | " +
    String(r.fixed).padStart(3) + " " + r.t_fixed.padEnd(10) + " " + r.g_fixed.padEnd(9) + " | " +
    String(r.renorm).padStart(3) + " " + r.t_renorm.padEnd(10) + " " + r.g_renorm.padEnd(9) + " | " +
    r.g_capped.padEnd(9) + (r.capReason ? "(" + r.capReason + ")" : "")
  );
}

const live = rows.filter(r => !r.error && !r.megacap);
const covs = live.map(r => r.cov);
console.log("\ncoverage: min " + Math.min(...covs) + "% max " + Math.max(...covs) + "% distinct " + [...new Set(covs)].sort().join(", "));
console.log("gate changes P1->P2: " + live.filter(r => r.g_fixed !== r.g_renorm).map(r => r.name).join(", "));
console.log("gate changes P1->P3: " + live.filter(r => r.g_fixed !== r.g_capped).map(r => r.name).join(", "));
console.log("mean fixed " + Math.round(live.reduce((s,r)=>s+r.fixed,0)/live.length) + " vs mean renorm " + Math.round(live.reduce((s,r)=>s+r.renorm,0)/live.length));
