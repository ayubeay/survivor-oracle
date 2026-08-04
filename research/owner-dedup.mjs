/* How often does one owner hold several of the top accounts, and how much does
   deduplicating change measured concentration? Observation only. */
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchTokenData } from "../src/fetcher.js";
const conn = new Connection(process.env.SOLANA_RPC, "confirmed");

const TOKENS = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["POPCAT","7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"],
  ["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
  ["RAY","4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["ORCA","orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE"],
  ["PYTH","HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3"],
  ["JTO","jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL"],
  ["mSOL","mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["jitoSOL","J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"],
  ["MEW","MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5"],
  ["BOME","ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
  ["DRIFT","DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7"],
  ["TNSR","TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6"],
  ["PYUSD","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
];

console.log("token".padEnd(9) + "supply%".padStart(8) + "  accts->owners  topOwner%  concentrationRatio");
console.log("-".repeat(66));
for (const [name, mint] of TOKENS) {
  try {
    const d = await fetchTokenData(mint);
    const supplyPct = d.top10HolderPercent;
    const largest = await conn.getTokenLargestAccounts(new PublicKey(mint));
    const accts = largest.value.slice(0, 10);
    const total = accts.reduce((s, a) => s + BigInt(a.amount), 0n);
    const byOwner = {};
    for (const a of accts) {
      const p = await conn.getParsedAccountInfo(a.address);
      const o = p.value?.data?.parsed?.info?.owner || "unknown";
      byOwner[o] = (byOwner[o] || 0n) + BigInt(a.amount);
      await new Promise(r => setTimeout(r, 100));
    }
    const owners = Object.values(byOwner).sort((a, b) => (b > a ? 1 : -1));
    const topOwnerPct = Number(owners[0] * 10000n / total) / 100;
    // what share of the token's total supply does the single largest owner hold
    const topOwnerOfSupply = supplyPct != null ? (supplyPct * topOwnerPct / 100) : null;
    console.log(name.padEnd(9) + String(supplyPct ?? "-").padStart(8) +
      "     " + String(accts.length) + "->" + String(owners.length).padEnd(4) +
      "     " + topOwnerPct.toFixed(1).padStart(5) + "%" +
      (topOwnerOfSupply != null ? "     " + topOwnerOfSupply.toFixed(1) + "% of supply" : ""));
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.log(name.padEnd(9), "ERROR", e.message.slice(0, 50));
  }
}
