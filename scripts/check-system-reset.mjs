#!/usr/bin/env node
// Reset Squad (ADR-0161 §3.1) and the saved-permissions read (§1.6) against a
// real isolated bridge: the member's config.json is readable through the
// bridge with the engine-facing names; reset moves Squad's folders aside with
// a date, keeps the person's Autohand config, and the bridge exits for its
// supervisor. Nothing touches the real ~/.autohand/squad.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
  assert.equal((await bridge.api("/api/runtime")).data.squadWorkspaceRoot, join(fixtureHome, ".autohandsquad"), "Refuse reset unless managed workspace roots are isolated.");
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

  assert.equal((await bridge.api("/api/system/reset", "POST", {})).status, 400, "reset needs an explicit confirmation");
  const squadDir = join(bridge.directory, "squad");
  const appDir = join(bridge.directory, "app");
  await writeFile(join(squadDir, "marker.txt"), "before reset");
  const userConfig = join(bridge.directory, "config.json");
  const before = await readFile(userConfig, "utf8");
  const result = await bridge.api("/api/system/reset", "POST", { confirm: "RESET" });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.ok(result.data.moved.every(entry => entry.folder.startsWith(bridge.directory)), "Only fixture folders can be archived.");
  assert.ok(result.data.moved.some((entry) => entry.folder === squadDir), "the state folder was moved aside");
  assert.ok(result.data.moved.some((entry) => entry.folder === appDir), "the members' homes were moved aside");
  await until(async () => { try { await bridge.api("/api/runtime"); return false; } catch { return true; } }, "the bridge exits for its supervisor", 10000);
  assert.equal(existsSync(join(squadDir, "marker.txt")), false);
  assert.equal(JSON.parse(await readFile(join(squadDir, "reset-progress.json"), "utf8")).phase, "complete");
  const backups = (await readdir(bridge.directory)).filter((name) => /^squad\.reset-/.test(name));
  assert.equal(backups.length, 1, "exactly one dated backup of the state folder");
  assert.equal(await readFile(join(bridge.directory, backups[0], "marker.txt"), "utf8"), "before reset", "nothing was deleted");
  assert.equal(await readFile(userConfig, "utf8"), before, "the person's Autohand config is untouched");
  await bridge.restart();
  assert.equal((await bridge.api("/api/setup")).data.status, "new", "after reset the bridge is a clean install");
  console.log("PASS reset moves Squad's folders aside with a date, keeps the sign-in, and comes back as a clean install");
} finally { await bridge.close(); }
