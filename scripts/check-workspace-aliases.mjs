import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startBridge } from "./lib/reliability-browser.mjs";
import { readSkillPackage } from "../server/skills/local.mjs";

const artifactRoot = join(homedir(), ".codex", "artifacts");
await mkdir(artifactRoot, { recursive: true });
const scratch = await mkdtemp(join(artifactRoot, "squad-workspace-alias-"));
const outside = await mkdtemp(join(tmpdir(), "squad-workspace-outside-"));
const target = join(scratch, "project");
const alias = join(scratch, "project-alias");
const outsideAlias = join(scratch, "outside-alias");
const outsideProject = join(outside, "project");
const skill = join(target, ".agents", "skills", "alias-workspace-fixture");
const linkType = process.platform === "win32" ? "junction" : "dir";
let bridge;
try {
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "---\nname: alias-workspace-fixture\ndescription: Controlled alias regression.\n---\nUse this fixture only.\n");
  await symlink(target, alias, linkType);
  await mkdir(outsideProject);
  await symlink(outside, outsideAlias, linkType);
  bridge = await startBridge({ development: false, prepare: async directory => {
    const entry = join(directory, "fixture-sdk.mjs");
    await writeFile(entry, "export class AutohandSDK { async start() {} async *streamPrompt() { yield {type:'message_end',content:'Controlled alias workspace reached the engine.'}; } async close() {} async interrupt() {} }\n");
    const registry = join(directory, "catalog");
    await mkdir(registry);
    await writeFile(join(registry, "registry.json"), '{"skills":[]}');
    const preload = join(directory, "registry.mjs");
    await writeFile(preload, "const original=globalThis.fetch; globalThis.fetch=(url,options)=>String(url)==='https://skilled.autohand.ai/skills-index.json'?Promise.resolve(new Response('{\"skills\":[]}')):original(url,options);\n");
    return { AUTOHAND_AGENT_SDK_ENTRY: entry, AUTOHAND_AGENT_SDK_DIR: directory, AUTOHAND_SKILLS_REPO_DIR: registry, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(preload).href}`.trim() };
  } });
  const agent = { id: "asq_alias_upgrade", name: "Alias fixture", role: "Engineer", skills: ["alias-workspace-fixture"], projects: [{ path: alias }], permissions: { permissionMode: "restricted", workspaceOverrides: { [alias]: { permissionMode: "restricted" } } }, harness: { id: "autohand" } };
  const provision = await bridge.api("/api/agents/provision", "POST", { agentId: agent.id, agent, workspace: alias });
  assert.equal(provision.success, true, JSON.stringify(provision));
  assert.equal(provision.data.skillInstall.installed.length, 1, JSON.stringify(provision.data.skillInstall));
  const identity = JSON.parse(await readFile(join(target, ".autohand", "workspace-identity.json"), "utf8"));
  assert.equal(JSON.parse(await readFile(join(alias, ".autohand", "workspace-identity.json"), "utf8")).id, identity.id);
  const saved = JSON.parse(await readFile(join(bridge.directory, "app", "agents", agent.id, "profile.json"), "utf8"));
  assert.equal(saved.workspace, alias, "The selected locator and workspace overrides must keep their saved key.");
  assert.equal(saved.projects[0].path, alias);
  assert.equal((await bridge.api("/api/members/" + agent.id + "/channel-access", "PUT", { agent })).success, true);
  const accessState = (await bridge.api("/api/channels")).data.agentChannelAccess[agent.id];
  assert.equal(accessState.agent.permissions.workspaceOverrides[alias].permissionMode, "restricted");
  const catalogFor = async workspace => (await bridge.api("/api/skills/catalog?workspace=" + encodeURIComponent(workspace) + "&q=alias-workspace-fixture")).data.skills.find(item => item.id === "alias-workspace-fixture");
  const aliasedSkill = await catalogFor(alias);
  const canonicalSkill = await catalogFor(target);
  assert.equal(aliasedSkill.reference.authority, canonicalSkill.reference.authority);
  assert.equal(aliasedSkill.reference.revision, canonicalSkill.reference.revision);
  assert.ok(aliasedSkill.reference.authority.includes(identity.id));
  const reply = await bridge.api("/api/chat", "POST", { agentId: agent.id, workspace: alias, prompt: "Confirm the assigned workspace without tools." });
  assert.equal(reply.success, true, JSON.stringify(reply));
  assert.match(reply.data.reply, /Controlled alias workspace reached the engine/);

  const escapedWorkspace = join(outsideAlias, "project");
  const refused = await bridge.api("/api/agents/provision", "POST", { agentId: "asq_outside_alias", agent: { ...agent, id: "asq_outside_alias", projects: [{ path: escapedWorkspace }] }, workspace: escapedWorkspace });
  assert.equal(refused.success, false, JSON.stringify(refused));
  assert.equal(refused.status, 400);
  assert.match(refused.error, /inside the user directory/);
  await assert.rejects(access(join(outsideProject, ".autohand", "workspace-identity.json")), { code: "ENOENT" });

  const packageAlias = join(scratch, "package-alias");
  await symlink(skill, packageAlias, linkType);
  await assert.rejects(readSkillPackage(packageAlias), /symbolic|symlink|regular directory/i);
  console.log("PASS workspace aliases inside the home provision and execute, retain their saved locator and identity, reject outside-home targets, and keep skill-package symlinks refused. Controlled SDK only.");
} finally {
  await bridge?.close();
  await rm(scratch, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}
