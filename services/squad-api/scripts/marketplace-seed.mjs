#!/usr/bin/env node
// The marketplace's 200 Autohand Squad team agents (ADR-0246), from
// marketplace-seeds/agents.json to rows in the squad-marketplace database.
//
// Every seed becomes an ordinary agent template through the same
// validateAgentTemplate the Worker runs on publish, so a seed cannot carry
// anything a person could not publish. Listing ids come from the slug, and
// every statement is INSERT OR IGNORE: running it twice changes nothing.
// `createdAt` is when the SQL is generated, i.e. when the rows are added.
//
//   node scripts/marketplace-seed.mjs --check
//   node scripts/marketplace-seed.mjs --batches .cloudflare/marketplace-seed
//     writes batch-001.json … for `cf d1 query <db> --batch @<file>`, 40
//     statements each, so no request nears D1's size limits
//   node scripts/marketplace-seed.mjs --out .cloudflare/marketplace-seed.sql
//   node scripts/marketplace-seed.mjs --local .cloudflare/local-state
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTOHAND_CREATOR_NAME, CATEGORY_IDS, contentHash, memberTemplateFindings, seedListingId, templateFromMember, templateSummary, validateAgentTemplate, validateListingInput } from "../../../src/lib/marketplace.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const AUTOHAND_PUBLISHER = Object.freeze({ id: "autohand-squad-team", kind: "autohand", issuer: "https://autohand.ai", subject: "autohand-squad-team", displayName: AUTOHAND_CREATOR_NAME });

export async function readSeeds(path = join(root, "marketplace-seeds", "agents.json")) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Each seed as `{ id, listing, document, hash, bytes, summary }`, validated. */
export async function seedTemplates(seeds) {
  const out = [];
  const ids = new Set();
  for (const seed of seeds) {
    if (!CATEGORY_IDS.includes(seed.category)) throw new Error(`${seed.slug}: unknown category ${seed.category}`);
    const member = { key: seed.slug, name: seed.name, role: seed.role, description: seed.tagline, instructions: seed.instructions, brainCard: seed.brainCard };
    const findings = memberTemplateFindings({ member, skills: seed.skills, notes: seed.notes || "", tagline: seed.tagline });
    if (findings.length) throw new Error(`${seed.slug}: secret scanner hit in ${findings[0].path}`);
    const document = templateFromMember({
      member: { key: seed.slug, name: seed.name, role: seed.role, description: seed.tagline, instructions: seed.instructions, brainCard: seed.brainCard, look: { avatar: `/avatars/birds/${seed.bird}.webp`, employeeType: "" }, skills: seed.skills.map((skill) => skill.name), harness: { id: "autohand" } },
      skills: seed.skills,
      notes: seed.notes || "",
      tagline: seed.tagline,
    });
    const template = validateAgentTemplate(document);
    if (!template.ok) throw new Error(`${seed.slug}: ${template.error}`);
    const listing = validateListingInput({ tagline: seed.tagline, description: seed.description, category: seed.category, tags: seed.tags });
    if (!listing.ok) throw new Error(`${seed.slug}: ${listing.error}`);
    const id = await seedListingId(seed.slug);
    if (ids.has(id)) throw new Error(`${seed.slug}: listing id collision ${id}`);
    ids.add(id);
    out.push({ id, slug: seed.slug, listing: listing.listing, document: template.document, bytes: template.bytes, hash: await contentHash(template.document), summary: templateSummary(template.document) });
  }
  return out;
}

const searchText = (t) => [t.summary.name, t.summary.role, t.listing.tagline, AUTOHAND_CREATOR_NAME, ...t.listing.tags, t.listing.category].join(" ").toLowerCase().replace(/\s+/g, " ");

/** `[{ sql, params }]` for the publisher, every listing and its version 1. */
export function seedStatements(templates, now = new Date().toISOString()) {
  const statements = [{
    sql: "INSERT OR IGNORE INTO publishers(id,kind,issuer,subject,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    params: [AUTOHAND_PUBLISHER.id, AUTOHAND_PUBLISHER.kind, AUTOHAND_PUBLISHER.issuer, AUTOHAND_PUBLISHER.subject, AUTOHAND_PUBLISHER.displayName, now, now],
  }];
  for (const t of templates) {
    statements.push({
      sql: `INSERT OR IGNORE INTO listings(id,publisher_id,name,role,tagline,description,category,tags,bird,creator_kind,creator_name,search_text,version,content_hash,bytes,skills,has_memory,status,featured,adds,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'published',0,0,?,?,?)`,
      params: [t.id, AUTOHAND_PUBLISHER.id, t.summary.name, t.summary.role, t.listing.tagline, t.listing.description, t.listing.category, JSON.stringify(t.listing.tags), t.summary.bird, "autohand", AUTOHAND_CREATOR_NAME, searchText(t), t.hash, t.bytes, t.summary.skills.length, t.summary.hasMemory ? 1 : 0, "seed", now, now],
    });
    statements.push({
      sql: "INSERT OR IGNORE INTO listing_versions(listing_id,version,document,content_hash,bytes,note,created_by,created_at) VALUES (?,1,?,?,?,?,?,?)",
      params: [t.id, JSON.stringify(t.document), t.hash, t.bytes, "Added by the Autohand Squad team.", "seed", now],
    });
  }
  statements.push({ sql: "INSERT INTO audit(at,actor_kind,actor,action,listing_id,detail) VALUES (?,?,?,?,?,?)", params: [now, "system", "seed", "seed.applied", "", `${templates.length} Autohand Squad team agents`] });
  return statements;
}

const literal = (value) => typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`;
/** One statement per line, values inlined, for `d1 execute --file`. */
export function seedSql(statements) {
  return statements.map(({ sql, params }) => {
    let index = 0;
    return `${sql.replace(/\?/g, () => literal(params[index++]))};`;
  }).join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const templates = await seedTemplates(await readSeeds());
  const counts = {};
  for (const t of templates) counts[t.listing.category] = (counts[t.listing.category] || 0) + 1;
  console.log(`${templates.length} seed agents valid; ${templates.reduce((sum, t) => sum + t.summary.skills.length, 0)} skills; ${JSON.stringify(counts)}`);
  const batches = args.includes("--batches") ? args[args.indexOf("--batches") + 1] : "";
  if (batches) {
    await mkdir(batches, { recursive: true });
    const statements = seedStatements(templates);
    let count = 0;
    for (let index = 0; index < statements.length; index += 40) {
      count += 1;
      await writeFile(join(batches, `batch-${String(count).padStart(3, "0")}.json`), JSON.stringify(statements.slice(index, index + 40)));
    }
    console.log(`wrote ${count} batch files to ${batches}`);
  }
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "";
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, seedSql(seedStatements(templates)));
    console.log(`wrote ${out}`);
  }
}

/**
 * Seed a local persisted database, the one `cf dev --persist-to <dir>`
 * serves after `cf d1 migrations apply … --local --persist-to <dir>`.
 * `cf d1 query` has no local mode, so this writes the persisted SQLite file
 * that holds the marketplace schema. Local only: production uses the batch
 * files through `cf d1 query --batch`.
 */
export async function seedLocal({ persistTo }) {
  const { DatabaseSync } = await import("node:sqlite");
  const { readdir } = await import("node:fs/promises");
  const folder = join(persistTo, "v3", "d1", "miniflare-D1DatabaseObject");
  const files = (await readdir(folder)).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  const path = files.map((name) => join(folder, name)).find((file) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='listings'").get()); } finally { db.close(); }
  });
  if (!path) throw new Error(`No local database with the marketplace schema under ${folder}. Apply marketplace-migrations first.`);
  const db = new DatabaseSync(path);
  try {
    db.exec("BEGIN");
    for (const { sql, params } of seedStatements(await seedTemplates(await readSeeds()))) db.prepare(sql).run(...params);
    db.exec("COMMIT");
    return db.prepare("SELECT count(*) AS n FROM listings WHERE creator_kind='autohand'").get().n;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--local")) {
  const args = process.argv.slice(2);
  const persistTo = args[args.indexOf("--local") + 1];
  if (!persistTo) throw new Error("Usage: node scripts/marketplace-seed.mjs --local <persist-to dir>");
  console.log(`local marketplace now holds ${await seedLocal({ persistTo })} Autohand Squad team agents`);
}
