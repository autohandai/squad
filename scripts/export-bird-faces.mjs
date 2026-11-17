#!/usr/bin/env node
// Write each cast bird's drawn face as a standalone SVG file (ADR-0240,
// ADR-0246). The website's marketplace shows the same faces as the app from
// these files: node scripts/export-bird-faces.mjs <out-dir> [flat|3d|clay]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BIRD_FACE_IDS, birdFaceSvg } from "../src/lib/bird-faces.js";

const [out, style = "flat"] = process.argv.slice(2);
if (!out) throw new Error("Usage: node scripts/export-bird-faces.mjs <out-dir> [flat|3d|clay]");
await mkdir(out, { recursive: true });
for (const bird of BIRD_FACE_IDS) {
  const svg = birdFaceSvg(bird, { style }).replace(' class="size-full"', "").replace(' role="img" aria-hidden="true"', "");
  await writeFile(join(out, `${bird}.svg`), `${svg}\n`);
}
console.log(`${BIRD_FACE_IDS.length} bird faces written to ${out}`);
