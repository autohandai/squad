// The agent marketplace's format, links and hashes (ADR-0246).
//
// A marketplace agent template is a team file (src/lib/teams.js) holding one
// member and its skills, with stricter limits. One validator serves the
// Worker on publish, the bridge on import and the browser preview, so the
// three can never disagree about what a template may carry.
//
// Pure: no React, no DOM, no Node APIs beyond the web platform (TextEncoder,
// WebCrypto), so services/squad-api bundles it into the Worker unchanged and
// scripts/check-marketplace.mjs proves it from Node.
// See docs/integration/marketplace.md.

import { scanSecrets } from "./secret-scan.js";
import { TEAM_FORMAT, TEAM_VERSION, buildTeamFile, validateTeamFile } from "./teams.js";

export const TEMPLATE_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  skills: 10,
  notes: 4000,
  tagline: 140,
  description: 1200,
  tags: 5,
  tag: 32,
  name: 80,
  note: 280,
});

export const CATEGORIES = Object.freeze([
  { id: "engineering", label: "Engineering" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "marketing", label: "Marketing" },
  { id: "sales", label: "Sales" },
  { id: "support", label: "Support" },
  { id: "operations", label: "Operations" },
  { id: "finance", label: "Finance" },
  { id: "people", label: "Recruiting & People" },
  { id: "personal", label: "Personal" },
]);
export const CATEGORY_IDS = Object.freeze(CATEGORIES.map((category) => category.id));
/**
 * Connectors an admin may name on an Autohand listing (ADR-0285), the ids the
 * website draws official marks for. Without a choice the website infers them
 * from the listing's words, as before.
 */
export const LISTING_CONNECTOR_IDS = Object.freeze(["github", "linear", "drive", "figma", "gmail", "hubspot", "calendar", "slack", "cloudflare"]);
export const LISTING_CONNECTOR_LIMIT = 4;
export const CREATOR_KINDS = Object.freeze(["autohand", "user", "team"]);
export const LISTING_STATUSES = Object.freeze(["published", "unpublished", "hidden", "removed"]);
// A listing is one agent or a whole team (ADR-0253). Both are team files.
export const LISTING_KINDS = Object.freeze(["agent", "team"]);
export const TEAM_TEMPLATE_LIMITS = Object.freeze({
  bytes: 768 * 1024,
  minMembers: 2,
  members: 8,
  skills: 40,
  skillsPerMember: 10,
  channels: 3,
});
export const REPORT_REASONS = Object.freeze([
  { id: "spam", label: "Spam or misleading" },
  { id: "harmful", label: "Harmful or unsafe instructions" },
  { id: "impersonation", label: "Pretends to be someone else" },
  { id: "secrets", label: "Contains private data or keys" },
  { id: "broken", label: "Does not work as described" },
  { id: "other", label: "Something else" },
]);
export const REPORT_REASON_IDS = Object.freeze(REPORT_REASONS.map((reason) => reason.id));
export const AUTOHAND_CREATOR_NAME = "Autohand Squad team";

export const LISTING_ID = /^[a-z0-9]{12}$/;
export const SHA256_HEX = /^[a-f0-9]{64}$/;
export const BIRD_AVATAR = /^\/avatars\/birds\/([a-z]{2,24})\.webp$/;
export const DEEP_LINK_SCHEME = "squad:";
export const DEEP_LINK_HOST = "app";
export const DEEP_LINK_PATH = "/v1/agent-template";
export const TEAM_DEEP_LINK_PATH = "/v1/team-template";
export const APP_ROUTE_PREFIX = "/marketplace/agents/";
export const TEAM_APP_ROUTE_PREFIX = "/marketplace/teams/";
// A short-lived random id a website Add click carries into Squad, so the
// install can be joined to the click (ADR-0253). It names a click, not a person.
export const ATTRIBUTION_ID = /^[a-z0-9]{20}$/;
export const WEB_ORIGINS = Object.freeze(["https://autohand.ai", "https://www.autohand.ai"]);
export const WEB_PATH_PREFIX = "/squad/marketplace/";
export const GROK_ORIGIN = "https://x.ai";
export const GROK_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_LINK = 512;

// --- small helpers -----------------------------------------------------------

const encoder = new TextEncoder();

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function line(value, limit) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * JSON with object keys sorted and no whitespace: the same document always
 * gives the same bytes, wherever it was built or parsed.
 */
export function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) =>
    isObject(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item
  );
}

export async function sha256Hex(text) {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(String(text))));
}

/** The content hash a listing version carries: SHA-256 of the canonical JSON. */
export function contentHash(document) {
  return sha256Hex(canonicalJson(document));
}

export function byteLength(text) {
  return encoder.encode(String(text)).length;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function idFromBytes(bytes) {
  return Array.from(bytes.slice(0, 12), (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

/** A seed's listing id: stable for its slug, so seeding twice changes nothing. */
export async function seedListingId(slug) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(`autohand-squad-marketplace-seed:${slug}`));
  return idFromBytes(new Uint8Array(digest));
}

export function randomListingId() {
  return idFromBytes(globalThis.crypto.getRandomValues(new Uint8Array(12)));
}

/** A fresh attribution id for one Add click: 20 characters a-z0-9. */
export function newAttributionId() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(20)), (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

export function categoryLabel(id) {
  return CATEGORIES.find((category) => category.id === id)?.label || "Other";
}

export function birdFromTemplateAvatar(avatar) {
  return BIRD_AVATAR.exec(String(avatar || ""))?.[1] || "";
}

/** "Added 17 Nov 2026" in the reader's locale, or "" for a bad date. */
export function addedDate(value, locale = "en-GB") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// --- templates ---------------------------------------------------------------

/** Every string in a value with its path, for reporting where a secret is. */
function strings(value, path = "", out = []) {
  if (typeof value === "string") out.push({ path: path || "text", text: value });
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (isObject(value)) for (const [key, item] of Object.entries(value)) strings(item, path ? `${path}.${key}` : key, out);
  return out;
}

/** Where the secret scanner finds something: `[{ path, kinds }]`. */
export function secretFindings(value) {
  const findings = [];
  for (const entry of strings(value)) {
    const hits = scanSecrets(entry.text);
    if (hits.length) findings.push({ path: entry.path, kinds: [...new Set(hits.map((hit) => hit.kind))] });
  }
  return findings;
}

/**
 * Validate an agent template. `input` is a JSON string or an object.
 * Returns `{ ok: true, document, bytes }` or `{ ok: false, error, code,
 * findings? }`. Refuses instead of trimming or redacting: a template that
 * does not fit, or that carries something shaped like a secret, is not the
 * template its publisher meant to share.
 */
export function validateAgentTemplate(input) {
  let source = input;
  if (typeof input === "string") {
    if (byteLength(input) > TEMPLATE_LIMITS.bytes * 2) return { ok: false, code: "template_too_large", error: "This agent template is larger than 256 KB." };
    try {
      source = JSON.parse(input);
    } catch {
      return { ok: false, code: "template_invalid", error: "This agent template is not JSON." };
    }
  }
  if (!isObject(source)) return { ok: false, code: "template_invalid", error: "This is not an agent template." };
  if (source.format !== TEAM_FORMAT || source.version !== TEAM_VERSION) return { ok: false, code: "template_invalid", error: `An agent template is a ${TEAM_FORMAT} version ${TEAM_VERSION} document.` };
  for (const key of ["channels", "workflows", "routines", "connectors", "presets"]) {
    if (Array.isArray(source[key]) && source[key].length) return { ok: false, code: "template_invalid", error: `An agent template carries one member and its skills; it has no place for ${key}.` };
  }
  if (!Array.isArray(source.members) || source.members.length !== 1) return { ok: false, code: "template_invalid", error: "An agent template carries exactly one member." };
  if (Array.isArray(source.skills) && source.skills.length > TEMPLATE_LIMITS.skills) return { ok: false, code: "template_invalid", error: `An agent template carries at most ${TEMPLATE_LIMITS.skills} skills.` };
  const member = source.members[0];
  if (isObject(member) && typeof member.notes === "string" && member.notes.length > TEMPLATE_LIMITS.notes) return { ok: false, code: "template_invalid", error: `Starter memory is limited to ${TEMPLATE_LIMITS.notes} characters in a template.` };
  const avatar = isObject(member?.look) ? String(member.look.avatar || "") : "";
  if (avatar && !BIRD_AVATAR.test(avatar)) return { ok: false, code: "template_invalid", error: "A template's picture is one of the Squad birds." };
  const findings = secretFindings(source);
  if (findings.length) {
    return { ok: false, code: "template_secrets", findings, error: `Something that looks like a ${findings[0].kinds.join(" or ")} is in ${findings[0].path}${findings.length > 1 ? ` and ${findings.length - 1} other place${findings.length > 2 ? "s" : ""}` : ""}. Remove it before sharing.` };
  }
  const result = validateTeamFile(source, { maxBytes: TEMPLATE_LIMITS.bytes * 2 });
  if (!result.ok) return { ok: false, code: "template_invalid", error: result.error };
  const document = result.document;
  if (document.members.length !== 1) return { ok: false, code: "template_invalid", error: "An agent template carries exactly one member." };
  // The member's skill names must be skills the template carries; a name
  // with no SKILL.md would arrive as a skill nobody can read.
  const carried = new Set(document.skills.map((skill) => skill.name));
  const missing = document.members[0].skills.filter((name) => !carried.has(name));
  if (missing.length) return { ok: false, code: "template_invalid", error: `Skill ${missing[0]} is named but its SKILL.md is not in the template.` };
  document.team = { ...document.team, lead: document.members[0].name, exportedAt: "", app: "" };
  const bytes = byteLength(canonicalJson(document));
  if (bytes > TEMPLATE_LIMITS.bytes) return { ok: false, code: "template_too_large", error: "This agent template is larger than 256 KB." };
  return { ok: true, document, bytes };
}

/**
 * Secret-scanner findings in what a template would be built from, at the
 * paths the template will have. Building a team file redacts what the
 * scanner finds, so this runs first: a public template is refused, never
 * published with "[removed]" in it.
 */
export function memberTemplateFindings({ member = {}, skills = [], notes = "", tagline = "" } = {}) {
  return secretFindings({ team: { description: tagline }, members: [{ ...member, notes }], skills });
}

/**
 * The template for one member: `member` is the export record shape
 * (name, role, description, instructions, brainCard, look, skills),
 * `skills` the SKILL.md texts, `notes` the starter memory or "".
 */
export function templateFromMember({ member, skills = [], notes = "", tagline = "" } = {}) {
  const record = { ...member, notes: notes || "" };
  const built = buildTeamFile({
    kind: "team",
    team: line(member?.name, TEMPLATE_LIMITS.name),
    description: line(tagline || member?.description, TEMPLATE_LIMITS.tagline),
    lead: line(member?.name, TEMPLATE_LIMITS.name),
    members: [record],
    skills,
    exportedAt: "",
    app: "",
  });
  return built.document;
}

/**
 * An agent's editable parts (ADR-0285), the shape a seed has: name, role,
 * tagline, bird, instructions, brain card, skills (SKILL.md texts) and
 * starter memory. `agentTemplateFromFields` builds the template a seed or an
 * admin edit becomes; `agentFieldsFromTemplate` reads one back for editing.
 */
export function agentTemplateFromFields({ key = "", name = "", role = "", tagline = "", bird = "", instructions = "", brainCard = {}, skills = [], notes = "" } = {}) {
  const member = { key: key || line(name, TEMPLATE_LIMITS.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent", name, role, description: tagline, instructions, brainCard,
    look: { avatar: bird ? `/avatars/birds/${bird}.webp` : "", employeeType: "" }, skills: skills.map((skill) => skill.name), harness: { id: "autohand" } };
  return { member, skills, notes, findings: memberTemplateFindings({ member, skills, notes, tagline }), document: templateFromMember({ member, skills, notes, tagline }) };
}

export function agentFieldsFromTemplate(document) {
  const member = document?.members?.[0] || {};
  return {
    key: member.key || "", name: member.name || "", role: member.role || "", bird: birdFromTemplateAvatar(member.look?.avatar), instructions: member.instructions || "",
    brainCard: isObject(member.brainCard) ? member.brainCard : {}, notes: member.notes || "",
    skills: (document?.skills || []).map((skill) => ({ name: skill.name, description: skill.description || "", text: skill.text || "" })),
  };
}

/** What a listing shows that comes from its template. */
export function templateSummary(document) {
  const member = document?.members?.[0] || {};
  return {
    name: member.name || "",
    role: member.role || "",
    bird: birdFromTemplateAvatar(member.look?.avatar),
    skills: (document?.skills || []).map((skill) => ({ name: skill.name, description: skill.description })),
    hasMemory: Boolean(member.notes),
    instructions: member.instructions || "",
    brainCard: member.brainCard || {},
  };
}

/**
 * Validate a team template: an ordinary team file with 2-8 members, their
 * skills and up to three channels among them (ADR-0253). No workflows,
 * routines, connectors or presets: a template is people and how they talk,
 * never something that runs or reaches out on import. Starter memory per
 * member is allowed only because the publisher switched it on, member by
 * member, and saw the text. Returns the same shape as validateAgentTemplate.
 */
export function validateTeamTemplate(input) {
  let source = input;
  if (typeof input === "string") {
    if (byteLength(input) > TEAM_TEMPLATE_LIMITS.bytes * 2) return { ok: false, code: "template_too_large", error: "This team template is larger than 768 KB." };
    try {
      source = JSON.parse(input);
    } catch {
      return { ok: false, code: "template_invalid", error: "This team template is not JSON." };
    }
  }
  if (!isObject(source)) return { ok: false, code: "template_invalid", error: "This is not a team template." };
  if (source.format !== TEAM_FORMAT || source.version !== TEAM_VERSION || source.kind !== "team") return { ok: false, code: "template_invalid", error: `A team template is a ${TEAM_FORMAT} version ${TEAM_VERSION} team document.` };
  for (const key of ["workflows", "routines", "connectors", "presets"]) {
    if (Array.isArray(source[key]) && source[key].length) return { ok: false, code: "template_invalid", error: `A team template carries members, skills and channels; it has no place for ${key}.` };
  }
  const members = Array.isArray(source.members) ? source.members : [];
  if (members.length < TEAM_TEMPLATE_LIMITS.minMembers || members.length > TEAM_TEMPLATE_LIMITS.members) return { ok: false, code: "template_invalid", error: `A team template carries ${TEAM_TEMPLATE_LIMITS.minMembers} to ${TEAM_TEMPLATE_LIMITS.members} members.` };
  if (Array.isArray(source.skills) && source.skills.length > TEAM_TEMPLATE_LIMITS.skills) return { ok: false, code: "template_invalid", error: `A team template carries at most ${TEAM_TEMPLATE_LIMITS.skills} skills.` };
  if (Array.isArray(source.channels) && source.channels.length > TEAM_TEMPLATE_LIMITS.channels) return { ok: false, code: "template_invalid", error: `A team template carries at most ${TEAM_TEMPLATE_LIMITS.channels} channels.` };
  for (const member of members) {
    if (isObject(member) && Array.isArray(member.skills) && member.skills.length > TEAM_TEMPLATE_LIMITS.skillsPerMember) return { ok: false, code: "template_invalid", error: `Each member of a team template carries at most ${TEAM_TEMPLATE_LIMITS.skillsPerMember} skills.` };
    if (isObject(member) && typeof member.notes === "string" && member.notes.length > TEMPLATE_LIMITS.notes) return { ok: false, code: "template_invalid", error: `Starter memory is limited to ${TEMPLATE_LIMITS.notes} characters per member.` };
    const avatar = isObject(member?.look) ? String(member.look.avatar || "") : "";
    if (avatar && !BIRD_AVATAR.test(avatar)) return { ok: false, code: "template_invalid", error: "A template's pictures are Squad birds." };
  }
  const findings = secretFindings(source);
  if (findings.length) {
    return { ok: false, code: "template_secrets", findings, error: `Something that looks like a ${findings[0].kinds.join(" or ")} is in ${findings[0].path}${findings.length > 1 ? ` and ${findings.length - 1} other place${findings.length > 2 ? "s" : ""}` : ""}. Remove it before sharing.` };
  }
  const result = validateTeamFile(source, { maxBytes: TEAM_TEMPLATE_LIMITS.bytes * 2 });
  if (!result.ok) return { ok: false, code: "template_invalid", error: result.error };
  const document = result.document;
  if (document.members.length !== members.length) return { ok: false, code: "template_invalid", error: "Two members of this team template share a name." };
  const names = new Set(document.members.map((member) => member.name.toLowerCase()));
  if (names.size !== document.members.length) return { ok: false, code: "template_invalid", error: "Two members of this team template share a name." };
  const carried = new Set(document.skills.map((skill) => skill.name));
  for (const member of document.members) {
    const missing = member.skills.filter((name) => !carried.has(name));
    if (missing.length) return { ok: false, code: "template_invalid", error: `Skill ${missing[0]} is named by ${member.name} but its SKILL.md is not in the template.` };
  }
  const used = new Set(document.members.flatMap((member) => member.skills));
  const loose = document.skills.find((skill) => !used.has(skill.name));
  if (loose) return { ok: false, code: "template_invalid", error: `Skill ${loose.name} is in the template but no member uses it.` };
  const lead = document.team.lead && names.has(document.team.lead.toLowerCase()) ? document.team.lead : document.members[0].name;
  document.team = { ...document.team, lead, exportedAt: "", app: "" };
  const bytes = byteLength(canonicalJson(document));
  if (bytes > TEAM_TEMPLATE_LIMITS.bytes) return { ok: false, code: "template_too_large", error: "This team template is larger than 768 KB." };
  return { ok: true, document, bytes };
}

/** The validator for a listing kind. */
export function validateListingTemplate(kind, input) {
  return kind === "team" ? validateTeamTemplate(input) : validateAgentTemplate(input);
}

/**
 * A team template from members in the export record shape. `members` is
 * `[{ member, skills, notes }]` (notes only where the publisher chose to
 * share them); `channels` is `[{ name, members? }]`, every member by default.
 */
export function teamTemplateFromMembers({ name, tagline = "", lead = "", members = [], channels = [] } = {}) {
  const records = members.map(({ member, notes = "" }) => ({ ...member, notes: notes || "" }));
  const skills = members.flatMap(({ skills = [] }) => skills);
  const everyone = records.map((member) => member.name);
  const built = buildTeamFile({
    kind: "team",
    team: line(name, TEMPLATE_LIMITS.name),
    description: line(tagline, TEMPLATE_LIMITS.tagline),
    lead: line(lead || records[0]?.name, TEMPLATE_LIMITS.name),
    members: records,
    skills,
    channels: channels.map((channel) => ({ name: channel.name, visibility: "public", section: "", members: Array.isArray(channel.members) && channel.members.length ? channel.members : everyone })),
    exportedAt: "",
    app: "",
  });
  return built.document;
}

/** Secret-scanner findings in what a team template would be built from. */
export function teamTemplateFindings({ members = [], tagline = "", name = "" } = {}) {
  return secretFindings({
    team: { name, description: tagline },
    members: members.map(({ member = {}, notes = "" }) => ({ ...member, notes })),
    skills: members.flatMap(({ skills = [] }) => skills),
  });
}

/** What a team listing shows that comes from its template. */
export function teamTemplateSummary(document) {
  const members = (document?.members || []).map((member) => ({
    name: member.name || "",
    role: member.role || "",
    description: member.description || "",
    bird: birdFromTemplateAvatar(member.look?.avatar),
    skills: member.skills || [],
    hasMemory: Boolean(member.notes),
    lead: member.name === document?.team?.lead,
  }));
  return {
    name: document?.team?.name || "",
    role: `Team of ${members.length}`,
    bird: members.find((member) => member.lead)?.bird || members[0]?.bird || "",
    members,
    skills: (document?.skills || []).map((skill) => ({ name: skill.name, description: skill.description })),
    channels: (document?.channels || []).map((channel) => ({ name: channel.name, members: channel.members.length })),
    hasMemory: members.some((member) => member.hasMemory),
  };
}

/** templateSummary or teamTemplateSummary, by the document's shape. */
export function listingSummary(kind, document) {
  if (kind === "team") {
    const summary = teamTemplateSummary(document);
    return { ...summary, instructions: "", brainCard: {} };
  }
  return { ...templateSummary(document), members: [], channels: [] };
}

/**
 * The listing fields a publisher chooses. Returns `{ ok, listing }` or
 * `{ ok: false, error }`; text is single-spaced and trimmed.
 */
export function validateListingInput(input = {}) {
  const source = isObject(input) ? input : {};
  const tagline = line(source.tagline, TEMPLATE_LIMITS.tagline + 1);
  if (!tagline) return { ok: false, error: "Give the agent a one-line tagline." };
  if (tagline.length > TEMPLATE_LIMITS.tagline) return { ok: false, error: `Keep the tagline under ${TEMPLATE_LIMITS.tagline} characters.` };
  const description = typeof source.description === "string" ? source.description.trim() : "";
  if (description.length > TEMPLATE_LIMITS.description) return { ok: false, error: `Keep the description under ${TEMPLATE_LIMITS.description} characters.` };
  if (!CATEGORY_IDS.includes(source.category)) return { ok: false, error: "Choose a category." };
  const tags = [...new Set((Array.isArray(source.tags) ? source.tags : []).map((tag) => line(tag, TEMPLATE_LIMITS.tag).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean))];
  if (tags.length > TEMPLATE_LIMITS.tags) return { ok: false, error: `Use at most ${TEMPLATE_LIMITS.tags} tags.` };
  const findings = secretFindings({ tagline, description, tags });
  if (findings.length) return { ok: false, error: `Something that looks like a ${findings[0].kinds.join(" or ")} is in the ${findings[0].path}. Remove it before sharing.` };
  return { ok: true, listing: { tagline, description, category: source.category, tags } };
}

// --- links -------------------------------------------------------------------

/**
 * `squad://app/v1/agent-template?id=…[&version=…][&sha256=…][&attribution=…]`,
 * or `team-template` for a team listing.
 */
export function buildDeepLink({ id, version, sha256, attribution, listing = "agent" } = {}) {
  if (!LISTING_ID.test(String(id || ""))) throw new Error("A marketplace link needs a listing id.");
  const params = new URLSearchParams({ id });
  if (Number.isInteger(version) && version > 0) params.set("version", String(version));
  if (SHA256_HEX.test(String(sha256 || ""))) params.set("sha256", sha256);
  if (ATTRIBUTION_ID.test(String(attribution || ""))) params.set("attribution", attribution);
  return `squad://app${listing === "team" ? TEAM_DEEP_LINK_PATH : DEEP_LINK_PATH}?${params}`;
}

const REQUEST_KEYS = ["id", "version", "sha256", "attribution"];

function marketplaceRequest(params, allowed = REQUEST_KEYS, listing = "agent") {
  for (const key of params.keys()) if (!allowed.includes(key)) return null;
  for (const key of allowed) if (params.getAll(key).length > 1) return null;
  const id = params.get("id") || "";
  if (!LISTING_ID.test(id)) return null;
  const out = { kind: "marketplace", listing, id };
  if (params.has("version")) {
    const version = Number(params.get("version"));
    if (!/^\d{1,7}$/.test(params.get("version")) || version < 1) return null;
    out.version = version;
  }
  if (params.has("sha256")) {
    if (!SHA256_HEX.test(params.get("sha256"))) return null;
    out.sha256 = params.get("sha256");
  }
  if (params.has("attribution")) {
    if (!ATTRIBUTION_ID.test(params.get("attribution"))) return null;
    out.attribution = params.get("attribution");
  }
  return out;
}

/**
 * The marketplace request in a `squad://` link, or null. Strict: exact
 * scheme, host, path and parameter names. The shell and the app both run
 * this; anything that does not parse is ignored, never "best effort".
 */
export function parseDeepLink(text) {
  const value = String(text || "").trim();
  if (!value || value.length > MAX_LINK) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== DEEP_LINK_SCHEME || url.username || url.password || url.port || url.hash) return null;
  // WHATWG URL keeps a non-special scheme's authority in `host` and the rest in `pathname`.
  if (url.host !== DEEP_LINK_HOST || (url.pathname !== DEEP_LINK_PATH && url.pathname !== TEAM_DEEP_LINK_PATH)) return null;
  return marketplaceRequest(url.searchParams, REQUEST_KEYS, url.pathname === TEAM_DEEP_LINK_PATH ? "team" : "agent");
}

/** The app route a deep link opens: `/marketplace/agents/<id>?version=…&sha256=…`. */
export function appRouteForRequest(request) {
  if (!request || request.kind !== "marketplace" || !LISTING_ID.test(request.id)) return "";
  const params = new URLSearchParams();
  if (request.version) params.set("version", String(request.version));
  if (request.sha256) params.set("sha256", request.sha256);
  if (request.attribution) params.set("attribution", request.attribution);
  const query = params.toString();
  return `${request.listing === "team" ? TEAM_APP_ROUTE_PREFIX : APP_ROUTE_PREFIX}${request.id}${query ? `?${query}` : ""}`;
}

/** The request behind an app route (`/marketplace/agents/<id>` or `/marketplace/teams/<id>`), or null. */
export function requestFromAppRoute(pathname, search = "") {
  const match = /^\/marketplace\/(agents|teams)\/([a-z0-9]{12})\/?$/.exec(String(pathname || ""));
  if (!match) return null;
  const params = new URLSearchParams(String(search || ""));
  params.set("id", match[2]);
  return marketplaceRequest(params, REQUEST_KEYS, match[1] === "teams" ? "team" : "agent");
}

/**
 * Anything a person pastes into From a link: a Squad link, a marketplace page,
 * a bare listing id, a Grok Bot page or a grokbot:// link. Returns
 * `{ kind: "marketplace", id, version?, sha256? }`, `{ kind: "grok", id, url }`
 * or `{ kind: "invalid", error }`.
 */
export function parseMarketplaceLink(text, { webOrigins = WEB_ORIGINS } = {}) {
  const value = String(text || "").trim();
  if (!value) return { kind: "invalid", error: "Paste a marketplace or Grok Bot link." };
  if (value.length > MAX_LINK) return { kind: "invalid", error: "That link is too long to be a marketplace link." };
  if (LISTING_ID.test(value)) return { kind: "marketplace", listing: "agent", id: value };
  const deep = parseDeepLink(value);
  if (deep) return deep;
  let url;
  try {
    url = new URL(value);
  } catch {
    return { kind: "invalid", error: "That is not a link Squad can open." };
  }
  if (url.protocol === "grokbot:") {
    const id = url.searchParams.get("id") || "";
    if (url.host === "app" && url.pathname === "/v1/bot-template" && GROK_ID.test(id)) return { kind: "grok", id, url: `${GROK_ORIGIN}/bot/${id}` };
    return { kind: "invalid", error: "That Grok Bot link has no template id." };
  }
  if (url.protocol !== "https:" || url.username || url.password) return { kind: "invalid", error: "Only https links are opened." };
  if (url.origin === GROK_ORIGIN) {
    const match = /^\/bot\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    if (match && GROK_ID.test(match[1])) return { kind: "grok", id: match[1], url: `${GROK_ORIGIN}/bot/${match[1]}` };
    return { kind: "invalid", error: "That x.ai link is not a Grok Bot template page." };
  }
  if (webOrigins.includes(url.origin)) {
    const match = /^\/squad\/marketplace\/(teams\/)?([a-z0-9]{12})\/?$/.exec(url.pathname);
    if (match) {
      const params = new URLSearchParams(url.search);
      params.set("id", match[2]);
      for (const key of [...params.keys()]) if (!["id", "version", "sha256"].includes(key)) params.delete(key);
      return marketplaceRequest(params, REQUEST_KEYS, match[1] ? "team" : "agent") || { kind: "invalid", error: "That marketplace link is not complete." };
    }
    return { kind: "invalid", error: "That page is not a marketplace agent." };
  }
  return { kind: "invalid", error: "Squad opens links from the Autohand marketplace and Grok Bot pages only." };
}

// --- Grok Bot templates ------------------------------------------------------

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function metaContent(html, attribute, name) {
  const pattern = new RegExp(`<meta[^>]+${attribute}="${name}"[^>]*>`, "i");
  const tag = pattern.exec(html)?.[0] || "";
  const content = /content="([^"]*)"/i.exec(tag)?.[1];
  return content === undefined ? "" : decodeEntities(content);
}

/**
 * The public facts of a Grok Bot template from its page's HTML: the page
 * embeds `{"id":…,"ownerType":…,"sharerName":…,"botName":…,"description":…,
 * "color":…,"shape":…}` in its server-rendered data, escaped once inside a
 * script string. Falls back to the Open Graph title and description.
 * Returns null when the page is not the template `id` asked for.
 */
export function parseGrokBotPage(html, id) {
  const source = String(html || "");
  if (!GROK_ID.test(String(id || ""))) return null;
  const unescaped = source.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const anchor = `{"id":"${id}","ownerType"`;
  const start = unescaped.indexOf(anchor);
  if (start !== -1) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < Math.min(unescaped.length, start + 20000); index += 1) {
      const character = unescaped[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            const data = JSON.parse(unescaped.slice(start, index + 1));
            if (data.id !== id) break;
            return {
              id,
              name: line(data.botName, TEMPLATE_LIMITS.name),
              description: line(data.description, TEMPLATE_LIMITS.description),
              sharerName: line(data.sharerName, TEMPLATE_LIMITS.name),
              ownerType: line(data.ownerType, 40),
              color: /^#[0-9a-f]{6}$/i.test(String(data.color || "")) ? data.color : "",
              shape: line(data.shape, 40),
              source: "page-data",
            };
          } catch {
            break;
          }
        }
      }
    }
  }
  const canonical = metaContent(source, "property", "og:url");
  if (canonical && canonical !== `${GROK_ORIGIN}/bot/${id}`) return null;
  const name = line(metaContent(source, "property", "og:title") || decodeEntities(/<title>([^<]*)<\/title>/i.exec(source)?.[1] || ""), TEMPLATE_LIMITS.name);
  if (!name || !canonical) return null;
  return { id, name, description: line(metaContent(source, "name", "description") || metaContent(source, "property", "og:description"), TEMPLATE_LIMITS.description), sharerName: "", ownerType: "", color: "", shape: "", source: "meta" };
}

/** "Grok Bot template by …": the sharer's name, or an honest stand-in. */
export function grokCreatorName(bot) {
  return bot?.sharerName || "a Grok Bot user";
}

/**
 * A starter agent template from a Grok Bot's public facts. The instructions
 * Grok keeps private are not here: pasted `instructions` are used when the
 * person has them, otherwise the agent starts from the description and says
 * so in its own instructions.
 */
export function grokTemplate(bot, { instructions = "", bird = "kea" } = {}) {
  // What gets created never names the service it was imported from (owner,
  // 19 Nov 2026; ADR-0261): no source line, role or fallback name says so.
  // The import receipt keeps the link for "Update available" and the count.
  const name = line(bot?.name, TEMPLATE_LIMITS.name) || "Imported agent";
  const description = line(bot?.description, 600);
  const pasted = typeof instructions === "string" ? instructions.trim().slice(0, 20000) : "";
  const body = pasted
    || `Act as ${name}. ${description}\n\nWork in small steps, say what you are about to do before you change anything, and ask when the request is unclear. These instructions start from a short description; refine them in your profile as the work becomes clear.`;
  const role = line(description.split(/[.;:—–-]\s/)[0], TEMPLATE_LIMITS.role || 80) || "Assistant";
  return templateFromMember({
    member: {
      name,
      role,
      description: description || "An imported agent.",
      instructions: body,
      brainCard: { purpose: description },
      look: { avatar: `/avatars/birds/${bird}.webp`, employeeType: "" },
      skills: [],
      harness: { id: "autohand" },
    },
    tagline: description,
  });
}
