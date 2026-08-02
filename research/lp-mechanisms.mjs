const TOKENS = [
  ["BONK","DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["WIF","EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"],
  ["SLERF","7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3"],
  ["mSOL","mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"],
  ["JUP","JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"],
];
const BURN = "11111111111111111111111111111111";

for (const [name, mint] of TOKENS) {
  const d = await (await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`)).json();
  const lockers = Object.entries(d.lockers || {});
  const byProgram = new Map();
  for (const [addr, l] of lockers) {
    const p = l?.programID || "UNKNOWN";
    const row = byProgram.get(p) || { count: 0, owners: new Set(), uris: new Set(), burnAcct: 0 };
    row.count++;
    if (l?.owner) row.owners.add(l.owner);
    if (l?.uri) row.uris.add(String(l.uri).split("?")[0]);
    if (l?.tokenAccount === BURN) row.burnAcct++;
    byProgram.set(p, row);
  }
  console.log(`\n=== ${name} === lockers ${lockers.length} | scanStatus ${d.lockerScanStatus}`);
  for (const [p, r] of byProgram) {
    console.log("  program", p);
    console.log("    entries", r.count, "| owner===program:", [...r.owners].every(o => o === p), "| tokenAccount=system:", r.burnAcct + "/" + r.count);
    console.log("    uri roots:", [...r.uris].slice(0, 3).join(", ") || "none");
  }
}
