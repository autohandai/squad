#!/usr/bin/env node
// Is the bundled Autohand Code (package.json `autohand.cliVersion`) the newest
// release? Squad 0.1.14 shipped 0.9.7 while 0.9.9 was out, and fixes the
// person had on their own CLI were missing from their members (ADR-0161).
// Run before a release: exits 1 when the pin is behind, 0 when current, and
// 0 with a note when GitHub cannot be reached (an offline build is not a
// failure). `--allow-behind` reports without failing.
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const pinned = String(pkg.autohand?.cliVersion || "").trim();
const repository = String(pkg.autohand?.cliRepository || "autohandai/code-cli");
const allowBehind = process.argv.includes("--allow-behind");

export function compareVersions(a, b) {
  const parse = (value) => String(value).replace(/^v/, "").split(/[.-]/).map((part) => (Number.isFinite(Number(part)) ? Number(part) : part));
  const left = parse(a); const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0; const r = right[index] ?? 0;
    if (l === r) continue;
    if (typeof l === "number" && typeof r === "number") return l < r ? -1 : 1;
    return String(l) < String(r) ? -1 : 1;
  }
  return 0;
}

if (!/^\d+\.\d+\.\d+/.test(pinned)) { console.error(`check-cli-pin: package.json autohand.cliVersion is "${pinned}", not a version`); process.exit(1); }
let latest = "";
try {
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "autohand-squad-check-cli-pin" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  latest = String((await response.json()).tag_name || "").replace(/^v/, "");
} catch (error) {
  console.log(`check-cli-pin: pinned ${pinned}; latest release unknown (${error?.message || error}). Not failing an offline check.`);
  process.exit(0);
}
const behind = compareVersions(pinned, latest) < 0;
console.log(`check-cli-pin: pinned Autohand Code ${pinned}, latest release ${latest}${behind ? " — the pin is behind" : " — current"}.`);
if (behind && !allowBehind) {
  console.error(`Update package.json autohand.cliVersion to ${latest}, run \`bun run cli:fetch\`, then \`node scripts/check-first-run-live.mjs\` before shipping (or pass --allow-behind to ship the older pin knowingly).`);
  process.exit(1);
}
