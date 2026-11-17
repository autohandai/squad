#!/usr/bin/env node
// The marketplace's Autohand Squad team agents and teams (ADR-0246,
// ADR-0253): marketplace-seeds/agents.json (the first 200), agents-more/*.json
// (added per category on 2026-11-17), teams.json (team templates built from
// those agents) and featured.json (the initial featured order), to rows in
// the squad-marketplace database.
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
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTOHAND_CREATOR_NAME, CATEGORY_IDS, contentHash, memberTemplateFindings, seedListingId, teamTemplateFindings, teamTemplateFromMembers, teamTemplateSummary, templateFromMember, templateSummary, validateAgentTemplate, validateListingInput, validateTeamTemplate } from "../../../src/lib/marketplace.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const AUTOHAND_PUBLISHER = Object.freeze({ id: "autohand-squad-team", kind: "autohand", issuer: "https://autohand.ai", subject: "autohand-squad-team", displayName: AUTOHAND_CREATOR_NAME });

const seedsDir = join(root, "marketplace-seeds");

/** Every agent seed: the first 200, then agents-more/<category>.json in category order. */
export async function readSeeds(path = join(seedsDir, "agents.json")) {
  const first = JSON.parse(await readFile(path, "utf8"));
  const more = join(dirname(path), "agents-more");
  let files = [];
  try { files = (await readdir(more)).filter((name) => name.endsWith(".json")); } catch { files = []; }
  files.sort((a, b) => CATEGORY_IDS.indexOf(a.replace(/\.json$/, "")) - CATEGORY_IDS.indexOf(b.replace(/\.json$/, "")) || a.localeCompare(b));
  const rest = [];
  for (const name of files) rest.push(...JSON.parse(await readFile(join(more, name), "utf8")));
  return [...first, ...rest];
}

export async function readTeamSeeds(path = join(seedsDir, "teams.json")) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

/** Slugs in featured order, agents and teams. */
export async function readFeatured(path = join(seedsDir, "featured.json")) {
  try { return JSON.parse(await readFile(path, "utf8")).featured || []; } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

/** The member record, SKILL.md texts and notes a seed contributes to a template. */
function seedMember(seed) {
  return {
    member: { key: seed.slug, name: seed.name, role: seed.role, description: seed.tagline, instructions: seed.instructions, brainCard: seed.brainCard, look: { avatar: `/avatars/birds/${seed.bird}.webp`, employeeType: "" }, skills: seed.skills.map((skill) => skill.name), harness: { id: "autohand" } },
    skills: seed.skills,
    notes: seed.notes || "",
  };
}

/**
 * Each team seed as a validated team template. A team seed names agent seeds
 * by slug; its members are those agents exactly as listed on their own, so a
 * team never says something its members' pages do not. Members' starter
 * memory is left out unless the team seed lists the slug in `memory`.
 */
export async function teamTemplates(teams, agents) {
  const bySlug = new Map(agents.map((seed) => [seed.slug, seed]));
  const out = [];
  const ids = new Set();
  for (const team of teams) {
    if (!/^team-[a-z0-9-]+$/.test(team.slug || "")) throw new Error(`${team.slug}: a team slug starts with team-`);
    if (!CATEGORY_IDS.includes(team.category)) throw new Error(`${team.slug}: unknown category ${team.category}`);
    const seeds = team.members.map((slug) => bySlug.get(slug) || (() => { throw new Error(`${team.slug}: no agent seed ${slug}`); })());
    const lead = bySlug.get(team.lead);
    if (!lead || !team.members.includes(team.lead)) throw new Error(`${team.slug}: the lead must be one of the members`);
    const members = seeds.map((seed) => ({ ...seedMember(seed), notes: (team.memory || []).includes(seed.slug) ? seed.notes || "" : "" }));
    const findings = teamTemplateFindings({ members, tagline: team.tagline, name: team.name });
    if (findings.length) throw new Error(`${team.slug}: secret scanner hit in ${findings[0].path}`);
    const document = teamTemplateFromMembers({ name: team.name, tagline: team.tagline, lead: lead.name, members, channels: team.channels || [] });
    const template = validateTeamTemplate(document);
    if (!template.ok) throw new Error(`${team.slug}: ${template.error}`);
    const listing = validateListingInput({ tagline: team.tagline, description: team.description, category: team.category, tags: team.tags });
    if (!listing.ok) throw new Error(`${team.slug}: ${listing.error}`);
    const id = await seedListingId(team.slug);
    if (ids.has(id)) throw new Error(`${team.slug}: listing id collision ${id}`);
    ids.add(id);
    const summary = teamTemplateSummary(template.document);
    out.push({ id, slug: team.slug, kind: "team", listing: listing.listing, document: template.document, bytes: template.bytes, hash: await contentHash(template.document), summary });
  }
  return out;
}

/** Each seed as `{ id, listing, document, hash, bytes, summary }`, validated. */
export async function seedTemplates(seeds) {
  const out = [];
  const ids = new Set();
  for (const seed of seeds) {
    if (!CATEGORY_IDS.includes(seed.category)) throw new Error(`${seed.slug}: unknown category ${seed.category}`);
    const { member, skills, notes } = seedMember(seed);
    const findings = memberTemplateFindings({ member, skills, notes, tagline: seed.tagline });
    if (findings.length) throw new Error(`${seed.slug}: secret scanner hit in ${findings[0].path}`);
    const document = templateFromMember({ member, skills, notes, tagline: seed.tagline });
    const template = validateAgentTemplate(document);
    if (!template.ok) throw new Error(`${seed.slug}: ${template.error}`);
    const listing = validateListingInput({ tagline: seed.tagline, description: seed.description, category: seed.category, tags: seed.tags });
    if (!listing.ok) throw new Error(`${seed.slug}: ${listing.error}`);
    const id = await seedListingId(seed.slug);
    if (ids.has(id)) throw new Error(`${seed.slug}: listing id collision ${id}`);
    ids.add(id);
    out.push({ id, slug: seed.slug, kind: "agent", listing: listing.listing, document: template.document, bytes: template.bytes, hash: await contentHash(template.document), summary: templateSummary(template.document) });
  }
  return out;
}

const searchText = (t) => [t.summary.name, t.summary.role, t.listing.tagline, AUTOHAND_CREATOR_NAME, ...t.listing.tags, t.listing.category, t.kind === "team" ? `team ${t.summary.members.map((member) => `${member.name} ${member.role}`).join(" ")}` : ""].join(" ").toLowerCase().replace(/\s+/g, " ").trim();

/** Every seed, agents then teams, validated, with the featured order: what the database is seeded with. */
export async function allSeedTemplates() {
  const agents = await readSeeds();
  const templates = [...await seedTemplates(agents), ...await teamTemplates(await readTeamSeeds(), agents)];
  return { templates, featured: await readFeatured() };
}

/** All seed statements, ready to run. */
export async function allSeedStatements(now) {
  const { templates, featured } = await allSeedTemplates();
  return seedStatements(templates, now, featured);
}

/**
 * `[{ sql, params }]` for the publisher, every listing and its version 1,
 * then the initial featured order. `templates` holds agents and teams;
 * `featured` is slugs in order. The featured order applies only while no
 * admin has featured, unfeatured or reordered anything: after that the
 * admins' curation is the truth and re-seeding leaves it alone.
 */
export function seedStatements(templates, now = new Date().toISOString(), featured = []) {
  const statements = [{
    sql: "INSERT OR IGNORE INTO publishers(id,kind,issuer,subject,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    params: [AUTOHAND_PUBLISHER.id, AUTOHAND_PUBLISHER.kind, AUTOHAND_PUBLISHER.issuer, AUTOHAND_PUBLISHER.subject, AUTOHAND_PUBLISHER.displayName, now, now],
  }];
  for (const t of templates) {
    statements.push({
      sql: `INSERT OR IGNORE INTO listings(id,publisher_id,kind,members,faces,name,role,tagline,description,category,tags,bird,creator_kind,creator_name,search_text,version,content_hash,bytes,skills,has_memory,status,featured,adds,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'published',0,0,?,?,?)`,
      params: [t.id, AUTOHAND_PUBLISHER.id, t.kind || "agent", t.kind === "team" ? t.summary.members.length : 1, JSON.stringify(t.kind === "team" ? [...t.summary.members].sort((a, b) => Number(b.lead) - Number(a.lead)).map((member) => member.bird).slice(0, 8) : []), t.summary.name, t.summary.role, t.listing.tagline, t.listing.description, t.listing.category, JSON.stringify(t.listing.tags), t.summary.bird, "autohand", AUTOHAND_CREATOR_NAME, searchText(t), t.hash, t.bytes, t.summary.skills.length, t.summary.hasMemory ? 1 : 0, "seed", now, now],
    });
    statements.push({
      sql: "INSERT OR IGNORE INTO listing_versions(listing_id,version,document,content_hash,bytes,note,created_by,created_at) VALUES (?,1,?,?,?,?,?,?)",
      params: [t.id, JSON.stringify(t.document), t.hash, t.bytes, "Added by the Autohand Squad team.", "seed", now],
    });
  }
  const bySlug = new Map(templates.map((t) => [t.slug, t.id]));
  featured.forEach((slug, index) => {
    const id = bySlug.get(slug);
    if (!id) throw new Error(`featured.json names ${slug}, which is not a seed`);
    statements.push({
      sql: "UPDATE listings SET featured=1,featured_rank=? WHERE id=? AND status='published' AND NOT EXISTS (SELECT 1 FROM audit WHERE action IN ('listing.featured','listing.unfeatured','featured.reordered'))",
      params: [index + 1, id],
    });
  });
  const teams = templates.filter((t) => t.kind === "team").length;
  statements.push({ sql: "INSERT INTO audit(at,actor_kind,actor,action,listing_id,detail) VALUES (?,?,?,?,?,?)", params: [now, "system", "seed", "seed.applied", "", `${templates.length - teams} Autohand Squad team agents, ${teams} teams, ${featured.length} featured`] });
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
  const { templates, featured } = await allSeedTemplates();
  const counts = {};
  for (const t of templates) if (t.kind === "agent") counts[t.listing.category] = (counts[t.listing.category] || 0) + 1;
  const agents = templates.filter((t) => t.kind === "agent");
  console.log(`${agents.length} seed agents valid; ${agents.reduce((sum, t) => sum + t.summary.skills.length, 0)} skills; ${templates.length - agents.length} teams; ${featured.length} featured; ${JSON.stringify(counts)}`);
  const batches = args.includes("--batches") ? args[args.indexOf("--batches") + 1] : "";
  if (batches) {
    await mkdir(batches, { recursive: true });
    const statements = seedStatements(templates, undefined, featured);
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
    await writeFile(out, seedSql(seedStatements(templates, undefined, featured)));
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
    for (const { sql, params } of await allSeedStatements()) db.prepare(sql).run(...params);
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
