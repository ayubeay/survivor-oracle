/* Wider Token-2022 sweep. Which extensions actually appear in the wild, and which
   constrain a holder's ability to transfer or sell? Observation only. */
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection(process.env.SOLANA_RPC, "confirmed");
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const MINTS = [
  ["PYUSD",  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["BERN",   "CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo"],
  ["EURC",   "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr"],
  ["USDG",   "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"],
  ["USDS",   "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"],
  ["FDUSD",  "9zNQRsGLjNKwCUU5Gq5LR8beUCPzQMVMqKAi3SSZh54u"],
  ["CHILLGUY","Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump"],
  ["GOAT",   "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump"],
];

const CONSTRAINING = new Set([
  "permanentDelegate", "transferFeeConfig", "transferHook",
  "defaultAccountState", "nonTransferable", "confidentialTransferMint",
  "mintCloseAuthority", "pausable",
]);

const seen = new Map();
for (const [name, mint] of MINTS) {
  try {
    const raw = await conn.getAccountInfo(new PublicKey(mint));
    if (!raw) { console.log(name.padEnd(9), "account not found"); continue; }
    const program = raw.owner.toBase58() === T22 ? "T22" : "SPL";
    const p = await conn.getParsedAccountInfo(new PublicKey(mint));
    const info = p.value?.data?.parsed?.info;
    const ext = info?.extensions || [];
    const names = ext.map(e => e.extension);
    names.forEach(n => seen.set(n, (seen.get(n) || 0) + 1));

    const constraints = [];
    for (const e of ext) {
      const s = e.state || {};
      if (e.extension === "permanentDelegate" && s.delegate)
        constraints.push("permanentDelegate=" + s.delegate.slice(0, 8) + "..");
      if (e.extension === "transferFeeConfig") {
        const bps = s.newerTransferFee?.transferFeeBasisPoints ?? 0;
        constraints.push("fee=" + (bps / 100).toFixed(2) + "%" + (bps === 0 ? " (inactive)" : " ACTIVE"));
      }
      if (e.extension === "transferHook")
        constraints.push("hook=" + (s.programId ? "ACTIVE " + s.programId.slice(0, 8) + ".." : "latent, authority can enable"));
      if (e.extension === "defaultAccountState")
        constraints.push("defaultState=" + s.accountState);
      if (e.extension === "nonTransferable") constraints.push("NON_TRANSFERABLE");
      if (e.extension === "pausable") constraints.push("pausable=" + JSON.stringify(s).slice(0, 60));
    }
    console.log(name.padEnd(9), program, String(raw.data.length).padStart(5), "|",
      names.length ? names.join(",") : "no extensions");
    if (constraints.length) console.log("          constraints:", constraints.join(" | "));
    if (info?.freezeAuthority) console.log("          freezeAuthority:", info.freezeAuthority.slice(0, 8) + "..");
  } catch (e) {
    console.log(name.padEnd(9), "ERROR", e.message.slice(0, 60));
  }
}
console.log("\nextensions observed across sample:");
[...seen.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log("  " + String(c).padStart(2), n, CONSTRAINING.has(n) ? "  <- constrains transfer" : ""));
