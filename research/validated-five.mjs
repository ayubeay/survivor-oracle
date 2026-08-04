import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore } from "../src/scorer.js";
const tier = s => s==null?"INCOMPLETE":s>=75?"LOW":s>=60?"MEDIUM":s>=50?"HIGH":s>=40?"VERY_HIGH":"EXTREME";
const gate = s => s==null?"DEFER":s>=65?"ALLOW":s>=40?"CHALLENGE":"DENY";
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
console.log("token".padEnd(9)+"live  new  delta | devConst  lpHole | band              | gate");
console.log("-".repeat(84));
let bandX=0, gateX=0, incomplete=0, deltas=[];
for (const [n,m] of T) {
  try {
    const d = await fetchTokenData(m);
    const r = calculateSurvivalScore(d);
    const v = r.validated_five_shadow || {};
    if (v.score_status === "INCOMPLETE") { incomplete++; console.log(n.padEnd(9)+String(r.score).padStart(4)+"  INCOMPLETE  missing: "+v.missing_required_signals.join(",")); continue; }
    const delta = v.score - r.score;
    deltas.push(delta);
    const devConst = -7.5;                       // removing the fabricated neutral 50 at weight 15
    const lpHole = (delta - devConst).toFixed(1); // the rest is the LP hole no longer suppressing
    const bx = tier(v.score) !== tier(r.score), gx = gate(v.score) !== gate(r.score);
    if (bx) bandX++; if (gx) gateX++;
    console.log(n.padEnd(9)+String(r.score).padStart(4)+String(v.score).padStart(5)+String(delta).padStart(7)+
      " |   "+devConst+"   "+String(lpHole).padStart(5)+"  | "+(tier(r.score)+"->"+tier(v.score)).padEnd(18)+(bx?"*":" ")+"| "+(gate(r.score)+"->"+gate(v.score))+(gx?" *":""));
    await new Promise(r=>setTimeout(r,500));
  } catch(e){ console.log(n.padEnd(9),"ERROR",e.message.slice(0,45)); }
}
const mean = deltas.length ? (deltas.reduce((a,b)=>a+b,0)/deltas.length).toFixed(1) : "n/a";
console.log("\nmean delta:",mean,"| band crossings:",bandX,"| gate crossings:",gateX,"| incomplete:",incomplete);
console.log("NOTE: bands are calibrated for the old model. Crossings here are expected and require recalibration, not rejection.");
