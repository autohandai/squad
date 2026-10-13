// Sharing a team as one file, and adding one.
//
// A team file holds what someone else needs to recreate a squad's members,
// skills, channels and workflows: names, titles, instructions, brain cards,
// looks, SKILL.md text, channel membership and workflow definitions. It has
// no field for a credential, a conversation, a permission grant, a provider
// or model key, a folder or a computer: the shape below is an allowlist, and
// `validateTeamFile` rebuilds every document from it, so an unknown field
// cannot ride along and a hand-edited file still says only what a file may.
//
// Pure: no React, no DOM, no Node. The bridge (server/teams) builds and
// validates with these functions, the browser previews with them, and
// scripts/check-teams.mjs proves them from Node.
// See docs/adrs/ADR-0106-team-sharing-presets-and-member-menus.md.

import { brainCardFields } from "./brain-card.js";
import { redactDeep } from "./secret-scan.js";

export const TEAM_FORMAT = "autohand.squad-team";
export const TEAM_VERSION = 1;
export const TEAM_FILE_SUFFIX = ".squad-team.json";

export const TEAM_LIMITS = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  members: 50,
  skills: 60,
  skillsPerMember: 30,
  channels: 50,
  membersPerChannel: 50,
  workflows: 100,
  stepsPerWorkflow: 20,
  presets: 40,
  routines: 40,
  connectors: 20,
  name: 80,
  key: 96,
  line: 600,
  instructions: 20000,
  notes: 32000,
  skillText: 64 * 1024,
  prompt: 8000,
  url: 2048,
  headers: 16,
  section: 80,
});

const BRAIN_CARD_FIELDS = Object.freeze(brainCardFields.map((field) => field.id));
const VISIBILITIES = Object.freeze(["public", "private"]);
const TRIGGER_TYPES = Object.freeze(["message", "reaction", "schedule", "webhook"]);
const STEP_KINDS = Object.freeze(["member", "http"]);
const STEP_CONDITIONS = Object.freeze(["always", "previous_succeeded", "previous_failed"]);
const APPROVAL_BY = Object.freeze(["user", "member"]);
const DISPATCH_MODES = Object.freeze(["app", "bridge"]);
const HTTP_METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HARNESS_IDS = Object.freeze(["autohand", "codex", "claude"]);
// Routine schedules are the shapes server/routines/schedule.mjs accepts
// (ADR-0110); a routine always arrives paused, so `enabled` is not a field.
const ROUTINE_KINDS = Object.freeze(["once", "weekdays", "interval", "monthly", "yearly", "cron"]);
// A connector in a file is a name and an address, never a key: header and
// environment names travel, values do not, and a connector arrives off.
const CONNECTOR_KINDS = Object.freeze(["url", "stdio", "builtin"]);
const CONNECTOR_TRANSPORTS = Object.freeze(["http", "sse"]);
// A look is a path the app serves itself. A data URL is a picture; pictures
// are not in this version of the format (ADR-0106, consequences).
const AVATAR_PATH = /^\/[a-z0-9/_.-]+\.(?:png|jpg|jpeg|webp|svg)$/i;

// --- small helpers ---------------------------------------------------------

export function slug(value, limit = TEAM_LIMITS.key) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, limit) || "item";
}

function line(value, limit = TEAM_LIMITS.line) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nameList(value, limit) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const name = line(typeof item === "string" ? item : item?.name, TEAM_LIMITS.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

function skillNameList(value, limit = TEAM_LIMITS.skillsPerMember) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const name = slug(typeof item === "string" ? item : item?.name || item?.id, TEAM_LIMITS.name);
    if (!name || name === "item" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

function brainCard(value) {
  const source = isObject(value) ? value : {};
  const out = {};
  for (const field of BRAIN_CARD_FIELDS) out[field] = line(source[field]);
  return out;
}

function look(value) {
  const source = isObject(value) ? value : {};
  const avatar = String(source.avatar || "").trim();
  return {
    avatar: AVATAR_PATH.test(avatar) ? avatar : "",
    employeeType: slug(source.employeeType, TEAM_LIMITS.key) === "item" ? "" : slug(source.employeeType, TEAM_LIMITS.key),
  };
}

/** A name nobody in `taken` has yet: "Iris", then "Iris 2", "Iris 3"… */
export function uniqueName(name, taken = [], { separator = " " } = {}) {
  const base = line(name, TEAM_LIMITS.name) || "Member";
  const used = new Set([...taken].map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  if (!used.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}${separator}${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}${separator}${Date.now().toString(36)}`;
}

export function teamFileName(teamName, date = new Date()) {
  const day = date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${slug(teamName, 40)}-${day}${TEAM_FILE_SUFFIX}`;
}

export function presetFileName(presetName, date = new Date()) {
  const day = date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `${slug(presetName, 40)}-${day}.squad-preset.json`;
}

// --- the allowlist, one record at a time -----------------------------------

/**
 * What a member contributes to a file: name, role title, instructions and
 * brain card, look, skill names, harness id. Nothing about permissions,
 * folders, model keys or conversations is read, so it cannot be written.
 */
export function memberExportRecord(agent, { notes = "" } = {}) {
  const source = isObject(agent) ? agent : {};
  const name = line(source.name, TEAM_LIMITS.name);
  if (!name) return null;
  const record = {
    key: slug(source.key || name),
    name,
    role: line(source.role || source.title, TEAM_LIMITS.name),
    description: line(source.description),
    instructions: text(source.instructions, TEAM_LIMITS.instructions),
    brainCard: brainCard(source.brainCard),
    look: look({ avatar: source.look?.avatar ?? source.avatar, employeeType: source.look?.employeeType ?? source.employeeType }),
    skills: skillNameList(source.skills),
    harness: { id: HARNESS_IDS.includes(String(source.harness?.id || source.harness || "").toLowerCase()) ? String(source.harness?.id || source.harness).toLowerCase() : "autohand" },
  };
  const memo = text(notes || source.notes, TEAM_LIMITS.notes);
  if (memo) record.notes = memo;
  return record;
}

export function skillExportRecord(skill) {
  const source = isObject(skill) ? skill : {};
  const name = slug(source.name || source.id, TEAM_LIMITS.name);
  const body = text(source.text, TEAM_LIMITS.skillText);
  if (!name || name === "item" || !body) return null;
  return { name, description: line(source.description), text: body };
}

export function channelExportRecord(channel, memberNames = []) {
  const source = isObject(channel) ? channel : {};
  const name = line(source.name, TEAM_LIMITS.name);
  if (!name) return null;
  return {
    name,
    visibility: VISIBILITIES.includes(source.visibility) ? source.visibility : "public",
    section: line(source.section, TEAM_LIMITS.section),
    members: nameList(memberNames.length ? memberNames : source.members, TEAM_LIMITS.membersPerChannel),
  };
}

function triggerRecord(value) {
  const source = isObject(value) ? value : {};
  const type = TRIGGER_TYPES.includes(source.type) ? source.type : "message";
  // A webhook token is a credential: it is minted again on import.
  return {
    type,
    pattern: type === "message" ? line(source.pattern, 400) : "",
    emoji: type === "reaction" ? line(source.emoji, 16) : "",
    cron: type === "schedule" ? line(source.cron, 120) : "",
  };
}

function stepRecord(value, index) {
  const source = isObject(value) ? value : {};
  const kind = STEP_KINDS.includes(source.kind) ? source.kind : "member";
  const base = {
    id: slug(source.id, 96) === "item" ? `step_${index + 1}` : slug(source.id, 96),
    kind,
    when: STEP_CONDITIONS.includes(source.when) ? source.when : "always",
    approval: isObject(source.approval)
      ? { by: APPROVAL_BY.includes(source.approval.by) ? source.approval.by : "user", emoji: line(source.approval.emoji, 16) }
      : null,
  };
  if (kind === "http") {
    const method = line(source.method, 10).toUpperCase();
    return {
      ...base,
      url: line(source.url, TEAM_LIMITS.url),
      method: HTTP_METHODS.includes(method) ? method : "POST",
      // Header names travel; values never do.
      headers: (Array.isArray(source.headers) ? source.headers : [])
        .map((header) => ({ name: line(typeof header === "string" ? header : header?.name, 128), value: "" }))
        .filter((header) => header.name)
        .slice(0, TEAM_LIMITS.headers),
      body: text(source.body, TEAM_LIMITS.prompt),
    };
  }
  return {
    ...base,
    member: line(source.member || source.memberName, TEAM_LIMITS.name),
    prompt: text(source.prompt, TEAM_LIMITS.prompt),
  };
}

export function workflowExportRecord(workflow, { channelName = "", memberNameById = new Map() } = {}) {
  const source = isObject(workflow) ? workflow : {};
  const name = line(source.name, 120);
  const channel = line(channelName || source.channel, TEAM_LIMITS.name);
  if (!name || !channel) return null;
  const steps = (Array.isArray(source.steps) ? source.steps : [])
    .slice(0, TEAM_LIMITS.stepsPerWorkflow)
    .map((step, index) =>
      stepRecord(
        step?.kind === "http" ? step : { ...step, member: step?.member || step?.memberName || memberNameById.get(step?.memberId) || "" },
        index
      )
    )
    .filter((step) => step.kind === "http" ? step.url : step.member && step.prompt);
  if (!steps.length) return null;
  return {
    channel,
    name,
    dispatch: DISPATCH_MODES.includes(source.dispatch) ? source.dispatch : "app",
    trigger: triggerRecord(source.trigger),
    steps,
  };
}

function routineScheduleRecord(value) {
  const source = isObject(value) ? value : {};
  const kind = ROUTINE_KINDS.includes(source.kind) ? source.kind : "weekdays";
  const record = { kind, time: /^\d{2}:\d{2}$/.test(String(source.time || "")) ? String(source.time) : "09:00" };
  // A time zone is the person's, not the file's: it is optional here and the
  // import fills in the importer's zone when the file names none.
  const timeZone = line(source.timeZone, 64);
  if (timeZone) record.timeZone = timeZone;
  if (kind === "once") record.date = line(source.date, 10);
  if (kind === "weekdays") record.days = (Array.isArray(source.days) ? source.days : [1, 2, 3, 4, 5]).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).slice(0, 7);
  if (kind === "interval") record.everyMinutes = Math.min(1440, Math.max(5, Number(source.everyMinutes) || 60));
  if (kind === "monthly") record.day = source.day === "last" ? "last" : Math.min(31, Math.max(1, Number(source.day) || 1));
  if (kind === "yearly") {
    record.month = Math.min(12, Math.max(1, Number(source.month) || 1));
    record.day = Math.min(31, Math.max(1, Number(source.day) || 1));
  }
  if (kind === "cron") record.cron = line(source.cron, 120);
  return record;
}

/** A member routine (ADR-0110) as a file carries it: paused, member by name. */
export function routineExportRecord(routine, { memberName = "" } = {}) {
  const source = isObject(routine) ? routine : {};
  const member = line(memberName || source.member || source.memberName, TEAM_LIMITS.name);
  const title = line(source.title, 120);
  const instructions = text(source.instructions, TEAM_LIMITS.prompt);
  if (!member || !title || !instructions) return null;
  const record = { member, title, instructions, schedule: routineScheduleRecord(source.schedule) };
  const minutes = Number(source.maxRunMinutes);
  if (Number.isFinite(minutes) && minutes > 0) record.maxRunMinutes = Math.min(1440, Math.round(minutes));
  return record;
}

/** A connector (ADR-0107) as a file carries it: name, kind, address; no values. */
export function connectorExportRecord(connector) {
  const source = isObject(connector) ? connector : {};
  const name = line(source.name, TEAM_LIMITS.name);
  const kind = source.builtin === true ? "builtin" : CONNECTOR_KINDS.includes(source.kind) ? source.kind : "";
  if (!name || !kind) return null;
  const record = { name, kind, note: line(source.note, TEAM_LIMITS.line) };
  if (kind === "url") {
    const url = line(source.url, TEAM_LIMITS.url);
    if (!/^https?:\/\//i.test(url)) return null;
    record.url = url;
    record.transport = CONNECTOR_TRANSPORTS.includes(source.transport) ? source.transport : "http";
    record.headers = (Array.isArray(source.headers) ? source.headers : [])
      .map((header) => line(typeof header === "string" ? header : header?.name || header?.key, 128))
      .filter(Boolean)
      .slice(0, TEAM_LIMITS.headers);
  } else if (kind === "stdio") {
    record.command = line(source.command, 1024);
    if (!record.command) return null;
    record.args = (Array.isArray(source.args) ? source.args : []).map((arg) => line(arg, 1024)).filter(Boolean).slice(0, 32);
    record.env = (Array.isArray(source.env) ? source.env : []).map((entry) => line(typeof entry === "string" ? entry : entry?.key || entry?.name, 128)).filter(Boolean).slice(0, 16);
  }
  return record;
}

/** A preset: a member minus anything that is specific to one squad. */
export function presetRecord(preset) {
  const source = isObject(preset) ? preset : {};
  const name = line(source.name, TEAM_LIMITS.name);
  const role = line(source.role, TEAM_LIMITS.name);
  if (!name && !role) return null;
  const record = {
    key: slug(source.key || `${name} ${role}`),
    name: name || role,
    description: line(source.description),
    role: role || name,
    instructions: text(source.instructions, TEAM_LIMITS.instructions),
    brainCard: brainCard(source.brainCard),
    look: look(source.look || { avatar: source.avatar, employeeType: source.employeeType }),
    skills: skillNameList(source.skills),
  };
  const notes = text(source.notes, TEAM_LIMITS.notes);
  if (notes) record.notes = notes;
  return record;
}

/** The preset a member becomes when shared on its own. */
export function presetFromMember(agent, { description = "", notes = "" } = {}) {
  const member = memberExportRecord(agent, { notes });
  if (!member) return null;
  return presetRecord({
    key: `member-${member.key}`,
    name: member.name,
    description: description || member.description,
    role: member.role,
    instructions: member.instructions,
    brainCard: member.brainCard,
    look: member.look,
    skills: member.skills,
    notes: member.notes || "",
  });
}

// --- building a file ---------------------------------------------------------

function dedupeKeys(records) {
  const taken = new Set();
  return records.map((record) => {
    let key = record.key;
    let index = 2;
    while (taken.has(key)) key = `${record.key}-${index++}`;
    taken.add(key);
    return { ...record, key };
  });
}

/**
 * One document from already-selected parts. Applies every limit, lists what
 * did not fit under `skipped`, and redacts every string, listing each change
 * under `redacted`. Returns `{ document, skipped, redacted, summary }`.
 */
export function buildTeamFile({ kind = "team", team = "", description = "", lead = "", members = [], skills = [], channels = [], workflows = [], presets = [], routines = [], connectors = [], exportedAt = new Date().toISOString(), app = "" } = {}) {
  const skipped = [];
  const take = (list, limit, what) => {
    if (list.length <= limit) return list;
    skipped.push({ what, reason: `only the first ${limit} fit in one file`, count: list.length - limit });
    return list.slice(0, limit);
  };
  const memberRecords = dedupeKeys(take(members.map((member) => memberExportRecord(member, { notes: member?.notes })).filter(Boolean), TEAM_LIMITS.members, "members"));
  for (const member of members) {
    if (!member) continue;
    const avatar = String(member.avatar || member.look?.avatar || "");
    if (avatar && !AVATAR_PATH.test(avatar)) skipped.push({ what: `picture of ${member.name}`, reason: "pictures are not in this file format" });
  }
  const seenSkills = new Set();
  const skillRecords = take(
    skills.map(skillExportRecord).filter((skill) => {
      if (!skill || seenSkills.has(skill.name)) return false;
      seenSkills.add(skill.name);
      return true;
    }),
    TEAM_LIMITS.skills,
    "skills"
  );
  const memberNames = new Set(memberRecords.map((member) => member.name.toLowerCase()));
  const channelRecords = take(
    channels
      .map((channel) => channelExportRecord(channel, Array.isArray(channel?.members) ? channel.members : []))
      .filter(Boolean)
      .map((channel) => ({ ...channel, members: channel.members.filter((name) => memberNames.has(name.toLowerCase())) })),
    TEAM_LIMITS.channels,
    "channels"
  );
  const channelNames = new Set(channelRecords.map((channel) => channel.name.toLowerCase()));
  const workflowRecords = take(
    workflows.map((workflow) => workflowExportRecord(workflow)).filter((workflow) => workflow && channelNames.has(workflow.channel.toLowerCase())),
    TEAM_LIMITS.workflows,
    "workflows"
  );
  const presetRecords = dedupeKeys(take(presets.map(presetRecord).filter(Boolean), TEAM_LIMITS.presets, "presets"));
  // A routine names a member in the file; one for anyone else is dropped.
  const routineRecords = take(
    routines.map((routine) => routineExportRecord(routine)).filter((routine) => routine && memberNames.has(routine.member.toLowerCase())),
    TEAM_LIMITS.routines,
    "routines"
  );
  const seenConnectors = new Set();
  const connectorRecords = take(
    connectors.map(connectorExportRecord).filter((connector) => {
      if (!connector || seenConnectors.has(connector.name.toLowerCase())) return false;
      seenConnectors.add(connector.name.toLowerCase());
      return true;
    }),
    TEAM_LIMITS.connectors,
    "connectors"
  );
  const leadName = line(lead, TEAM_LIMITS.name).toLowerCase();
  const leadRecord = leadName ? memberRecords.find((member) => member.name.toLowerCase() === leadName) : null;
  const redacted = [];
  const document = redactDeep(
    {
      format: TEAM_FORMAT,
      version: TEAM_VERSION,
      kind: kind === "preset" ? "preset" : "team",
      team: { name: line(team, TEAM_LIMITS.name) || "Squad", description: line(description), lead: leadRecord ? leadRecord.name : "", exportedAt: line(exportedAt, 40), app: line(app, 80) },
      members: memberRecords,
      skills: skillRecords,
      channels: channelRecords,
      workflows: workflowRecords,
      presets: presetRecords,
      routines: routineRecords,
      connectors: connectorRecords,
    },
    redacted
  );
  return {
    document,
    skipped,
    redacted,
    summary: {
      members: document.members.length,
      skills: document.skills.length,
      channels: document.channels.length,
      workflows: document.workflows.length,
      presets: document.presets.length,
      routines: document.routines.length,
      connectors: document.connectors.length,
      notes: document.members.filter((member) => member.notes).length + document.presets.filter((preset) => preset.notes).length,
    },
  };
}

// --- validating a file ---------------------------------------------------

/**
 * Parse and rebuild a document through the allowlist. `input` may be a JSON
 * string or an object. Returns `{ ok: true, document, warnings }` or
 * `{ ok: false, error }` with one sentence a person can act on. Every limit
 * is a refusal, not a trim: a file that does not fit is not the file the
 * sender wrote.
 */
export function validateTeamFile(input, { maxBytes = TEAM_LIMITS.fileBytes } = {}) {
  let source = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > maxBytes) return { ok: false, error: `This file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than a team file can be.` };
    try {
      source = JSON.parse(input);
    } catch {
      return { ok: false, error: "This file is not JSON. A team file ends in .squad-team.json and was saved by Share team." };
    }
  } else if (isObject(input)) {
    try {
      if (new TextEncoder().encode(JSON.stringify(input)).length > maxBytes) return { ok: false, error: `This file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than a team file can be.` };
    } catch {
      return { ok: false, error: "This file could not be read." };
    }
  }
  if (!isObject(source)) return { ok: false, error: "This file is not a team file." };
  if (source.format !== TEAM_FORMAT) return { ok: false, error: "This file is not a team file: it does not say it is one." };
  if (source.version !== TEAM_VERSION) return { ok: false, error: `This team file is version ${String(source.version)}; this app reads version ${TEAM_VERSION}.` };
  const allowedTop = new Set(["format", "version", "kind", "team", "members", "skills", "channels", "workflows", "presets", "routines", "connectors"]);
  const unknown = Object.keys(source).filter((key) => !allowedTop.has(key));
  if (unknown.length) return { ok: false, error: `This file carries fields a team file has no place for: ${unknown.join(", ")}.` };
  for (const [key, limit] of [["members", TEAM_LIMITS.members], ["skills", TEAM_LIMITS.skills], ["channels", TEAM_LIMITS.channels], ["workflows", TEAM_LIMITS.workflows], ["presets", TEAM_LIMITS.presets], ["routines", TEAM_LIMITS.routines], ["connectors", TEAM_LIMITS.connectors]]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) return { ok: false, error: `"${key}" should be a list.` };
    if (Array.isArray(source[key]) && source[key].length > limit) return { ok: false, error: `This file lists ${source[key].length} ${key}; a team file holds at most ${limit}.` };
  }
  const oversize = [];
  for (const member of source.members || []) {
    if (!isObject(member) || !line(member.name)) return { ok: false, error: "A member in this file has no name." };
    if (typeof member.instructions === "string" && member.instructions.length > TEAM_LIMITS.instructions) oversize.push(`instructions for ${line(member.name)}`);
    if (typeof member.notes === "string" && member.notes.length > TEAM_LIMITS.notes) oversize.push(`notes for ${line(member.name)}`);
    if (Array.isArray(member.skills) && member.skills.length > TEAM_LIMITS.skillsPerMember) oversize.push(`skills on ${line(member.name)}`);
  }
  for (const skill of source.skills || []) {
    if (!isObject(skill) || !line(skill.name)) return { ok: false, error: "A skill in this file has no name." };
    if (typeof skill.text !== "string" || !skill.text.trim()) return { ok: false, error: `Skill ${line(skill.name)} has no SKILL.md text.` };
    if (skill.text.length > TEAM_LIMITS.skillText) oversize.push(`skill ${line(skill.name)}`);
    const extra = Object.keys(skill).filter((key) => !["name", "description", "text"].includes(key));
    if (extra.length) return { ok: false, error: `Skill ${line(skill.name)} carries files other than SKILL.md text (${extra.join(", ")}), which a team file never does.` };
  }
  for (const channel of source.channels || []) {
    if (!isObject(channel) || !line(channel.name)) return { ok: false, error: "A channel in this file has no name." };
  }
  for (const workflow of source.workflows || []) {
    if (!isObject(workflow) || !line(workflow.name)) return { ok: false, error: "A workflow in this file has no name." };
    if (Array.isArray(workflow.steps) && workflow.steps.length > TEAM_LIMITS.stepsPerWorkflow) oversize.push(`workflow ${line(workflow.name)}`);
  }
  for (const routine of source.routines || []) {
    if (!isObject(routine) || !line(routine.title)) return { ok: false, error: "A routine in this file has no title." };
    if (!line(routine.member)) return { ok: false, error: `Routine ${line(routine.title)} names no member.` };
    if (typeof routine.instructions === "string" && routine.instructions.length > TEAM_LIMITS.prompt) oversize.push(`routine ${line(routine.title)}`);
  }
  for (const connector of source.connectors || []) {
    if (!isObject(connector) || !line(connector.name)) return { ok: false, error: "A connector in this file has no name." };
    const extra = Object.keys(connector).filter((key) => !["name", "kind", "note", "url", "transport", "headers", "command", "args", "env"].includes(key));
    if (extra.length) return { ok: false, error: `Connector ${line(connector.name)} carries ${extra.join(", ")}, which a team file never does: a key or token is never in a file.` };
  }
  if (oversize.length) return { ok: false, error: `Too long for a team file: ${oversize.slice(0, 3).join(", ")}${oversize.length > 3 ? ` and ${oversize.length - 3} more` : ""}.` };
  const rebuilt = buildTeamFile({
    kind: source.kind,
    team: isObject(source.team) ? source.team.name : "",
    description: isObject(source.team) ? source.team.description : "",
    lead: isObject(source.team) ? source.team.lead : "",
    members: source.members || [],
    skills: source.skills || [],
    channels: source.channels || [],
    workflows: source.workflows || [],
    presets: source.presets || [],
    routines: source.routines || [],
    connectors: source.connectors || [],
    exportedAt: isObject(source.team) ? source.team.exportedAt : "",
    app: isObject(source.team) ? source.team.app : "",
  });
  if (!rebuilt.document.members.length && !rebuilt.document.presets.length && !rebuilt.document.channels.length && !rebuilt.document.skills.length) {
    return { ok: false, error: "This file has nothing to add: no members, presets, channels or skills." };
  }
  const warnings = rebuilt.redacted.map((entry) => `Something that looked like a ${entry.kinds.join(" or ")} was removed from ${entry.path}.`);
  return { ok: true, document: rebuilt.document, warnings };
}

// --- planning an import ----------------------------------------------------

/** What this file's members look like to the New member screen and `createAgent`. */
export function memberDraftFromRecord(member, name = member.name) {
  return {
    employeeType: "",
    name,
    role: member.role || "Squad member",
    description: member.description || member.role || "Added from a team file.",
    instructions: member.instructions || `Act as ${member.role || "a squad member"}.`,
    brainCard: { ...member.brainCard },
    avatar: member.look?.avatar || "",
    // Skills arrive switched off: the names are kept on the draft so the
    // person can switch them on after reading them.
    skills: [],
    importedSkills: [...member.skills],
    harness: { id: member.harness?.id || "autohand" },
    profileFiles: [],
    notes: member.notes || "",
  };
}

/**
 * Everything an import will create, named so nothing collides with what is
 * already there, and everything it will drop with the reason. Pure, so the
 * review screen and the bridge agree.
 */
export function planImport(document, { existingMemberNames = [], existingChannelNames = [], existingSkillNames = [], existingPresetKeys = [], existingConnectorNames = [] } = {}) {
  const dropped = [];
  const takenMembers = [...existingMemberNames];
  const members = (document.members || []).map((member) => {
    const name = uniqueName(member.name, takenMembers);
    takenMembers.push(name);
    return { key: member.key, originalName: member.name, name, renamed: name !== member.name, draft: memberDraftFromRecord(member, name) };
  });
  const nameByOriginal = new Map(members.map((member) => [member.originalName.toLowerCase(), member]));
  const takenChannels = [...existingChannelNames];
  const channels = (document.channels || []).map((channel) => {
    const name = uniqueName(channel.name, takenChannels, { separator: "-" });
    takenChannels.push(name);
    const resolved = channel.members.map((memberName) => nameByOriginal.get(memberName.toLowerCase())).filter(Boolean);
    for (const memberName of channel.members) {
      if (!nameByOriginal.has(memberName.toLowerCase())) dropped.push({ what: `${memberName} in #${channel.name}`, reason: "no such member in this file" });
    }
    return { originalName: channel.name, name, renamed: name !== channel.name, visibility: channel.visibility, section: channel.section, memberKeys: resolved.map((member) => member.key) };
  });
  const channelByOriginal = new Map(channels.map((channel) => [channel.originalName.toLowerCase(), channel]));
  const workflows = [];
  for (const workflow of document.workflows || []) {
    const channel = channelByOriginal.get(workflow.channel.toLowerCase());
    if (!channel) {
      dropped.push({ what: `workflow ${workflow.name}`, reason: `#${workflow.channel} is not in this file` });
      continue;
    }
    const steps = [];
    for (const step of workflow.steps) {
      if (step.kind === "http") {
        steps.push({ ...step });
        continue;
      }
      const member = nameByOriginal.get(step.member.toLowerCase());
      if (!member) {
        dropped.push({ what: `a step of ${workflow.name}`, reason: `${step.member} is not in this file` });
        continue;
      }
      steps.push({ ...step, memberKey: member.key });
    }
    if (!steps.length) {
      dropped.push({ what: `workflow ${workflow.name}`, reason: "none of its steps could be kept" });
      continue;
    }
    workflows.push({ channelOriginalName: workflow.channel, channelName: channel.name, name: workflow.name, dispatch: workflow.dispatch, trigger: workflow.trigger, steps, enabled: false });
  }
  const existingSkills = new Set(existingSkillNames.map((name) => String(name).toLowerCase()));
  const skills = (document.skills || []).map((skill) => ({ name: skill.name, description: skill.description, text: skill.text, action: existingSkills.has(skill.name.toLowerCase()) ? "keep" : "add" }));
  const existingPresets = new Set(existingPresetKeys);
  const presets = presetsFromDocument(document).map((preset) => ({ ...preset, action: existingPresets.has(preset.key) ? "keep" : "add" }));
  // Routines (ADR-0110) bind to a member in the file and arrive paused.
  const routines = [];
  for (const routine of document.routines || []) {
    const member = nameByOriginal.get(routine.member.toLowerCase());
    if (!member) {
      dropped.push({ what: `routine ${routine.title}`, reason: `${routine.member} is not in this file` });
      continue;
    }
    routines.push({ memberKey: member.key, memberName: member.name, title: routine.title, instructions: routine.instructions, schedule: { ...routine.schedule }, maxRunMinutes: routine.maxRunMinutes || 0, enabled: false });
  }
  // Connectors (ADR-0107) are saved off; one with a name already here is kept.
  const existingConnectors = new Set(existingConnectorNames.map((name) => String(name).trim().toLowerCase()));
  const connectors = (document.connectors || []).map((connector) => ({ ...connector, action: connector.kind === "builtin" || existingConnectors.has(connector.name.toLowerCase()) ? "keep" : "add" }));
  const leadName = String(document.team?.lead || "").toLowerCase();
  const lead = leadName ? nameByOriginal.get(leadName) || null : null;
  return {
    kind: document.kind || "team",
    team: document.team?.name || "Squad",
    description: document.team?.description || "",
    lead: lead ? { key: lead.key, name: lead.name } : null,
    members,
    channels,
    workflows,
    skills,
    presets,
    routines,
    connectors,
    dropped,
  };
}

/** The presets a file offers New member: its own, plus each member as one. */
export function presetsFromDocument(document) {
  const seen = new Set();
  const out = [];
  for (const preset of [
    ...(document.presets || []),
    ...(document.members || []).map((member) => presetFromMember({ ...member, key: member.key, avatar: member.look?.avatar, employeeType: member.look?.employeeType })),
  ]) {
    const record = presetRecord(preset);
    if (!record || seen.has(record.key)) continue;
    seen.add(record.key);
    out.push(record);
  }
  return out;
}

/** A stored preset as a role the New member screen can list. */
export function presetTemplate(preset) {
  const record = presetRecord(preset);
  if (!record) return null;
  return {
    id: `preset-${record.key}`,
    title: record.role,
    label: "Imported preset",
    accent: "blue",
    avatar: record.look.avatar,
    description: record.description || record.name,
    starter: record.instructions || `Act as ${record.role}.`,
    // Switched off until the person turns them on; the names are kept so the
    // form can say which ones the preset came with.
    skills: [],
    presetSkills: [...record.skills],
    presetName: record.name,
    brainCard: { ...record.brainCard },
    profileFiles: [],
    preset: true,
  };
}
