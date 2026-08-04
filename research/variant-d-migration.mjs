/* Variant D: largest keypair-controllable owner (% of supply) replacing the legacy
   top-10 subscore in the same 15-point slot. Reporting only. */
import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore, WEIGHTS } from "../src/scorer.js";

const ANCHORS = [[0,100],[5,100],[10,85],[20,60],[35,35],[50,15],[100,5]];
function curve(pct) {
  if (typeof pct !== "number" || !isFinite(pct)) return null;
  const p = Math.max(0, Math.min(100, pct));
  for (let i = 1; i < ANCHORS.length; i++) {
    const [lx, ly] = ANCHORS[i-1], [hx, hy] = ANCHORS[i];
    if (p <= hx) { const t = hx === lx ? 0 : (p - lx) / (hx - lx); return Math.round(ly + t * (hy - ly)); }
  }
  return 5;
}
const tier = s => s>=75?"LOW":s>=60?"MEDIUM":s>=50?"HIGH":s>=40?"VERY_HIGH":"EXTREME";
const gate = s => s>=65?"ALLOW":s>=40?"CHALLENGE":"DENY";

const T = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT","7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],["MEW","MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
  ["BOME","ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],["SLERF","7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3"],
  ["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],["RAY","4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["ORCA","orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],["PYTH","HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["JTO","jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],["TNSR","TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6"],
  ["DRIFT","DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7"],["mSOL","mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["jitoSOL","J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],["PYUSD","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
];

console.log("token".padEnd(9)+"kpCtrl%".padStart(8)+"  legacy  new | live  new  delta | band          | gate");
console.log("-".repeat(86));
let up=0, down=0, bandX=0, gateX=0, unres=0;
for (const [n, m] of T) {
  try {
    const d = await fetchTokenData(m);
    const r = calculateSurvivalScore(d);
    const c = (d.concentrationBasis||{}).owner_control || {};
    const kp = c.largest_keypair_controllable_percent_of_supply;
    const sub = curve(kp);
    if (sub === null) { unres++; console.log(n.padEnd(9), "keypair share unavailable"); continue; }
    const legacy = r.breakdown.holderConcentration;
    const delta = Math.round(((sub - legacy) * WEIGHTS.topHolderConcentration) / 100);
    const ns = r.score + delta;
    if (delta > 0) up++; if (delta < 0) down++;
    const bx = tier(ns) !== tier(r.score), gx = gate(ns) !== gate(r.score);
    if (bx) bandX++; if (gx) gateX++;
    console.log(n.padEnd(9)+String(kp).padStart(8)+"  "+String(legacy).padStart(6)+String(sub).padStart(5)+
      " | "+String(r.score).padStart(4)+String(ns).padStart(5)+String(delta).padStart(6)+
      "  | "+(tier(r.score)+"->"+tier(ns)).padEnd(13)+(bx?"*":" ")+"| "+(gate(r.score)+"->"+gate(ns))+(gx?" *":""));
    await new Promise(r => setTimeout(r, 500));
  } catch (e) { console.log(n.padEnd(9), "ERROR", e.message.slice(0,45)); }
}
console.log("\nup:",up,"down:",down,"| band crossings:",bandX,"| gate crossings:",gateX,"| unresolved:",unres);
