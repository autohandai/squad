#!/usr/bin/env node
// Write each cast bird as a standalone SVG file (ADR-0240, ADR-0246). The
// website's marketplace shows the same birds as the app from these files:
// node scripts/export-bird-faces.mjs <out-dir> [flat|3d|clay]
//
// Flat birds with painted art (ADR-0271) use their traced SVG from
// public/avatars/birds-svg; the rest keep the drawn face, so every bird has a
// file whatever has been generated so far.
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTALLED_ART } from "../src/lib/bird-cast.js";
import { BIRD_FACE_IDS, birdFaceSvg } from "../src/lib/bird-faces.js";

const [out, style = "flat"] = process.argv.slice(2);
if (!out) throw new Error("Usage: node scripts/export-bird-faces.mjs <out-dir> [flat|3d|clay]");
const traced = fileURLToPath(new URL("../public/avatars/birds-svg/", import.meta.url));
await mkdir(out, { recursive: true });
let painted = 0;
for (const bird of BIRD_FACE_IDS) {
  const file = join(traced, `${bird}.svg`);
  if (style === "flat" && INSTALLED_ART.flat.includes(bird) && existsSync(file)) {
    await copyFile(file, join(out, `${bird}.svg`));
    painted += 1;
    continue;
  }
  const svg = birdFaceSvg(bird, { style }).replace(' class="size-full"', "").replace(' role="img" aria-hidden="true"', "");
  await writeFile(join(out, `${bird}.svg`), `${svg}\n`);
}
console.log(`${BIRD_FACE_IDS.length} birds written to ${out} (${painted} painted, ${BIRD_FACE_IDS.length - painted} drawn)`);
