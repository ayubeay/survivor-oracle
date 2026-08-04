/* Can an off-curve owner with no account be attributed to a controlling program by
   derivation? If findProgramAddress reproduces it, the link is proven, not inferred. */
import { PublicKey } from "@solana/web3.js";

const CANDIDATES = {
  "raydium_amm_v4": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "raydium_clmm":   "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "raydium_cpmm":   "CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW",
  "meteora_dlmm":   "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "orca_whirlpool": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "jupiter_v6":     "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
};

const TARGETS = [
  ["SLERF owner", "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"],
  ["JUP owner",   "EXJHiMkj6NRFDf6MJhDvpMeYuahiZaTHiTMkyPRDrqbP"],
];

const SEEDS = [
  ["amm authority", [Buffer.from("amm authority")]],
  ["authority",     [Buffer.from("authority")]],
  ["vault_auth",    [Buffer.from("vault_auth_seed")]],
  ["pool_authority",[Buffer.from("pool_authority")]],
];

for (const [label, addr] of TARGETS) {
  console.log("\n=== " + label + " " + addr.slice(0, 12) + ".. ===");
  let found = false;
  for (const [pname, pid] of Object.entries(CANDIDATES)) {
    for (const [sname, seeds] of SEEDS) {
      try {
        const [derived] = PublicKey.findProgramAddressSync(seeds, new PublicKey(pid));
        if (derived.toBase58() === addr) {
          console.log("  MATCH: derives from " + pname + " with seed '" + sname + "'");
          found = true;
        }
      } catch (e) {}
    }
  }
  if (!found) console.log("  no match against tested programs and seeds - controlling program unresolved");
}
