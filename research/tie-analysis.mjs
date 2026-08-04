/* BONK, WIF, POPCAT, PYTH and JTO all score 91 under validated-five. Are they identical
   on every subscore, or do differences exist that the weighting flattens? */
import { fetchTokenData } from "../src/fetcher.js";
import { calculateSurvivalScore } from "../src/scorer.js";

const T = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT","7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],
  ["PYTH","HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["JTO","jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
];

console.log("token".padEnd(8) + "mint  frz  hold  age  liq | raw inputs");
console.log("-".repeat(96));
for (const [n, m] of T) {
  const d = await fetchTokenData(m);
  const r = calculateSurvivalScore(d);
  const b = r.breakdown;
  console.log(n.padEnd(8) +
    String(b.mintAuthority).padStart(4) + String(b.freezeAuthority).padStart(5) +
    String(b.holderConcentration).padStart(6) + String(b.tokenAge).padStart(5) +
    String(b.liquidityDepth).padStart(5) + " | " +
    "age " + Math.round((d.ageInHours || 0) / 24) + "d, " +
    "liq $" + Math.round((d.liquidityUsd || 0) / 1000) + "k, " +
    "top10 " + d.top10HolderPercent + "%");
  await new Promise(r => setTimeout(r, 500));
}
console.log("\nIf subscores are identical, the tie is structural - the signals saturate.");
console.log("If raw inputs differ widely but subscores match, the curves are too coarse.");
