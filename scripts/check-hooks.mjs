#!/usr/bin/env node
// Sessions started outside Squad (ADR-0127). Pure checks for the installer's
// merge (other hooks kept, Squad's replaced not duplicated, removal exact) and
// the member attribution; then a real bridge with config dirs in a temp
// folder: install through the route writes both engines' configs with a
// backup, the real forwarder is fed hook JSON on stdin like Claude Code and
// Codex do, and the bridge turns it into a run with tool rows and the reply;
// a turn Squad started itself (AUTOHAND_SQUAD_MEMBER set) is ignored;
// uninstall leaves the person's own hooks exactly as they were.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FORWARDER_MARK, hooksInstalled, withSquadHooks, withoutSquadHooks } from "../server/hooks/install.mjs";
import { lastAssistantText } from "../server/hooks/sessions.mjs";
import { externalRunBelongs, runsForMember } from "../src/lib/external-sessions.js";

// ---------- pure ----------
const theirs = { model: "fable", hooks: { Stop: [{ hooks: [{ type: "command", command: "/x/notify.sh" }] }], PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/x/notify.sh" }] }] } };
const command = `"/node" "/app/${FORWARDER_MARK}" claude 19821`;
const merged = withSquadHooks(theirs, command);
assert.equal(merged.model, "fable", "other settings are kept");
assert.equal(merged.hooks.Stop.length, 2, "the person's Stop hook stays, Squad's is added beside it");
assert.equal(merged.hooks.Stop[0].hooks[0].command, "/x/notify.sh");
assert.equal(merged.hooks.PostToolUse[1].matcher, "*");
assert.ok(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"].every((event) => merged.hooks[event].some((group) => group.hooks.some((hook) => hook.command === command))));
assert.deepEqual(withSquadHooks(merged, command), merged, "installing twice does not duplicate");
assert.deepEqual(withoutSquadHooks(merged), theirs, "removal restores exactly what was there");
assert.equal(hooksInstalled(merged), true); assert.equal(hooksInstalled(theirs), false);
assert.deepEqual(withoutSquadHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }), {}, "an emptied hooks object is removed");
assert.equal(lastAssistantText('{"type":"user","message":{"content":"hi"}}\n{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}\n{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}\n{"type":"assis'), "Done.", "the last assistant text, skipping tool-only entries and a torn line");
const member = { id: "alex", harness: { id: "claude" }, workspace: "/w/leads", projects: [{ path: "/w/other" }] };
const outside = { id: "e1", mode: "external", harness: "claude", workspace: "/w/leads/sub" };
assert.equal(externalRunBelongs(outside, member), true, "same engine, inside the member's folder");
assert.equal(externalRunBelongs({ ...outside, harness: "codex" }, member), false, "another engine");
assert.equal(externalRunBelongs({ ...outside, workspace: "/w/leadsX" }, member), false, "a sibling folder with the same prefix");
assert.deepEqual(runsForMember([outside, { id: "own", agentId: "alex" }, { id: "other", agentId: "eva" }], member).map((run) => run.id), ["e1", "own"]);
assert.ok((await readFile(new URL("../src/lib/execution-panel.js", import.meta.url), "utf8")).includes('run?.mode === "external") return copy.runExternal || "outside Squad"'), "the Runs tab labels them outside Squad");
console.log("Hooks pure checks passed: merge, idempotence, exact removal, transcript reply, attribution, label.");

// ---------- bridge ----------
const rootDir = resolve(new URL("..", import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), "squad-hooks-"));
const claudeDir = join(directory, "claude"), codexHome = join(directory, "codex");
await mkdir(claudeDir, { recursive: true }); await mkdir(codexHome, { recursive: true });
await writeFile(join(claudeDir, "settings.json"), JSON.stringify(theirs, null, 2));
const socket = createServer(); await new Promise((r) => socket.listen(0, "127.0.0.1", r)); const port = socket.address().port; await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let logs = "";
const bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: rootDir,
  env: { ...process.env, AUTOHAND_SQUAD_HOME: join(directory, "squad"), AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, "app"), AUTOHAND_HOME: join(directory, "autohand"), AUTOHAND_USER_CONFIG_PATH: join(directory, "config.json"), CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome, AUTOHAND_SQUAD_MEMBER: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
bridge.stdout.on("data", (d) => { logs += d; }); bridge.stderr.on("data", (d) => { logs += d; });
const api = async (path, body) => { const r = await fetch(origin + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, ...(await r.json()) }; };
async function until(fn, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await delay(50); } throw new Error(`${label} timed out; bridge: ${logs.slice(-2000)}`); }
// Run the command the installer wrote, exactly as the engine would.
async function fire(commandLine, event, env = {}) {
  await new Promise((resolveRun, reject) => {
    const child = spawn("/bin/sh", ["-c", commandLine], { env: { ...process.env, AUTOHAND_SQUAD_MEMBER: "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", (d) => { out += d; });
    child.on("exit", (code) => (code === 0 && out === "" ? resolveRun() : reject(new Error(`forwarder exit ${code}, printed ${JSON.stringify(out)}`))));
    child.stdin.end(JSON.stringify(event));
  });
}
try {
  await until(async () => (await api("/api/hooks/status")).success, "bridge start", 30000);
  const before = (await api("/api/hooks/status")).data;
  assert.equal(before.claude.installed, false); assert.equal(before.codex.installed, false); assert.equal(before.codex.exists, false);
  const installed = await api("/api/hooks/claude/install", {});
  assert.equal(installed.data.installed, true);
  assert.equal((await api("/api/hooks/codex/install", {})).data.installed, true, "Codex: hooks.json is created");
  const claudeConfig = JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8"));
  assert.equal(claudeConfig.model, "fable"); assert.equal(claudeConfig.hooks.Stop[0].hooks[0].command, "/x/notify.sh", "the person's hooks are kept");
  assert.ok((await readdir(claudeDir)).some((name) => name.startsWith("settings.json.squad-backup-")), "a backup was written before the change");
  const ourCommand = claudeConfig.hooks.UserPromptSubmit.at(-1).hooks[0].command;
  assert.ok(ourCommand.includes(FORWARDER_MARK) && ourCommand.endsWith(` claude ${port}`), ourCommand);
  const codexCommand = JSON.parse(await readFile(join(codexHome, "hooks.json"), "utf8")).hooks.Stop[0].hooks[0].command;

  // A Claude Code session in a terminal: prompt, a tool, the reply in the transcript.
  const transcript = join(directory, "transcript.jsonl");
  await writeFile(transcript, `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Shortlist written." }] } })}\n`);
  const base = { session_id: "sess-123456789", cwd: "/w/leads", transcript_path: transcript };
  await fire(ourCommand, { ...base, hook_event_name: "SessionStart", source: "startup" });
  await fire(ourCommand, { ...base, hook_event_name: "UserPromptSubmit", prompt: "write the NZ shortlist" });
  await fire(ourCommand, { ...base, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: "shortlist.csv" }, tool_response: {} });
  await fire(ourCommand, { ...base, hook_event_name: "Stop", stop_hook_active: false });
  const run = await until(async () => (await api("/api/runs")).data.find((item) => item.mode === "external" && item.status === "completed"), "the outside run to finish");
  assert.equal(run.title, "write the NZ shortlist"); assert.equal(run.harness, "claude"); assert.equal(run.workspace, "/w/leads"); assert.equal(run.agentId, "");
  assert.equal(run.reply, "Shortlist written.", "the reply comes from the transcript");
  assert.ok(run.logs.some((entry) => entry.source === "tool" && entry.line.startsWith("Write completed")), JSON.stringify(run.logs));

  // Codex: its own hook payload, the reply in last_assistant_message.
  await fire(codexCommand, { hook_event_name: "UserPromptSubmit", session_id: "thread-1", cwd: "/w/app", prompt: "fix the build" });
  await fire(codexCommand, { hook_event_name: "Stop", session_id: "thread-1", cwd: "/w/app", last_assistant_message: "Build is green." });
  const codexRun = await until(async () => (await api("/api/runs")).data.find((item) => item.mode === "external" && item.harness === "codex" && item.status === "completed"), "the Codex run");
  assert.equal(codexRun.reply, "Build is green.");

  // A turn Squad started itself is not recorded twice.
  const countBefore = (await api("/api/runs")).data.length;
  await fire(ourCommand, { ...base, session_id: "squad-own", hook_event_name: "UserPromptSubmit", prompt: "from squad" }, { AUTOHAND_SQUAD_MEMBER: "asq_alex" });
  await delay(400);
  assert.equal((await api("/api/runs")).data.length, countBefore, "Squad's own turns are skipped by the forwarder");

  // SessionEnd closes an open prompt as stopped.
  await fire(ourCommand, { ...base, session_id: "sess-2", hook_event_name: "UserPromptSubmit", prompt: "long job" });
  await fire(ourCommand, { ...base, session_id: "sess-2", hook_event_name: "SessionEnd", reason: "exit" });
  await until(async () => (await api("/api/runs")).data.find((item) => item.title === "long job" && item.status === "stopped"), "the ended session");

  // Uninstall leaves exactly the person's hooks.
  assert.equal((await api("/api/hooks/claude/uninstall", {})).data.installed, false);
  assert.deepEqual(JSON.parse(await readFile(join(claudeDir, "settings.json"), "utf8")), theirs, "the person's settings are back exactly as they were");
  assert.equal((await api("/api/hooks/codex/uninstall", {})).data.installed, false);
  console.log("Hooks bridge checks passed: install with backup, Claude and Codex sessions recorded through the real forwarder, Squad's own turns skipped, session end, exact uninstall.");
} catch (error) {
  console.error(`bridge log tail: ${logs.slice(-2000)}`);
  throw error;
} finally {
  bridge.kill("SIGTERM");
  await delay(300);
  if (bridge.exitCode === null) bridge.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}
