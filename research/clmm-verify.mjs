/* Does RugCheck's "locked" mean escrow, or just a Raydium CLMM position?
   Finds the pool contributing most of WIF's locked USD and reads it on-chain. */
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection(process.env.SOLANA_RPC, "confirmed");

const MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"; // WIF, 94.7% "locked"
const d = await (await fetch(`https://api.rugcheck.xyz/v1/tokens/${MINT}/report`)).json();

const top = (d.markets || [])
  .filter(m => m.lp && m.lp.lpLockedUSD > 0)
  .sort((a, b) => b.lp.lpLockedUSD - a.lp.lpLockedUSD)[0];

console.log("=== rugcheck's view of the top locked pool ===");
console.log("  pool        :", top.pubkey);
console.log("  marketType  :", top.marketType);
console.log("  lpMint      :", top.mintLP);
console.log("  lpLocked    :", top.lp.lpLocked, "of total", top.lp.lpTotalSupply);
console.log("  lpLockedPct :", top.lp.lpLockedPct);
console.log("  lpLockedUSD :", Math.round(top.lp.lpLockedUSD).toLocaleString());
console.log("  holders     :", Array.isArray(top.lp.holders) ? top.lp.holders.length : top.lp.holders);
if (Array.isArray(top.lp.holders) && top.lp.holders.length) {
  console.log("  holder[0]   :", JSON.stringify(top.lp.holders[0]).slice(0, 300));
}

console.log("\n=== on-chain ===");
const poolInfo = await conn.getAccountInfo(new PublicKey(top.pubkey));
console.log("  pool account owner :", poolInfo ? poolInfo.owner.toBase58() : "not found");
console.log("  pool data length   :", poolInfo ? poolInfo.data.length : "-");

if (top.mintLP) {
  const lpMint = await conn.getParsedAccountInfo(new PublicKey(top.mintLP));
  const info = lpMint.value?.data?.parsed?.info;
  console.log("  lpMint supply      :", info?.supply, "| decimals", info?.decimals);
  console.log("  lpMint authority   :", info?.mintAuthority ?? "revoked");
  if (info && Number(info.supply) > 0) {
    const largest = await conn.getTokenLargestAccounts(new PublicKey(top.mintLP));
    console.log("  top LP holders     :", largest.value.length);
    for (const a of largest.value.slice(0, 5)) {
      const acct = await conn.getParsedAccountInfo(a.address);
      const owner = acct.value?.data?.parsed?.info?.owner;
      const ownerAcct = owner ? await conn.getAccountInfo(new PublicKey(owner)) : null;
      console.log("    ", a.uiAmountString.padStart(18),
        "owner", (owner || "?").slice(0, 12) + "..",
        "| owned by", ownerAcct ? ownerAcct.owner.toBase58().slice(0, 12) + ".." : "system/none");
    }
  } else {
    console.log("  lpMint supply is 0 - LP is not fungible-token represented (CLMM/NFT positions)");
  }
}
