#!/usr/bin/env node
// The Autohand Squad team's marketplace seeds (ADR-0246, ADR-0248), checked
// before they can be inserted: shape, uniqueness across every seed, writing
// rules, the secret scanner and the same validateAgentTemplate the Worker
// runs on publish. Team seeds are built from agent seeds and checked with
// validateTeamTemplate. Additions per category must match the counts drawn
// from the recorded seed in additions-2026-11.json.
//
//   node scripts/check-marketplace-seeds.mjs            every seed
//   node scripts/check-marketplace-seeds.mjs <file>     one agents-more file, while writing it
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSeeds, readTeamSeeds, readFeatured, seedTemplates, teamTemplates } from "./marketplace-seed.mjs";
import { CATEGORY_IDS } from "../../../src/lib/marketplace.js";
import { BIRD_FACE_IDS } from "../../../src/lib/bird-faces.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BANNED = ["seamless", "leverage", "unlock", "empower", "cutting-edge", "game-chang", "revolutioni", "supercharge", "delve", "robust", "synergy", "world-class", "effortless", "streamline", "holistic", "next-level", "in today's", "tapestry", "grok", "x.ai"];
const BRAIN_KEYS = ["purpose", "defaultWorkflow", "allowedTools", "escalationRules", "definitionOfDone", "reviewStyle", "memoryPolicy"];
const PRIVATE = [/\/Users\//, /\/home\/[a-z]/, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, /C:\\Users/i];
const birds = new Set(BIRD_FACE_IDS);

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The per-category counts the recorded seed draws. */
export function drawnCounts(manifest) {
  const random = mulberry32(manifest.seed);
  return Object.fromEntries(manifest.order.map((category) => [category, manifest.min + Math.floor(random() * (manifest.max - manifest.min + 1))]));
}

/** Problems with one agent seed, as sentences. */
export function seedProblems(seed) {
  const problems = [];
  const where = seed?.slug || "(no slug)";
  const need = (condition, message) => { if (!condition) problems.push(`${where}: ${message}`); };
  need(/^[a-z]+(-[a-z0-9]+)+$/.test(seed.slug || ""), "slug is <category>-<words>");
  need(CATEGORY_IDS.includes(seed.category), `unknown category ${seed.category}`);
  need(String(seed.slug || "").startsWith(`${seed.category}-`), "slug starts with its category");
  need(/^[A-Z][a-zA-Z' -]{1,23}$/.test(seed.name || ""), "name is a short first name");
  need(typeof seed.role === "string" && seed.role.length >= 4 && seed.role.length <= 60, "role is 4-60 characters");
  need(typeof seed.tagline === "string" && seed.tagline.length >= 40 && seed.tagline.length <= 140, "tagline is 40-140 characters");
  need(typeof seed.description === "string" && seed.description.length >= 160 && seed.description.length <= 1200, "description is 160-1200 characters");
  need(Array.isArray(seed.tags) && seed.tags.length >= 2 && seed.tags.length <= 5 && seed.tags.every((tag) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(tag)), "2-5 lowercase-hyphen tags");
  need(birds.has(seed.bird), `bird ${seed.bird} is not a cast bird`);
  need(typeof seed.instructions === "string" && seed.instructions.length >= 600 && seed.instructions.length <= 6000, "instructions are 600-6000 characters");
  need(/ask|First/.test(seed.instructions || ""), "instructions say what to ask first");
  need(seed.brainCard && BRAIN_KEYS.every((key) => typeof seed.brainCard[key] === "string" && seed.brainCard[key].length >= 20) && Object.keys(seed.brainCard).length === BRAIN_KEYS.length, `brainCard has exactly ${BRAIN_KEYS.join(", ")}`);
  need(Array.isArray(seed.skills) && seed.skills.length >= 1 && seed.skills.length <= 3, "1-3 skills");
  for (const skill of seed.skills || []) {
    need(/^[a-z]+(-[a-z0-9]+)+$/.test(skill.name || ""), `skill name ${skill.name} is kebab-case`);
    need(typeof skill.description === "string" && skill.description.length >= 20 && skill.description.length <= 200, `skill ${skill.name} description is 20-200 characters`);
    need(typeof skill.text === "string" && skill.text.startsWith(`---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`), `skill ${skill.name} text starts with its front matter`);
    need(typeof skill.text === "string" && skill.text.length >= 400 && /\n## /.test(skill.text), `skill ${skill.name} has a procedure of substance (400+ characters, ## sections)`);
  }
  need(seed.notes === undefined || (typeof seed.notes === "string" && seed.notes.length <= 600), "notes are absent or at most 600 characters");
  const text = JSON.stringify(seed);
  for (const word of BANNED) if (text.toLowerCase().includes(word)) problems.push(`${where}: uses "${word}"`);
  if (text.includes("\u2014")) problems.push(`${where}: uses an em dash`);
  for (const pattern of PRIVATE) if (pattern.test(text)) problems.push(`${where}: carries a private path or an email (${pattern})`);
  return problems;
}

async function main() {
  const only = process.argv[2];
  const all = await readSeeds();
  const problems = [];
  const fresh = only ? JSON.parse(await readFile(only, "utf8")) : all.slice(200);
  for (const seed of fresh) problems.push(...seedProblems(seed));
  // Unique across every seed (and the file being written, which may not be read yet).
  const pool = only ? [...all.filter((seed) => !fresh.some((item) => item.slug === seed.slug)), ...fresh] : all;
  for (const key of ["slug", "name"]) {
    const seen = new Map();
    for (const seed of pool) {
      const value = String(seed[key] || "").toLowerCase();
      if (seen.has(value)) problems.push(`${seed.slug}: ${key} "${seed[key]}" is also ${seen.get(value)}`);
      seen.set(value, seed.slug);
    }
  }
  const skillNames = new Map();
  for (const seed of pool) for (const skill of seed.skills || []) {
    if (skillNames.has(skill.name)) problems.push(`${seed.slug}: skill ${skill.name} is also in ${skillNames.get(skill.name)}`);
    skillNames.set(skill.name, seed.slug);
  }
  const taglines = new Map();
  for (const seed of pool) {
    if (taglines.has(seed.tagline)) problems.push(`${seed.slug}: same tagline as ${taglines.get(seed.tagline)}`);
    taglines.set(seed.tagline, seed.slug);
  }
  if (problems.length) {
    console.error(problems.slice(0, 60).join("\n"));
    console.error(`${problems.length} problem(s)`);
    process.exit(1);
  }
  // The Worker's validator on every one.
  const templates = await seedTemplates(pool);
  if (only) {
    console.log(`${fresh.length} seeds in ${only} pass; ${fresh.reduce((sum, seed) => sum + seed.skills.length, 0)} skills`);
    return;
  }
  const manifest = JSON.parse(await readFile(join(root, "marketplace-seeds", "additions-2026-11.json"), "utf8"));
  const drawn = drawnCounts(manifest);
  const added = {};
  for (const seed of all.slice(200)) added[seed.category] = (added[seed.category] || 0) + 1;
  for (const category of manifest.order) {
    if (drawn[category] !== manifest.counts[category]) throw new Error(`${category}: manifest says ${manifest.counts[category]}, the seed draws ${drawn[category]}`);
    if ((added[category] || 0) !== drawn[category]) throw new Error(`${category}: ${added[category] || 0} added, the seed drew ${drawn[category]}`);
  }
  const files = (await readdir(join(root, "marketplace-seeds", "agents-more"))).filter((name) => name.endsWith(".json"));
  const teams = await teamTemplates(await readTeamSeeds(), pool);
  const featured = await readFeatured();
  console.log(`${templates.length} seed agents valid (${all.length - 200} added from ${files.length} files: ${JSON.stringify(added)}); ${templates.reduce((sum, t) => sum + t.summary.skills.length, 0)} skills; ${teams.length} team templates; ${featured.length} featured`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
