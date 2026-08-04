/* Can the largest observed owner actually exercise control, or is the position
   structurally immobile? Layer 1: address class only, never real-world identity. */
import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection(process.env.SOLANA_RPC, "confirmed");
const SYSTEM = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const BURN = ["1nc1nerator11111111111111111111111111111111"];

for (const [name, mint] of [
  ["SLERF","7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3"],
  ["RAY","4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"],
  ["PYUSD","2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"],
  ["BOME","ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82"],
  ["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
]) {
  try {
    const largest = await conn.getTokenLargestAccounts(new PublicKey(mint));
    const top = largest.value.slice(0, 10);
    const total = top.reduce((s, a) => s + BigInt(a.amount), 0n);
    const batch = await conn.getMultipleParsedAccounts(top.map(a => a.address));
    const byOwner = {};
    batch.value.forEach((v, i) => {
      const o = v?.data?.parsed?.info?.owner || "unresolved";
      byOwner[o] = (byOwner[o] || 0n) + BigInt(top[i].amount);
    });
    const [addr, amt] = Object.entries(byOwner).sort((a, b) => (b[1] > a[1] ? 1 : -1))[0];
    const share = Number(amt * 10000n / total) / 100;

    let cls = "UNKNOWN", interp = "UNKNOWN";
    if (addr === "unresolved") cls = "UNRESOLVED";
    else if (BURN.includes(addr)) { cls = "BURN_ADDRESS"; interp = "PROBABLY_IRRECOVERABLE"; }
    else {
      const pk = new PublicKey(addr);
      const onCurve = PublicKey.isOnCurve(pk.toBytes());
      const acct = await conn.getAccountInfo(pk);
      const prog = acct ? acct.owner.toBase58() : null;
      if (!acct) { cls = onCurve ? "WALLET_NO_ACCOUNT" : "PDA_NO_ACCOUNT";
                   interp = onCurve ? "ECONOMICALLY_CONTROLLABLE" : "PROGRAM_DERIVED_NO_ACCOUNT"; }
      else if (!onCurve && prog === SYSTEM) { cls = "PDA_SYSTEM_OWNED"; interp = "PROGRAM_DERIVED_NO_PROGRAM_RESOLVED"; }
      else if (!onCurve) { cls = "PDA_PROGRAM_OWNED:" + prog.slice(0,10); interp = "PROGRAM_CONSTRAINED"; }
      else if (prog === SYSTEM) { cls = "WALLET"; interp = "ECONOMICALLY_CONTROLLABLE"; }
      else if (prog === TOKEN || prog === TOKEN22) { cls = "TOKEN_PROGRAM_OWNED"; interp = "MULTISIG_OR_PROGRAM"; }
      else { cls = "PROGRAM_OWNED:" + prog.slice(0,10); interp = "PROGRAM_CONSTRAINED"; }
    }
    console.log(name.padEnd(7), String(share.toFixed(1)).padStart(5) + "% of sample |",
      addr.slice(0, 14) + ".." , "|", cls.padEnd(26), "|", interp);
    await new Promise(r => setTimeout(r, 500));
  } catch (e) { console.log(name.padEnd(7), "ERROR", e.message.slice(0, 50)); }
}
