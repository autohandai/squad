#!/usr/bin/env node
// The team MCP server, end to end, against a real bridge in an isolated state
// dir (ADR-0134). Two members run on a fake Codex that speaks the managed MCP
// server's newline framing: Noah messages Eva and gets her reply inside his
// own turn, saves team memory that reaches Eva's next prompt, renames
// himself, proposes a reminder, and is refused where he should be. No run
// touches the person's real ~/.autohand/squad.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { TEAM_TOOL_NAMES, resolveTeammate, teamInstructions } from "../server/team/service.mjs";
import { cleanMemoryText, looksSecret, memoryKey } from "../server/team/store.mjs";
import { asksForRole, needsShapingInstruction } from "../src/lib/member-shaping.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), "squad-team-"));
const state = join(directory, "state");
const app = join(directory, "app");
const home = join(directory, "home");
const harness = join(directory, "mock-codex");
const config = join(directory, "user.json");
const calls = join(directory, "calls.jsonl");

const noah = { id: "team-noah", name: "Noah", role: "Frontend", status: "online", workspace: root, projects: [{ path: root }], harness: { id: "codex", executablePath: harness }, permissions: { permissionMode: "restricted" } };
const eva = { id: "team-eva", name: "Eva Green", role: "QA", status: "online", workspace: root, projects: [{ path: root }], harness: { id: "codex", executablePath: harness }, permissions: { permissionMode: "restricted" } };
const squadMembers = [noah, eva];

const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
let bridge;
let logs = "";

async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, text, ...JSON.parse(text) };
}
async function until(operation, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await operation().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(`Bridge fixture timed out: ${logs.slice(-1500)}`);
}
function start() {
  bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: "",
      AUTOHAND_SQUAD_HOME: state,
      AUTOHAND_SQUAD_APP_STATE_DIR: app,
      AUTOHAND_HOME: home,
      AUTOHAND_USER_CONFIG_PATH: config,
      AUTOHAND_SQUAD_VAULT_KEY_SOURCE: "file",
      AUTOHAND_SQUAD_VAULT_KEY_FILE: join(home, "vault.key"),
      AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS: "macos",
      CODEX_HOME: join(directory, "codex"),
      OPENAI_API_KEY: "fixture-no-provider",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stdout.on("data", (b) => { logs += b; });
  bridge.stderr.on("data", (b) => { logs += b; });
}
async function stop() {
  if (!bridge || bridge.exitCode !== null) return;
  const closed = new Promise((r) => bridge.once("close", r));
  bridge.kill("SIGTERM");
  await closed;
}
const entries = async () => (await readFile(calls, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(JSON.parse);
const toolText = (entry) => entry?.response?.result?.content?.[0]?.text || entry?.response?.error?.message || "";
const chat = (member, prompt) => api("/api/chat", { agentId: member.id, agent: member, workspace: root, prompt, resumeSession: false, squadMembers });

// The fake Codex: scenario words in the prompt decide which tools it calls.
const fakeCodex = `#!${process.execPath}
const fs = require('node:fs'), child = require('node:child_process'), readline = require('node:readline');
const toml = require(${JSON.stringify(join(root, "node_modules", "toml"))});
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex 1.0.0'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using fixture'); process.exit(0); }
const log = (entry) => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(entry) + '\\n');
const say = (text) => { console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-' + (/Member: ([^\\n(]+) \\(/.exec(process.argv.at(-1))?.[1] || 'x').trim().split(' ')[0] })); console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } })); console.log(JSON.stringify({ type: 'turn.completed' })); };
(async () => {
  const merged = args.flatMap((value, index) => value === '-c' ? [toml.parse(args[index + 1])] : []);
  const field = (name, suffix) => merged.find((value) => value.mcp_servers?.[name]?.[suffix] !== undefined)?.mcp_servers[name][suffix];
  const command = field('autohand-squad', 'command');
  const prompt = args[args.length - 1];
  const who = /Member: ([^\\n(]+) \\(/.exec(prompt)?.[1]?.trim() || '';
  log({ kind: 'harness', resume: args.includes('resume') ? args[args.indexOf('resume') + 1] : '', ask: prompt.split('</turn_context>').pop().slice(0, 300), who, teamManaged: !!command, timeout: field('autohand-squad', 'tool_timeout_sec'), prompt });
  const ask = prompt.split('</operating_instructions>').pop().split('</turn_context>').pop();
  if (/^\\s*Message from Noah/.test(ask)) return say('Eva here: the build is green on main.');
  const scenario = /team-scenario-([a-z-]+)/.exec(ask)?.[1] || (/Draft an automation:/.test(ask) ? 'schedule' : '');
  if (!command || !scenario) return say('Fixture turn done.');
  const proxy = child.spawn(command, field('autohand-squad', 'args'), { env: { ...process.env, ...field('autohand-squad', 'env') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  readline.createInterface({ input: proxy.stdout }).on('line', (line) => { const response = JSON.parse(line); pending.get(response.id)?.(response); });
  let sequence = 0;
  const rpc = (method, params) => new Promise((resolve) => { const id = ++sequence; pending.set(id, resolve); proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n'); });
  const call = async (name, arguments_) => { const response = await rpc('tools/call', { name, arguments: arguments_ }); log({ kind: 'tool', who, scenario, name, response }); return response; };
  try {
    log({ kind: 'initialize', response: await rpc('initialize', { protocolVersion: '2025-06-18' }) });
    log({ kind: 'tools', response: await rpc('tools/list', {}) });
    if (scenario === 'message') {
      await call('squad_team', {});
      await call('squad_message', { to: '@Eva,', message: 'Is the build green?', wait_seconds: 30 });
      await call('squad_message', { to: 'Nobody', message: 'hello' });
    }
    if (scenario === 'remember') {
      await call('squad_remember', { text: 'Igor writes in NZ English and wants short replies.' });
      await call('squad_remember', { text: 'Igor writes in NZ English and wants short replies.' });
      await call('squad_remember', { text: 'Noah owns the landing page.', scope: 'me' });
      await call('squad_remember', { text: 'The deploy key is sk-live-abcdefghijklmnop1234' });
    }
    if (scenario === 'forget') {
      const listed = JSON.parse((await call('squad_recall', { query: 'nz english' })).result.content[0].text);
      await call('squad_forget', { id: listed.memories[0].id });
    }
    if (scenario === 'rename') await call('squad_set_profile', { name: 'Robert' });
    if (scenario === 'rename-again') await call('squad_set_profile', { name: 'Rob' });
    if (scenario === 'profile') {
      await call('squad_set_profile', { description: 'Owns the release experience.', instructions: 'Verify the shipped UI.', personality: 'Concise, candid and patient.', skills: ['accessibility', 'release QA'] });
      await call('squad_get_profile', {});
      await call('squad_set_profile', { name: 'Imposter', memberId: 'team-eva' });
      await call('squad_set_profile', { skills: 'not an array' });
    }
    if (scenario === 'channels') {
      await call('squad_channels', {});
      const posted = (await call('squad_post_channel', { channel_id: 'team-room', text: 'Release notes are ready.', request_id: 'release-ready' })).result.structuredContent;
      await call('squad_post_channel', { channel_id: 'team-room', text: 'Release notes are ready.', request_id: 'release-ready' });
      await call('squad_post_channel', { channel_id: 'team-room', thread_id: posted.threadId, text: 'Please review the accessibility notes.' });
      await call('squad_channel_messages', { channel_id: 'team-room', thread_id: posted.threadId });
      await call('squad_post_channel', { channel_id: 'private-room', text: 'Must be refused.' });
      await call('squad_create_channel', { name: 'release-review', members: ['Eva Green'] });
    }
    if (scenario === 'tasks') {
      const added = (await call('squad_task', { op: 'add', title: 'Review the release notes', detail: 'Check accessibility notes.' })).result.structuredContent;
      await call('squad_work_plan', {});
      await call('squad_task', { op: 'update', id: added.taskId, status: 'doing' });
      await call('squad_task', { op: 'done', id: added.taskId, outcome: 'Release notes reviewed.' });
    }
    if (scenario === 'old-name') await call('squad_message', { to: 'Noah', message: 'Still there?', wait_seconds: 30 });
    if (scenario === 'schedule') await call('squad_schedule', { title: 'Call Sam', instructions: 'Remind Igor to call Sam about the contract.', schedule: { kind: 'once', date: '2099-01-02', time: '09:00' }, timezone: 'Pacific/Auckland' });
    if (scenario === 'schedule-nozone') await call('squad_schedule', { title: 'Stretch', instructions: 'Remind Igor to stretch.', schedule: { kind: 'once', date: '2099-01-03', time: '15:00' } });
    if (scenario === 'teach') await call('squad_teach', { text: 'Use release smoke checks before customer handoff.', request_id: 'transport-teach-once' });
  } finally { proxy.kill(); }
  say('Fixture turn done.');
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

try {
  // --- pure pieces --------------------------------------------------------
  assert.deepEqual(TEAM_TOOL_NAMES, ["squad_team", "squad_message", "squad_replies", "squad_teach", "squad_remember", "squad_recall", "squad_forget", "squad_set_profile", "squad_schedule", "squad_get_profile", "squad_update_memory", "squad_channels", "squad_channel_messages", "squad_post_channel", "squad_create_channel", "squad_work_plan", "squad_task"]);
  const roster = [{ id: "a1", name: "Eva Green" }, { id: "a2", name: "Noah" }, { id: "a3", name: "Max Power" }, { id: "a4", name: "Max Steel" }];
  assert.equal(resolveTeammate("@Eva,", roster).member?.id, "a1", "a first name with @ and a comma finds the teammate");
  assert.equal(resolveTeammate("eva green", roster).member?.id, "a1");
  assert.equal(resolveTeammate("EvaGreen", roster).member?.id, "a1");
  assert.equal(resolveTeammate("a2", roster).member?.id, "a2");
  assert.match(resolveTeammate("Max", roster).reason, /more than one/);
  assert.equal(resolveTeammate("Max Power", roster).member?.id, "a3");
  const renamed = [{ id: "r1", name: "Robert", formerNames: ["Max"] }, { id: "r2", name: "Eva" }];
  assert.equal(resolveTeammate("@Max", renamed).member?.id, "r1", "a former name reaches the renamed teammate");
  assert.equal(resolveTeammate("Max", [...renamed, { id: "r3", name: "Max" }]).member?.id, "r3", "someone who has the name now wins over a former name");
  assert.match(resolveTeammate("Zoe", roster).reason, /no teammate called Zoe/);
  assert.equal(looksSecret("token: abcdef123456"), true);
  assert.equal(looksSecret("Igor likes short replies"), false);
  assert.equal(memoryKey("Igor prefers short replies."), memoryKey("igor prefers  short replies!"), "case, spacing and the full stop do not make a second memory");
  assert.notEqual(memoryKey("Ship on Friday"), memoryKey("Ship on Monday"));
  for (const shape of ["Staging is https://deploy:Hunter2pass@staging.example.com", "github_pat_11ABCDEFG0123456789_abcdefghijklmnop", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmn", "glpat-abcdefghij0123456789", "AIzaSyA1234567890abcdefghijklmnopqrstuv"]) {
    assert.equal(looksSecret(shape), true, `a credential is refused: ${shape.slice(0, 16)}`);
  }
  assert.equal(looksSecret("Release 2.1 is commit 3f2a9c1e5b7d4a6f8e0c2b4d6f8a0c2e4b6d8f0a"), false, "a commit hash is not a secret");
  assert.throws(() => cleanMemoryText("  "), /say what to remember/);
  assert.match(teamInstructions({ memory: [{ scope: "team", text: "Ship on Fridays", authorName: "Eva" }], memberId: "x" }), /Team memory \(shared by every member\):\n- Ship on Fridays \(saved by Eva\)/);
  assert.match(teamInstructions({ depth: 2 }), /do not message further teammates/);
  const many = Array.from({ length: 62 }, (_, i) => ({ scope: "team", text: `Fact ${i}` }));
  const manyText = teamInstructions({ memory: many, memberId: "x" });
  assert.ok(manyText.includes("- (2 older entries are not shown here; squad_recall finds them)") && manyText.includes("- Fact 61") && !manyText.includes("- Fact 1\n"), "past 60 entries the prompt says the oldest are in squad_recall");
  // Naming a member is a profile change (ADR-0134 extends ADR-0126's phrases).
  for (const phrase of ["change your name to Viggas", "your name is Robert", "you will be called Robert", "I'll call you Robert", "call yourself Robert", "from now on you're Robert", "rename yourself to Robert", "I want to call you Growth X"]) {
    assert.equal(asksForRole(phrase), true, `"${phrase}" carries the profile instruction`);
  }
  for (const phrase of ["call Sam tomorrow", "what is your name?", "can you be quick", "name the file report.md"]) {
    assert.equal(asksForRole(phrase), false, `"${phrase}" is not a profile change`);
  }
  assert.equal(needsShapingInstruction({ role: "QA" }, "your name is Robert"), true);

  await Promise.all([mkdir(state, { recursive: true }), mkdir(home, { recursive: true }), mkdir(join(directory, "codex"), { recursive: true })]);
  await writeFile(config, JSON.stringify({ provider: "autohandai", autohandai: { model: "auto" } }));
  await writeFile(join(state, "notifications.json"), JSON.stringify({ version: 1, settings: { runFinished: false, runFailed: false, handoffPending: false, approvalPending: false, mention: false }, items: [] }));
  await writeFile(join(directory, "codex", "auth.json"), "{}");
  await writeFile(harness, fakeCodex);
  await chmod(harness, 0o700);

  start();
  await until(async () => (await api("/api/team")).success);
  await api("/api/status/snapshot", { members: squadMembers, jobs: [] });
  // The app registers its squad designer like a member; it is not a teammate.
  assert.equal((await api("/api/members/squad-designer/channel-access", { agent: { id: "squad-designer", name: "Squad member" }, profile: "" }, "PUT")).status, 200);

  // --- message: Noah asks Eva and reads her reply inside his turn ---------
  let result = await chat(noah, "team-scenario-message");
  assert.equal(result.success, true, result.text);
  let log = await entries();
  const noahHarness = log.find((entry) => entry.kind === "harness" && entry.who === "Noah");
  assert.equal(noahHarness?.teamManaged, true, "the team server reaches Codex");
  assert.equal(noahHarness.timeout, 120, "Codex gets a tool timeout longer than a teammate's reply");
  assert.match(noahHarness.prompt, /squad_message asks one and returns their reply/, "the member is told about its team tools");
  const tools = log.find((entry) => entry.kind === "tools");
  assert.deepEqual(tools.response.result.tools.map((tool) => tool.name), TEAM_TOOL_NAMES);
  const team = JSON.parse(toolText(log.find((entry) => entry.name === "squad_team")));
  assert.deepEqual(team.teammates.map((member) => [member.name, member.engine]), [["Eva Green", "codex"]]);
  const asked = JSON.parse(toolText(log.find((entry) => entry.name === "squad_message" && /Is the build/.test(JSON.stringify(entry)) || entry.name === "squad_message")));
  assert.equal(asked.status, "replied", JSON.stringify(asked));
  assert.equal(asked.from, "Eva Green");
  assert.match(asked.reply, /the build is green/, JSON.stringify(log.filter((e) => e.kind === "harness").map((e) => e.ask)));
  const evaTurn = log.find((entry) => entry.kind === "harness" && /Message from Noah \(Frontend\)/.test(entry.prompt));
  assert.ok(evaTurn, "Eva ran a turn of her own with Noah's message");
  assert.match(evaTurn.prompt, /Is the build green\?/);
  const nobody = log.filter((entry) => entry.name === "squad_message")[1];
  assert.equal(nobody.response.result.isError, true);
  assert.match(toolText(nobody), /no teammate called Nobody/);
  assert.ok(result.data.channelActions?.some((receipt) => receipt.type === "team_message" && receipt.toId === eva.id), "the turn records who was asked");
  let shared = await api("/api/team");
  assert.equal(shared.data.deliveries.at(-1).status, "completed");
  assert.equal(shared.data.deliveries.at(-1).fromId, noah.id);

  // --- from a channel thread, the exchange is posted in that thread ---------
  // (bug hunt 2026-10: it was only a run, so the person could not see it).
  await api("/api/channels", { id: "team-room", name: "team-room", memberIds: [noah.id, eva.id] });
  result = await api("/api/chat", { agentId: noah.id, agent: noah, workspace: root, prompt: "team-scenario-message", resumeSession: false, squadMembers, requestId: "room-thread-noah", channelId: "team-room", threadId: "room-thread", parentMessageId: "room-thread-root", channel: { id: "team-room", name: "team-room", threadId: "room-thread", parentMessageId: "room-thread-root", memberIds: [noah.id, eva.id] } });
  assert.equal(result.success, true, result.text);
  const room = JSON.parse(await readFile(join(state, "channels.json"), "utf8")).messages.filter((message) => message.channelId === "team-room" && message.threadId === "room-thread");
  const askPosted = room.find((message) => message.id.endsWith("-ask"));
  const replyPosted = room.find((message) => message.id.endsWith("-reply"));
  assert.equal(askPosted?.agentId, noah.id, JSON.stringify(room));
  assert.equal(askPosted.body, "@Eva Is the build green?");
  assert.equal(replyPosted?.agentId, eva.id);
  assert.match(replyPosted.body, /the build is green/);
  assert.equal(replyPosted.relayFromAgentId, noah.id);
  assert.equal(replyPosted.parentMessageId, "room-thread-root");
  assert.equal(room.filter((message) => message.id.endsWith("-reply")).length, 1, "the failed second message is not posted");

  await api("/api/channels", { id: "private-room", name: "private-room", visibility: "private", memberIds: [eva.id] });
  result = await chat(noah, "team-scenario-channels");
  assert.equal(result.success, true, result.text);
  log = await entries();
  const channelCalls = log.filter(entry => entry.scenario === "channels");
  const listed = channelCalls.find(entry => entry.name === "squad_channels").response.result.structuredContent.channels;
  assert.ok(listed.some(channel => channel.id === "team-room" && channel.replyMode === "thread"));
  assert.ok(!listed.some(channel => channel.id === "private-room"), "private channels stay outside a non-member's directory");
  const posts = channelCalls.filter(entry => entry.name === "squad_post_channel");
  assert.equal(posts[0].response.result.structuredContent.status, "published");
  assert.equal(posts[1].response.result.structuredContent.duplicate, true);
  assert.equal(posts[3].response.result.isError, true, "a member cannot post in someone else's private channel");
  const channelMessages = channelCalls.find(entry => entry.name === "squad_channel_messages").response.result.structuredContent.messages;
  assert.equal(channelMessages.length, 2, "publication is persisted once and the follow-up is in its thread");
  assert.equal(channelMessages[1].parentMessageId, channelMessages[0].id);
  assert.equal(channelCalls.find(entry => entry.name === "squad_create_channel").response.result.structuredContent.status, "proposed", "MCP channel creation retains the person's existing Ask policy");

  result = await chat(noah, "team-scenario-tasks");
  assert.equal(result.success, true, result.text);
  log = await entries();
  const taskCalls = log.filter(entry => entry.scenario === "tasks");
  assert.equal(taskCalls.find(entry => entry.name === "squad_work_plan").response.result.structuredContent.tasks[0].title, "Review the release notes");
  assert.deepEqual(taskCalls.filter(entry => entry.name === "squad_task").map(entry => entry.response.result.structuredContent.status), ["added", "updated", "done"]);
  const work = JSON.parse(await readFile(join(state, "work.json"), "utf8"));
  assert.equal(work.tasks.find(task => task.memberId === noah.id).status, "done");

  // --- remember: team memory reaches Eva's next prompt --------------------
  result = await chat(noah, "team-scenario-remember");
  assert.equal(result.success, true, result.text);
  log = await entries();
  const remembered = log.filter((entry) => entry.name === "squad_remember");
  assert.equal(JSON.parse(toolText(remembered[0])).saved, true);
  assert.equal(JSON.parse(toolText(remembered[1])).alreadyKnown, true, "the same memory is not saved twice");
  assert.equal(JSON.parse(toolText(remembered[2])).scope, "me");
  assert.equal(remembered[3].response.result.isError, true, "a secret is refused");
  assert.match(toolText(remembered[3]), /vault/);
  assert.match(result.data.reply, /Remembered for the team: Igor writes in NZ English/, "the person sees what was saved");
  shared = await api("/api/team");
  assert.equal(shared.data.memory.length, 2);
  assert.ok(!JSON.stringify(shared.data).includes("sk-live"), "the refused secret is stored nowhere");
  await chat(eva, "plain turn");
  log = await entries();
  const evaNext = log.filter((entry) => entry.kind === "harness" && entry.who === "Eva Green").at(-1);
  assert.match(evaNext.prompt, /Team memory \(shared by every member\):\n- Igor writes in NZ English and wants short replies\. \(saved by Noah\)/, "a Codex teammate reads what another member saved");
  const evaMemory = evaNext.prompt.split("Team memory (shared by every member):")[1].split("\n\n")[0];
  assert.ok(!evaMemory.includes("Noah owns the landing page"), "a personal memory is not in a teammate's memory");
  assert.ok(!/Your own memory:/.test(evaNext.prompt), "Eva has no personal memory of her own yet");

  // --- forget: Eva cannot remove what Noah saved; the person can ----------
  result = await chat(eva, "team-scenario-forget");
  log = await entries();
  const evaForget = log.filter((entry) => entry.name === "squad_forget").at(-1);
  assert.equal(evaForget.response.result.isError, true);
  assert.match(toolText(evaForget), /only the member who saved a memory, or the person/);
  const teamEntry = (await api("/api/team")).data.memory.find((entry) => entry.scope === "team");
  const removed = await api(`/api/team/memory/${teamEntry.id}`, undefined, "DELETE");
  assert.equal(removed.success, true, removed.text);
  const added = await api("/api/team/memory", { text: "Releases go out on Thursdays." });
  assert.equal(added.data.authorName, "You");
  const refused = await api("/api/team/memory", { text: "password: hunter2hunter2" });
  assert.equal(refused.status, 400);

  // --- rename: the profile changes and the team learns the new name -------
  result = await chat(noah, "team-scenario-rename");
  assert.equal(result.success, true, result.text);
  const profile = result.data.channelActions.find((receipt) => receipt.type === "profile");
  assert.equal(profile?.status, "applied", JSON.stringify(result.data.channelActions));
  assert.deepEqual(profile.patch, { name: "Robert" });
  assert.equal(profile.message, "Noah is now called Robert.");
  shared = await api("/api/team");
  assert.ok(shared.data.memory.some((entry) => entry.text === "Noah is now called Robert, " || entry.text === "Noah is now called Robert."), JSON.stringify(shared.data.memory));
  const channelsFile = JSON.parse(await readFile(join(state, "channels.json"), "utf8"));
  assert.equal(channelsFile.agentChannelAccess[noah.id].agent.name, "Robert", "the bridge's member copy has the new name");
  result = await chat({ ...noah, name: "Robert" }, "team-scenario-rename-again");
  assert.equal(result.success, true, result.text);
  shared = await api("/api/team");
  const renames = shared.data.memory.filter((entry) => entry.source === "rename");
  assert.deepEqual(renames.map((entry) => entry.text), ["Robert is now called Rob (earlier Noah)."], "a second rename replaces the first, which was no longer true");
  result = await chat(noah, "team-scenario-profile");
  assert.equal(result.success, true, result.text);
  log = await entries();
  const profileCalls = log.filter(entry => entry.scenario === "profile");
  const persisted = profileCalls.find(entry => entry.name === "squad_get_profile").response.result.structuredContent;
  assert.equal(persisted.name, "Rob", "a stale launch payload cannot undo an earlier rename");
  assert.equal(persisted.description, "Owns the release experience.");
  assert.equal(persisted.instructions, "Verify the shipped UI.");
  assert.match(persisted.personality, /Concise, candid and patient/);
  assert.deepEqual(persisted.skills, ["accessibility", "release QA"]);
  assert.ok(persisted.revision > profile.profileRevision);
  for (const invalid of profileCalls.filter(entry => entry.name === "squad_set_profile").slice(1)) assert.equal(invalid.response.result.isError, true, "spoofed identity and wrong field types fail as MCP tool errors");
  const savedProfile = JSON.parse(await readFile(join(app, "agents", noah.id, "profile.json"), "utf8"));
  assert.equal(savedProfile.name, "Rob");
  assert.equal(savedProfile.description, persisted.description, "the file projection is updated before the next run");
  assert.equal(savedProfile.profileRevision, persisted.revision);
  result = await chat(eva, "team-scenario-old-name");
  log = await entries();
  const oldName = JSON.parse(toolText(log.filter((entry) => entry.name === "squad_message").at(-1)));
  assert.equal(oldName.from, "Rob", `a message to "Noah" reaches him as Rob: ${JSON.stringify(oldName)}`);
  // A rename in Edit profile reaches the team too: the window saves the
  // member copy, and that is where every rename passes.
  assert.equal((await api(`/api/members/${eva.id}/channel-access`, { agent: { ...eva, name: "Evie" }, profilePatch: { name: "Evie" }, profile: "" }, "PUT")).status, 200);
  shared = await api("/api/team");
  assert.ok(shared.data.memory.some((entry) => entry.source === "rename" && entry.text === "Eva Green is now called Evie."), JSON.stringify(shared.data.memory.map((entry) => entry.text)));
  assert.equal((await api(`/api/members/${eva.id}/channel-access`, { agent: { ...eva, name: "Evie" }, profilePatch: { name: "Evie" }, profile: "" }, "PUT")).status, 200);
  assert.equal((await api("/api/team")).data.memory.filter((entry) => entry.source === "rename").length, 2, "saving the same name again tells nobody anything");
  // The copy keeps the old name for @mentions, and the saved profile takes
  // the new one now rather than at Eva's next run.
  assert.deepEqual(JSON.parse(await readFile(join(state, "channels.json"), "utf8")).agentChannelAccess[eva.id].agent.formerNames, ["Eva Green"]);
  assert.equal(JSON.parse(await readFile(join(app, "agents", eva.id, "profile.json"), "utf8")).name, "Evie", "profile.json follows the rename before the next run");

  // --- scheduling is real and automatic; editor drafts stay inert --------
  result = await chat(eva, "team-scenario-schedule");
  assert.equal(result.success, true, result.text);
  const proposal = result.data.channelActions.find((receipt) => receipt.type === "schedule");
  assert.ok(proposal, JSON.stringify(result.data.channelActions));
  assert.equal(proposal.status, "confirmed", JSON.stringify(proposal));
  assert.ok((await api(`/api/routines/${proposal.routineId}`)).data.enabled);
  log = await entries();
  assert.match(toolText(log.filter((entry) => entry.name === "squad_schedule").at(-1)), /saved and enabled/);
  // The timezone is optional in the tool; without one the person's zone is used.
  result = await chat(eva, "team-scenario-schedule-nozone");
  const zoneless = result.data.channelActions.find((receipt) => receipt.type === "schedule");
  assert.equal(zoneless?.status, "confirmed", JSON.stringify(result.data.channelActions));
  const stretch = (await api("/api/routines/proposals")).data.proposals.find((item) => item.title === "Stretch");
  assert.equal(stretch?.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", JSON.stringify(stretch));
  const beforeDraft = (await api('/api/routines')).data.routines.length;
  const draft = await api('/api/routines/draft', {memberId:eva.id,agent:eva,workspace:root,text:'Remind Igor to call Sam tomorrow at 9',timeZone:'Pacific/Auckland'});
  assert.equal(draft.success,true,draft.text);
  assert.ok(draft.data.draft);
  assert.equal((await api('/api/routines')).data.routines.length,beforeDraft,'managed MCP drafting cannot activate a schedule');

  result = await chat(noah, 'team-scenario-teach');
  assert.equal(result.success,true,result.text);
  const teaching = result.data.channelActions.find(receipt=>receipt.type==='team_teaching');
  assert.equal(teaching.deliveryIds.length,1);
  await until(async()=>{const shared=(await api('/api/team')).data;return shared.deliveries.find(item=>item.id===teaching.deliveryIds[0])?.status==='completed';});
  assert.ok((await api('/api/team')).data.memory.some(item=>item.text.includes('release smoke checks')));

  // --- a resumed Codex thread still gets the turn's context ----------------
  const resumed = (prompt) => api("/api/chat", { agentId: eva.id, agent: eva, workspace: root, prompt, squadMembers });
  await resumed("first resumable turn");
  await resumed("second resumable turn");
  log = await entries();
  const second = log.filter((entry) => entry.kind === "harness" && entry.who === "" && /second resumable turn/.test(entry.prompt)).at(-1) || log.filter((entry) => entry.kind === "harness" && /second resumable turn/.test(entry.prompt)).at(-1);
  assert.match(second.resume, /^thread-/, "the second turn resumes Eva's thread");
  assert.match(second.prompt, /<turn_context>[\s\S]*Releases go out on Thursdays\./, "a resumed thread still receives team memory");
  assert.ok(!second.prompt.includes("<operating_instructions>"), "unchanged instructions are not sent again");
  await api("/api/team/memory", { text: "Eva is the release captain this week." });
  await resumed("third resumable turn");
  log = await entries();
  const third = log.filter((entry) => entry.kind === "harness" && /third resumable turn/.test(entry.prompt)).at(-1);
  assert.match(third.prompt, /Eva is the release captain this week\./, "new team memory reaches the next resumed turn");
  const renamedEva = { ...eva, name: "Evelyn" };
  assert.equal((await api(`/api/members/${eva.id}/channel-access`, { agent: renamedEva, profilePatch: { name: "Evelyn" } }, "PUT")).status, 200);
  await api("/api/chat", { agentId: eva.id, agent: renamedEva, workspace: root, prompt: "fourth resumable turn", squadMembers: [noah, renamedEva] });
  log = await entries();
  const fourth = log.filter((entry) => entry.kind === "harness" && /fourth resumable turn/.test(entry.prompt)).at(-1);
  assert.match(fourth.prompt, /<operating_instructions>[\s\S]*Member: Evelyn/, "changed instructions are sent again on a resumed thread");

  // --- a copy renamed before its profile text followed is put right at start
  const max = { id: "team-max", name: "Max", role: "Growth", workspace: root, projects: [{ path: root }], harness: { id: "codex", executablePath: harness } };
  assert.equal((await api(`/api/members/${max.id}/channel-access`, { agent: max, profile: "Agent ID: team-max\nName: Max\nRole: Growth" }, "PUT")).status, 200);
  await stop();
  const before = JSON.parse(await readFile(join(state, "channels.json"), "utf8"));
  before.agentChannelAccess[max.id].agent.name = "Robert";
  await writeFile(join(state, "channels.json"), JSON.stringify(before));
  await mkdir(join(app, "agents", max.id), { recursive: true });
  await writeFile(join(app, "agents", max.id, "profile.json"), JSON.stringify({ id: max.id, name: "Max" }));
  start();
  const migrated = await until(async () => {
    const copy = JSON.parse(await readFile(join(state, "channels.json"), "utf8")).agentChannelAccess[max.id];
    return copy.profile.includes("Name: Robert") && copy;
  });
  assert.ok(!migrated.profile.includes("Name: Max"));
  assert.deepEqual(migrated.agent.formerNames, ["Max"]);
  await until(async () => (await api("/api/team")).data.memory.some((entry) => entry.source === "rename" && entry.text === "Max is now called Robert."));
  await until(async () => JSON.parse(await readFile(join(app, "agents", max.id, "profile.json"), "utf8")).name === "Robert");

  // --- a stale token is refused -------------------------------------------
  const stale = await fetch(`${origin}/api/team/mcp`, { method: "POST", headers: { "content-type": "application/json", "x-squad-team-token": "nope" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(stale.status, 401);

  console.log("Team check passed: messages between members, shared memory, rename and schedule through the managed MCP server.");
} catch (error) {
  console.error(logs.slice(-3000));
  throw error;
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
