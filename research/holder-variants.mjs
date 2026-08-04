import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore } from "../src/scorer.js";

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

console.log("token".padEnd(9) + "top10".padStart(7) + "owner".padStart(8) + " | legacy  A   B  | deltaB | interpretation");
console.log("-".repeat(88));
const rows = [];
for (const [n, m] of TOKENS) {
  try {
    const d = await fetchTokenData(m);
    const r = calculateSurvivalScore(d);
    const h = r.holder_structure_shadow || {};
    const b = h.variant_b || {};
    rows.push({ n, legacy: h.legacy_subscore, a: h.composite_subscore, b: b.subscore, owner: h.largest_owner_percent_of_supply });
    console.log(n.padEnd(9) + String(h.legacy_top10_percent ?? "-").padStart(7) +
      String(h.largest_owner_percent_of_supply ?? "-").padStart(8) + " |  " +
      String(h.legacy_subscore).padStart(4) + String(h.composite_subscore).padStart(4) + String(b.subscore).padStart(4) +
      "  | " + String(b.score_delta).padStart(5) + "  | " + (h.interpretation || "-"));
    await new Promise(r => setTimeout(r, 500));
  } catch (e) { console.log(n.padEnd(9), "ERROR", e.message.slice(0, 45)); }
}
const distinct = k => new Set(rows.map(r => r[k])).size;
console.log("\ndistinct subscores - legacy:", distinct("legacy"), "| variantA:", distinct("a"), "| variantB:", distinct("b"), "across", rows.length, "tokens");
