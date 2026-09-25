// Relay route plug-in: settings, status, manual sync and a live event stream
// for the self-hosted relay (docs/integration/relay.md, ADR-0026).
//
//   GET  /api/relay/config   -> { url, workspace, enabled, hasToken, tokenHint }
//   PUT  /api/relay/config   <- { url, token?, workspace, enabled }
//                               (empty/missing token keeps the stored one; null clears it)
//   GET  /api/relay/status   -> { configured, connected, peers, lastSync, ... }
//   POST /api/relay/sync     -> pull + push now, returns status
//   GET  /api/relay/events   -> SSE: relay.message / relay.channel / relay.presence
//
// The token lives in <squadStateDir>/relay.json with mode 0600. The bridge
// pushes local changes whenever it emits "channels.changed"; the integrator
// can also import { pushRelay } and call it after writeChannelsState.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createRelaySync, isRelayConfigured, normalizeRelayConfig } from "../relay/sync.mjs";

export const name = "relay";

const RELAY_EVENTS = ["relay.message", "relay.channel", "relay.presence"];

let sync = null;
let configPath = "";
let stored = normalizeRelayConfig({});
const streams = new Set();

export function getRelaySync() {
  return sync;
}

/** Push local channel/message changes to the relay (no-op when not configured). */
export async function pushRelay() {
  if (!sync) return { channels: 0, messages: 0 };
  try {
    return await sync.push();
  } catch {
    return { channels: 0, messages: 0 };
  }
}

async function readConfig() {
  try {
    return normalizeRelayConfig(JSON.parse(await readFile(configPath, "utf8")));
  } catch {
    return normalizeRelayConfig({});
  }
}

async function writeConfig(config) {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => {});
}

function publicConfig(config) {
  return {
    url: config.url,
    workspace: config.workspace,
    enabled: config.enabled,
    hasToken: Boolean(config.token),
    tokenHint: config.token ? `…${config.token.slice(-4)}` : "",
  };
}

function statusPayload() {
  const status = sync ? sync.status() : { configured: false, enabled: false, connected: false, peers: [], lastSync: "", lastError: "" };
  return { ...status, config: publicConfig(stored) };
}

export async function init(ctx) {
  configPath = join(ctx.squadStateDir, "relay.json");
  stored = await readConfig();
  sync = createRelaySync(ctx, {
    log: (line) => ctx.logEvent?.(ctx.SEVERITY?.INFO ?? 9, line, { "relay.url": stored.url, "relay.workspace": stored.workspace }),
  });
  sync.configure(stored);
  // Bridge-side writes: server.mjs (or any route) emits "channels.changed"
  // after writeChannelsState; we push what is new.
  ctx.events.on("channels.changed", () => {
    pushRelay();
  });
  for (const eventName of RELAY_EVENTS) {
    ctx.events.on(eventName, (event) => {
      for (const stream of streams) {
        try {
          stream.send(eventName, event);
        } catch {
          streams.delete(stream);
        }
      }
    });
  }
}

export async function handle(req, res, url, ctx) {
  if (!url.pathname.startsWith("/api/relay/")) return false;

  if (url.pathname === "/api/relay/config" && req.method === "GET") {
    ctx.json(res, 200, { success: true, data: publicConfig(stored) });
    return true;
  }

  if (url.pathname === "/api/relay/config" && (req.method === "PUT" || req.method === "POST")) {
    try {
      const payload = await ctx.readBody(req);
      const token = payload.token === null ? "" : String(payload.token || "").trim() || stored.token;
      const next = normalizeRelayConfig({
        url: payload.url !== undefined ? payload.url : stored.url,
        workspace: payload.workspace !== undefined ? payload.workspace : stored.workspace,
        enabled: payload.enabled !== undefined ? payload.enabled === true : stored.enabled,
        token,
      });
      if (next.url && !/^https?:\/\//i.test(next.url)) throw new Error("relay url must start with http:// or https://");
      if (next.workspace && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(next.workspace)) {
        throw new Error("workspace must be lowercase letters, digits, dots, dashes or underscores");
      }
      if (next.enabled && !isRelayConfigured(next)) throw new Error("relay needs a url, a token and a workspace before it can be enabled");
      stored = next;
      await writeConfig(stored);
      sync.configure(stored);
      ctx.json(res, 200, { success: true, data: publicConfig(stored) });
    } catch (error) {
      ctx.json(res, 400, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/relay/status" && req.method === "GET") {
    ctx.json(res, 200, { success: true, data: statusPayload() });
    return true;
  }

  if (url.pathname === "/api/relay/sync" && req.method === "POST") {
    if (!stored.enabled || !isRelayConfigured(stored)) {
      ctx.json(res, 200, { success: true, data: { ...statusPayload(), synced: false } });
      return true;
    }
    try {
      const result = await sync.sync();
      ctx.json(res, 200, { success: true, data: { ...statusPayload(), synced: true, pulled: { channels: result.pulled.channels.length, messages: result.pulled.messages.length }, pushed: result.pushed } });
    } catch (error) {
      ctx.json(res, 502, { success: false, error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/relay/events" && req.method === "GET") {
    const stream = ctx.startEventStream(res);
    streams.add(stream);
    stream.send("relay.status", statusPayload());
    req.on("close", () => streams.delete(stream));
    return true;
  }

  return false;
}
