#!/usr/bin/env node
// Vendors kale-tts-1 (Kale, Apache-2.0) into vendor/kale-tts: the on-device
// speech model Squad reads replies aloud with (ADR-0276). Files come from the
// Hugging Face Space pinned in kale-tts.lock.json at one commit, and every file
// must match the sha256 recorded there, so a changed upstream file fails the
// build instead of shipping.
//
//   node scripts/fetch-kale-tts.mjs            # fetch and verify
//   node scripts/fetch-kale-tts.mjs --relock   # fetch the pinned commit and rewrite the hashes (review the diff)
//
// Both models ship: nano (7.5M parameters, 15 MB) and tiny (45.7M, 80 MB), int8
// graphs on the CPU (onnxruntime-web wasm) only. Measured in Chrome on this Mac,
// tiny on one thread speaks at 15x real time with the first sound in 180 ms, so
// the float32 graphs (31 MB, 183 MB) and the WebGPU runtime (43 MB) stay out.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = join(root, 'kale-tts.lock.json');
export const kaleDir = (base = root) => process.env.AUTOHAND_SQUAD_KALE_DIR ? resolve(process.env.AUTOHAND_SQUAD_KALE_DIR) : join(base, 'vendor', 'kale-tts');

const VOICES = ['d03', 'd13', 'f06', 'h013f', 'm3', 's057b', 't071', 'w165', 'w602', 'x328'];
const MODEL_FILES = (model, extra = []) => [
  'config.json', 'model.onnx', 'tokenizer.json', 'tokenizer_config.json', 'voices.json', ...extra,
  ...VOICES.flatMap((id) => [`voices/${id}.bin`, `voices/${id}.extra.bin`]),
].map((file) => `models/${model}/${file}`);

export const KALE_FILES = [
  'README.md', 'THIRD_PARTY_NOTICES.md', 'js/kale-tts.mjs',
  'frontend/ettin.js', 'frontend/release-loader.mjs',
  'frontend/dizione/LICENSE', 'frontend/dizione/homographs.data.js', 'frontend/dizione/homographs.js', 'frontend/dizione/spoken.js', 'frontend/dizione/tables.js',
  'frontend/words/kaleTts.js', 'frontend/words/enGb.js', 'frontend/words/g2p.bin', 'frontend/words/lexicon.tsv', 'frontend/words/override.public.tsv',
  'frontend/words/override-sources.public.tsv', 'frontend/words/terms.tsv',
  'frontend/words/en-gb/g2p.bin', 'frontend/words/en-gb/lexicon.tsv', 'frontend/words/en-gb/override.public.tsv', 'frontend/words/en-gb/terms.tsv',
  'ort/LICENSE', 'ort/VERSION', 'ort/ort.wasm.min.mjs', 'ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm',
  ...MODEL_FILES('kale-tts-1-nano'),
  ...MODEL_FILES('kale-tts-1-tiny', ['ettin-tokenizer.json']),
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const relock = process.argv.includes('--relock');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(lock.commit || '')) throw new Error('kale-tts.lock.json needs a 40-character commit');
  const out = kaleDir();
  const hashes = {};
  let fetched = 0;
  for (const file of KALE_FILES) {
    const target = join(out, file);
    const expected = lock.files?.[file];
    if (!relock && expected && existsSync(target) && sha256(await readFile(target)) === expected) { hashes[file] = expected; continue; }
    const url = `https://huggingface.co/spaces/${lock.space}/resolve/${lock.commit}/${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${file}: ${response.status} from ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256(bytes);
    if (!relock && digest !== expected) throw new Error(`${file}: sha256 ${digest} does not match kale-tts.lock.json (${expected || 'missing'})`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, bytes);
    await rename(`${target}.tmp`, target);
    hashes[file] = digest;
    fetched += 1;
  }
  if (relock) await writeFile(lockPath, `${JSON.stringify({ ...lock, files: hashes }, null, 2)}\n`);
  await writeFile(join(out, 'BUILD_INFO.json'), `${JSON.stringify({ space: lock.space, commit: lock.commit, license: 'Apache-2.0', files: KALE_FILES.length }, null, 2)}\n`);
  console.log(`kale-tts: ${KALE_FILES.length} files in ${out} (${fetched} downloaded)${relock ? ', lock rewritten' : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
