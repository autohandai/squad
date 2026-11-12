#!/usr/bin/env node
// Saved permissions and the owner-scoped reset protocol against a real isolated
// broker/worker. No installed app, real credentials or real Squad data used.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startBridge, until } from "./lib/reliability-browser.mjs";

let fixtureHome, workspace;
const bridge = await startBridge({ prepare: async directory => {
  fixtureHome = join(directory, "home");
  workspace = join(fixtureHome, "project");
  await mkdir(workspace, { recursive: true });
  const preload = join(directory, "isolate-home.mjs");
  await writeFile(preload, `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; os.homedir=()=>${JSON.stringify(fixtureHome)}; syncBuiltinESMExports();\n`);
  const sdk = join(directory, "fixture-sdk.mjs");
  await writeFile(sdk, "export class AutohandSDK { async start() {} async close() {} async interrupt() {} }\n");
  return { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(preload).href}`.trim(), AUTOHAND_AGENT_SDK_ENTRY: sdk, AUTOHAND_AGENT_SDK_DIR: directory, AUTOHAND_SQUAD_COMPUTER_USE: "bundled", AUTOHAND_SQUAD_COMPUTER_USE_RUNTIME_DIR: directory };
} });
try {
  assert.equal((await bridge.api("/api/runtime")).data.squadWorkspaceRoot, bridge.workspaceRoot, "Managed work stays in the isolated owner dataset.");
  const member = { id: "reset-fixture", name: "Reset Fixture", role: "Engineer", workspace, projects: [{ path: workspace }], harness: { id: "autohand" }, permissions: { permissionMode: "interactive", builtInToolPolicyEnabled: true, builtInPolicies: { read_file: "allow", write_file: "ask" } } };
  await bridge.api(`/api/members/${member.id}/channel-access`, "PUT", { agent: member, profile: "", profilePatch: {} });
  // Warming writes the member's config.json; it needs no model.
  await bridge.api("/api/chat/warm", "POST", { agentId: member.id, agent: member, workspace }).catch(() => {});
  const saved = await until(async () => { const r = await bridge.api(`/api/members/${member.id}/runtime-permissions`); return r.success ? r.data : false; }, "saved permissions readable", 30000);
  const kinds = (saved.permissions.availableTools || []).map((entry) => entry.kind);
  assert.ok(kinds.includes("mcp__autohand-squad__squad_team"), "the file carries the engine-facing team tool names");
  assert.ok((saved.permissions.excludedTools || []).some((entry) => entry.kind === "ask_followup_question"));
  assert.equal(saved.features.automaticSpecialists, false);
  assert.equal((await bridge.api("/api/members/not%20valid/runtime-permissions")).status, 400);
  assert.equal((await bridge.api("/api/members/nobody-here/runtime-permissions")).status, 404);
  console.log("PASS the saved config.json is readable through the bridge with the engine-facing names");

  assert.equal((await bridge.api("/api/system/reset", "POST", {})).status, 410, "old PID-based reset cannot run against owned data");
  const squadDir = bridge.dataRoot;
  const appDir = bridge.appRoot;
  await writeFile(join(squadDir, "marker.txt"), "before reset");
  await writeFile(join(appDir, "marker.txt"), "old agent data");
  const userConfig = join(bridge.directory, "config.json");
  const before = await readFile(userConfig, "utf8");
  const oldContext=(await bridge.api('/api/ownership/context')).data;
  const input={id:randomUUID(),kind:'reset',beforeDatasetId:oldContext.datasetId,confirmation:'replace-current-squad'};
  assert.equal((await bridge.api('/api/ownership/operations','POST',{...input,confirmation:'unreviewed'})).status,400);
  const result = await bridge.api('/api/ownership/operations','POST',input);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.data.context.state,'awaiting_restart');
  assert.notEqual(result.data.context.datasetId,oldContext.datasetId);
  const after=join(bridge.directory,'squad','owners',result.data.context.scopeKey,'datasets',result.data.context.datasetId,'state');
  assert.equal(existsSync(join(after,'marker.txt')),false);
  assert.equal(await readFile(join(squadDir,'marker.txt'),'utf8'),'before reset');
  assert.equal(await readFile(join(appDir,'marker.txt'),'utf8'),'old agent data');
  assert.equal((await bridge.api('/api/setup')).status,401,'no private worker behind completion');
  assert.equal((await bridge.api('/api/ownership/operations','POST',input)).data.operation.afterDatasetId,result.data.context.datasetId,'retry cannot reset twice');
  assert.equal(await readFile(userConfig, "utf8"), before, "the person's Autohand config is untouched");
  await bridge.restart();
  const pending=(await bridge.api('/api/ownership/context')).data;
  assert.equal(pending.state,'awaiting_restart');
  assert.equal(pending.pendingOperation.id,input.id);
  assert.equal((await bridge.api(`/api/ownership/operations/${input.id}/restart`,'POST',{revision:pending.pendingOperation.revision})).success,true);
  assert.equal((await bridge.api("/api/setup")).data.status, "new", "after reset the bridge is a clean install");
  console.log("PASS owner-scoped reset confirms replacement, retains original dataset and sign-in, rejects the legacy protocol, recovers its durable receipt and explicitly restarts a clean dataset");
} finally { await bridge.close(); }
