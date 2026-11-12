#!/usr/bin/env node
// How each engine's output reaches the person (bug hunt 2026-10, engines).
// A real bridge in a temporary state folder runs members on a fake Autohand
// SDK and a fake Codex; scenario words in the person's message decide what
// the fake engine does. Nothing reaches a provider or the person's own
// ~/.autohand/squad.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createOwnedBridgeFixture,ownedFixtureHeaders } from "./lib/owned-bridge-fixture.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), "squad-engine-output-"));
const calls = join(directory, "calls.jsonl");
const fakeSdk = join(directory, "fixture-sdk.mjs");
const fakeCodex = join(directory, "fixture-codex");

const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
let bridge,ownedFixture;
let logs = "";

const member = (id, harness) => ({ id, name: id[0].toUpperCase() + id.slice(1), role: "Engineer", status: "online", workspace: root, projects: [{ path: root }], harness });
const autohand = member("ari", { id: "autohand" });
const codex = member("cody", { id: "codex", executablePath: fakeCodex });
const squadMembers = [autohand, codex];

async function stream(agent, prompt, extra = {}) {
  const response = await fetch(`${origin}/api/chat/stream`, { method: "POST", headers: await ownedFixtureHeaders(origin), body: JSON.stringify({ agentId: agent.id, agent, workspace: root, prompt, profile: "You are a fixture member.", squadMembers, ...extra }) });
  const text = await response.text();
  const blocks = text.split("\n\n").filter(Boolean).map((block) => ({ event: /^event: (.+)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || "null") }));
  return { done: blocks.find((block) => block.event === "done")?.data, error: blocks.find((block) => block.event === "error")?.data, blocks };
}
const entries = async () => (await readFile(calls, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(JSON.parse);
async function until(operation, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await operation().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(`Bridge fixture timed out: ${logs.slice(-1500)}`);
}

try {
  await mkdir(join(directory, "codex"), { recursive: true });
  await writeFile(join(directory, "codex", "auth.json"), "{}");
  // A disposable token selects the fake SDK; no provider ever receives it.
  await writeFile(join(directory, "config.json"), JSON.stringify({ provider: "autohandai", auth: { token: "fixture-only-no-provider" }, autohandai: { model: "auto" } }));
  await writeFile(fakeSdk, `
import { appendFileSync } from 'node:fs';
const log = (entry) => appendFileSync(${JSON.stringify(calls)}, JSON.stringify(entry) + '\\n');
export class AutohandSDK {
  constructor(options) { this.options = options; this.member = options.envVars.AUTOHAND_CLIENT_NAME.replace('autohand-squad-', ''); }
  async start() { log({ kind: 'sdk-start', member: this.member, profile: this.options.appendSystemPrompt || '' }); }
  async *streamPrompt({ message }) {
    log({ kind: 'sdk-turn', member: this.member, message });
    if (message.includes('scenario-reflection')) {
      yield { type: 'message_end', content: 'Reflection: The diff confirms both changes. I can answer now.' };
      yield { type: 'message_end', content: 'Reflection: The diff confirms both changes.\\n\\n---\\n\\nBoth changes are in.' };
      return;
    }
    yield { type: 'message_end', content: 'Fixture reply.' };
  }
  async interrupt() {}
  async close() {}
}
`);
  await writeFile(fakeCodex, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex 1.0.0'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using fixture'); process.exit(0); }
const log = (entry) => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(entry) + '\\n');
const emit = (event) => console.log(JSON.stringify(event));
const prompt = args[args.length - 1];
log({ kind: 'codex', args });
emit({ type: 'thread.started', thread_id: 'thread-cody' });
emit({ type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: 'Fixture reply.' } });
emit({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
`);
  await chmod(fakeCodex, 0o700);
  ownedFixture=await createOwnedBridgeFixture({serviceRoot:join(directory,'squad'),appRoot:join(directory,'app')});
  bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      ...ownedFixture.env,
      AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: "",
      AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS: "",
      AUTOHAND_SQUAD_HOME: join(directory, "squad"),
      AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, "app"),
      AUTOHAND_HOME: join(directory, "autohand"),
      AUTOHAND_USER_CONFIG_PATH: join(directory, "config.json"),
      AUTOHAND_SQUAD_VAULT_KEY_SOURCE: "file",
      AUTOHAND_SQUAD_VAULT_KEY_FILE: join(directory, "vault.key"),
      CODEX_HOME: join(directory, "codex"),
      OPENAI_API_KEY: "fixture-no-provider",
      AUTOHAND_AGENT_SDK_DIR: directory,
      AUTOHAND_AGENT_SDK_ENTRY: fakeSdk,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stdout.on("data", (b) => { logs += b; });
  bridge.stderr.on("data", (b) => { logs += b; });
  await until(async () => (await fetch(`${origin}/api/harnesses`,{headers:await ownedFixtureHeaders(origin)})).ok);

  {
    // Autohand's reflection paragraph is the engine's, not the member's answer.
    const { done } = await stream(autohand, "scenario-reflection what changed?");
    assert.ok(done, `reflection turn finished: ${logs.slice(-800)}`);
    assert.equal(done.reply, "Both changes are in.", "the reply carries no 'Reflection:' paragraph");
    console.log("reflection preamble: dropped from the Autohand reply");
  }

  console.log("Engine output checks passed.");
} finally {
  if (bridge && bridge.exitCode === null) {
    const closed = new Promise((r) => bridge.once("close", r));
    bridge.kill("SIGTERM");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
    if (bridge.exitCode === null) bridge.kill("SIGKILL");
  }
  await ownedFixture?.close();
  await rm(directory, { recursive: true, force: true });
}
