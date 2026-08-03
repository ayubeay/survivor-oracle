/* Layer 1 probe: what does the RPC actually expose about token capabilities?
   Observation only - no classification, no scoring, no production change. */
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection(process.env.SOLANA_RPC, "confirmed");

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN_CLASSIC = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const TOKENS = [
  ["BONK",    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["USDC",    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["mSOL",    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["PYUSD",   "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],  // token-2022
  ["BERN",    "CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo"],  // token-2022, transfer fee
  ["ORE",     "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp"],
];

for (const [name, mint] of TOKENS) {
  try {
    const pk = new PublicKey(mint);
    const raw = await conn.getAccountInfo(pk);
    const parsed = await conn.getParsedAccountInfo(pk);
    const info = parsed.value?.data?.parsed?.info;
    const owner = raw ? raw.owner.toBase58() : null;
    const program = owner === TOKEN_2022 ? "TOKEN_2022"
      : owner === TOKEN_CLASSIC ? "CLASSIC_SPL" : owner;

    console.log(`\n=== ${name} ===`);
    console.log("  program      :", program);
    console.log("  mint bytes   :", raw ? raw.data.length : "-", "(82 = classic, >82 = extensions present)");
    console.log("  parsed type  :", parsed.value?.data?.parsed?.type);
    console.log("  base fields  :", JSON.stringify({
      decimals: info?.decimals,
      mintAuthority: info?.mintAuthority ?? null,
      freezeAuthority: info?.freezeAuthority ?? null,
      isInitialized: info?.isInitialized,
    }));

    const ext = info?.extensions;
    if (!ext) { console.log("  extensions   : none reported by parser"); continue; }
    console.log("  extensions   :", ext.length, "->", ext.map(e => e.extension).join(", "));
    for (const e of ext) {
      console.log("    -", e.extension, ":", JSON.stringify(e.state ?? e).slice(0, 400));
    }
  } catch (err) {
    console.log(`\n=== ${name} === ERROR`, err.message.slice(0, 80));
  }
}
