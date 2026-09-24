#!/usr/bin/env node
// Every capitalised JSX tag must be imported or defined in its file. ESLint's
// no-undef does not cover JSX tags, and a missing icon import only fails at
// render time ("Can't find variable: CornerDownRight"), so this check runs
// before every build.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
walk("src");
let failures = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const used = new Set([...source.matchAll(/<([A-Z][A-Za-z0-9_.]*)[\s/>]/g)].map((m) => m[1].split(".")[0]));
  const defined = new Set(["Fragment"]);
  for (const m of source.matchAll(/^(?:export )?(?:async )?(?:function|const|let|class)\s+([A-Z][A-Za-z0-9_]*)/gm)) defined.add(m[1]);
  for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s+"[^"]+"/g)) {
    for (const name of m[1].replace(/[{}]/g, " ").split(/[\s,]+/)) {
      const local = name.split(" as ").pop();
      if (/^[A-Z]/.test(local)) defined.add(local);
    }
  }
  for (const m of source.matchAll(/\b(?:const|let|var)\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const local = part.trim().split(":").pop().trim().split("=")[0].trim();
      if (/^[A-Z]/.test(local)) defined.add(local);
    }
  }
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/g)) defined.add(m[1]);
  // Render-prop style locals: `({ icon: Icon })`, `.map((Item) =>`.
  for (const m of source.matchAll(/[:(,]\s*([A-Z][A-Za-z0-9_]*)\s*[,)=]/g)) defined.add(m[1]);
  const missing = [...used].filter((name) => !defined.has(name));
  if (missing.length) {
    failures += 1;
    console.error(`${file}: JSX tags without an import or definition: ${missing.join(", ")}`);
  }
}
if (failures) process.exit(1);
console.log(`JSX import check passed for ${files.length} files.`);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(jsx|js)$/.test(entry)) files.push(path);
  }
}
