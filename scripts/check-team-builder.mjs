#!/usr/bin/env node
// Teams from an objective and from templates (ADR-0118).
//
// Pure checks first: the proposal builder (an objective becomes three to
// five members with names, roles, skills, a lead, a channel and paused
// routines; names never collide with the squad; the proposal is a valid
// team file), the format's routines and connectors, every built-in template
// file, and the build record a reload resumes. Then a real bridge in an
// isolated state directory: the templates route lists the files, an import
// of one creates the channel, paused routines and switched-off connectors
// without a single secret, and a team.built event lands in the feed.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { roleTemplates } from "../src/lib/member-profiles.js";
import { TEAM_FILE_SUFFIX, buildTeamFile, planImport, validateTeamFile } from "../src/lib/teams.js";
import {
  PROPOSAL_MEMBER_RANGE,
  buildFinishedEvent,
  buildMemberDraft,
  buildProgress,
  createTeamBuild,
  filterTemplates,
  kitForObjective,
  patchBuildMember,
  pendingBuildMembers,
  proposalProblems,
  proposeTeam,
  resumeBuilds,
  teamDocumentFromProposal,
  teamNameFromObjective,
  templateFacts,
  templateMeta,
  updateProposal,
} from "../src/lib/team-builder.js";
import { NOTIFICATION_EVENTS, notificationFor, settingKeyFor } from "../server/notify/policy.mjs";
import { startBridge } from "./lib/reliability-browser.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const templatesDir = join(root, "server", "teams", "templates");

// ---------------------------------------------------------------------------
// A team from an objective

{
  const objective = "Marketing team for our NZ launch";
  assert.equal(kitForObjective(objective).id, "marketing");
  assert.equal(teamNameFromObjective(objective), "Marketing team");
  assert.equal(teamNameFromObjective("Grow organic traffic to the docs"), "SEO team", "a sentence that names no team gets the kit's label");
  assert.equal(kitForObjective("Keep our support inbox answered within a day").id, "support");
  assert.equal(kitForObjective("Watch what our competitors ship").id, "research");
  assert.equal(kitForObjective("A design refresh of the dashboard").id, "design", "design wins over the dashboard word");
  assert.equal(kitForObjective("Ship the v2 API").id, "engineering");
  assert.equal(kitForObjective("do stuff").id, "general");

  const proposal = proposeTeam({ objective, roleTemplates, existingNames: ["Maya", "Noah", "Eva"] });
  assert.equal(proposal.name, "Marketing team");
  assert.ok(proposal.members.length >= PROPOSAL_MEMBER_RANGE.min && proposal.members.length <= PROPOSAL_MEMBER_RANGE.max, `${proposal.members.length} members`);
  for (const member of proposal.members) {
    assert.ok(member.name && member.role && member.purpose, `${member.key} has a name, a role and a purpose`);
    assert.ok(member.skills.length, `${member.role} has suggested skills`);
    assert.ok(!["maya", "noah", "eva"].includes(member.name.toLowerCase()), `${member.name} does not collide with the squad`);
  }
  const names = proposal.members.map((member) => member.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, "no two members share a name");
  assert.ok(proposal.members.some((member) => member.key === proposal.leadKey), "the lead is a member");
  assert.equal(proposal.members.find((member) => member.key === proposal.leadKey).role, "Marketing Lead");
  assert.equal(proposal.channel.name, "marketing-team");
  assert.ok(proposal.routines.length >= 1 && proposal.routines.length <= 2, "one or two routines");
  const templated = proposal.members.find((member) => member.templateId);
  assert.ok(templated, "at least one member is a built-in role template");
  assert.deepEqual(templated.skills, roleTemplates.find((template) => template.id === templated.templateId).skills, "a template member's skills are the template's catalog skills");
  assert.deepEqual(proposeTeam({ objective, roleTemplates, existingNames: ["Maya", "Noah", "Eva"] }), proposal, "the proposal is deterministic");
  assert.equal(proposalProblems(proposal).length, 0);

  // Editing: untick, rename, pick a lead.
  const second = proposal.members[1];
  let edited = updateProposal(proposal, { member: { key: proposal.leadKey, selected: false } });
  assert.notEqual(edited.leadKey, proposal.leadKey, "unticking the lead moves the lead to someone being created");
  edited = updateProposal(edited, { leadKey: second.key });
  assert.equal(edited.leadKey, second.key);
  edited = updateProposal(edited, { member: { key: second.key, name: "Aroha" } });
  assert.equal(edited.members[1].name, "Aroha");
  edited = updateProposal(edited, { name: "NZ launch crew" });
  assert.equal(edited.channel.name, "nz-launch-crew", "the channel follows the team name");
  assert.deepEqual(proposalProblems(updateProposal(edited, { member: { key: second.key, name: "" } })), ["member-name"]);
  assert.ok(proposalProblems({ ...edited, members: edited.members.map((member) => ({ ...member, selected: false })) }).includes("members"));

  // The proposal is a team file the same import creates.
  const document = teamDocumentFromProposal(edited, { roleTemplates });
  const validated = validateTeamFile(document);
  assert.equal(validated.ok, true, validated.error);
  assert.equal(validated.document.team.lead, "Aroha");
  assert.equal(validated.document.team.description, objective);
  assert.equal(validated.document.channels[0].name, "nz-launch-crew");
  assert.equal(validated.document.channels[0].members.length, 3, "the channel holds everyone being created");
  assert.ok(validated.document.routines.every((routine) => validated.document.members.some((member) => member.name === routine.member)), "every routine names a member in the file");
  assert.ok(validated.document.members.every((member) => member.instructions.includes("Objective: Marketing team for our NZ launch")), "every member knows the objective");
  assert.ok(validated.document.members.every((member) => member.instructions.includes("Aroha")), "every member knows the roster");
  const custom = validated.document.members.find((member) => !member.look.employeeType);
  assert.ok(custom, "a custom role is in the file");
  assert.ok(custom.instructions.startsWith(`Act as ${custom.role}.`), "a custom role's instructions start with its title");
  assert.ok(custom.brainCard.defaultWorkflow, "a custom role's brain card comes from the member-draft fallback");
  const plan = planImport(validated.document, { existingMemberNames: ["Aroha"] });
  assert.equal(plan.members.find((member) => member.originalName === "Aroha").name, "Aroha 2", "duplicate names get numbered");
  assert.equal(plan.routines.length, validated.document.routines.length);
  assert.ok(plan.routines.every((routine) => routine.enabled === false), "routines arrive paused");
  assert.equal(plan.lead.name, "Aroha 2", "the lead follows the renamed member");

  // Drafts for createAgent: trusted members switch their catalog skills on.
  const trusted = buildMemberDraft(validated.document.members[0], "Kai", { trusted: true });
  assert.equal(trusted.name, "Kai");
  assert.deepEqual(trusted.skills, validated.document.members[0].skills);
  assert.deepEqual(trusted.importedSkills, []);
  const untrusted = buildMemberDraft(validated.document.members[0], "Kai", { trusted: false });
  assert.deepEqual(untrusted.skills, [], "a file's members keep their skills off");
  assert.deepEqual(untrusted.importedSkills, validated.document.members[0].skills);
}

// ---------------------------------------------------------------------------
// Routines and connectors in a team file

{
  const built = buildTeamFile({
    team: "Ops",
    lead: "Iris",
    description: "Keep things running",
    members: [{ name: "Iris", role: "Ops" }, { name: "Noah", role: "Dev" }],
    routines: [
      { member: "Iris", title: "Morning check", instructions: "Check the queues.", schedule: { kind: "weekdays", days: [1, 2, 3, 4, 5], time: "08:30", timeZone: "Pacific/Auckland" }, maxRunMinutes: 20 },
      { member: "Ghost", title: "Orphan", instructions: "x", schedule: { kind: "once", date: "2026-12-01" } },
      { member: "Noah", title: "No instructions", instructions: "", schedule: {} },
    ],
    connectors: [
      { name: "GitHub", kind: "url", url: "https://api.githubcopilot.com/mcp/", transport: "http", headers: [{ name: "Authorization", value: "Bearer ghp_secret_value_1234567890" }], note: "PRs" },
      { name: "Local tool", kind: "stdio", command: "npx", args: ["-y", "some-mcp"], env: [{ key: "API_TOKEN", value: "sk-live-abcdefghijklmnopqrstuvwxyz0123" }] },
      { name: "Web research", builtin: true, kind: "stdio", enabled: true, firecrawlApiKey: "fc-secret" },
      { name: "Bad", kind: "url", url: "ftp://nope" },
      { name: "GitHub", kind: "url", url: "https://example.test/dup" },
    ],
  });
  const { document, summary } = built;
  assert.equal(document.team.lead, "Iris");
  assert.equal(document.team.description, "Keep things running");
  assert.equal(document.routines.length, 1, "a routine for a member not in the file, or without instructions, is dropped");
  assert.deepEqual(document.routines[0], { member: "Iris", title: "Morning check", instructions: "Check the queues.", schedule: { kind: "weekdays", time: "08:30", timeZone: "Pacific/Auckland", days: [1, 2, 3, 4, 5] }, maxRunMinutes: 20 });
  assert.equal(document.connectors.length, 3, "one per name; an invalid address is dropped");
  const serialized = JSON.stringify(document);
  for (const forbidden of ["ghp_secret", "sk-live", "fc-secret", "firecrawlApiKey", "enabled"]) assert.ok(!serialized.includes(forbidden), `a connector never carries ${forbidden}`);
  assert.deepEqual(document.connectors[0].headers, ["Authorization"], "header names travel, values do not");
  assert.deepEqual(document.connectors[1].env, ["API_TOKEN"]);
  assert.equal(document.connectors[2].kind, "builtin");
  assert.equal(summary.routines, 1);
  assert.equal(summary.connectors, 3);
  assert.equal(validateTeamFile(document).ok, true);
  assert.match(validateTeamFile({ ...document, connectors: [{ name: "X", kind: "url", url: "https://x.test", apiKey: "k" }] }).error, /never in a file/);
  assert.match(validateTeamFile({ ...document, routines: [{ title: "No member" }] }).error, /names no member/);
  const plan = planImport(document, { existingConnectorNames: ["github"] });
  assert.deepEqual(plan.connectors.map((connector) => `${connector.name}:${connector.action}`), ["GitHub:keep", "Local tool:add", "Web research:keep"]);
  assert.equal(plan.routines[0].memberKey, "iris");
  assert.equal(plan.lead.name, "Iris");
}

// ---------------------------------------------------------------------------
// The built-in templates

const templateFiles = (await readdir(templatesDir)).filter((name) => name.endsWith(TEAM_FILE_SUFFIX)).sort();
const templates = [];
{
  assert.ok(templateFiles.length >= 6, `six or more templates ship (${templateFiles.length})`);
  for (const file of templateFiles) {
    const result = validateTeamFile(await readFile(join(templatesDir, file), "utf8"));
    assert.equal(result.ok, true, `${file}: ${result.error}`);
    assert.equal(result.warnings.length, 0, `${file} carries nothing that looks like a secret`);
    const { document } = result;
    assert.ok(document.team.description, `${file} says what it is for`);
    assert.ok(document.members.length >= 3, `${file} has a team`);
    assert.ok(document.members.some((member) => member.name === document.team.lead), `${file} names a lead who is a member`);
    assert.equal(document.channels.length, 1, `${file} has one channel`);
    assert.equal(document.channels[0].members.length, document.members.length, `${file}: everyone is in the channel`);
    assert.ok(document.routines.length >= 1, `${file} has routines`);
    for (const member of document.members) {
      assert.ok(member.instructions.length > 80, `${file}: ${member.name} has instructions`);
      assert.ok(member.skills.length, `${file}: ${member.name} has skills`);
      for (const field of ["purpose", "defaultWorkflow", "allowedTools", "escalationRules", "definitionOfDone", "reviewStyle", "memoryPolicy"]) assert.ok(member.brainCard[field], `${file}: ${member.name} brain card ${field}`);
      if (member.look.employeeType) assert.ok(roleTemplates.some((template) => template.id === member.look.employeeType), `${file}: ${member.name} names a real role template`);
    }
    templates.push({ id: file.replace(TEAM_FILE_SUFFIX, ""), name: document.team.name, description: document.team.description, document });
  }
  const names = new Set(templates.map((template) => template.name));
  for (const wanted of ["Marketing campaign team", "SEO growth team", "Engineering team", "Lead research team", "Competitor watch", "Inbox follow-up"]) assert.ok(names.has(wanted), `${wanted} ships`);
  const engineering = templates.find((template) => template.name === "Engineering team");
  assert.equal(templateMeta(engineering.document), "4 members · 2 routines · needs GitHub, Sentry");
  assert.deepEqual(templateFacts(engineering.document), ["Atlas leads", "1 channel", "2 paused routines", "2 connections off"]);
  assert.equal(filterTemplates(templates, "github").length, 2, "search matches a connector");
  assert.equal(filterTemplates(templates, "inbox").length, 1);
  assert.equal(filterTemplates(templates, "").length, templates.length);
}

// ---------------------------------------------------------------------------
// The build record

{
  const engineering = templates.find((template) => template.name === "Engineering team").document;
  const plan = planImport(engineering, { existingMemberNames: ["Atlas"] });
  const memberIds = Object.fromEntries(plan.members.map((member, index) => [member.key, `asq_t${index}`]));
  const drafts = Object.fromEntries(plan.members.map((member) => [member.key, buildMemberDraft(engineering.members.find((record) => record.key === member.key), member.name, { trusted: true })]));
  let builds = [createTeamBuild({ id: "build_1", document: engineering, plan, drafts, memberIds, trusted: true, source: "template" })];
  assert.equal(builds[0].name, "Engineering team");
  assert.equal(builds[0].members[0].name, "Atlas 2", "the build carries the plan's unique names");
  assert.equal(builds[0].members[0].id, "asq_t0");
  assert.deepEqual(builds[0].members[0].draft.skills, engineering.members[0].skills, "a built-in template's skills are on");
  assert.equal(pendingBuildMembers(builds[0]).length, 4);
  builds = patchBuildMember(builds, "build_1", "atlas", { status: "ready" });
  assert.equal(pendingBuildMembers(builds[0]).length, 3, "a ready member leaves the pending rows");
  assert.deepEqual(buildProgress(builds[0]), { total: 4, ready: 1, failed: 0, interrupted: 0, preparing: 3 });
  const resumed = resumeBuilds(JSON.parse(JSON.stringify(builds)));
  assert.equal(resumed[0].status, "interrupted", "a build caught by a reload is interrupted, not lost");
  assert.equal(resumed[0].members[1].status, "interrupted");
  assert.equal(resumed[0].members[0].status, "ready", "a ready member stays ready");
  assert.deepEqual(resumeBuilds("junk"), []);
  const done = buildFinishedEvent({ ...builds[0], status: "ready", members: builds[0].members.map((member) => ({ ...member, status: "ready" })), channels: [{ name: "engineering" }], routines: [{}, {}] });
  assert.equal(done.name, "team.built");
  assert.equal(done.status, "completed");
  assert.equal(done.memberCount, 4);
  assert.ok(NOTIFICATION_EVENTS.includes("team.built"), "the feed listens for it");
  assert.equal(settingKeyFor(done), "runFinished");
  assert.equal(settingKeyFor({ ...done, status: "failed" }), "runFailed");
  const copy = notificationFor(done, { appUrl: "http://127.0.0.1:19821" });
  assert.equal(copy.title, "Engineering team is ready");
  assert.equal(copy.route, "/squad");
  assert.match(copy.body, /4 members prepared · #engineering created · 2 routines paused/);
  const failed = notificationFor(buildFinishedEvent({ ...builds[0], status: "failed", members: builds[0].members.map((member, index) => ({ ...member, status: index === 0 ? "ready" : index === 1 ? "failed" : "preparing" })) }), {});
  assert.equal(failed.title, "Engineering team could not be finished");
  assert.match(failed.body, /1 member was not prepared/);
}

console.log("team-builder: pure checks passed");

// ---------------------------------------------------------------------------
// The real bridge

const bridge = await startBridge();
try {
  const listed = await bridge.api("/api/teams/templates");
  assert.equal(listed.status, 200, JSON.stringify(listed));
  assert.equal(listed.data.templates.length, templateFiles.length, "the bridge serves every template file");
  const engineering = listed.data.templates.find((template) => template.name === "Engineering team");
  assert.ok(engineering, "the Engineering team is served");
  assert.equal(engineering.id, "engineering-team");
  assert.equal(engineering.document.routines.length, 2);

  // Plan: names made unique, routines and connectors in the plan.
  const planned = await bridge.api("/api/teams/import/plan", "POST", { document: engineering.document, existingMemberNames: ["Atlas"] });
  assert.equal(planned.status, 200, JSON.stringify(planned));
  assert.equal(planned.data.plan.members[0].name, "Atlas 2");
  assert.equal(planned.data.plan.routines.length, 2);
  assert.deepEqual(planned.data.plan.connectors.map((connector) => connector.action), ["add", "add"]);
  assert.equal(planned.data.plan.lead.name, "Atlas 2");

  // Import: the channel, two paused routines in the importer's zone, two
  // connectors saved off with empty header values.
  const memberIds = Object.fromEntries(planned.data.plan.members.map((member, index) => [member.key, `asq_eng_${index}`]));
  const imported = await bridge.api("/api/teams/import", "POST", { document: engineering.document, existingMemberNames: ["Atlas"], memberIds, choices: { presets: false }, timeZone: "Pacific/Auckland" });
  assert.equal(imported.status, 201, JSON.stringify(imported));
  assert.equal(imported.data.channels.length, 1);
  assert.equal(imported.data.channels[0].name, "engineering");
  assert.equal(imported.data.routines.length, 2, "both routines were created");
  assert.ok(imported.data.routines.every((routine) => routine.enabled === false), "and they are paused");
  assert.deepEqual(imported.data.connectors.added.map((connector) => connector.name), ["GitHub", "Sentry"]);
  assert.equal(imported.data.presets.added.length, 0, "a built-in template adds no presets when asked not to");
  const routines = (await bridge.api("/api/routines")).data.routines;
  assert.equal(routines.length, 2);
  for (const routine of routines) {
    assert.equal(routine.enabled, false, `${routine.title} is paused`);
    assert.equal(routine.schedule.timeZone, "Pacific/Auckland", "the importer's zone filled the schedule");
    assert.ok(Object.values(memberIds).includes(routine.memberId), "bound to a created member");
    assert.deepEqual(routine.runs, []);
  }
  const daily = routines.find((routine) => routine.title === "Daily CI and open PR review");
  assert.equal(daily.memberId, memberIds.ridge);
  assert.equal(daily.schedule.kind, "weekdays");
  const connectors = (await bridge.api("/api/connectors")).data.connectors;
  const github = connectors.find((connector) => connector.name === "GitHub");
  assert.ok(github, "GitHub was saved");
  assert.equal(github.enabled, false, "and it is off");
  assert.equal(github.url, "https://api.githubcopilot.com/mcp/");
  assert.deepEqual(github.headers.map((header) => [header.name, header.configured]), [["Authorization", false]], "the header exists with no value");
  const channel = (await bridge.api("/api/channels")).data.channels.find((item) => item.id === imported.data.channels[0].id);
  assert.deepEqual(channel.memberIds.sort(), Object.values(memberIds).sort());

  // A second import keeps the connectors, numbers the channel, adds routines again.
  const again = await bridge.api("/api/teams/import", "POST", { document: engineering.document, existingMemberNames: ["Atlas", "Atlas 2"], memberIds: Object.fromEntries(Object.entries(memberIds).map(([key, id]) => [key, `${id}_b`])), choices: { presets: false, routines: false } });
  assert.equal(again.status, 201, JSON.stringify(again));
  assert.equal(again.data.channels[0].name, "engineering-2");
  assert.deepEqual(again.data.connectors.added, []);
  assert.deepEqual(again.data.connectors.kept.map((connector) => connector.name), ["GitHub", "Sentry"]);
  assert.equal(again.data.routines.length, 0, "routines can be declined");
  assert.equal((await bridge.api("/api/connectors")).data.connectors.filter((connector) => connector.name === "GitHub").length, 1, "no duplicate connector");

  // Share back out: the routines of the selected members travel, paused, by name.
  const exported = await bridge.api("/api/teams/export", "POST", { team: "Engineering copy", lead: "Atlas 2", members: Object.entries(memberIds).map(([key, id]) => ({ id, name: planned.data.plan.members.find((member) => member.key === key).name, role: key })), include: { skills: [], channels: true, workflows: true, notes: false } });
  assert.equal(exported.status, 200, JSON.stringify(exported));
  assert.equal(exported.data.document.routines.length, 2, "routines are in the shared file");
  assert.equal(exported.data.document.routines.find((routine) => routine.title === daily.title).member, "Ridge");
  assert.equal(exported.data.document.team.lead, "Atlas 2");
  assert.ok(!("enabled" in exported.data.document.routines[0]), "a shared routine carries no enabled flag; it arrives paused");
  assert.equal(validateTeamFile(exported.data.document).ok, true);

  // The event the app raises when a build ends becomes a notification.
  const event = await bridge.api("/api/events", "POST", { name: "team.built", status: "completed", team: "Engineering team", memberCount: 4, failedCount: 0, channels: ["engineering"], routines: 2 });
  assert.equal(event.status, 200);
  let feed = null;
  for (let attempt = 0; attempt < 20 && !feed; attempt += 1) {
    const items = (await bridge.api("/api/notifications")).data.items;
    feed = items.find((item) => item.kind === "team.built") || null;
    if (!feed) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(feed, "the feed carries the team.built notification");
  assert.equal(feed.title, "Engineering team is ready");
  assert.equal(feed.route, "/squad");

  console.log("team-builder: bridge checks passed");
} catch (error) {
  console.error(bridge.logs.slice(-4000));
  throw error;
} finally {
  await bridge.close();
}

console.log("check-team-builder: ok");
