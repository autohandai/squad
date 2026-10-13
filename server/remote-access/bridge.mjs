// Telegram remote access bridge (ADR-0102, docs/integration/remote-access.md).
//
// Long-polls the Bot API from this machine, answers exactly one paired
// account, runs each inbound message as a bridge-owned turn for the chosen
// member through the same launch path the goal manager uses, and forwards
// the squad's needs-you events to the paired chat. State lives in
// <squadStateDir>/remote-access.json (mode 0600); the bot token never leaves
// the bridge.

import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import { readPersistentJson, writePersistentJson } from "../persistent-json.mjs";
import { notificationFor } from "../notify/policy.mjs";
import { BOT_COMMANDS, TelegramError, createTelegramApi, telegramApiUrl } from "./telegram-api.mjs";
import { describeStep, escapeHtml, markdownToTelegramHtml, plainText, renderStatus, splitMarkdown } from "./format.mjs";
import {
  TURN_HISTORY_LIMIT,
  displayName,
  evaluateSender,
  newPairingCode,
  normalizeNotifyMode,
  normalizeState,
  publicStatus,
  publicTurn,
  shouldNotifyFinished,
  unpaired,
} from "./pairing.mjs";

const DEFAULT_APP_URL = "http://127.0.0.1:19821";
const STATUS_EDIT_INTERVAL_MS = 1500;
const NAME_CACHE_MS = 5000;
const NOTIFY_EVENTS = ["handoff.pending", "approval.pending", "run.finished", "chat.finished", "channels.changed"];
const TOKEN_REJECTED = "Telegram rejected the bot token. Copy it again from @BotFather.";

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
  signal?.addEventListener("abort", done, { once: true });
});

function argvOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}

/** The bridge's own loopback origin, for calling its decision routes. */
export function selfOriginFromArgv() {
  const host = argvOption("--host") || "127.0.0.1";
  const port = argvOption("--port") || "19821";
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function shortKey() {
  return randomBytes(6).toString("base64url");
}

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function createRemoteAccessBridge({
  ctx,
  executeTurn = (payload, options) => ctx.goals.executeTurn(payload, options),
  now = () => Date.now(),
  pollTimeoutSeconds = Number(process.env.AUTOHAND_SQUAD_TELEGRAM_POLL_SECONDS) || 50,
  apiBaseUrl = telegramApiUrl(),
  selfOrigin = process.env.AUTOHAND_SQUAD_APP_URL || selfOriginFromArgv(),
  fetchImpl = fetch,
} = {}) {
  const statePath = join(ctx.squadStateDir, "remote-access.json");
  let state = normalizeState(null);
  let api = null;
  let poller = null; // { controller, done }
  const live = { polling: false, error: "", lastPollAt: "" };
  const activeTurns = new Map(); // memberId -> { turnId, controller }
  const picks = new Map(); // short key -> memberId, for member buttons
  const listeners = [];
  let appUrl = process.env.AUTOHAND_SQUAD_APP_URL || "";
  let writing = Promise.resolve();
  let nameCache = { at: 0, memberNames: {}, channelNames: {} };
  let ready = Promise.resolve();

  function log(severity, message, attributes = {}) {
    try { ctx.logEvent?.(severity, message, { "squad.module": "remote-access", ...attributes }); }
    catch { /* logging must never break the bridge */ }
  }
  const warn = (message, attributes) => log(ctx.SEVERITY?.WARN ?? 13, message, attributes);
  const info = (message, attributes) => log(ctx.SEVERITY?.INFO ?? 9, message, attributes);

  function save() {
    const snapshot = structuredClone({ ...state, turns: state.turns.slice(-TURN_HISTORY_LIMIT) });
    writing = writing.catch(() => {}).then(() => writePersistentJson(statePath, snapshot));
    return writing;
  }

  async function load() {
    state = normalizeState(await readPersistentJson(statePath, null));
    let changed = false;
    for (const turn of state.turns) {
      if (turn.status === "running") {
        Object.assign(turn, { status: "failed", error: "The bridge restarted during this turn. Send the message again.", finishedAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() });
        changed = true;
      }
    }
    if (changed) await save();
  }

  // ----- names and links ------------------------------------------------

  async function loadNames() {
    if (now() - nameCache.at < NAME_CACHE_MS) return nameCache;
    const memberNames = {};
    const channelNames = {};
    try {
      const status = await ctx.readOptionalJsonFile?.(join(ctx.squadStateDir, "web-status.json"));
      for (const member of status?.members || []) if (member?.id) memberNames[String(member.id)] = String(member.name || "");
    } catch { /* names are cosmetic */ }
    try {
      const channels = await ctx.readChannelsState?.();
      for (const channel of channels?.channels || []) if (channel?.id) channelNames[String(channel.id)] = String(channel.name || "");
      for (const [id, access] of Object.entries(channels?.agentChannelAccess || {})) {
        if (!memberNames[id] && access?.agent?.name && !access.removed) memberNames[id] = String(access.agent.name);
      }
    } catch { /* names are cosmetic */ }
    nameCache = { at: now(), memberNames, channelNames };
    return nameCache;
  }

  function currentAppUrl() {
    return (appUrl || selfOrigin || DEFAULT_APP_URL).replace(/\/+$/, "");
  }

  function rememberAppUrl(host) {
    const value = String(host || "").trim();
    if (value && !process.env.AUTOHAND_SQUAD_APP_URL) appUrl = `http://${value}`;
  }

  /** Members the owner can talk to: the app's roster plus launch records. */
  async function listMembers() {
    const names = await loadNames();
    let access = {};
    try { access = (await ctx.readChannelsState?.())?.agentChannelAccess || {}; } catch { access = {}; }
    const roster = new Map();
    try {
      const status = await ctx.readOptionalJsonFile?.(join(ctx.squadStateDir, "web-status.json"));
      for (const member of status?.members || []) if (member?.id) roster.set(String(member.id), { id: String(member.id), name: String(member.name || member.id), role: String(member.role || ""), status: String(member.status || "") });
    } catch { /* roster is optional */ }
    for (const [id, record] of Object.entries(access)) {
      if (record?.removed || !record?.agent) continue;
      if (!roster.has(id)) roster.set(id, { id, name: String(record.agent.name || names.memberNames[id] || id), role: String(record.agent.role || ""), status: "" });
    }
    return [...roster.values()].map((member) => ({ ...member, launchable: Boolean(access[member.id]?.agent && !access[member.id].removed) }));
  }

  async function launchFor(memberId) {
    const channels = await ctx.readChannelsState?.();
    const access = channels?.agentChannelAccess?.[memberId];
    if (!access?.agent || access.removed) return null;
    const agent = structuredClone(access.agent);
    const workspace = String(agent.workspace || agent.projects?.[0]?.path || "");
    const squadMembers = Object.entries(channels.agentChannelAccess)
      .filter(([id, record]) => id !== memberId && record?.agent && !record.removed)
      .map(([, record]) => structuredClone(record.agent));
    return { agent, workspace, profile: String(access.profile || agent.squadProfile || ""), squadMembers };
  }

  // ----- Telegram I/O ---------------------------------------------------

  async function send(chatId, html, extra = {}) {
    return api.call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
  }

  /** Send Markdown as one or more HTML messages; fall back to plain text. */
  async function say(chatId, markdown, extra = {}) {
    let last = null;
    for (const chunk of splitMarkdown(markdown)) {
      try {
        last = await send(chatId, markdownToTelegramHtml(chunk), extra);
      } catch (error) {
        if (error instanceof TelegramError && error.code === 400) {
          last = await api.call("sendMessage", { chat_id: chatId, text: plainText(chunk).slice(0, 4096), ...extra });
        } else throw error;
      }
    }
    return last;
  }

  async function edit(chatId, messageId, html, extra = {}) {
    try {
      await api.call("editMessageText", { chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
    } catch (error) {
      // "message is not modified" and deleted messages are not failures.
      if (!(error instanceof TelegramError && error.code === 400)) warn(`remote-access: edit failed: ${error.message}`);
    }
  }

  async function answerCallback(id, text = "") {
    try { await api.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 200) } : {}) }); }
    catch (error) { warn(`remote-access: answerCallbackQuery failed: ${error.message}`); }
  }

  // ----- lifecycle ------------------------------------------------------

  async function connect(token) {
    const candidate = String(token || "").trim();
    if (!candidate) throw Object.assign(new Error("Paste the bot token from @BotFather."), { status: 400 });
    const probe = createTelegramApi({ token: candidate, baseUrl: apiBaseUrl, fetchImpl });
    let me;
    try {
      me = await probe.call("getMe", {}, { timeoutMs: 15_000 });
    } catch (error) {
      const message = error instanceof TelegramError && (error.code === 401 || error.code === 404) ? TOKEN_REJECTED : `Can't reach Telegram: ${error.message}`;
      throw Object.assign(new Error(message), { status: error instanceof TelegramError && error.code ? 400 : 502 });
    }
    await stopPolling();
    const sameBot = state.bot && Number(state.bot.id) === Number(me.id);
    state = {
      ...state,
      token: candidate,
      bot: { id: Number(me.id), username: String(me.username || ""), name: String(me.first_name || me.username || "") },
      // A different bot means a different chat; the old owner cannot reach it.
      ...(sameBot ? {} : { owner: null, target: null, pairingCode: newPairingCode(), pairingFailures: 0, updateOffset: 0 }),
    };
    live.error = "";
    await save();
    startPolling();
    info(`remote-access: connected as @${state.bot.username}`);
    return status();
  }

  async function disconnect() {
    await stopPolling();
    state = { ...state, token: "", bot: null, owner: null, target: null, pairingCode: newPairingCode(), pairingFailures: 0, updateOffset: 0, decisions: {} };
    live.error = "";
    await save();
    return status();
  }

  async function unpair() {
    state = unpaired(state);
    await save();
    return status();
  }

  async function rotatePairing() {
    if (!state.owner) state = { ...state, pairingCode: newPairingCode(), pairingFailures: 0 };
    await save();
    return status();
  }

  async function setNotifyMode(mode) {
    state = { ...state, notifyMode: normalizeNotifyMode(mode) };
    await save();
    return status();
  }

  function status() {
    const running = [...activeTurns.entries()].map(([memberId, entry]) => ({ memberId, turnId: entry.turnId }));
    return publicStatus(state, { ...live, running: running[0] || null });
  }

  function turns(memberId = "") {
    return state.turns.filter((turn) => !memberId || turn.memberId === memberId).map(publicTurn);
  }

  function startPolling() {
    if (!state.token) return;
    api = createTelegramApi({ token: state.token, baseUrl: apiBaseUrl, fetchImpl });
    const controller = new AbortController();
    const done = pollLoop(controller.signal).catch((error) => { if (!controller.signal.aborted) warn(`remote-access: poll loop ended: ${error.message}`); });
    poller = { controller, done };
  }

  async function stopPolling() {
    const previous = poller;
    poller = null;
    live.polling = false;
    if (!previous) return;
    previous.controller.abort();
    await previous.done;
  }

  async function pollLoop(signal) {
    const token = state.token;
    const alive = () => !signal.aborted && state.token === token;
    await api.call("deleteWebhook", { drop_pending_updates: false }, { signal }).catch(() => {});
    await api.call("setMyCommands", { commands: BOT_COMMANDS }, { signal }).catch((error) => warn(`remote-access: setMyCommands failed: ${error.message}`));
    live.polling = true;
    while (alive()) {
      try {
        const updates = await api.call("getUpdates", { offset: state.updateOffset, timeout: pollTimeoutSeconds, allowed_updates: ["message", "callback_query"] }, { signal, timeoutMs: (pollTimeoutSeconds + 15) * 1000 });
        live.lastPollAt = new Date(now()).toISOString();
        live.error = "";
        for (const update of Array.isArray(updates) ? updates : []) {
          if (!alive()) break;
          state.updateOffset = Number(update.update_id) + 1;
          try { await handleUpdate(update); }
          catch (error) { warn(`remote-access: update failed: ${error?.stack || error}`); }
        }
        if (updates?.length) await save();
      } catch (error) {
        if (!alive()) break;
        if (error instanceof TelegramError && error.code === 401) {
          live.error = TOKEN_REJECTED;
          live.polling = false;
          warn(`remote-access: ${TOKEN_REJECTED}`);
          return;
        }
        if (error instanceof TelegramError && error.code === 409) {
          live.error = "Another program is polling this bot (another Squad, or a webhook). Only one can at a time.";
          await sleep(15_000, signal);
        } else {
          live.error = `Lost contact with Telegram: ${error.message}`;
          await sleep(error instanceof TelegramError && error.retryAfter ? error.retryAfter * 1000 : 5_000, signal);
        }
      }
    }
    live.polling = false;
  }

  // ----- inbound updates ------------------------------------------------

  async function handleUpdate(update) {
    if (update.callback_query) return handleCallback(update.callback_query);
    const message = update.message;
    if (!message?.from || message.chat?.type !== "private") return;
    const text = String(message.text || "").trim();
    const verdict = evaluateSender(state, { from: message.from, chatId: message.chat.id, text });
    if (verdict.kind !== "owner") {
      state = verdict.state;
      await save();
      if (verdict.kind === "paired") {
        info(`remote-access: paired with ${state.owner.name}`);
        await say(message.chat.id, "**Paired.** This Telegram account now controls your Squad.\n\nWrite a message to talk to a member. /members picks who, /new starts a fresh conversation, /stop interrupts, /help lists everything.");
        await sendMemberPicker(message.chat.id);
      } else {
        await say(message.chat.id, verdict.reply);
      }
      return;
    }
    if (state.owner.chatId !== Number(message.chat.id)) {
      state = { ...state, owner: { ...state.owner, chatId: Number(message.chat.id) } };
      await save();
    }
    if (!text) { await say(message.chat.id, "I can only read text messages for now."); return; }
    const command = text.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
    if (command) return handleCommand(message.chat.id, command[1].toLowerCase(), String(command[2] || "").trim());
    // A turn can run for minutes; the poll loop must keep reading so /stop
    // and the next message are seen while it runs.
    converse(message.chat.id, text).catch((error) => warn(`remote-access: turn failed: ${error?.stack || error}`));
    return undefined;
  }

  async function handleCommand(chatId, command, argument) {
    switch (command) {
      case "start":
      case "help":
        return say(chatId, helpText());
      case "members":
        return sendMemberPicker(chatId);
      case "channels":
        return sendChannels(chatId);
      case "new":
        return startFresh(chatId);
      case "stop":
        return stopTurn(chatId);
      case "status":
        return sendStatus(chatId);
      case "pair":
        return say(chatId, "Already paired. /unpair happens in Settings → Remote access on the computer.");
      default:
        return say(chatId, `Unknown command /${command}.\n\n${helpText()}`);
    }
  }

  function helpText() {
    return [
      "**Autohand Squad on Telegram**",
      "Write a message and the chosen member answers here; the conversation also appears in the app.",
      "",
      "/members — pick the member you are talking to",
      "/channels — list the squad's channels",
      "/new — start a fresh conversation",
      "/stop — stop the turn in progress",
      "/status — what Squad is running",
      "/help — this list",
    ].join("\n");
  }

  async function sendMemberPicker(chatId) {
    const members = await listMembers();
    if (!members.length) return say(chatId, "No members yet. Create one in the app, send it a message there once, and it appears here.");
    picks.clear();
    const rows = [];
    for (const member of members) {
      const key = shortKey();
      picks.set(key, member.id);
      const label = `${member.name}${member.role ? ` · ${member.role}` : ""}${member.launchable ? "" : " (open in app first)"}`.slice(0, 60);
      rows.push([{ text: label, callback_data: `use:${key}` }]);
    }
    const current = state.target ? members.find((member) => member.id === state.target.memberId) : null;
    await send(chatId, current ? `Talking to <b>${escapeHtml(current.name)}</b>. Pick another member:` : "Who do you want to talk to?", { reply_markup: { inline_keyboard: rows.slice(0, 40) } });
  }

  async function sendChannels(chatId) {
    let channels = [];
    try { channels = (await ctx.readChannelsState?.())?.channels || []; } catch { channels = []; }
    if (!channels.length) return say(chatId, "No channels yet.");
    const names = await loadNames();
    const lines = channels.slice(0, 40).map((channel) => {
      const members = (channel.memberIds || []).map((id) => names.memberNames[id] || id).filter(Boolean);
      return `• **#${channel.name}**${members.length ? ` · ${members.join(", ")}` : ""}`;
    });
    return say(chatId, lines.join("\n"));
  }

  async function startFresh(chatId) {
    const target = await currentTarget();
    if (!target) return sendMemberPicker(chatId);
    const active = activeTurns.get(target.id);
    if (active) return say(chatId, `${target.name} is still working. Send /stop first.`);
    try { await ctx.sdkSessions?.reset?.(target.id, "new conversation"); } catch (error) { warn(`remote-access: session reset failed: ${error.message}`); }
    state = { ...state, target: { memberId: target.id } };
    await save();
    return say(chatId, `Fresh conversation with **${target.name}**. The app's conversation keeps its history; the member starts from a clean context.`);
  }

  async function stopTurn(chatId) {
    const entries = [...activeTurns.entries()];
    if (!entries.length) return say(chatId, "Nothing is running.");
    for (const [, entry] of entries) entry.controller.abort(new Error("Stopped from Telegram."));
    return say(chatId, "Stopping…");
  }

  async function sendStatus(chatId) {
    const target = await currentTarget();
    const running = [...activeTurns.values()][0];
    const lines = [
      `Bot: @${state.bot?.username || "?"}${live.polling ? " · polling" : live.error ? ` · ${live.error}` : ""}`,
      target ? `Talking to: **${target.name}**` : "Talking to: nobody yet (/members)",
      running ? `Running: a turn started from here (${running.turnId.slice(0, 8)}…). /stop interrupts it.` : "Running: nothing from here",
      `Notify: ${state.notifyMode === "long" ? "long work (a minute or more)" : state.notifyMode === "all" ? "everything" : "off"} — needs-you events always notify`,
      `App: ${currentAppUrl()}`,
    ];
    return say(chatId, lines.join("\n"));
  }

  async function currentTarget() {
    if (!state.target?.memberId) return null;
    const members = await listMembers();
    return members.find((member) => member.id === state.target.memberId) || null;
  }

  async function handleCallback(query) {
    if (!state.owner || Number(query.from?.id) !== state.owner.id) return answerCallback(query.id, "This Squad is paired with another account.");
    const data = String(query.data || "");
    const chatId = query.message?.chat?.id ?? state.owner.chatId;
    const pick = data.match(/^use:(.+)$/);
    if (pick) {
      const memberId = picks.get(pick[1]);
      const members = await listMembers();
      const member = members.find((item) => item.id === memberId);
      if (!member) return answerCallback(query.id, "That member is no longer listed. Send /members again.");
      state = { ...state, target: { memberId: member.id } };
      await save();
      await answerCallback(query.id, `Talking to ${member.name}`);
      if (query.message?.message_id) await edit(chatId, query.message.message_id, `Now talking to <b>${escapeHtml(member.name)}</b>. Write a message; /new starts a fresh conversation.`);
      else await say(chatId, `Now talking to **${member.name}**.`);
      return;
    }
    const decision = data.match(/^dec:([A-Za-z0-9_-]+):(a|d)$/);
    if (decision) return handleDecision(query, decision[1], decision[2] === "a");
    return answerCallback(query.id);
  }

  // ----- turns ----------------------------------------------------------

  async function converse(chatId, text) {
    const target = await currentTarget();
    if (!target) return sendMemberPicker(chatId);
    if (activeTurns.has(target.id)) return say(chatId, `${target.name} is still working on your last message. Send /stop to interrupt it.`);
    const launch = await launchFor(target.id);
    if (!launch) return say(chatId, `Open **${target.name}** in the app and send one message there first, so Squad knows how this member runs. Then write here again.`);

    const startedAt = new Date(now()).toISOString();
    const turn = { id: randomUUID(), memberId: target.id, memberName: target.name, prompt: text.slice(0, 16_000), reply: "", status: "running", error: "", workspace: launch.workspace, startedAt, updatedAt: startedAt, finishedAt: null, durationMs: null, chatId };
    state.turns.push(turn);
    if (state.turns.length > TURN_HISTORY_LIMIT) state.turns.splice(0, state.turns.length - TURN_HISTORY_LIMIT);
    await save();

    const controller = new AbortController();
    activeTurns.set(target.id, { turnId: turn.id, controller });
    const typing = () => api.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    void typing();
    const typingTimer = setInterval(typing, 4500);

    const steps = [];
    let checklist = null;
    let statusMessageId = null;
    let lastEdit = 0;
    let pendingEdit = null;
    let editing = Promise.resolve();
    const startedMs = now();
    const flush = (done = false) => {
      pendingEdit = null;
      lastEdit = now();
      const html = renderStatus({ memberName: target.name, steps, done, elapsedMs: now() - startedMs, checklist });
      editing = editing.then(async () => {
        if (!statusMessageId) {
          const message = await send(chatId, html).catch(() => null);
          statusMessageId = message?.message_id || null;
        } else {
          await edit(chatId, statusMessageId, html);
        }
      });
      return editing;
    };
    const scheduleEdit = () => {
      if (pendingEdit) return;
      const wait = Math.max(0, STATUS_EDIT_INTERVAL_MS - (now() - lastEdit));
      pendingEdit = setTimeout(() => { void flush(false); }, wait);
    };
    const onEvent = (event, data) => {
      if (event === "sdk" && data?.type === "tool_start") { steps.push(describeStep(data)); scheduleEdit(); }
      else if (event === "sdk" && data?.type === "status" && data.label) { steps.push(String(data.label).slice(0, 90)); scheduleEdit(); }
      else if (event === "progress" && Array.isArray(data?.items)) {
        checklist = { total: data.items.length, done: data.items.filter((item) => item.status === "completed").length };
        scheduleEdit();
      }
    };

    const payload = {
      requestId: `remote-${turn.id}`,
      agentId: target.id,
      agent: launch.agent,
      squadMembers: launch.squadMembers,
      workspace: launch.workspace,
      prompt: text,
      profile: launch.profile,
      mode: "prompt",
      source: "telegram",
    };
    let result = null;
    let failure = null;
    try {
      result = await executeTurn(payload, { signal: controller.signal, onEvent });
    } catch (error) {
      failure = error;
    } finally {
      clearInterval(typingTimer);
      if (pendingEdit) clearTimeout(pendingEdit);
      activeTurns.delete(target.id);
    }

    const finishedAt = new Date(now()).toISOString();
    const stopped = controller.signal.aborted;
    const reply = String(result?.reply || "").trim();
    Object.assign(turn, {
      status: failure ? (stopped ? "stopped" : "failed") : "completed",
      reply: failure ? "" : reply,
      error: failure ? (stopped ? "Stopped from Telegram." : String(failure?.message || failure)) : "",
      finishedAt,
      updatedAt: finishedAt,
      durationMs: now() - startedMs,
    });
    await save();

    if (statusMessageId || steps.length || checklist) await flush(true);
    if (failure) {
      await say(chatId, stopped ? `Stopped ${target.name}.` : `⚠️ ${target.name} could not reply: ${failure?.message || failure}`);
      return;
    }
    if (result?.declined) {
      await say(chatId, reply || `${target.name} declined this request.`);
      return;
    }
    await say(chatId, reply || `${target.name} finished without a written reply. Open the app for the trace.`);
  }

  // ----- notifications --------------------------------------------------

  function openLink(url, label = "Open in Squad") {
    return url ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : "";
  }

  async function notify({ title, body, url, decision = null }) {
    if (!state.owner || !api) return null;
    const chatId = state.owner.chatId;
    const html = [`<b>${escapeHtml(title)}</b>`, body ? escapeHtml(body) : "", openLink(url)].filter(Boolean).join("\n");
    let extra = {};
    let key = "";
    if (decision) {
      key = shortKey();
      extra = { reply_markup: { inline_keyboard: [[{ text: "✓ Approve", callback_data: `dec:${key}:a` }, { text: "✕ Decline", callback_data: `dec:${key}:d` }]] } };
    }
    try {
      const message = await send(chatId, html, extra);
      if (decision) {
        state.decisions[key] = { ...decision, title, body, url, chatId, messageId: message?.message_id || null, at: new Date(now()).toISOString() };
        await save();
      }
      return message;
    } catch (error) {
      warn(`remote-access: notification failed: ${error.message}`);
      return null;
    }
  }

  async function onEvent(event) {
    if (!state.owner || !api) return;
    try {
      const name = String(event?.name || "");
      if (name === "channels.changed") return notifyProposals();
      const names = await loadNames();
      const copy = notificationFor(event, { appUrl: currentAppUrl(), ...names });
      if (name === "handoff.pending") return notify(copy);
      if (name === "approval.pending") return notify({ ...copy, decision: { kind: "workflow", id: String(event.runId || "") } });
      if (name === "run.finished") {
        if (String(event.status) === "stopped") return;
        const run = ctx.runs?.get?.(event.runId);
        const started = Date.parse(run?.startedAt || "");
        const finished = Date.parse(run?.finishedAt || event.at || "");
        const durationMs = Number.isFinite(started) && Number.isFinite(finished) ? finished - started : NaN;
        if (!shouldNotifyFinished({ status: event.status, durationMs, mode: state.notifyMode })) return;
        return notify(copy);
      }
      if (name === "chat.finished") {
        if (!shouldNotifyFinished({ status: event.status, durationMs: NaN, mode: state.notifyMode })) return;
        if (String(event.status) === "completed") {
          const member = names.memberNames[String(event.memberId || "")] || "A member";
          return notify({ title: `${member} replied`, body: clip(event.preview, 200), url: copy.url });
        }
        return notify(copy);
      }
    } catch (error) {
      warn(`remote-access: event handler failed: ${error.message}`, { "event.name": String(event?.name || "") });
    }
  }

  let proposalsBusy = false;
  async function notifyProposals() {
    if (proposalsBusy) return;
    proposalsBusy = true;
    try {
      const records = await ctx.agentChannelActions?.list?.();
      const names = await loadNames();
      for (const record of Array.isArray(records) ? records : []) {
        if (record?.status !== "proposed" || state.notifiedProposals.includes(record.id)) continue;
        state.notifiedProposals.push(record.id);
        if (state.notifiedProposals.length > 500) state.notifiedProposals.splice(0, state.notifiedProposals.length - 500);
        const actor = names.memberNames[record.actorId] || "A member";
        const teammates = (record.action?.memberIds || []).filter((id) => id !== record.actorId).map((id) => names.memberNames[id] || id);
        await notify({
          title: `${actor} proposes #${record.action?.name || "a channel"}`,
          body: [record.action?.purpose ? clip(record.action.purpose, 200) : "", teammates.length ? `With ${teammates.join(", ")}.` : ""].filter(Boolean).join(" ") || String(record.message || ""),
          url: `${currentAppUrl()}/mission-control`,
          decision: { kind: "proposal", id: String(record.id) },
        });
      }
      await save();
    } finally { proposalsBusy = false; }
  }

  /** Approve or decline through the bridge's own decision routes. */
  async function decide(kind, id, approve) {
    const action = approve ? "approve" : "decline";
    const path = kind === "workflow" ? `/api/workflows/${encodeURIComponent(id)}/${action}` : `/api/channel-actions/${encodeURIComponent(id)}/${action}`;
    const response = await fetchImpl(`${selfOrigin}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: "telegram" }), signal: AbortSignal.timeout(15_000) });
    const json = await response.json().catch(() => null);
    if (!json?.success) throw new Error(json?.error || `The bridge answered ${response.status}.`);
    return json.data;
  }

  async function handleDecision(query, key, approve) {
    const record = state.decisions[key];
    if (!record) return answerCallback(query.id, "This decision was already handled.");
    let outcome;
    try {
      await decide(record.kind, record.id, approve);
      outcome = approve ? "✓ Approved from Telegram" : "✕ Declined from Telegram";
      delete state.decisions[key];
    } catch (error) {
      outcome = `⚠️ ${error.message}`;
      if (/already resolved|not found|not waiting/i.test(error.message)) delete state.decisions[key];
    }
    await save();
    await answerCallback(query.id, outcome.slice(0, 200));
    const messageId = query.message?.message_id || record.messageId;
    if (messageId) {
      const html = [`<b>${escapeHtml(record.title)}</b>`, record.body ? escapeHtml(record.body) : null, "", escapeHtml(outcome), openLink(record.url) || null].filter((line) => line !== null).join("\n");
      await edit(record.chatId, messageId, html, { reply_markup: { inline_keyboard: [] } });
    }
  }

  // ----- plug-in surface ------------------------------------------------

  async function init() {
    ready = load();
    await ready;
    dispose();
    for (const eventName of NOTIFY_EVENTS) {
      const listener = (event) => { void onEvent(event); };
      ctx.events?.on?.(eventName, listener);
      listeners.push([eventName, listener]);
    }
    if (state.token) startPolling();
  }

  function dispose() {
    for (const [eventName, listener] of listeners) ctx.events?.off?.(eventName, listener);
    listeners.length = 0;
  }

  async function close() {
    dispose();
    for (const entry of activeTurns.values()) entry.controller.abort(new Error("The bridge is shutting down."));
    await stopPolling();
  }

  return { init, close, status, connect, disconnect, unpair, rotatePairing, setNotifyMode, turns, rememberAppUrl, onEvent, get state() { return state; } };
}
