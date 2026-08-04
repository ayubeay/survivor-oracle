/* Does the collective penalty modify the owner signal, or dominate it? If the ranking
   holds across penalty scales, the owner signal is primary. If it flips, the penalty is. */
import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore } from "../src/scorer.js";

const SCALES = {
  steep:  [0, 5, 10, 15, 20],
  medium: [0, 4,  8, 12, 16],
  mild:   [0, 3,  7, 10, 15],
};
function penalty(top10, scale) {
  if (typeof top10 !== "number") return 0;
  if (top10 <= 35) return scale[0];
  if (top10 <= 50) return scale[1];
  if (top10 <= 70) return scale[2];
  if (top10 <= 85) return scale[3];
  return scale[4];
}

const TOKENS = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT","7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],
  ["MEW","MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
  ["BOME","ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
  ["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["RAY","4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["ORCA","orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],
  ["PYTH","HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["JTO","jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
  ["TNSR","TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6"],
  ["DRIFT","DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7"],
  ["mSOL","mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["jitoSOL","J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["PYUSD","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
];

const rows = [];
for (const [n, m] of TOKENS) {
  const d = await fetchTokenData(m);
  const r = calculateSurvivalScore(d);
  const h = r.holder_structure_shadow || {};
  const lo = h.largest_owner_subscore, t10 = h.legacy_top10_percent;
  const out = { n, lo, t10 };
  for (const [k, s] of Object.entries(SCALES)) out[k] = Math.max(5, lo - penalty(t10, s));
  rows.push(out);
  await new Promise(r => setTimeout(r, 450));
}

console.log("\ntoken".padEnd(10) + "owner".padStart(6) + "top10".padStart(8) + "  steep  med  mild");
console.log("-".repeat(48));
for (const r of rows) {
  console.log(r.n.padEnd(10) + String(r.lo).padStart(6) + String(r.t10).padStart(8) +
    String(r.steep).padStart(7) + String(r.medium).padStart(6) + String(r.mild).padStart(6));
}

const rank = k => [...rows].sort((a, b) => b[k] - a[k]).map(r => r.n);
const rs = rank("steep"), rm = rank("medium"), rl = rank("mild"), ro = rank("lo");
console.log("\nranking by steep :", rs.join(" "));
console.log("ranking by mild  :", rl.join(" "));
console.log("ranking by owner :", ro.join(" "));
const flips = rs.filter((n, i) => rl[i] !== n).length;
console.log("\npositions differing steep vs mild:", flips, "of", rows.length);
const bome = rows.find(r => r.n === "BOME"), tnsr = rows.find(r => r.n === "TNSR");
console.log("BOME vs TNSR - steep:", bome.steep, "vs", tnsr.steep, "| mild:", bome.mild, "vs", tnsr.mild);
