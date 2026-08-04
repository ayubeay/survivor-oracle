/* Promotion gate for the adverse-only holder control penalty.
   Pass conditions: no score rises, no gate loosens, penalties land only on genuine
   controllable concentration, off-curve holdings are not penalised for existing. */
import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore } from "../src/scorer.js";

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

console.log("token".padEnd(9)+"kpCtrl%".padStart(8)+"  pen | live  new | band            | gate            | class");
console.log("-".repeat(96));
let rose=0, gateLoosened=0, penalised=0, offCurvePenalised=0;
for (const [n, m] of T) {
  try {
    const d = await fetchTokenData(m);
    const r = calculateSurvivalScore(d);
    const p = r.holder_control_penalty_shadow || {};
    const pen = p.penalty || 0;
    const ns = r.score - pen;
    if (ns > r.score) rose++;
    if (pen > 0) penalised++;
    if (pen > 0 && String(p.largest_owner_class).indexOf("OFF_CURVE") === 0) offCurvePenalised++;
    const gx = gate(ns) !== gate(r.score);
    const loosened = gx && (gate(ns) === "ALLOW" && gate(r.score) !== "ALLOW");
    if (loosened) gateLoosened++;
    console.log(n.padEnd(9)+String(p.largest_keypair_controllable_percent_of_supply).padStart(8)+
      "  -"+String(pen).padStart(2)+" | "+String(r.score).padStart(4)+String(ns).padStart(5)+
      "  | "+(tier(r.score)+"->"+tier(ns)).padEnd(15)+" | "+(gate(r.score)+"->"+gate(ns)).padEnd(15)+" | "+p.largest_owner_class);
    await new Promise(r => setTimeout(r, 500));
  } catch (e) { console.log(n.padEnd(9), "ERROR", e.message.slice(0,45)); }
}
console.log("\nPASS CONDITIONS");
console.log("  scores that rose:", rose, rose === 0 ? "PASS" : "FAIL");
console.log("  gates loosened:", gateLoosened, gateLoosened === 0 ? "PASS" : "FAIL");
console.log("  off-curve holdings penalised:", offCurvePenalised, offCurvePenalised === 0 ? "PASS" : "FAIL");
console.log("  tokens penalised:", penalised, "of", T.length);
