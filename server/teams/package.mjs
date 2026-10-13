// The bridge's half of a team file: what only the bridge can read or write.
//
// Members live in the browser, so the request brings them. Skill text lives
// in each member's home (`<agentsDir>/<id>/skills/<name>/SKILL.md`), starter
// notes in `<agentsDir>/<id>/profile/MEMORY.md`, channels in channels.json
// and workflows in channel-workflows.json: those are read here. On import,
// skills are written to `<squadStateDir>/skills`, a local skill root, so a
// member can install one by name later; presets go to presets.json.
//
// Only SKILL.md text is ever read from a skill folder. Other files in it
// (scripts, data) never leave the machine.
// See docs/adrs/ADR-0106-team-sharing-presets-and-member-menus.md.

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { readSkillFrontmatter } from "../skills/local.mjs";
import { STORE_FILE as WORKFLOW_STORE_FILE, importWorkflows, removeChannelWorkflows } from "../routes/workflows.route.mjs";
import { TEAM_LIMITS, buildTeamFile, planImport, presetFileName, presetFromMember, presetRecord, slug, teamFileName } from "../../src/lib/teams.js";

export const PRESETS_FILE = "presets.json";
export const IMPORTED_SKILLS_DIR = "skills";

function safeId(value) {
  const safe = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "";
}

function memberHome(ctx, memberId) {
  const id = safeId(memberId);
  return id && ctx.agentsDir ? join(ctx.agentsDir, id) : "";
}

// --- reading what the bridge holds -----------------------------------------

/** `{ name, description, text }` for each named skill installed in a member's home. */
export async function readMemberSkills(ctx, memberId, names = []) {
  const home = memberHome(ctx, memberId);
  if (!home) return [];
  const out = [];
  for (const name of names.slice(0, TEAM_LIMITS.skillsPerMember)) {
    const id = safeId(name);
    if (!id) continue;
    const path = join(home, "skills", id, "SKILL.md");
    if (!existsSync(path)) continue;
    try {
      const text = await readFile(path, "utf8");
      const frontmatter = readSkillFrontmatter(text);
      out.push({ name: id, description: frontmatter?.description || "", text });
    } catch {
      // A skill that cannot be read is a skill that is not in the file.
    }
  }
  return out;
}

/** A member's MEMORY.md, or "" when it has none. */
export async function readMemberNotes(ctx, memberId) {
  const home = memberHome(ctx, memberId);
  if (!home) return "";
  const path = join(home, "profile", "MEMORY.md");
  if (!existsSync(path)) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function readWorkflowStore(ctx) {
  const saved = await ctx.readOptionalJsonFile(join(ctx.squadStateDir, WORKFLOW_STORE_FILE));
  return saved?.channels && typeof saved.channels === "object" ? saved.channels : {};
}

/**
 * The file for a selection: `members` are the browser's member records,
 * `include.skills` the skill names to carry ("all" for every selected
 * member's), `include.channels`, `include.workflows`, `include.notes` switch
 * the bridge-side parts. Returns `{ document, filename, summary, skipped,
 * redacted }`; nothing is written anywhere.
 */
export async function assembleTeamExport(ctx, body = {}) {
  const source = body && typeof body === "object" ? body : {};
  const include = source.include && typeof source.include === "object" ? source.include : {};
  const members = (Array.isArray(source.members) ? source.members : []).filter((member) => member && typeof member === "object" && String(member.name || "").trim()).slice(0, TEAM_LIMITS.members);
  const wantedSkills = include.skills === "all" ? null : new Set((Array.isArray(include.skills) ? include.skills : []).map((name) => safeId(name)).filter(Boolean));
  const memberRecords = [];
  const skills = [];
  const seenSkills = new Set();
  for (const member of members) {
    const names = (Array.isArray(member.skills) ? member.skills : []).map(safeId).filter(Boolean);
    const carried = names.filter((name) => wantedSkills === null || wantedSkills.has(name));
    for (const skill of await readMemberSkills(ctx, member.id, carried)) {
      if (seenSkills.has(skill.name)) continue;
      seenSkills.add(skill.name);
      skills.push(skill);
    }
    memberRecords.push({
      ...member,
      skills: carried,
      notes: include.notes ? await readMemberNotes(ctx, member.id) : "",
    });
  }
  const memberNameById = new Map(members.map((member) => [String(member.id), String(member.name).trim()]));
  const channels = [];
  const workflows = [];
  if (include.channels !== false) {
    const state = await ctx.readChannelsState();
    const wantedChannels = Array.isArray(include.channelIds) ? new Set(include.channelIds.map(String)) : null;
    for (const channel of state?.channels || []) {
      if (wantedChannels && !wantedChannels.has(String(channel.id))) continue;
      channels.push({
        name: channel.name,
        visibility: channel.visibility,
        section: channel.section,
        members: (channel.memberIds || []).map((id) => memberNameById.get(String(id))).filter(Boolean),
      });
    }
    if (include.workflows !== false) {
      const store = await readWorkflowStore(ctx);
      const channelNameById = new Map((state?.channels || []).map((channel) => [String(channel.id), channel.name]));
      for (const [channelId, list] of Object.entries(store)) {
        const channelName = channelNameById.get(channelId);
        if (!channelName || (wantedChannels && !wantedChannels.has(channelId))) continue;
        for (const workflow of Array.isArray(list) ? list : []) {
          workflows.push({
            ...workflow,
            channel: channelName,
            steps: (workflow.steps || []).map((step) => ({ ...step, member: memberNameById.get(String(step.memberId || "")) || "" })),
          });
        }
      }
    }
  }
  const presets = (Array.isArray(source.presets) ? source.presets : []).map(presetRecord).filter(Boolean);
  const teamName = String(source.team || "").trim() || "Squad";
  const built = buildTeamFile({
    kind: "team",
    team: teamName,
    members: memberRecords,
    skills,
    channels,
    workflows,
    presets,
    exportedAt: new Date().toISOString(),
    app: `autohand-squad ${ctx.packageMetadata?.version || ""}`.trim(),
  });
  return { ...built, filename: teamFileName(teamName, new Date()) };
}

/** A preset file for one member: the preset and its skills text, no team. */
export async function assemblePresetExport(ctx, body = {}) {
  const source = body && typeof body === "object" ? body : {};
  const member = source.member && typeof source.member === "object" ? source.member : null;
  if (!member || !String(member.name || "").trim()) throw Object.assign(new Error("Say which member to share as a preset."), { status: 400 });
  const names = (Array.isArray(member.skills) ? member.skills : []).map(safeId).filter(Boolean);
  const wanted = Array.isArray(source.skills) ? new Set(source.skills.map(safeId)) : null;
  const carried = names.filter((name) => wanted === null || wanted.has(name));
  const skills = await readMemberSkills(ctx, member.id, carried);
  const notes = source.notes ? await readMemberNotes(ctx, member.id) : "";
  const presetName = String(source.presetName || member.name || "").trim();
  const preset = presetFromMember({ ...member, name: presetName, skills: carried }, { description: String(source.description || "").trim(), notes });
  const built = buildTeamFile({
    kind: "preset",
    team: presetName,
    members: [],
    skills,
    channels: [],
    workflows: [],
    presets: preset ? [preset] : [],
    exportedAt: new Date().toISOString(),
    app: `autohand-squad ${ctx.packageMetadata?.version || ""}`.trim(),
  });
  return { ...built, filename: presetFileName(presetName, new Date()) };
}

// --- presets.json ----------------------------------------------------------

function presetsPath(ctx) {
  return join(ctx.squadStateDir, PRESETS_FILE);
}

export async function readPresets(ctx) {
  const saved = await ctx.readOptionalJsonFile(presetsPath(ctx));
  const list = Array.isArray(saved?.presets) ? saved.presets : [];
  return list
    .map((entry) => {
      const preset = presetRecord(entry?.preset);
      return preset && typeof entry?.id === "string" ? { id: entry.id, key: preset.key, source: entry.source === "file" ? "file" : "file", packageName: String(entry.packageName || ""), addedAt: String(entry.addedAt || ""), preset } : null;
    })
    .filter(Boolean)
    .slice(0, TEAM_LIMITS.presets * 5);
}

/** Add presets; one with a key already stored is kept as it was. Returns `{ added, kept }`. */
export async function addPresets(ctx, presets = [], { packageName = "" } = {}) {
  const current = await readPresets(ctx);
  const byKey = new Map(current.map((entry) => [entry.key, entry]));
  const added = [];
  const kept = [];
  for (const input of presets) {
    const preset = presetRecord(input);
    if (!preset) continue;
    if (byKey.has(preset.key)) {
      kept.push(byKey.get(preset.key));
      continue;
    }
    const entry = { id: `preset_${randomUUID().slice(0, 8)}`, key: preset.key, source: "file", packageName: String(packageName || ""), addedAt: new Date().toISOString(), preset };
    byKey.set(preset.key, entry);
    added.push(entry);
  }
  if (added.length) await ctx.writeJsonFile(presetsPath(ctx), { version: 1, presets: [...byKey.values()] });
  return { added, kept };
}

export async function removePreset(ctx, id) {
  const current = await readPresets(ctx);
  const next = current.filter((entry) => entry.id !== id);
  if (next.length === current.length) return null;
  await ctx.writeJsonFile(presetsPath(ctx), { version: 1, presets: next });
  return current.find((entry) => entry.id === id) || null;
}

// --- imported skills -------------------------------------------------------

function importedSkillsDir(ctx) {
  return join(ctx.squadStateDir, IMPORTED_SKILLS_DIR);
}

export async function listImportedSkillNames(ctx) {
  const dir = importedSkillsDir(ctx);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md"))).map((entry) => entry.name);
}

/** Write SKILL.md text for each skill that is not already there. Returns `{ added, kept }` names. */
export async function writeImportedSkills(ctx, skills = []) {
  const dir = importedSkillsDir(ctx);
  const added = [];
  const kept = [];
  for (const skill of skills) {
    const name = safeId(skill?.name);
    const body = typeof skill?.text === "string" ? skill.text.trim() : "";
    if (!name || !body) continue;
    const target = join(dir, name);
    if (existsSync(join(target, "SKILL.md"))) {
      kept.push(name);
      continue;
    }
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), `${body}\n`, "utf8");
    added.push(name);
  }
  return { added, kept };
}

// --- channels and workflows --------------------------------------------------

/**
 * Create the plan's channels in one channel-store mutation (all or none),
 * then its workflows (paused). If any workflow fails, the channels and the
 * workflows already written are removed again, so the bridge side is whole
 * or absent. `memberIds` maps a member key from the file to the id the
 * browser created it with; keys without an id are left out of membership.
 */
export async function createChannelsAndWorkflows(ctx, plan, memberIds = {}) {
  const idFor = (key) => String(memberIds?.[key] || "").trim();
  const requested = plan.channels.map((channel) => ({
    id: `channel-${randomUUID()}`,
    requestedName: channel.name,
    visibility: channel.visibility,
    section: channel.section,
    memberIds: channel.memberKeys.map(idFor).filter(Boolean),
  }));
  const created = requested.length
    ? await ctx.mutateChannelsState((state) => {
        const taken = new Set(state.channels.map((item) => String(item.name || "").toLowerCase()));
        const out = [];
        for (const channel of requested) {
          let name = channel.requestedName;
          let index = 2;
          while (taken.has(name.toLowerCase())) name = `${channel.requestedName}-${index++}`;
          taken.add(name.toLowerCase());
          const now = new Date().toISOString();
          state.channels.push({ id: channel.id, name, visibility: channel.visibility, section: channel.section, memberIds: channel.memberIds, projects: [], creatorId: "team-import", createdAt: now, updatedAt: now });
          out.push({ id: channel.id, name, requestedName: channel.requestedName, memberIds: channel.memberIds });
        }
        return out;
      })
    : [];
  const channelIdByOriginal = new Map(plan.channels.map((channel, index) => [channel.originalName.toLowerCase(), created[index]?.id]));
  const workflows = [];
  try {
    const byChannel = new Map();
    for (const workflow of plan.workflows) {
      const channelId = channelIdByOriginal.get(workflow.channelOriginalName.toLowerCase());
      if (!channelId) continue;
      const steps = workflow.steps.map((step) =>
        step.kind === "http"
          ? { id: step.id, kind: "http", when: step.when, approval: step.approval, url: step.url, method: step.method, headers: step.headers, body: step.body }
          : { id: step.id, kind: "member", when: step.when, approval: step.approval, memberId: idFor(step.memberKey), prompt: step.prompt }
      ).filter((step) => step.kind === "http" || step.memberId);
      if (!steps.length) continue;
      if (!byChannel.has(channelId)) byChannel.set(channelId, []);
      byChannel.get(channelId).push({ name: workflow.name, dispatch: workflow.dispatch, trigger: workflow.trigger, steps, enabled: false });
    }
    for (const [channelId, list] of byChannel) {
      for (const workflow of await importWorkflows(ctx, channelId, list)) workflows.push({ id: workflow.id, name: workflow.name, channelId, enabled: workflow.enabled });
    }
  } catch (error) {
    for (const channel of created) await removeChannelWorkflows(ctx, channel.id).catch(() => {});
    if (created.length) {
      const ids = new Set(created.map((channel) => channel.id));
      await ctx.mutateChannelsState((state) => {
        state.channels = state.channels.filter((item) => !ids.has(item.id));
      }).catch(() => {});
    }
    throw Object.assign(new Error(`Nothing was added: ${error.message}`), { status: 400 });
  }
  return { channels: created, workflows };
}

/** The review a file gets before anything is created. */
export async function planTeamImport(ctx, document, { existingMemberNames = [] } = {}) {
  const state = await ctx.readChannelsState();
  const presets = await readPresets(ctx);
  return planImport(document, {
    existingMemberNames,
    existingChannelNames: (state?.channels || []).map((channel) => channel.name),
    existingSkillNames: await listImportedSkillNames(ctx),
    existingPresetKeys: presets.map((entry) => entry.key),
  });
}

export { slug };
