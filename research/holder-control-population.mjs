import { fetchTokenData } from "../src/fetcher.js";
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
console.log("token".padEnd(9) + "raw".padStart(7) + "keypair".padStart(9) + "offcurve".padStart(10) + " | totals: ctrl / offcurve | class");
console.log("-".repeat(84));
let diverged = 0;
for (const [n, m] of T) {
  try {
    const d = await fetchTokenData(m);
    const b = d.concentrationBasis || {}, c = b.owner_control || {};
    const raw = b.largest_owner_share_of_sample, kp = c.largest_keypair_controllable_share_of_sample;
    if (typeof raw === "number" && typeof kp === "number" && Math.abs(raw - kp) > 10) diverged++;
    console.log(n.padEnd(9) + String(raw).padStart(7) + String(kp).padStart(9) +
      String(c.largest_unattributed_off_curve_share_of_sample).padStart(10) +
      " |  " + String(c.controllable_total_share).padStart(6) + " / " + String(c.unattributed_off_curve_total_share).padStart(6) +
      "  | " + c.largest_owner_class);
    await new Promise(r => setTimeout(r, 500));
  } catch (e) { console.log(n.padEnd(9), "ERROR", e.message.slice(0, 45)); }
}
console.log("\ntokens where raw and keypair-controllable diverge by >10 points:", diverged, "of", T.length);
