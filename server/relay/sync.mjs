// Bridge-side relay client. Keeps the local channels.json in step with one
// relay workspace and stays fully inert when no relay is configured.
//
//   const sync = createRelaySync(ctx);
//   sync.connect({ url, token, workspace });   // opens the stream, pulls, pushes
//   await sync.push();                          // after channels.json changed
//   await sync.pull();                          // GET channels + messages?since=
//   await sync.sync();                          // pull, then push
//   sync.status();                              // { configured, connected, peers, lastSync, ... }
//   sync.disconnect(); sync.close();
//
// Merge rules (both directions): records are keyed by id and the newer
// `updatedAt` wins; equal timestamps keep what is already stored. Channels
// are merged before messages so a message never arrives for an unknown
// channel (the bridge's normaliser drops those). Inbound messages raise
// ctx.emit("relay.message", { workspace, channelId, messageId, message, origin })
// and channels raise "relay.channel"; presence raises "relay.presence".
//
// The WebSocket framer lives in relay/ws.mjs so the relay and the bridge share
// one implementation; the desktop bundle must ship `relay/` next to `server/`.

import { hostname } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

import { connectWebSocket } from "../../relay/ws.mjs";

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const HEARTBEAT_MS = 20_000;
const REMOTE_CACHE_LIMIT = 4000;

export function isNewer(candidate, current) {
  if (!current) return true;
  return String(candidate?.updatedAt || "") > String(current?.updatedAt || "");
}

function stampOf(record) {
  return String(record?.updatedAt || record?.createdAt || "");
}

/** Pure: merge remote channels/messages into a local channels.json state (LWW by id). */
export function mergeChannelsState(local, { channels = [], messages = [] } = {}) {
  const state = {
    ...local,
    channels: Array.isArray(local?.channels) ? [...local.channels] : [],
    threads: Array.isArray(local?.threads) ? local.threads : [],
    messages: Array.isArray(local?.messages) ? [...local.messages] : [],
  };
  const changed = { channels: [], messages: [] };
  const channelIndex = new Map(state.channels.map((channel, index) => [channel.id, index]));
  for (const channel of channels) {
    if (!channel?.id || !channel?.name) continue;
    const index = channelIndex.get(channel.id);
    const current = index === undefined ? null : state.channels[index];
    if (!isNewer(channel, current)) continue;
    const next = { ...(current || {}), ...channel };
    if (index === undefined) {
      channelIndex.set(channel.id, state.channels.length);
      state.channels.push(next);
    } else {
      state.channels[index] = next;
    }
    changed.channels.push(next);
  }
  const known = new Set(state.channels.map((channel) => channel.id));
  const messageIndex = new Map(state.messages.map((message, index) => [message.id, index]));
  for (const message of messages) {
    if (!message?.id || !message?.channelId || !known.has(message.channelId)) continue;
    const index = messageIndex.get(message.id);
    const current = index === undefined ? null : state.messages[index];
    if (!isNewer(message, current)) continue;
    const next = { ...(current || {}), ...message };
    if (index === undefined) {
      messageIndex.set(message.id, state.messages.length);
      state.messages.push(next);
    } else {
      state.messages[index] = next;
    }
    changed.messages.push(next);
  }
  return { state, changed };
}

export function normalizeRelayConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    url: String(source.url || "").trim().replace(/\/+$/, ""),
    token: String(source.token || "").trim(),
    workspace: String(source.workspace || "").trim().toLowerCase(),
    enabled: source.enabled === true,
  };
}

export function isRelayConfigured(config) {
  const normalized = normalizeRelayConfig(config);
  return Boolean(normalized.url && normalized.token && normalized.workspace);
}

function streamUrl(url, workspace) {
  const base = new URL(url);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/v1/workspaces/${encodeURIComponent(workspace)}/stream`;
  base.search = "";
  return base.toString();
}

export function createRelaySync(ctx, { log = () => {}, fetchImpl = globalThis.fetch, now = () => new Date(), heartbeatMs = HEARTBEAT_MS } = {}) {
  const cursorFile = ctx?.squadStateDir ? join(ctx.squadStateDir, "relay-sync.json") : "";
  let config = normalizeRelayConfig({});
  let connection = null;
  let connected = false;
  let wanted = false;
  let attempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let lastError = "";
  let lastSync = "";
  let cursor = "";
  let peers = [];
  let self = null;
  let queue = Promise.resolve();
  const pushedChannels = new Map(); // id -> updatedAt already on the relay
  const pushedMessages = new Map();
  const remoteMessages = new Map(); // id -> message received from the relay (reconciled on push)
  const remoteChannels = new Map();

  function emit(name, payload) {
    try {
      ctx?.emit?.(name, { workspace: config.workspace, ...payload });
    } catch {
      // Listeners must not break the sync loop.
    }
  }

  function serialized(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  function remember(map, record) {
    map.set(record.id, record);
    if (map.size > REMOTE_CACHE_LIMIT) map.delete(map.keys().next().value);
  }

  async function loadCursor() {
    if (!cursorFile) return;
    try {
      const saved = JSON.parse(await readFile(cursorFile, "utf8"));
      const entry = saved?.workspaces?.[`${config.url} ${config.workspace}`];
      cursor = String(entry?.cursor || "");
      lastSync = String(entry?.lastSync || "");
    } catch {
      cursor = "";
    }
  }

  async function saveCursor() {
    if (!cursorFile) return;
    let saved = {};
    try {
      saved = JSON.parse(await readFile(cursorFile, "utf8")) || {};
    } catch {
      saved = {};
    }
    const workspaces = saved.workspaces && typeof saved.workspaces === "object" ? saved.workspaces : {};
    workspaces[`${config.url} ${config.workspace}`] = { cursor, lastSync };
    try {
      await mkdir(ctx.squadStateDir, { recursive: true });
      await writeFile(cursorFile, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`, "utf8");
    } catch (error) {
      log(`relay cursor not saved: ${error?.message || error}`);
    }
  }

  function api(path, { method = "GET", body } = {}) {
    if (!isRelayConfigured(config)) throw new Error("relay is not configured");
    const target = `${config.url}/v1/workspaces/${encodeURIComponent(config.workspace)}${path}`;
    return fetchImpl(target, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        const error = new Error(payload?.error || `relay responded ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return payload.data;
    });
  }

  function originFor() {
    const account = ctx?.getRuntime?.()?.account || {};
    return {
      personName: String(account.name || account.email || "").trim() || undefined,
      host: hostname(),
    };
  }

  /** Write remote records into channels.json; emits relay.* for what changed. */
  function applyRemote({ channels = [], messages = [] }, { emitEvents = true } = {}) {
    return serialized(async () => {
      for (const channel of channels) if (channel?.id) remember(remoteChannels, channel);
      for (const message of messages) if (message?.id) remember(remoteMessages, message);
      const local = await ctx.readChannelsState();
      const { state, changed } = mergeChannelsState(local, { channels, messages });
      if (changed.channels.length || changed.messages.length) await ctx.writeChannelsState(state);
      // Anything we just took from the relay is, by definition, already there.
      for (const channel of channels) if (channel?.id) pushedChannels.set(channel.id, stampOf(channel));
      for (const message of messages) if (message?.id) pushedMessages.set(message.id, stampOf(message));
      for (const record of [...channels, ...messages]) if (stampOf(record) > cursor) cursor = stampOf(record);
      if (emitEvents) {
        for (const channel of changed.channels) emit("relay.channel", { channelId: channel.id, channel });
        for (const message of changed.messages) {
          emit("relay.message", { channelId: message.channelId, messageId: message.id, message, origin: message.origin || null });
        }
      }
      return changed;
    });
  }

  async function pull() {
    if (!isRelayConfigured(config)) return { channels: [], messages: [] };
    const channelsData = await api("/channels");
    const messagesData = await api(`/messages?since=${encodeURIComponent(cursor)}&limit=5000`);
    const changed = await applyRemote({ channels: channelsData?.channels || [], messages: messagesData?.messages || [] });
    lastSync = now().toISOString();
    lastError = "";
    await saveCursor();
    return changed;
  }

  async function push() {
    if (!isRelayConfigured(config)) return { channels: 0, messages: 0 };
    // Reconcile first: a full-snapshot write from the web app may have dropped
    // records that only the relay knew about. Re-merging them is idempotent.
    if (remoteChannels.size || remoteMessages.size) {
      await applyRemote({ channels: Array.from(remoteChannels.values()), messages: Array.from(remoteMessages.values()) }, { emitEvents: false });
    }
    const state = await ctx.readChannelsState();
    const channels = (state.channels || []).filter((channel) => pushedChannels.get(channel.id) !== stampOf(channel));
    const messages = (state.messages || []).filter(
      (message) => message.status !== "loading" && pushedMessages.get(message.id) !== stampOf(message)
    );
    let pushedChannelCount = 0;
    let pushedMessageCount = 0;
    if (channels.length) {
      await api("/channels", { method: "PUT", body: { channels } });
      for (const channel of channels) pushedChannels.set(channel.id, stampOf(channel));
      pushedChannelCount = channels.length;
    }
    const origin = originFor();
    for (const message of messages) {
      const outbound = message.origin ? message : { ...message, origin };
      await api(`/channels/${encodeURIComponent(message.channelId)}/messages`, { method: "POST", body: outbound });
      pushedMessages.set(message.id, stampOf(message));
      remember(remoteMessages, outbound);
      pushedMessageCount += 1;
    }
    if (pushedChannelCount || pushedMessageCount) {
      lastSync = now().toISOString();
      await saveCursor();
    }
    lastError = "";
    return { channels: pushedChannelCount, messages: pushedMessageCount };
  }

  async function sync() {
    if (!isRelayConfigured(config)) return { pulled: { channels: [], messages: [] }, pushed: { channels: 0, messages: 0 } };
    try {
      const pulled = await pull();
      const pushed = await push();
      return { pulled, pushed };
    } catch (error) {
      lastError = error?.message || String(error);
      throw error;
    }
  }

  function clearTimers() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    reconnectTimer = null;
    heartbeatTimer = null;
  }

  function scheduleReconnect() {
    if (!wanted || reconnectTimer) return;
    attempt += 1;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt - 1, 5));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
    reconnectTimer.unref?.();
  }

  function handleEvent(text) {
    let event = null;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    if (!event || typeof event !== "object") return;
    if (event.type === "hello") {
      self = event.person || null;
      peers = Array.isArray(event.people) ? event.people : [];
      emit("relay.presence", { people: peers, self });
      return;
    }
    if (event.type === "presence") {
      peers = Array.isArray(event.people) ? event.people : [];
      emit("relay.presence", { people: peers, self });
      return;
    }
    if (event.type === "message" && event.message?.id) {
      applyRemote({ messages: [event.message] }).catch((error) => log(`relay message not applied: ${error?.message || error}`));
      return;
    }
    if (event.type === "channel" && event.channel?.id) {
      applyRemote({ channels: [event.channel] }).catch((error) => log(`relay channel not applied: ${error?.message || error}`));
    }
  }

  async function open() {
    if (!wanted || connection || !isRelayConfigured(config)) return;
    try {
      const socket = await connectWebSocket(streamUrl(config.url, config.workspace), {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!wanted) {
        socket.close(1000, "disabled");
        return;
      }
      connection = socket;
      connected = true;
      attempt = 0;
      lastError = "";
      socket.on("message", handleEvent);
      socket.on("error", (error) => {
        lastError = error?.message || String(error);
      });
      socket.on("close", () => {
        if (connection === socket) connection = null;
        connected = false;
        peers = [];
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        emit("relay.presence", { people: [], self });
        scheduleReconnect();
      });
      heartbeatTimer = setInterval(() => socket.ping(), heartbeatMs);
      heartbeatTimer.unref?.();
      log(`relay connected: ${config.url} / ${config.workspace}`);
      await sync().catch((error) => log(`relay initial sync failed: ${error?.message || error}`));
    } catch (error) {
      lastError = error?.message || String(error);
      connected = false;
      if (error?.status === 401) log(`relay refused the token for ${config.url}`);
      scheduleReconnect();
    }
  }

  // Pushes are serialised against each other so two rapid writes never race.
  let pushQueue = Promise.resolve();
  function serializedPush() {
    const next = pushQueue.then(push, push);
    pushQueue = next.catch(() => {});
    return next;
  }

  function disconnect(reason = "disconnected") {
    wanted = false;
    clearTimers();
    const socket = connection;
    connection = null;
    connected = false;
    peers = [];
    if (socket) socket.close(1000, reason);
  }

  return {
    /** Start syncing with a relay. Safe to call again with new settings. */
    connect(input) {
      const next = normalizeRelayConfig({ ...input, enabled: true });
      if (!isRelayConfigured(next)) throw new Error("relay needs url, token and workspace");
      const changed = next.url !== config.url || next.token !== config.token || next.workspace !== config.workspace;
      if (changed) {
        disconnect("reconfigured");
        pushedChannels.clear();
        pushedMessages.clear();
        remoteChannels.clear();
        remoteMessages.clear();
        cursor = "";
        lastSync = "";
      }
      config = next;
      wanted = true;
      attempt = 0;
      loadCursor().finally(() => open());
      return this;
    },
    /** Apply a full config: connect when enabled and complete, otherwise disconnect. */
    configure(input) {
      const next = normalizeRelayConfig(input);
      if (next.enabled && isRelayConfigured(next)) return this.connect(next);
      config = next;
      disconnect("disabled");
      return this;
    },
    disconnect,
    push: () => serializedPush(),
    pull,
    sync,
    status() {
      return {
        configured: isRelayConfigured(config),
        enabled: wanted,
        connected,
        url: config.url,
        workspace: config.workspace,
        self,
        peers,
        lastSync,
        lastError,
        reconnectAttempt: attempt,
      };
    },
    close() {
      disconnect("closed");
    },
    _mergeChannelsState: mergeChannelsState,
  };
}
