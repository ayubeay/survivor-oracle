/* live score vs score with largest-owner replacing the legacy top-10 subscore */
import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore, WEIGHTS } from "../src/scorer.js";

const tier = s => s>=75?"LOW":s>=60?"MEDIUM":s>=50?"HIGH":s>=40?"VERY_HIGH":"EXTREME";
const gate = s => s>=65?"ALLOW":s>=40?"CHALLENGE":"DENY";

const TOKENS = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT","7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],["MEW","MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
  ["BOME","ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["RAY","4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],["ORCA","orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],
  ["PYTH","HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],["JTO","jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
  ["TNSR","TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6"],["DRIFT","DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7"],
  ["mSOL","mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],["jitoSOL","J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["PYUSD","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],["SLERF","7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3"],
  ["bSOL","bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"],["INF","5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm"],
];

console.log("token".padEnd(9) + "live  new  delta | band            | gate           | owner%");
console.log("-".repeat(78));
let moved = 0, bandX = 0, gateX = 0, unresolved = 0;
for (const [n, m] of TOKENS) {
  try {
    const d = await fetchTokenData(m);
    const r = calculateSurvivalScore(d);
    const h = r.holder_structure_shadow || {}, c = h.variant_c || {};
    if (typeof c.subscore !== "number") { unresolved++; console.log(n.padEnd(9), "owner share unavailable -", c.reason); continue; }
    const newScore = r.score + (c.score_delta || 0);
    if (newScore !== r.score) moved++;
    const bx = tier(newScore) !== tier(r.score), gx = gate(newScore) !== gate(r.score);
    if (bx) bandX++; if (gx) gateX++;
    console.log(n.padEnd(9) + String(r.score).padStart(4) + String(newScore).padStart(5) +
      String(c.score_delta).padStart(6) + "  | " + (tier(r.score) + "->" + tier(newScore)).padEnd(15) + (bx ? "*" : " ") +
      "| " + (gate(r.score) + "->" + gate(newScore)).padEnd(14) + (gx ? "*" : " ") +
      "| " + String(h.largest_owner_percent_of_supply).padStart(6));
    await new Promise(r => setTimeout(r, 450));
  } catch (e) { console.log(n.padEnd(9), "ERROR", e.message.slice(0, 45)); }
}
console.log("\nmoved:", moved, "| band crossings:", bandX, "| gate crossings:", gateX, "| owner unresolved:", unresolved);
