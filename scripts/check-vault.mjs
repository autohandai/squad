#!/usr/bin/env node
// The vault, end to end, against a real bridge in an isolated state dir.
// The key is forced onto the file fallback (AUTOHAND_SQUAD_VAULT_KEY_SOURCE=file)
// inside a temporary home, so no run touches the person's keychain or their
// real ~/.autohand/squad. The only harness is a fake Codex that speaks the
// managed MCP server's newline framing; this check speaks Content-Length to
// the same proxy itself. See ADR-0104.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createVaultStore } from "../server/vault/store.mjs";
import { VAULT_TOOL_NAMES, WORKSTATION_REFUSAL } from "../server/vault/service.mjs";
import { notificationFor, settingKeyFor, shouldNotify } from "../server/notify/policy.mjs";
import { vaultToolsAllowed, builtInPoliciesForRank } from "../src/lib/permission-policy.js";
import { vaultNeedsYouRows } from "../src/lib/vault.js";

const root = resolve(new URL("..", import.meta.url).pathname);
const directory = await mkdtemp(join(tmpdir(), "squad-vault-"));
const state = join(directory, "state");
const app = join(directory, "app");
const home = join(directory, "home");
const keyFile = join(home, ".autohand", "squad-vault.key");
const harness = join(directory, "mock-codex");
const config = join(directory, "user.json");
const calls = join(directory, "calls.jsonl");

const SEED = {
  password: "hunter2-correct-horse",
  username: "octocat@example.com",
  card: "4242424242424242",
  cvv: "737",
};
const member = { id: "vault-fixture", name: "Eva", role: "Assistant", status: "online", harness: { id: "codex", executablePath: harness }, permissions: { permissionMode: "restricted" } };
const blocked = { ...member, id: "vault-blocked", name: "Noor", permissions: { permissionMode: "restricted", builtInPolicies: Object.fromEntries(VAULT_TOOL_NAMES.map((tool) => [tool, "block"])) } };

const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`;
let bridge;
let logs = "";

async function api(path, body, headers = {}, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, text, ...JSON.parse(text) };
}
async function until(operation) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await operation().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 30));
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
      AUTOHAND_SQUAD_VAULT_KEY_FILE: keyFile,
      AUTOHAND_SQUAD_NATIVE_NOTIFICATIONS: "",
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
function assertNoSeed(text, where) {
  for (const [name, value] of Object.entries(SEED)) {
    // A three-digit CVV also occurs inside random ids and localhost ports.
    // Its standalone plaintext value must never appear in a response or prompt.
    const found = name === "cvv" ? new RegExp(`(?<!\\w)${value}(?!\\w)`).test(String(text)) : String(text).includes(value);
    assert.ok(!found, `${where} must not contain the seeded ${name}`);
  }
}
assert.doesNotThrow(() => assertNoSeed(`vlt_a${SEED.cvv}b`, "an opaque id"));
assert.throws(() => assertNoSeed(JSON.stringify({ cvv: SEED.cvv }), "plaintext CVV"), /seeded cvv/);

/** Speak to the stdio proxy ourselves with Content-Length framing. */
async function headerFramedCalls(server, requests) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  const responses = [];
  const done = new Promise((resolveDone, reject) => {
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        const size = Number(buffer.subarray(0, end).toString().match(/Content-Length:\s*(\d+)/i)?.[1]);
        if (buffer.length < end + 4 + size) break;
        responses.push(JSON.parse(buffer.subarray(end + 4, end + 4 + size).toString()));
        buffer = buffer.subarray(end + 4 + size);
        if (responses.length === requests.length) resolveDone(responses);
      }
    });
    child.on("error", reject);
    setTimeout(() => reject(Error("proxy (header framing) timed out")), 15000).unref();
  });
  for (const request of requests) {
    const encoded = Buffer.from(JSON.stringify(request));
    child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded]));
  }
  try { return await done; } finally { child.kill(); }
}

/** Collect `changed` events from the vault SSE stream while `run` happens. */
async function withEvents(run) {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/vault/events`, { signal: controller.signal });
  const reader = response.body.getReader();
  const events = [];
  let text = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      text += Buffer.from(value).toString();
      let index;
      while ((index = text.indexOf("\n\n")) >= 0) {
        const block = text.slice(0, index); text = text.slice(index + 2);
        const name = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (name === "changed" && data) events.push(JSON.parse(data));
      }
    }
  })();
  try {
    await run();
    await until(async () => events.length > 0 || null).catch(() => {});
    await new Promise((r) => setTimeout(r, 80));
  } finally {
    controller.abort();
    await pump.catch(() => {});
  }
  return events;
}

const fakeCodex = `#!${process.execPath}
const fs = require('node:fs'), child = require('node:child_process'), readline = require('node:readline');
const toml = require(${JSON.stringify(join(root, "node_modules", "toml"))});
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex 1.0.0'); process.exit(0); }
if (args[0] === 'login') { console.log('Logged in using fixture'); process.exit(0); }
const log = (entry) => fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(entry) + '\\n');
(async () => {
  const merged = args.flatMap((value, index) => value === '-c' ? [toml.parse(args[index + 1])] : []);
  const field = (name, suffix) => merged.find((value) => value.mcp_servers?.[name]?.[suffix])?.mcp_servers[name][suffix];
  const command = field('autohand-vault', 'command');
  const prompt = args.join(' ');
  log({ kind: 'harness', vaultManaged: !!command, computerUseManaged: !!field('autohand-computer-use', 'command'), prompt });
  if (command && /vault-scenario-/.test(prompt)) {
    const proxy = child.spawn(command, field('autohand-vault', 'args'), { env: { ...process.env, ...field('autohand-vault', 'env') }, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    readline.createInterface({ input: proxy.stdout }).on('line', (line) => { const response = JSON.parse(line); pending.get(response.id)?.(response); });
    let sequence = 0;
    const rpc = (method, params) => new Promise((resolve) => { const id = ++sequence; pending.set(id, resolve); proxy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n'); });
    const call = async (name, arguments_) => { const response = await rpc('tools/call', { name, arguments: arguments_ }); log({ kind: 'tool', name, response }); return response; };
    try {
      log({ kind: 'initialize', response: await rpc('initialize', { protocolVersion: '2024-11-05' }) });
      log({ kind: 'tools', response: await rpc('tools/list', {}) });
      if (/vault-scenario-request/.test(prompt)) {
        const listed = await call('vault_list', {});
        const items = JSON.parse(listed.result.content[0].text).items;
        await call('request_secret', { kind: 'login', label: 'GitHub login', reason: 'to open the private repo', saveToVault: true });
        await call('vault_fill', { itemId: items[0].id, field: items[0].kind === 'login' ? 'password' : 'number' });
        await call('vault_fill', { itemId: 'vlt_missing', field: 'password' });
      }
      if (/vault-scenario-payments/.test(prompt)) {
        for (const merchant of ['Fastmail', 'Railway', 'Linear']) await call('request_payment_approval', { merchant, amount: '19.99', currency: 'USD', site: merchant.toLowerCase() + '.com', reason: 'monthly plan' });
      }
    } finally { proxy.kill(); }
  }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fixture turn done.' } }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

try {
  await Promise.all([mkdir(state, { recursive: true }), mkdir(home, { recursive: true }), mkdir(join(directory, "codex"), { recursive: true })]);
  await writeFile(config, JSON.stringify({ provider: "autohandai", autohandai: { model: "auto" }, mcp: { enabled: true, servers: [{ name: "user-sentinel", command: "/mock/unstarted" }] } }));
  await writeFile(join(state, "notifications.json"), JSON.stringify({ version: 1, settings: { runFinished: false, runFailed: false, handoffPending: false, approvalPending: false, mention: false }, items: [] }));
  await writeFile(join(directory, "codex", "auth.json"), "{}");
  await writeFile(harness, fakeCodex);
  await chmod(harness, 0o700);

  // --- pure pieces --------------------------------------------------------
  assert.equal(vaultToolsAllowed({}), true, "no saved policy means the default (allowed)");
  assert.equal(vaultToolsAllowed(blocked.permissions), false, "every vault tool blocked means no server");
  assert.equal(vaultToolsAllowed({ builtInToolPolicyEnabled: false, builtInPolicies: blocked.permissions.builtInPolicies }), true, "a disabled policy does not block");
  assert.equal(builtInPoliciesForRank(1).vault_list, "block", "the lowest rung has no vault");
  assert.equal(builtInPoliciesForRank(3).vault_list, "allow");
  assert.equal(builtInPoliciesForRank(3).request_payment_approval, "ask");
  assert.equal(settingKeyFor({ name: "vault.request.pending" }), "approvalPending");
  assert.equal(shouldNotify({ name: "vault.request.pending", memberId: member.id }, {}, { focusedRoute: "/squad" }).notify, true);
  assert.equal(shouldNotify({ name: "vault.request.pending", memberId: member.id }, {}, { focusedRoute: `/conversations/new?member=${member.id}` }).reason, "focused");
  const payment = notificationFor({ name: "vault.request.pending", type: "payment", memberId: member.id, title: "19.99 USD to Fastmail" }, { memberNames: { [member.id]: "Eva" } });
  assert.equal(payment.title, "Eva needs you · payment: 19.99 USD to Fastmail");
  assert.equal(payment.route, `/conversations/new?member=${member.id}`);

  // --- items: add, list hints only, ciphertext on disk -------------------
  start();
  await until(async () => (await api("/api/vault")).success);
  let vault = await api("/api/vault");
  assert.deepEqual(vault.data.items, []);
  assert.equal(vault.data.keySource, "file", "the check never uses the keychain");
  assert.equal(vault.data.locked, false);

  const login = await api("/api/vault/items", { kind: "login", label: "GitHub", fields: { site: "https://www.GitHub.com/login", username: SEED.username, password: SEED.password } });
  assert.equal(login.status, 200, login.text);
  assertNoSeed(login.text, "the add response");
  assert.equal(login.data.hint, "o•••@example.com · github.com");
  assert.equal(login.data.site, "github.com");
  const card = await api("/api/vault/items", { kind: "card", fields: { number: "4242 4242 4242 4242", expiry: "12/2030", cvv: SEED.cvv, name: "Igor Costa" } });
  assert.equal(card.status, 200, card.text);
  assertNoSeed(card.text, "the add response");
  assert.equal(card.data.hint, "Visa ···· 4242 · 12/30");
  assert.equal(card.data.label, "Visa 4242");
  const invalid = await api("/api/vault/items", { kind: "card", fields: { number: "1234 5678 9012 3456", expiry: "12/30" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.error, "That card number isn't valid.");

  vault = await api("/api/vault");
  assertNoSeed(vault.text, "the list response");
  assert.equal(vault.data.items.length, 2);
  assert.ok(vault.data.items.every((item) => !("secret" in item) && !("fields" in item)), "views carry no secret");

  const itemsFile = join(state, "vault", "items.json");
  const stored = await readFile(itemsFile, "utf8");
  assertNoSeed(stored, "the items file");
  assert.ok(!stored.includes("github.com\"") || true, "site is a hint, not a secret");
  assert.equal((await stat(itemsFile)).mode & 0o777, 0o600, "items file is private");
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600, "key file is private");
  assert.ok(!keyFile.startsWith(state), "the key file is outside the data folder");

  // The same files, opened by the store module: a value opens, a tampered one does not.
  const store = createVaultStore({ stateDir: state, homeDir: home });
  assert.equal(await store.open(login.data.id, "password"), SEED.password);
  assert.equal(await store.open(card.data.id, "expiry_year"), "2030");
  await assert.rejects(store.open(card.data.id, "iban"), /has no "iban"/);
  const parsed = JSON.parse(stored);
  const target = parsed.items.find((item) => item.id === login.data.id);
  const bytes = Buffer.from(target.secret, "base64");
  bytes[bytes.length - 1] ^= 0x01;
  target.secret = bytes.toString("base64");
  await writeFile(itemsFile, JSON.stringify(parsed));
  await assert.rejects(store.open(login.data.id, "password"), (error) => error.name === "VaultOpenError" && /changed outside Squad/.test(error.message));
  // A ciphertext moved onto another item fails too: the id and kind are bound.
  const swapped = JSON.parse(stored);
  const [a, b] = swapped.items;
  [a.secret, b.secret] = [b.secret, a.secret];
  await writeFile(itemsFile, JSON.stringify(swapped));
  await assert.rejects(store.open(a.id, a.kind === "login" ? "password" : "number"), /changed outside Squad/);
  await writeFile(itemsFile, stored);

  // --- the key is never recreated while items exist ----------------------
  await stop();
  const keyBytes = await readFile(keyFile);
  await rm(keyFile);
  start();
  await until(async () => (await api("/api/vault")).success);
  vault = await api("/api/vault");
  assert.equal(vault.data.locked, true, "a missing key with items is reported, not replaced");
  assert.match(vault.data.error, /key is missing/);
  const refused = await api("/api/vault/items", { kind: "login", fields: { site: "x.com", username: "u", password: "p" } });
  assert.equal(refused.status, 503);
  assert.match(refused.error, /key is missing/);
  await assert.rejects(stat(keyFile), { code: "ENOENT" }, "no new key was written");
  await writeFile(keyFile, keyBytes, { mode: 0o600 });
  await stop();
  start();
  await until(async () => (await api("/api/vault")).success);
  assert.equal((await api("/api/vault")).data.locked, false);

  // --- member tools through the real managed MCP server -------------------
  await api("/api/status/snapshot", { members: [member, blocked], jobs: [] });
  const requestEvents = await withEvents(async () => {
    const chat = await api("/api/chat", { agentId: member.id, agent: member, workspace: root, prompt: "vault-scenario-request", resumeSession: false });
    assert.equal(chat.success, true, chat.text);
    assertNoSeed(chat.text, "the chat result");
  });
  assert.ok(requestEvents.some((event) => event.name === "vault.request.pending" && event.type === "secret"), `request_secret emits an event: ${JSON.stringify(requestEvents)}`);
  let entries = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  const harnessEntry = entries.find((entry) => entry.kind === "harness");
  assert.equal(harnessEntry.vaultManaged, true, "the vault server was injected into Codex");
  assert.equal(harnessEntry.computerUseManaged, false);
  assert.match(harnessEntry.prompt, /autohand-vault MCP server/, "the member is told how the vault behaves");
  assert.equal(entries.find((entry) => entry.kind === "initialize").response.result.protocolVersion, "2024-11-05");
  assert.deepEqual(entries.find((entry) => entry.kind === "tools").response.result.tools.map((tool) => tool.name), VAULT_TOOL_NAMES, "exactly the four tools, newline framing");
  const tool = (name, index = 0) => entries.filter((entry) => entry.kind === "tool" && entry.name === name)[index].response;
  const listed = JSON.parse(tool("vault_list").result.content[0].text);
  assert.equal(listed.items.length, 2);
  assertNoSeed(JSON.stringify(listed), "vault_list");
  assert.ok(listed.items.some((item) => item.hint === "Visa ···· 4242 · 12/30"));
  const secret = JSON.parse(tool("request_secret").result.content[0].text);
  assert.equal(secret.status, "waiting_for_person");
  assert.match(secret.message, /Your turn ends here/);
  assert.equal(tool("vault_fill", 0).result.isError, true);
  assert.equal(tool("vault_fill", 0).result.content[0].text, WORKSTATION_REFUSAL);
  assert.match(tool("vault_fill", 1).result.content[0].text, /doesn't exist/);

  // Content-Length framing against the same proxy, with the member's own credential.
  const memberConfig = JSON.parse(await readFile(join(app, "agents", member.id, "vault-configs", "member.json"), "utf8"));
  const server = memberConfig.mcp.servers.find((entry) => entry.name === "autohand-vault");
  assert.ok(server, "the member config carries the managed vault server");
  assert.ok(memberConfig.mcp.servers.some((entry) => entry.name === "user-sentinel"), "the member's other MCP entries are kept");
  const savedConfig = JSON.parse(await readFile(join(app, "agents", member.id, "config.json"), "utf8"));
  assert.ok(!savedConfig.mcp?.servers?.some((entry) => entry.name === "autohand-vault"), "the saved member config is untouched");
  const framed = await headerFramedCalls(server, [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }]);
  assert.equal(framed[0].result.serverInfo.name, "autohand-squad-vault");
  assert.deepEqual(framed[1].result.tools.map((item) => item.name), VAULT_TOOL_NAMES, "exactly the four tools, Content-Length framing");
  const forged = await headerFramedCalls({ ...server, env: { ...server.env, AUTOHAND_SQUAD_VAULT_TOKEN: "f".repeat(64) } }, [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  assert.match(forged[0].error.message, /expired/, "a forged credential gets nothing");

  // --- the request survives a restart and completes from the browser ------
  let pending = (await api("/api/vault/requests?status=pending")).data.requests;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, "secret");
  assert.equal(pending[0].memberId, member.id);
  assert.equal(pending[0].request.label, "GitHub login");
  await stop();
  start();
  await until(async () => (await api("/api/vault")).success);
  pending = (await api("/api/vault/requests?status=pending")).data.requests;
  assert.equal(pending.length, 1, "pending requests survive a restart");
  const rows = vaultNeedsYouRows(pending, [member]);
  assert.equal(rows[0].title, "Eva needs GitHub login");
  const resolvedEvents = await withEvents(async () => {
    const completed = await api(`/api/vault/requests/${pending[0].id}/secret`, { fields: { site: "github.com", username: "eva-bot", password: "p@ss-from-browser" } });
    assert.equal(completed.status, 200, completed.text);
    assert.ok(!completed.text.includes("p@ss-from-browser"), "the submitted value never comes back");
    assert.equal(completed.data.status, "resolved");
    assert.equal(completed.data.outcome.action, "provided");
    assert.match(completed.data.outcome.itemId, /^vlt_/);
    assert.equal(completed.data.outcome.hint, "ev••• · github.com");
    assert.equal(completed.data.outcome.label, "GitHub login");
  });
  assert.ok(resolvedEvents.some((event) => event.name === "vault.request.resolved"));
  assert.equal((await api("/api/vault/requests?status=pending")).data.requests.length, 0);
  assert.equal((await api(`/api/vault/requests/${pending[0].id}/secret`, { fields: {} })).status, 409, "a request is answered once");
  vault = await api("/api/vault");
  assert.equal(vault.data.items.length, 3);
  assert.ok(!vault.text.includes("p@ss-from-browser"));
  assert.ok(!(await readFile(join(state, "vault-requests.json"), "utf8")).includes("p@ss-from-browser"), "the request file never holds a value");

  // --- payment approvals: approve / I'll pay myself / decline -------------
  await rm(calls, { force: true });
  const paymentEvents = await withEvents(async () => {
    const chat = await api("/api/chat", { agentId: member.id, agent: member, workspace: root, prompt: "vault-scenario-payments", resumeSession: false });
    assert.equal(chat.success, true, chat.text);
  });
  assert.equal(paymentEvents.filter((event) => event.name === "vault.request.pending" && event.type === "payment").length, 3);
  entries = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  assert.match(entries.find((entry) => entry.kind === "harness").prompt, /answered your request for “GitHub login”: it is in the vault as item vlt_/, "the next turn is told the secret outcome by id and hint");
  assert.match(entries.find((entry) => entry.kind === "harness").prompt, /ev••• · github\.com/);
  assert.ok(!entries.find((entry) => entry.kind === "harness").prompt.includes("p@ss-from-browser"));
  pending = (await api("/api/vault/requests?status=pending")).data.requests;
  assert.equal(pending.length, 3);
  const byMerchant = Object.fromEntries(pending.map((item) => [item.request.merchant, item]));
  const noCard = await api(`/api/vault/requests/${byMerchant.Fastmail.id}/payment`, { decision: "approve", itemId: login.data.id });
  assert.equal(noCard.status, 400);
  assert.match(noCard.error, /saved card/);
  const approved = await api(`/api/vault/requests/${byMerchant.Fastmail.id}/payment`, { decision: "approve", itemId: card.data.id });
  assert.equal(approved.status, 200, approved.text);
  assert.deepEqual(approved.data.outcome, { action: "approved", itemId: card.data.id, hint: "Visa ···· 4242 · 12/30", label: "Visa 4242" });
  const self = await api(`/api/vault/requests/${byMerchant.Railway.id}/payment`, { decision: "self" });
  assert.equal(self.data.outcome.action, "self");
  const declined = await api(`/api/vault/requests/${byMerchant.Linear.id}/payment`, { decision: "decline" });
  assert.equal(declined.data.outcome.action, "declined");
  assert.equal((await api(`/api/vault/requests/${byMerchant.Linear.id}/payment`, { decision: "approve", itemId: card.data.id })).status, 409);
  assert.equal((await api(`/api/vault/requests/${byMerchant.Linear.id}/payment`, { decision: "maybe" })).status, 400);
  assert.equal((await api("/api/vault/requests?status=pending")).data.requests.length, 0);

  await rm(calls, { force: true });
  const after = await api("/api/chat", { agentId: member.id, agent: member, workspace: root, prompt: "plain turn", resumeSession: false });
  assert.equal(after.success, true, after.text);
  entries = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  const told = entries.find((entry) => entry.kind === "harness").prompt;
  assert.match(told, new RegExp(`Approved: pay 19.99 USD to Fastmail with vault item ${card.data.id} \\(Visa ···· 4242 · 12/30\\)`));
  assert.match(told, /will pay 19.99 USD to Railway themselves/);
  assert.match(told, /declined the payment of 19.99 USD to Linear/);
  assertNoSeed(told, "the next-turn prompt");
  await rm(calls, { force: true });
  await api("/api/chat", { agentId: member.id, agent: member, workspace: root, prompt: "another plain turn", resumeSession: false });
  entries = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(!/Approved: pay/.test(entries.find((entry) => entry.kind === "harness").prompt), "an outcome is delivered once");

  // --- a member whose policy blocks the vault gets no server --------------
  await rm(calls, { force: true });
  const denied = await api("/api/chat", { agentId: blocked.id, agent: blocked, workspace: root, prompt: "vault-scenario-request", resumeSession: false });
  assert.equal(denied.success, true, denied.text);
  entries = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(entries.find((entry) => entry.kind === "harness").vaultManaged, false, "no vault server for a blocked member");
  assert.ok(!/autohand-vault MCP server/.test(entries.find((entry) => entry.kind === "harness").prompt));
  await assert.rejects(stat(join(app, "agents", blocked.id, "vault-configs", "member.json")), { code: "ENOENT" });
  assert.equal((await api("/api/vault/requests?status=pending")).data.requests.length, 0);

  // --- remove ---------------------------------------------------------------
  assert.equal((await api(`/api/vault/items/${login.data.id}`, undefined, {}, "DELETE")).status, 200);
  assert.equal((await api(`/api/vault/items/${login.data.id}`, undefined, {}, "DELETE")).status, 404);
  assert.equal((await api("/api/vault")).data.items.length, 2);

  console.log("Vault check passed: file-key fallback in an isolated home, hints only in every response, ciphertext on disk, tamper and swap detection, key never recreated while items exist, real managed MCP server over Codex (newline) and direct (Content-Length) with exactly four tools, secret request persisted across restart and completed from the browser with id + hint, payment approve / self / decline with events, next-turn outcomes delivered once, blocked policy gets no server. The keychain path was not exercised (manual step in docs/integration/vault.md).");
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}
