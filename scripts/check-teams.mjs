#!/usr/bin/env node
// Team sharing, presets and the member menu (ADR-0106).
//
// Pure checks first: the secret detector, the team file allowlist and
// validator, the import plan, and the member menu's state rules (pin order,
// hidden group, unread marking, duplicate stash). Then a real bridge in an
// isolated state directory: a member home is seeded with a skill and a
// MEMORY.md holding an `sk-…` token and a password line, channels and a
// webhook workflow are created through their own routes, and the export is
// shown to carry exactly the allowed fields and none of the secrets. The
// file is then imported: channels and paused workflows appear, skills land
// in the squad skills folder, presets round-trip, duplicate names get a
// suffix, and an oversized, malformed or half-valid file is refused with a
// message and leaves nothing behind.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SECRET_MARKER, containsSecret, redactSecrets, redactDeep, scanSecrets } from "../src/lib/secret-scan.js";
import { TEAM_FORMAT, TEAM_LIMITS, TEAM_VERSION, buildTeamFile, memberExportRecord, planImport, presetFromMember, presetTemplate, presetsFromDocument, teamFileName, uniqueName, validateTeamFile } from "../src/lib/teams.js";
import { createMemberId, duplicateCreationStash, hiddenMembers, hidePatch, markUnreadReadAt, orderMembers, pinPatch, unreadCount } from "../src/lib/member-menus.js";
import { startBridge } from "./lib/reliability-browser.mjs";

const TOKEN = "sk-live-4f8a9b2c1d0e3f6a7b8c9d0e1f2a3b4c";
const PASSWORD = "hunter2-very-secret";

// ---------------------------------------------------------------------------
// Secret detector

{
  const note = `Deploy notes.\nAPI key: ${TOKEN}\npassword: ${PASSWORD}\nhttps://bob:pw1234@example.test/x\nBearer abcdefghijklmnopqrstuvwxyz012345\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\nAKIAABCDEFGHIJKLMNOP\n`;
  assert.ok(containsSecret(note));
  const kinds = new Set(scanSecrets(note).map((hit) => hit.kind));
  for (const kind of ["API key", "password or key line", "URL credential", "token", "private key"]) assert.ok(kinds.has(kind), `detects a ${kind}`);
  const { text, count } = redactSecrets(note);
  assert.ok(count >= 6, `redacts every hit (${count})`);
  assert.ok(!text.includes(TOKEN) && !text.includes(PASSWORD) && !text.includes("pw1234") && !text.includes("MIIE"), "nothing secret survives");
  assert.ok(text.includes(SECRET_MARKER) && text.includes("password:"), "the label stays, the value goes");
  assert.equal(redactSecrets(text).count, 0, "redaction is idempotent");
  const benign = "Act as a QA engineer. Run `bun run check:jsx` first, then open a PR against main-2024. See https://example.test/docs?page=2.";
  assert.equal(redactSecrets(benign).count, 0, "ordinary instructions are left alone");
  const report = [];
  const deep = redactDeep({ members: [{ name: "Iris", notes: `token=${TOKEN}` }] }, report);
  assert.equal(deep.members[0].name, "Iris");
  assert.ok(!JSON.stringify(deep).includes(TOKEN));
  assert.equal(report[0].path, "members[0].notes");
}

// ---------------------------------------------------------------------------
// The allowlist

const iris = {
  id: "asq_iris",
  name: "Iris",
  role: "QA Engineer",
  description: "Owns regression testing.",
  instructions: "Act as QA Engineer. Keep the suite green.",
  brainCard: { purpose: "Tests", defaultWorkflow: "Run checks", allowedTools: "Shell", escalationRules: "Ask", definitionOfDone: "Green", reviewStyle: "Direct", memoryPolicy: "Keep decisions", whyThisAgent: "secret-ish internal" },
  avatar: "/avatars/qa-engineer.jpg",
  employeeType: "qa-engineer",
  skills: ["review-notes", "Review Notes", "e2e-tests"],
  harness: { id: "codex", executablePath: "/Users/someone/.local/bin/codex", model: "gpt-x" },
  permissions: { ladderLevel: "open-pr", modelSecurity: { provider: "x" } },
  workspace: "/Users/someone/projects/app",
  projects: [{ path: "/Users/someone/projects/app" }],
  modelAssignment: { mode: "override", model: "gpt" },
  memory: ["remember this"],
  profileFiles: [{ section: "persona", content: "x" }],
};

{
  const record = memberExportRecord(iris);
  assert.deepEqual(Object.keys(record).sort(), ["brainCard", "description", "harness", "instructions", "key", "look", "name", "role", "skills"]);
  assert.deepEqual(record.skills, ["review-notes", "e2e-tests"], "skill names are slugs, deduplicated");
  assert.deepEqual(record.harness, { id: "codex" }, "only the harness id travels");
  assert.deepEqual(record.look, { avatar: "/avatars/qa-engineer.jpg", employeeType: "qa-engineer" });
  assert.equal(record.brainCard.whyThisAgent, undefined, "only the seven brain card fields");
  assert.equal(memberExportRecord({ ...iris, avatar: "data:image/png;base64,AAAA" }).look.avatar, "", "a data URL picture is not a look");
  assert.equal(memberExportRecord({ name: "   " }), null);
}

const built = buildTeamFile({
  team: "Release crew",
  members: [iris, { ...iris, id: "asq_noah", name: "Noah", avatar: "data:image/png;base64,AAAA", notes: `Noah's notes\npassword: ${PASSWORD}` }],
  skills: [{ name: "review-notes", description: "Review", text: `---\nname: review-notes\n---\nUse ${TOKEN} to fetch.`, files: ["extra.sh"] }, { name: "review-notes", text: "duplicate" }],
  channels: [{ name: "release", visibility: "private", section: "Engineering", members: ["Iris", "Noah", "Ghost"] }],
  workflows: [{ channel: "release", name: "Smoke", trigger: { type: "webhook", token: "wh_secret_token_value_123456" }, steps: [{ member: "Iris", prompt: "Run smoke" }, { kind: "http", url: "https://example.test/hook", headers: [{ name: "Authorization", value: "Bearer abc" }] }] }, { channel: "nowhere", name: "Orphan", steps: [{ member: "Iris", prompt: "x" }] }],
  presets: [],
  exportedAt: "2026-10-13T10:00:00.000Z",
  app: "autohand-squad 0.1.6",
});

{
  const { document, skipped, redacted, summary } = built;
  assert.equal(document.format, TEAM_FORMAT);
  assert.equal(document.version, TEAM_VERSION);
  assert.deepEqual(Object.keys(document).sort(), ["channels", "connectors", "format", "kind", "members", "presets", "routines", "skills", "team", "version", "workflows"]);
  const serialized = JSON.stringify(document);
  for (const forbidden of [TOKEN, PASSWORD, "wh_secret_token_value", "Bearer abc", "/Users/someone", "ladderLevel", "modelAssignment", "executablePath", '"projects"', '"memory"', "extra.sh"]) {
    assert.ok(!serialized.includes(forbidden), `the file never carries ${forbidden}`);
  }
  assert.equal(document.skills.length, 1, "one skill per name");
  assert.deepEqual(Object.keys(document.skills[0]).sort(), ["description", "name", "text"], "SKILL.md text only");
  assert.deepEqual(document.channels[0].members, ["Iris", "Noah"], "a channel lists only members in the file");
  assert.equal(document.workflows.length, 1, "a workflow whose channel is not in the file is dropped");
  assert.deepEqual(Object.keys(document.workflows[0].trigger).sort(), ["cron", "emoji", "pattern", "type"], "no webhook token");
  assert.deepEqual(document.workflows[0].steps[1].headers, [{ name: "Authorization", value: "" }], "header names travel, values do not");
  assert.ok(skipped.some((entry) => entry.what === "picture of Noah"), "a dropped picture is listed");
  assert.ok(redacted.length >= 2, "redactions are listed by path");
  assert.equal(summary.notes, 1);
  assert.equal(teamFileName("Release crew", new Date("2026-10-13T10:00:00Z")), "release-crew-2026-10-13.squad-team.json");
}

// ---------------------------------------------------------------------------
// Validation

{
  assert.equal(validateTeamFile(JSON.stringify(built.document)).ok, true, "a built file validates");
  assert.equal(validateTeamFile("not json").ok, false);
  assert.match(validateTeamFile({ format: "other" }).error, /not a team file/);
  assert.match(validateTeamFile({ format: TEAM_FORMAT, version: 2 }).error, /version 2/);
  assert.match(validateTeamFile({ ...built.document, conversations: [] }).error, /no place for: conversations/);
  assert.match(validateTeamFile({ ...built.document, members: Array.from({ length: TEAM_LIMITS.members + 1 }, (_, index) => ({ name: `M${index}` })) }).error, /at most 50/);
  assert.match(validateTeamFile({ ...built.document, members: [{ name: "Big", instructions: "x".repeat(TEAM_LIMITS.instructions + 1) }] }).error, /Too long/);
  assert.match(validateTeamFile({ ...built.document, skills: [{ name: "s", text: "t", files: {} }] }).error, /files other than SKILL.md/);
  assert.match(validateTeamFile("x".repeat(TEAM_LIMITS.fileBytes + 1)).error, /larger than 4 MB/);
  assert.match(validateTeamFile({ format: TEAM_FORMAT, version: 1, members: [], skills: [] }).error, /nothing to add/);
  const validated = validateTeamFile({ ...built.document, members: [{ ...built.document.members[0], permissions: { ladderLevel: "open-pr" }, instructions: `Use ${TOKEN}` }] });
  assert.equal(validated.ok, true);
  assert.equal(validated.document.members[0].permissions, undefined, "unknown member fields are rebuilt away");
  assert.ok(!validated.document.members[0].instructions.includes(TOKEN), "an imported file is redacted too");
  assert.equal(validated.warnings.length, 1);
}

// ---------------------------------------------------------------------------
// Planning an import

{
  const plan = planImport(built.document, { existingMemberNames: ["iris"], existingChannelNames: ["Release"], existingSkillNames: [], existingPresetKeys: [] });
  assert.equal(plan.members[0].name, "Iris 2", "a taken member name gets a suffix");
  assert.equal(plan.members[0].renamed, true);
  assert.equal(plan.members[1].name, "Noah");
  assert.equal(plan.channels[0].name, "release-2", "a taken channel name gets a suffix");
  assert.deepEqual(plan.channels[0].memberKeys, ["iris", "noah"]);
  assert.equal(plan.workflows[0].enabled, false, "workflows arrive paused");
  assert.equal(plan.workflows[0].steps[0].memberKey, "iris");
  assert.deepEqual(plan.members[0].draft.skills, [], "skills start switched off");
  assert.deepEqual(plan.members[0].draft.importedSkills, ["review-notes", "e2e-tests"]);
  assert.equal(plan.members[0].draft.harness.id, "codex");
  assert.equal(plan.skills[0].action, "add");
  assert.equal(plan.presets.length, 2, "each member is offered as a preset");
  assert.equal(uniqueName("Iris", ["Iris", "Iris 2"]), "Iris 3");
  const template = presetTemplate(presetsFromDocument(built.document)[0]);
  assert.equal(template.id, "preset-member-iris");
  assert.equal(template.label, "Imported preset");
  assert.equal(template.title, "QA Engineer");
  assert.deepEqual(template.skills, [], "a preset's skills are off until switched on");
  assert.deepEqual(template.presetSkills, ["review-notes", "e2e-tests"]);
  assert.equal(presetFromMember(iris).key, "member-iris");
}

// ---------------------------------------------------------------------------
// Member menu state

{
  const agents = [{ id: "a", name: "A" }, { id: "b", name: "B", ...pinPatch(null, true, "2026-10-13T10:00:02Z") }, { id: "c", name: "C", ...hidePatch(null, true) }, { id: "d", name: "D", ...pinPatch(null, true, "2026-10-13T10:00:01Z") }];
  assert.deepEqual(orderMembers(agents).map((agent) => agent.id), ["d", "b", "a"], "pinned first in pin order, hidden left out");
  assert.deepEqual(hiddenMembers(agents).map((agent) => agent.id), ["c"]);
  assert.equal(hidePatch({ pinned: true }, true).pinned, false, "hiding unpins");
  assert.equal(orderMembers([{ ...agents[1], ...pinPatch(null, false) }, agents[0]]).map((agent) => agent.id).join(","), "b,a", "unpinning keeps list order");
  const messages = [
    { id: "u1", role: "user", body: "hi", createdAt: "2026-10-13T10:00:00Z" },
    { id: "r1", role: "agent", body: "hello", status: "complete", completedAt: "2026-10-13T10:00:05Z" },
    { id: "r2", role: "agent", body: "", status: "loading", startedAt: "2026-10-13T10:00:09Z" },
  ];
  const readAt = "2026-10-13T10:00:06Z";
  assert.equal(unreadCount(messages, readAt), 0, "read");
  const marked = markUnreadReadAt(messages);
  assert.equal(marked, "2026-10-13T10:00:04.999Z", "one millisecond before the latest finished reply");
  assert.equal(unreadCount(messages, marked), 1, "marking unread counts exactly like a new reply");
  assert.equal(markUnreadReadAt([messages[0], messages[2]]), "", "nothing to mark without a finished reply");
  assert.match(createMemberId(), /^asq_[a-z0-9]+$/);
  const stash = duplicateCreationStash(iris, { memberId: "asq_copy1", now: 1 });
  assert.equal(stash.version, 1);
  assert.equal(stash.memberId, "asq_copy1");
  assert.ok(stash.templateId.startsWith("custom-role-"), "the copy is a custom role the create form already knows how to restore");
  assert.equal(stash.customTemplates[0].id, stash.templateId);
  for (const field of ["name", "role", "description", "instructions"]) assert.equal(typeof stash.draft[field], "string");
  assert.equal(stash.draft.name, "Iris copy");
  assert.equal(stash.draft.role, "QA Engineer");
  assert.equal(stash.draft.instructions, iris.instructions);
  assert.deepEqual(stash.draft.skills, ["review-notes", "Review Notes", "e2e-tests"]);
  assert.equal(stash.draft.brainCard.purpose, "Tests");
  assert.equal(stash.draft.harness.id, "codex");
  assert.equal(stash.draft.profileFiles[0].content, "x");
  assert.equal(stash.preparing, false);
}

console.log("teams: pure checks passed");

// ---------------------------------------------------------------------------
// The real bridge

const bridge = await startBridge({
  prepare: async (directory) => {
    const home = join(directory, "app", "agents", "asq_iris");
    await mkdir(join(home, "skills", "review-notes"), { recursive: true });
    await mkdir(join(home, "skills", "private-tool"), { recursive: true });
    await mkdir(join(home, "profile"), { recursive: true });
    await writeFile(join(home, "skills", "review-notes", "SKILL.md"), `---\nname: review-notes\ndescription: Review release notes.\n---\nRead the notes. Never paste ${TOKEN} anywhere.\n`);
    await writeFile(join(home, "skills", "review-notes", "helper.sh"), "#!/bin/sh\necho never shared\n");
    await writeFile(join(home, "skills", "private-tool", "SKILL.md"), "---\nname: private-tool\n---\nStays home.\n");
    await writeFile(join(home, "profile", "MEMORY.md"), `# Memory\n- Prefers small PRs.\n- password: ${PASSWORD}\n- api key ${TOKEN}\n`);
    return {};
  },
});

try {
  const release = (await bridge.api("/api/channels", "POST", { name: "release", visibility: "private", section: "Engineering", memberIds: ["asq_iris", "asq_noah"], projects: [{ name: "app", path: process.cwd() }] })).data;
  const workflow = await bridge.api(`/api/channels/${release.id}/workflows`, "POST", { name: "Smoke on webhook", trigger: { type: "webhook" }, steps: [{ memberId: "asq_iris", prompt: "Run the smoke suite" }] });
  assert.equal(workflow.status, 201, JSON.stringify(workflow));
  assert.ok(workflow.data.trigger.token, "the live workflow has a webhook token");

  const members = [
    iris,
    { ...iris, id: "asq_noah", name: "Noah", role: "Backend Engineer", skills: [], harness: { id: "autohand" } },
  ];
  const exported = await bridge.api("/api/teams/export", "POST", { team: "Release crew", members, include: { skills: "all", channels: true, workflows: true, notes: true } });
  assert.equal(exported.status, 200, JSON.stringify(exported));
  const { document, filename, summary, redacted } = exported.data;
  assert.match(filename, /^release-crew-\d{4}-\d{2}-\d{2}\.squad-team\.json$/);
  assert.deepEqual(Object.keys(document).sort(), ["channels", "connectors", "format", "kind", "members", "presets", "routines", "skills", "team", "version", "workflows"]);
  assert.deepEqual(Object.keys(document.members[0]).sort(), ["brainCard", "description", "harness", "instructions", "key", "look", "name", "notes", "role", "skills"], "exactly the allowed member fields");
  const serialized = JSON.stringify(document);
  for (const forbidden of [TOKEN, PASSWORD, workflow.data.trigger.token, "/Users/someone", "ladderLevel", "executablePath", process.cwd(), "helper.sh", "never shared", "private-tool"]) {
    assert.ok(!serialized.includes(forbidden), `the exported file never carries ${forbidden}`);
  }
  assert.ok(document.members[0].notes.includes("Prefers small PRs"), "starter notes travel when asked for");
  assert.ok(document.members[0].notes.includes(SECRET_MARKER), "the note's secrets became markers");
  assert.equal(document.skills.length, 1, "only the selected member's named skills, SKILL.md text only");
  assert.equal(document.skills[0].name, "review-notes");
  assert.ok(document.skills[0].text.includes(SECRET_MARKER));
  assert.deepEqual(document.channels, [{ name: "release", visibility: "private", section: "Engineering", members: ["Iris", "Noah"] }], "channels carry name, visibility, section and member names; no folders");
  assert.equal(document.workflows[0].channel, "release");
  assert.equal(document.workflows[0].steps[0].member, "Iris");
  assert.equal(document.workflows[0].trigger.type, "webhook");
  assert.deepEqual(summary, { members: 2, skills: 1, channels: 1, workflows: 1, presets: 0, routines: 0, connectors: 0, notes: 1 });
  assert.ok(redacted.length >= 2, `the export reports what it changed (${redacted.length})`);

  // Notes stay home unless asked for; skills can be chosen by name.
  const quiet = (await bridge.api("/api/teams/export", "POST", { team: "Quiet", members, include: { skills: [], channels: false, notes: false } })).data;
  assert.equal(quiet.document.members[0].notes, undefined);
  assert.equal(quiet.document.skills.length, 0);
  assert.equal(quiet.document.channels.length, 0);
  assert.equal(quiet.document.workflows.length, 0);

  // The plan names everything that will be created and what collides.
  const planned = await bridge.api("/api/teams/import/plan", "POST", { document, existingMemberNames: ["Iris"] });
  assert.equal(planned.status, 200, JSON.stringify(planned));
  assert.equal(planned.data.plan.members[0].name, "Iris 2");
  assert.equal(planned.data.plan.channels[0].name, "release-2");
  assert.equal(planned.data.plan.channels[0].renamed, true);

  // Import: channels and paused workflows on the bridge, members handed back.
  const memberIds = { iris: "asq_iris_2", noah: "asq_noah_2" };
  const imported = await bridge.api("/api/teams/import", "POST", { document, existingMemberNames: ["Iris"], memberIds });
  assert.equal(imported.status, 201, JSON.stringify(imported));
  assert.equal(imported.data.members.length, 2, "the members to create come back");
  assert.equal(imported.data.members[0].draft.name, "Iris 2");
  assert.deepEqual(imported.data.members[0].draft.skills, []);
  assert.equal(imported.data.channels.length, 1);
  assert.equal(imported.data.channels[0].name, "release-2");
  const channelsNow = (await bridge.api("/api/channels")).data.channels;
  const createdChannel = channelsNow.find((channel) => channel.id === imported.data.channels[0].id);
  assert.ok(createdChannel, "the channel exists in channels.json");
  assert.deepEqual(createdChannel.memberIds, ["asq_iris_2", "asq_noah_2"]);
  assert.equal(createdChannel.visibility, "private");
  assert.equal(createdChannel.section, "Engineering");
  assert.deepEqual(createdChannel.projects, [], "no folders arrive");
  const workflowsNow = (await bridge.api("/api/workflows")).data.channels;
  const createdWorkflows = workflowsNow[createdChannel.id] || [];
  assert.equal(createdWorkflows.length, 1, "the workflow was created");
  assert.equal(createdWorkflows[0].enabled, false, "and it is paused");
  assert.deepEqual(createdWorkflows[0].runs, []);
  assert.equal(createdWorkflows[0].steps[0].memberId, "asq_iris_2");
  assert.ok(createdWorkflows[0].trigger.token && createdWorkflows[0].trigger.token !== workflow.data.trigger.token, "a new webhook token was minted");
  const skillPath = join(bridge.directory, "squad", "skills", "review-notes", "SKILL.md");
  assert.ok(existsSync(skillPath), "the skill text landed in the squad skills folder");
  assert.ok(!(await readFile(skillPath, "utf8")).includes(TOKEN));
  assert.deepEqual(imported.data.skills, { added: ["review-notes"], kept: [] });
  assert.equal(imported.data.presets.added.length, 2, "each member is offered as a preset");
  const presets = (await bridge.api("/api/teams/presets")).data.presets;
  assert.equal(presets.length, 2);
  assert.equal(presets[0].preset.role, "QA Engineer");

  // Importing the same file again adds nothing twice and suffixes again.
  const again = await bridge.api("/api/teams/import", "POST", { document, existingMemberNames: ["Iris", "Iris 2", "Noah"], memberIds: { iris: "asq_iris_3", noah: "asq_noah_3" } });
  assert.equal(again.status, 201);
  assert.equal(again.data.members[0].draft.name, "Iris 3");
  assert.equal(again.data.channels[0].name, "release-3");
  assert.deepEqual(again.data.skills, { added: [], kept: ["review-notes"] });
  assert.equal(again.data.presets.added.length, 0);
  assert.equal(again.data.presets.kept.length, 2);
  assert.equal((await bridge.api("/api/teams/presets")).data.presets.length, 2, "presets are not duplicated");

  // Refusals: oversized, malformed, unknown fields.
  const huge = await bridge.api("/api/teams/import/plan", "POST", { text: "x".repeat(TEAM_LIMITS.fileBytes + 1024) });
  assert.equal(huge.status, 413, JSON.stringify(huge).slice(0, 200));
  assert.match(huge.error, /larger than 4 MB/);
  const malformed = await bridge.api("/api/teams/import/plan", "POST", { text: "{not json" });
  assert.equal(malformed.status, 400);
  assert.match(malformed.error, /not JSON/);
  const stranger = await bridge.api("/api/teams/import", "POST", { document: { ...document, conversations: [{ body: "hi" }] } });
  assert.equal(stranger.status, 400);
  assert.match(stranger.error, /conversations/);
  const wrongKind = await bridge.api("/api/teams/import", "POST", { document: { format: "x" } });
  assert.equal(wrongKind.status, 400);

  // A workflow the bridge cannot keep rolls the channels back too.
  const broken = { ...document, team: { ...document.team, name: "Broken" }, channels: [{ name: "fragile", visibility: "public", section: "", members: ["Iris"] }], workflows: [{ channel: "fragile", name: "Bad hook", trigger: { type: "message", pattern: "deploy" }, steps: [{ kind: "http", url: "not a url", method: "POST" }] }] };
  const before = (await bridge.api("/api/channels")).data.channels.length;
  const failed = await bridge.api("/api/teams/import", "POST", { document: broken, memberIds: { iris: "asq_x" } });
  assert.equal(failed.status, 400, JSON.stringify(failed));
  assert.match(failed.error, /Nothing was added/);
  assert.equal((await bridge.api("/api/channels")).data.channels.length, before, "no channel is left behind");
  assert.ok(!(await bridge.api("/api/channels")).data.channels.some((channel) => channel.name === "fragile"));

  // Presets round-trip on their own.
  const presetFile = await bridge.api("/api/teams/presets/export", "POST", { member: iris, presetName: "Release QA", description: "QA for release trains", skills: ["review-notes"], notes: true });
  assert.equal(presetFile.status, 200, JSON.stringify(presetFile));
  assert.equal(presetFile.data.document.kind, "preset");
  assert.equal(presetFile.data.document.members.length, 0);
  assert.equal(presetFile.data.document.presets[0].name, "Release QA");
  assert.deepEqual(Object.keys(presetFile.data.document.presets[0]).sort(), ["brainCard", "description", "instructions", "key", "look", "name", "notes", "role", "skills"]);
  assert.ok(!JSON.stringify(presetFile.data.document).includes(PASSWORD));
  assert.match(presetFile.data.filename, /^release-qa-\d{4}-\d{2}-\d{2}\.squad-preset\.json$/);
  const presetImport = await bridge.api("/api/teams/import", "POST", { document: presetFile.data.document });
  assert.equal(presetImport.status, 201, JSON.stringify(presetImport));
  assert.equal(presetImport.data.members.length, 0);
  assert.equal(presetImport.data.channels.length, 0);
  assert.equal(presetImport.data.presets.added.length, 1);
  const list = (await bridge.api("/api/teams/presets")).data.presets;
  const stored = list.find((entry) => entry.preset.name === "Release QA");
  assert.ok(stored, "the preset is offered");
  assert.equal(presetTemplate(stored.preset).title, "QA Engineer");
  const removed = await bridge.api(`/api/teams/presets/${stored.id}`, "DELETE");
  assert.equal(removed.status, 200);
  assert.equal((await bridge.api("/api/teams/presets")).data.presets.length, list.length - 1);
  assert.equal((await bridge.api(`/api/teams/presets/${stored.id}`, "DELETE")).status, 404);

  console.log("teams: bridge checks passed");
} catch (error) {
  console.error(bridge.logs.slice(-4000));
  throw error;
} finally {
  await bridge.close();
}

console.log("check-teams: ok");
