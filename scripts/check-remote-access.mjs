#!/usr/bin/env node
// Telegram remote access (ADR-0102): the pure formatting and pairing rules,
// the browser reconciliation helper, and the real bridge driven end to end
// in an isolated state dir against a fake Telegram Bot API on loopback and a
// disposable Codex-shaped member fixture. No vendor, credentials, installed
// app, or provider requests are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { markdownToTelegramHtml, splitMarkdown, tablesToLines, renderStatus } from "../server/remote-access/format.mjs";
import { evaluateSender, normalizeState, pairingCodeFrom, publicStatus, shouldNotifyFinished, unpaired } from "../server/remote-access/pairing.mjs";
import { reconcileRemoteTurns, remoteAccessDetail, remoteTurnMessages } from "../src/lib/remote-access.js";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

// --- pure: formatting --------------------------------------------------------
{
  const html = markdownToTelegramHtml("# Title\n\nSome **bold** and `code` and a [link](https://example.test/x?a=1&b=2).\n\n```js\nconst a = 1 < 2;\n```\n- one\n- two\n> quoted");
  assert.ok(html.includes("<b>Title</b>"), "heading becomes bold");
  assert.ok(html.includes("<b>bold</b>") && html.includes("<code>code</code>"));
  assert.ok(html.includes('<a href="https://example.test/x?a=1&amp;b=2">link</a>'), "link survives escaping");
  assert.ok(html.includes('<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>'), "fenced code is escaped and kept");
  assert.ok(html.includes("• one\n• two"), "bullets");
  assert.ok(html.includes("<blockquote>quoted</blockquote>"));
  const table = tablesToLines("| Name | Status |\n| --- | --- |\n| build | ok |\n| test | failed |\nafter");
  assert.equal(table, "*Name · Status*\n- **build** · ok\n- **test** · failed\nafter", "tables become readable lines");
  const long = Array.from({ length: 300 }, (_, index) => `line ${index} ${"x".repeat(20)}`).join("\n\n");
  const pieces = splitMarkdown(long, 1000);
  assert.ok(pieces.length > 1 && pieces.every((piece) => piece.length <= 1150), "long replies split under the limit");
  assert.equal(pieces.join("\n").replace(/\n+/g, "\n"), long.replace(/\n+/g, "\n"), "splitting loses no text");
  const status = renderStatus({ memberName: "Kai <x>", steps: ["read a.txt"], done: true, elapsedMs: 2500 });
  assert.ok(status.startsWith("<code>✓ Kai &lt;x&gt; · 1 step · 2.5s</code>"), status);
}

// --- pure: pairing -----------------------------------------------------------
{
  const fresh = normalizeState(null);
  assert.equal(fresh.pairingCode.length, 8);
  assert.equal(fresh.notifyMode, "long");
  assert.equal(pairingCodeFrom(`/start@squad_bot ${fresh.pairingCode.toLowerCase()}`), fresh.pairingCode, "deep-link start carries the code, case-insensitive");
  assert.equal(pairingCodeFrom("/start"), "");
  const stranger = { id: 7, username: "stranger" };
  const refused = evaluateSender(fresh, { from: stranger, chatId: 7, text: "hello" });
  assert.equal(refused.kind, "refused");
  assert.equal(refused.state.pairingCode, fresh.pairingCode, "plain chatter does not rotate the code");
  const wrong = evaluateSender(fresh, { from: stranger, chatId: 7, text: "/pair NOPE1234" });
  assert.equal(wrong.kind, "refused");
  assert.notEqual(wrong.state.pairingCode, fresh.pairingCode, "a wrong code rotates the code");
  assert.equal(wrong.state.pairingFailures, 1);
  const paired = evaluateSender(wrong.state, { from: { id: 9, first_name: "Igor" }, chatId: 9, text: `/pair ${wrong.state.pairingCode}` });
  assert.equal(paired.kind, "paired");
  assert.deepEqual({ id: paired.state.owner.id, name: paired.state.owner.name, chatId: paired.state.owner.chatId }, { id: 9, name: "Igor", chatId: 9 });
  assert.equal(paired.state.pairingCode, "", "the code is single-use");
  assert.equal(evaluateSender(paired.state, { from: { id: 9 }, chatId: 9, text: "hi" }).kind, "owner");
  assert.equal(evaluateSender(paired.state, { from: stranger, chatId: 7, text: `/pair ${fresh.pairingCode}` }).kind, "refused", "a second account cannot pair");
  const again = unpaired(paired.state);
  assert.equal(again.owner, null);
  assert.ok(again.pairingCode.length === 8);
  const visible = publicStatus({ ...paired.state, token: "123:SECRET-TOKEN-VALUE" }, { polling: true });
  assert.ok(!JSON.stringify(visible).includes("SECRET-TOKEN-VALUE"), "status never carries the token");
  assert.equal(visible.tokenHint, "…ALUE");
  assert.ok(shouldNotifyFinished({ status: "failed", durationMs: 10, mode: "off" }), "failures always notify");
  assert.ok(!shouldNotifyFinished({ status: "completed", durationMs: 59_000, mode: "long" }));
  assert.ok(shouldNotifyFinished({ status: "completed", durationMs: 60_000, mode: "long" }));
  assert.ok(!shouldNotifyFinished({ status: "completed", durationMs: NaN, mode: "long" }), "unknown duration is not long");
  assert.ok(shouldNotifyFinished({ status: "completed", durationMs: NaN, mode: "all" }));
  assert.ok(!shouldNotifyFinished({ status: "completed", durationMs: 600_000, mode: "off" }));
}

// --- pure: browser reconciliation ---------------------------------------------
{
  const members = [{ id: "kai", name: "Kai" }, { id: "eva", name: "Eva", conversationStartedAt: "2026-10-13T10:00:00.000Z" }];
  const running = { id: "t1", memberId: "kai", prompt: "Say hello", reply: "", status: "running", startedAt: "2026-10-13T09:00:00.000Z", updatedAt: "2026-10-13T09:00:00.000Z" };
  const first = reconcileRemoteTurns({ kai: [{ id: "old", role: "agent", body: "earlier", createdAt: "2026-10-13T08:00:00.000Z" }] }, [running], members);
  assert.deepEqual(first.kai.map((message) => message.id), ["old", "remote-t1-u", "remote-t1-a"]);
  assert.equal(first.kai[1].body, "Say hello");
  assert.equal(first.kai[2].status, "loading");
  const unchanged = reconcileRemoteTurns(first, [running], members);
  assert.equal(unchanged, first, "an unchanged turn does not touch state");
  const finished = { ...running, status: "completed", reply: "Hello back", updatedAt: "2026-10-13T09:00:05.000Z", finishedAt: "2026-10-13T09:00:05.000Z" };
  const second = reconcileRemoteTurns(first, [finished], members);
  assert.equal(second.kai.length, 3, "the reply patches the same row");
  assert.equal(second.kai[2].body, "Hello back");
  assert.equal(second.kai[2].status, "complete");
  const stale = reconcileRemoteTurns({}, [{ ...finished, id: "t2", memberId: "eva", startedAt: "2026-10-13T09:30:00.000Z" }], members);
  assert.deepEqual(stale, {}, "turns before /new stay out of a cleared conversation");
  const failed = remoteTurnMessages({ ...finished, status: "failed", reply: "", error: "boom" })[1];
  assert.equal(failed.status, "error");
  assert.equal(failed.body, "boom");
  assert.equal(remoteAccessDetail({ configured: false }), "Off");
  assert.equal(remoteAccessDetail({ configured: true, polling: true, bot: { username: "b" } }), "Waiting to pair");
  assert.equal(remoteAccessDetail({ configured: true, paired: { name: "@igor" } }), "@igor");
}

// --- fake Telegram Bot API ----------------------------------------------------
const VALID_TOKEN = "123456789:AAHfixtureTokenNotRealDoNotUse0000";
async function startFakeTelegram() {
  const calls = [];
  const pending = [];
  let queue = [];
  let messageId = 100;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const match = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
      const reply = (payload) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (!match) return reply({ ok: false, error_code: 404, description: "Not Found" });
      const [, token, method] = match;
      let params = {};
      try { params = body ? JSON.parse(body) : {}; } catch { params = {}; }
      calls.push({ method, params, token });
      if (token !== VALID_TOKEN) return reply({ ok: false, error_code: 401, description: "Unauthorized" });
      switch (method) {
        case "getMe": return reply({ ok: true, result: { id: 42, is_bot: true, first_name: "Squad Fixture", username: "squad_fixture_bot" } });
        case "getUpdates": {
          const offset = Number(params.offset) || 0;
          queue = queue.filter((update) => update.update_id >= offset);
          const deliver = () => {
            const batch = queue.filter((update) => update.update_id >= offset);
            reply({ ok: true, result: batch });
          };
          if (queue.length) return deliver();
          const timer = setTimeout(() => { pending.splice(pending.indexOf(entry), 1); deliver(); }, Math.min(Number(params.timeout) || 0, 2) * 1000);
          const entry = { deliver: () => { clearTimeout(timer); deliver(); } };
          pending.push(entry);
          return undefined;
        }
        case "sendMessage": return reply({ ok: true, result: { message_id: ++messageId, chat: { id: params.chat_id }, text: params.text } });
        default: return reply({ ok: true, result: true });
      }
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  let updateId = 1;
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    callsOf: (method) => calls.filter((call) => call.method === method),
    push(update) {
      queue.push({ update_id: updateId++, ...update });
      for (const entry of pending.splice(0)) entry.deliver();
    },
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

// --- bridge fixture ---------------------------------------------------------
async function freePort() {
  const socket = createNetServer();
  await new Promise((resolveListen) => socket.listen(0, "127.0.0.1", resolveListen));
  const port = socket.address().port;
  await new Promise((resolveClose) => socket.close(resolveClose));
  return port;
}

const directory = await mkdtemp(join(tmpdir(), "squad-remote-access-"));
const squadHome = join(directory, "squad");
const fake = join(directory, "fixture-codex");
const callsFile = join(directory, "calls.jsonl");
const telegram = await startFakeTelegram();
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
let bridge = null;
let logs = "";

async function until(fn, label, timeout = 12_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(25);
  }
  throw new Error(`${label} timed out${last ? `: ${last.message}` : ""}; bridge: ${logs.slice(-3000)}`);
}
const api = async (path, method = "GET", body) => {
  const response = await fetch(origin + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  return { status: response.status, ...(await response.json()) };
};
async function stopBridge() {
  if (!bridge || bridge.exitCode !== null) return;
  const exited = new Promise((resolveExit) => bridge.once("exit", resolveExit));
  bridge.kill("SIGTERM");
  await Promise.race([exited, delay(3000)]);
  if (bridge.exitCode === null) { bridge.kill("SIGKILL"); await exited; }
}
async function startBridge() {
  bridge = spawn(process.execPath, ["server.mjs", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: rootDir,
    env: {
      ...process.env,
      AUTOHAND_SQUAD_HOME: squadHome,
      AUTOHAND_SQUAD_APP_STATE_DIR: join(directory, "app"),
      AUTOHAND_HOME: join(directory, "autohand"),
      AUTOHAND_USER_CONFIG_PATH: join(directory, "config.json"),
      CODEX_HOME: join(directory, "codex"),
      OPENAI_API_KEY: "fixture-only-no-provider",
      ANTHROPIC_API_KEY: "fixture-only-no-provider",
      AUTOHAND_SQUAD_TELEGRAM_API_URL: telegram.origin,
      AUTOHAND_SQUAD_TELEGRAM_POLL_SECONDS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stdout.on("data", (data) => { logs += data; });
  bridge.stderr.on("data", (data) => { logs += data; });
  await until(async () => (await api("/api/remote-access/status")).success, "bridge start", 60_000);
}

const OWNER = { id: 1001, is_bot: false, first_name: "Igor", username: "igor_owner" };
const STRANGER = { id: 2002, is_bot: false, first_name: "Someone" };
const text = (from, body) => ({ message: { message_id: Math.floor(Math.random() * 1e6), from, chat: { id: from.id, type: "private" }, date: Math.floor(Date.now() / 1000), text: body } });
const sentTo = (chatId) => telegram.callsOf("sendMessage").filter((call) => Number(call.params.chat_id) === chatId);
const member = { id: "kai", name: "Kai", role: "Engineer", harness: { id: "codex", executablePath: fake }, projects: [{ name: "repo", path: rootDir }], workspace: rootDir, permissions: { builtInPolicies: { squad_create_channel: "ask" } } };

try {
  await mkdir(join(directory, "codex"), { recursive: true });
  await writeFile(join(directory, "codex", "auth.json"), "{}");
  await mkdir(squadHome, { recursive: true });
  await writeFile(join(squadHome, "web-status.json"), JSON.stringify({ source: "web-console", updatedAt: new Date().toISOString(), members: [{ id: "kai", name: "Kai", role: "Engineer", status: "online" }] }));
  await writeFile(fake, `#!${process.execPath}
const fs = require('node:fs');
const file = ${JSON.stringify(callsFile)};
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex 1.0.0'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using fixture'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'fixture' })); process.exit(0); }
const prompt = args.at(-1);
const append = (x) => fs.appendFileSync(file, JSON.stringify(x) + '\\n');
append({ kind: 'start', args, cwd: process.cwd(), prompt });
process.on('SIGTERM', () => { append({ kind: 'abort' }); process.exit(143); });
const emit = (x) => console.log(JSON.stringify(x));
emit({ type: 'thread.started', thread_id: 'fixture-thread' });
emit({ type: 'item.completed', item: { id: 'plan', type: 'todo_list', items: [{ text: 'Answer from the fixture', completed: false }] } });
if (prompt.includes('HOLD fixture')) { setTimeout(() => process.exit(0), 45000); return; }
let reply = 'Hello from the fixture: ' + prompt.slice(0, 40) + '\\n\\n| Step | State |\\n| --- | --- |\\n| build | ok |';
if (prompt.includes('propose a channel')) reply = 'Opening a room.\\nSQUAD_ACTION: {"type":"create_channel","name":"ops-room","purpose":"Coordinate the fixture work"}';
emit({ type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: reply } });
emit({ type: 'turn.completed' });
`);
  await chmod(fake, 0o700);
  await startBridge();

  // The member's launch record, as the app registers it on its first chat.
  const access = await api("/api/members/kai/channel-access", "PUT", { agent: member, profile: "You are Kai, a fixture member." });
  assert.equal(access.success, true, JSON.stringify(access));

  // Unconfigured status carries no token and no pairing.
  const initial = await api("/api/remote-access/status");
  assert.equal(initial.data.configured, false);
  assert.equal(initial.data.pairing, null);

  // A bad token fails without being saved.
  const bad = await api("/api/remote-access/token", "PUT", { token: "123:bad-token" });
  assert.equal(bad.status, 400, JSON.stringify(bad));
  assert.match(bad.error, /rejected the bot token/);
  assert.equal((await api("/api/remote-access/status")).data.configured, false, "a rejected token is not saved");
  await assert.rejects(stat(join(squadHome, "remote-access.json")), "no state file is written for a rejected token");

  // A good token connects, registers commands, and starts polling.
  const connected = await api("/api/remote-access/token", "PUT", { token: VALID_TOKEN });
  assert.equal(connected.success, true, JSON.stringify(connected));
  assert.equal(connected.data.bot.username, "squad_fixture_bot");
  assert.equal(connected.data.tokenHint, `…${VALID_TOKEN.slice(-4)}`);
  assert.equal(connected.data.pairing.code.length, 8);
  assert.equal(connected.data.pairing.link, `https://t.me/squad_fixture_bot?start=${connected.data.pairing.code}`);
  await until(() => telegram.callsOf("getUpdates").length > 0, "long-poll starts");
  await until(() => telegram.callsOf("setMyCommands").length > 0, "commands registered");
  assert.deepEqual(telegram.callsOf("setMyCommands")[0].params.commands.map((command) => command.command), ["members", "channels", "new", "stop", "status", "help"]);
  const polling = await until(async () => { const { data } = await api("/api/remote-access/status"); return data.polling ? data : null; }, "polling status");
  assert.equal(polling.error, "");
  const fileMode = (await stat(join(squadHome, "remote-access.json"))).mode & 0o777;
  assert.equal(fileMode, 0o600, `state file mode ${fileMode.toString(8)}`);

  // An unpaired sender gets one line and nothing else.
  telegram.push(text(STRANGER, "hello?"));
  await until(() => sentTo(STRANGER.id).length === 1, "stranger refusal");
  assert.match(sentTo(STRANGER.id)[0].params.text, /isn't paired yet/);

  // A wrong code is refused and rotates the code.
  const beforeCode = (await api("/api/remote-access/status")).data.pairing.code;
  telegram.push(text(OWNER, "/pair WRONG123"));
  await until(() => sentTo(OWNER.id).length === 1, "wrong code refusal");
  assert.match(sentTo(OWNER.id)[0].params.text, /not valid/);
  const afterCode = await until(async () => { const code = (await api("/api/remote-access/status")).data.pairing?.code; return code && code !== beforeCode ? code : null; }, "code rotation");
  assert.notEqual(afterCode, beforeCode);

  // The deep link's /start CODE pairs exactly this account.
  telegram.push(text(OWNER, `/start ${afterCode}`));
  const pairedStatus = await until(async () => { const { data } = await api("/api/remote-access/status"); return data.paired ? data : null; }, "paired");
  assert.equal(pairedStatus.paired.name, "@igor_owner");
  assert.equal(pairedStatus.pairing, null, "no code is shown once paired");
  await until(() => sentTo(OWNER.id).length >= 3, "pairing confirmation and member picker");
  assert.match(sentTo(OWNER.id)[1].params.text, /Paired\./);
  const picker = sentTo(OWNER.id)[2];
  const pickButton = picker.params.reply_markup.inline_keyboard[0][0];
  assert.match(pickButton.text, /^Kai · Engineer/);
  assert.match(pickButton.callback_data, /^use:/);

  // A second account is refused after pairing, and never rotates anything.
  telegram.push(text(STRANGER, `/pair ${afterCode}`));
  await until(() => sentTo(STRANGER.id).length === 2, "second account refused");
  assert.match(sentTo(STRANGER.id)[1].params.text, /paired with another/);

  // Choosing a member edits the picker in place.
  telegram.push({ callback_query: { id: "cb-pick", from: OWNER, message: { message_id: 102, chat: { id: OWNER.id, type: "private" } }, data: pickButton.callback_data } });
  await until(() => telegram.callsOf("answerCallbackQuery").some((call) => call.params.callback_query_id === "cb-pick"), "pick answered");
  await until(() => telegram.callsOf("editMessageText").some((call) => /Now talking to <b>Kai<\/b>/.test(call.params.text)), "picker edited");
  assert.equal((await api("/api/remote-access/status")).data.target.memberId, "kai");

  // /help lists the commands.
  telegram.push(text(OWNER, "/help"));
  await until(() => sentTo(OWNER.id).some((call) => /\/members/.test(call.params.text) && /\/stop/.test(call.params.text)), "help text");

  // A message from the owner runs a bridge-owned turn and the reply comes back.
  const sentBefore = sentTo(OWNER.id).length;
  telegram.push(text(OWNER, "Say hello"));
  const replyCall = await until(() => sentTo(OWNER.id).slice(sentBefore).find((call) => /Hello from the fixture/.test(call.params.text)), "member reply");
  assert.equal(replyCall.params.parse_mode, "HTML");
  assert.ok(replyCall.params.text.includes("<i>Step · State</i>") && replyCall.params.text.includes("• <b>build</b> · ok"), `table rendered as lines: ${replyCall.params.text}`);
  const statusLine = [...telegram.callsOf("sendMessage"), ...telegram.callsOf("editMessageText")].find((call) => /✓ Kai · \d+ steps? · [\d.]+s/.test(call.params.text));
  assert.ok(statusLine, "one status message reports the finished turn");
  assert.ok(telegram.callsOf("sendChatAction").some((call) => call.params.action === "typing"), "typing indicator while working");
  const launches = (await readFile(callsFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).filter((line) => line.kind === "start");
  assert.equal(launches.length, 1, "one harness launch for one message");
  assert.equal(launches[0].cwd, rootDir, "the turn runs in the member's workspace");
  assert.ok(launches[0].prompt.endsWith("\nSay hello"), "the member receives the Telegram message with its usual operating instructions");
  const listed = await api("/api/remote-access/turns?memberId=kai");
  assert.equal(listed.data.turns.length, 1);
  assert.equal(listed.data.turns[0].status, "completed");
  assert.match(listed.data.turns[0].reply, /^Hello from the fixture/);
  assert.equal(listed.data.turns[0].source, "telegram");
  assert.ok(listed.data.turns[0].durationMs >= 0);
  assert.ok(!JSON.stringify(listed).includes(VALID_TOKEN) && !JSON.stringify(await api("/api/remote-access/status")).includes(VALID_TOKEN), "the token never reaches the browser");

  // A handoff that needs the person reaches the phone with a deep link.
  const handoffBefore = sentTo(OWNER.id).length;
  const raised = await api("/api/events", "POST", { name: "handoff.pending", taskId: "task-1", fromMemberId: "kai", toMemberId: "kai", title: "Review the fixture" });
  assert.equal(raised.success, true);
  const handoff = await until(() => sentTo(OWNER.id).slice(handoffBefore).find((call) => /needs you/.test(call.params.text)), "handoff notification");
  assert.ok(handoff.params.text.includes(`<a href="${origin}/inbox">Open in Squad</a>`), handoff.params.text);
  assert.match(handoff.params.text, /handoff: Review the fixture/);

  // Notify mode: everything / long / off.
  assert.equal((await api("/api/remote-access/settings", "PUT", { notifyMode: "all" })).data.notifyMode, "all");
  const allBefore = sentTo(OWNER.id).length;
  await api("/api/events", "POST", { name: "run.finished", runId: "run-x", memberId: "kai", status: "completed", title: "Build the fixture" });
  await until(() => sentTo(OWNER.id).slice(allBefore).some((call) => /Kai finished · Build the fixture/.test(call.params.text)), "finished run under 'all'");
  assert.equal((await api("/api/remote-access/settings", "PUT", { notifyMode: "off" })).data.notifyMode, "off");
  const offBefore = sentTo(OWNER.id).length;
  await api("/api/events", "POST", { name: "run.finished", runId: "run-y", memberId: "kai", status: "completed", title: "Quiet run" });
  await api("/api/events", "POST", { name: "run.finished", runId: "run-z", memberId: "kai", status: "failed", title: "Broken run" });
  await until(() => sentTo(OWNER.id).slice(offBefore).some((call) => /Kai failed · Broken run/.test(call.params.text)), "failed run under 'off'");
  await delay(300);
  assert.ok(!sentTo(OWNER.id).slice(offBefore).some((call) => /Quiet run/.test(call.params.text)), "a completed run stays quiet under 'off'");
  assert.equal((await api("/api/remote-access/settings", "PUT", { notifyMode: "long" })).data.notifyMode, "long");

  // A channel proposal arrives with Approve/Decline; approving reaches the bridge's decision route.
  const proposalBefore = sentTo(OWNER.id).length;
  telegram.push(text(OWNER, "please propose a channel"));
  const proposal = await until(() => sentTo(OWNER.id).slice(proposalBefore).find((call) => /Kai proposes #ops-room/.test(call.params.text)), "proposal notification");
  const buttons = proposal.params.reply_markup.inline_keyboard[0];
  assert.deepEqual(buttons.map((button) => button.text), ["✓ Approve", "✕ Decline"]);
  assert.match(buttons[0].callback_data, /^dec:[A-Za-z0-9_-]+:a$/);
  const proposed = (await api("/api/channel-actions")).data.find((record) => record.action?.name === "ops-room");
  assert.equal(proposed.status, "proposed");
  telegram.push({ callback_query: { id: "cb-approve", from: OWNER, message: { message_id: 555, chat: { id: OWNER.id, type: "private" } }, data: buttons[0].callback_data } });
  await until(async () => (await api("/api/channel-actions")).data.find((record) => record.id === proposed.id)?.status === "created", "proposal approved through the decision route");
  const outcome = await until(() => telegram.callsOf("editMessageText").find((call) => call.params.message_id === 555), "decision message edited");
  assert.match(outcome.params.text, /Approved from Telegram/);
  assert.deepEqual(outcome.params.reply_markup, { inline_keyboard: [] }, "the buttons are removed");
  assert.ok((await api("/api/channels")).data.channels.some((channel) => channel.name === "ops-room"), "the channel exists");
  telegram.push({ callback_query: { id: "cb-again", from: OWNER, message: { message_id: 555, chat: { id: OWNER.id, type: "private" } }, data: buttons[0].callback_data } });
  const again = await until(() => telegram.callsOf("answerCallbackQuery").find((call) => call.params.callback_query_id === "cb-again"), "second tap answered");
  assert.match(again.params.text, /already handled/);

  // /stop interrupts a running turn.
  const holdBefore = sentTo(OWNER.id).length;
  telegram.push(text(OWNER, "HOLD fixture please"));
  await until(async () => (await api("/api/remote-access/status")).data.running?.memberId === "kai", "turn running");
  telegram.push(text(OWNER, "/stop"));
  await until(() => sentTo(OWNER.id).slice(holdBefore).some((call) => /Stopped Kai/.test(call.params.text)), "stopped reply");
  const stoppedTurn = (await api("/api/remote-access/turns")).data.turns.find((turn) => turn.prompt.startsWith("HOLD"));
  assert.equal(stoppedTurn.status, "stopped");

  // State survives a bridge restart: token, bot, owner, turns, and polling resumes.
  const pollsBefore = telegram.callsOf("getUpdates").length;
  await stopBridge();
  await startBridge();
  const restored = await until(async () => { const { data } = await api("/api/remote-access/status"); return data.polling ? data : null; }, "polling after restart");
  assert.equal(restored.paired.name, "@igor_owner");
  assert.equal(restored.bot.username, "squad_fixture_bot");
  assert.equal(restored.target.memberId, "kai");
  assert.ok(telegram.callsOf("getUpdates").length > pollsBefore);
  const turnsAfter = (await api("/api/remote-access/turns?memberId=kai")).data.turns;
  assert.equal(turnsAfter.length, 3);
  assert.equal(turnsAfter[0].status, "completed");
  const afterRestart = sentTo(OWNER.id).length;
  telegram.push(text(OWNER, "Still there?"));
  await until(() => sentTo(OWNER.id).slice(afterRestart).some((call) => /Hello from the fixture: Still there\?/.test(call.params.text)), "reply after restart");

  // Unpair forgets the owner; the old owner is refused and a new code appears.
  const unpairedStatus = (await api("/api/remote-access/unpair", "POST")).data;
  assert.equal(unpairedStatus.paired, null);
  assert.equal(unpairedStatus.pairing.code.length, 8);
  const unpairBefore = sentTo(OWNER.id).length;
  telegram.push(text(OWNER, "hello again"));
  await until(() => sentTo(OWNER.id).slice(unpairBefore).some((call) => /isn't paired yet/.test(call.params.text)), "old owner refused after unpair");

  // Disconnect forgets the token; status goes back to off.
  const disconnected = (await api("/api/remote-access/token", "DELETE")).data;
  assert.equal(disconnected.configured, false);
  assert.ok(!(await readFile(join(squadHome, "remote-access.json"), "utf8")).includes(VALID_TOKEN), "the token is gone from disk");

  console.log("Remote access checks passed: formatting and pairing rules, browser reconciliation, bad token not saved, pairing with rotation and refusals, member picker, bridge-owned turn with status edits and a formatted reply, turns listed for the app, handoff deep link, notify modes, proposal Approve through the decision route, /stop, restart persistence, unpair and disconnect.");
} finally {
  await stopBridge();
  await telegram.close();
  await rm(directory, { recursive: true, force: true });
}
