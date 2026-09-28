#!/usr/bin/env node
// Everything the bridge imports has to be something the desktop app ships.
//
// scripts/stage-desktop.mjs copies three trees into the packaged runtime:
// server/, src/lib/ and relay/. A route plug-in that reaches outside them
// works perfectly in development, where the whole repo is on disk, and is
// missing from the installed app: the import throws, the loader skips that
// route, and the feature is simply absent with no error anywhere the person
// can see. That is how `/api/members/draft` was lost by one import of
// src/data.js, after a whole day of work on it.
//
// This walks the import graph from server/ and asserts every relative import
// resolves inside a staged tree. Bare specifiers are packages, which are
// staged separately from node_modules.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Keep in step with stageRuntime() in scripts/stage-desktop.mjs.
const STAGED = ["server", "src/lib", "relay"];
const ENTRY_DIRS = ["server"];
const ENTRY_FILES = ["server.mjs"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(mjs|js)$/.test(entry)) out.push(path);
  }
  return out;
}

function importsIn(source) {
  const specifiers = [];
  const patterns = [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s+["']([^"']+)["']/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function isStaged(path) {
  const rel = relative(root, path);
  return STAGED.some((tree) => rel === tree || rel.startsWith(`${tree}/`));
}

const queue = [...ENTRY_FILES.map((name) => join(root, name)), ...ENTRY_DIRS.flatMap((dir) => walk(join(root, dir)))];
const seen = new Set();
const offences = [];

while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const specifier of importsIn(source)) {
    if (!specifier.startsWith(".")) continue;
    const target = resolve(dirname(file), specifier);
    // server.mjs itself is staged at the runtime root, so it is allowed even
    // though it is not inside one of the trees.
    const allowed = isStaged(target) || target === join(root, "server.mjs");
    if (!allowed) {
      offences.push(`${relative(root, file)} imports ${specifier}, which the desktop app does not ship`);
      continue;
    }
    queue.push(target);
  }
}

assert.deepEqual(offences, [], `\n${offences.join("\n")}\n\nEither move the file into src/lib, or stage its tree in scripts/stage-desktop.mjs.`);
assert.ok(seen.size > 20, "the walk found the bridge's files");

// The trees this check trusts must be the trees the staging script copies.
const stager = readFileSync(join(root, "scripts", "stage-desktop.mjs"), "utf8");
for (const tree of STAGED) {
  const parts = tree.split("/").map((part) => `'${part}'`).join(", ");
  assert.ok(stager.includes(parts), `scripts/stage-desktop.mjs still stages ${tree}`);
}

console.log(`check-bridge-imports: ok (${seen.size} files, all inside ${STAGED.join(", ")})`);
