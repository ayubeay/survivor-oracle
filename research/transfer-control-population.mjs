/* Does transfer control carry independent information across the population, or did
   BERN just give us one compelling example? Observation only. */
import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore } from "../src/scorer.js";

const TOKENS = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT","7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],
  ["MEW","MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
  ["BOME","ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
  ["SLERF","7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3"],
  ["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["PYTH","HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["JTO","jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
  ["RAY","4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["ORCA","orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],
  ["TNSR","TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6"],
  ["DRIFT","DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7"],
  ["W","85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ"],
  ["mSOL","mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["jitoSOL","J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["bSOL","bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"],
  ["INF","5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm"],
  ["USDC","EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["USDT","Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  ["PYUSD","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["USDG","2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"],
  ["BERN","CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo"],
];

const rows = [];
for (const [name, mint] of TOKENS) {
  try {
    const d = await fetchTokenData(mint);
    const r = calculateSurvivalScore(d);
    const t = d.transferControl || {};
    const cs = t.controls || [];
    // separated deliberately: freeze authority already carries 10 live weight as a boolean
    const freeze = cs.find(c => c.type === "FREEZE_AUTHORITY") || null;
    const others = cs.filter(c => c.type !== "FREEZE_AUTHORITY");
    rows.push({
      name, score: r.score, program: t.program, state: t.state,
      freezeClass: freeze ? freeze.authority_class : null,
      otherControls: others.map(c => c.type + ":" + c.status),
      activeConstraints: cs.filter(c => c.status === "ACTIVE_CONSTRAINT").map(c => c.type),
      shadowTC: r.shadow_transfer_control || {},
      latent: cs.filter(c => c.status === "PRESENT_LATENT" || c.status === "PRESENT_INACTIVE").map(c => c.type),
    });
  } catch (e) { rows.push({ name, error: e.message.slice(0, 50) }); }
}

console.log("\n" + "token".padEnd(9) + "score".padStart(6) + "  " + "program".padEnd(12) + "state".padEnd(15) + "freezeAuth".padEnd(16) + "other controls");
console.log("-".repeat(110));
for (const r of rows) {
  if (r.error) { console.log(r.name.padEnd(9), "ERROR", r.error); continue; }
  console.log(r.name.padEnd(9) + String(r.score).padStart(6) + "  " +
    String(r.program).padEnd(12) + String(r.state).padEnd(15) +
    String(r.freezeClass || "-").padEnd(14) +
    "live " + String(r.shadowTC.live_freeze_subscore).padStart(4) +
    " shadow " + String(r.shadowTC.shadow_subscore).padStart(4) +
    " delta " + String(r.shadowTC.score_delta).padStart(4) + "  " + String(r.shadowTC.reason || "").slice(0, 40));
}

const ok = rows.filter(r => !r.error);
const byState = {};
ok.forEach(r => { byState[r.state] = (byState[r.state] || 0) + 1; });
console.log("\nstate distribution:", JSON.stringify(byState));
console.log("with freeze authority:", ok.filter(r => r.freezeClass).length, "/", ok.length);
console.log("with any non-freeze control:", ok.filter(r => r.otherControls.length).length);
console.log("with an ACTIVE_CONSTRAINT:", ok.filter(r => r.activeConstraints.length).map(r => r.name).join(", ") || "none");
console.log("token-2022:", ok.filter(r => r.program === "TOKEN_2022").map(r => r.name).join(", "));

// does it separate tokens the live score conflates?
const byScore = {};
ok.forEach(r => { (byScore[r.score] = byScore[r.score] || []).push(r); });
console.log("\nseparation within identical live scores:");
Object.entries(byScore).filter(([, v]) => v.length > 1).forEach(([s, v]) => {
  const states = new Set(v.map(r => r.state));
  console.log("  score " + s + ":", v.map(r => r.name + "(" + r.state + ")").join(" "),
    states.size > 1 ? "  <- SEPARATED" : "  (same state)");
});
