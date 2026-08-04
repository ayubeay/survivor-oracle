/* What kind of accounts hold the concentration? Layer 1 only - ownership and program
   control are derivable; naming Coinbase or a Paxos treasury is not. Observation only. */
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection(process.env.SOLANA_RPC, "confirmed");
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const TOKENS = [
  ["RAY",   "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["PYUSD", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["BONK",  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["mSOL",  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
];

for (const [name, mint] of TOKENS) {
  try {
    const largest = await conn.getTokenLargestAccounts(new PublicKey(mint));
    const accts = largest.value.slice(0, 10);
    const total = accts.reduce((s, a) => s + BigInt(a.amount), 0n);
    console.log(`\n=== ${name} ===`);
    const classes = {};
    for (const a of accts) {
      const parsed = await conn.getParsedAccountInfo(a.address);
      const owner = parsed.value?.data?.parsed?.info?.owner;
      if (!owner) { classes.UNPARSEABLE = (classes.UNPARSEABLE || 0) + 1; continue; }
      const ownerPk = new PublicKey(owner);
      const onCurve = PublicKey.isOnCurve(ownerPk.toBytes());
      const ownerAcct = await conn.getAccountInfo(ownerPk);
      const ownerProgram = ownerAcct ? ownerAcct.owner.toBase58() : null;
      let cls;
      if (!ownerAcct) cls = onCurve ? "WALLET_NO_ACCOUNT" : "OFF_CURVE_NO_ACCOUNT";
      else if (!onCurve) cls = "PROGRAM_DERIVED";
      else if (ownerProgram === SYSTEM) cls = "WALLET";
      else if (ownerProgram === TOKEN || ownerProgram === TOKEN22) cls = "MULTISIG_OR_TOKEN_OWNED";
      else cls = "PROGRAM_OWNED";
      const pct = Number(BigInt(a.amount) * 10000n / total) / 100;
      classes[cls] = (classes[cls] || 0) + pct;
      console.log("  " + String(pct.toFixed(1)).padStart(5) + "%  " + cls.padEnd(24) +
        owner.slice(0, 10) + ".." + (ownerProgram ? " prog " + ownerProgram.slice(0, 10) + ".." : ""));
    }
    console.log("  share by class:", Object.entries(classes).map(([k, v]) => k + " " + v.toFixed(1) + "%").join(" | "));
  } catch (e) {
    console.log(`\n=== ${name} === ERROR`, e.message.slice(0, 70));
  }
}
